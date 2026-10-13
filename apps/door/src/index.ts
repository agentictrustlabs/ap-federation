// THE RECEIVING DOOR — spec 439 F2 (Ring 0 spec 410 §4.2 step 3, made live).
//
// An agent chartered in estate A arrives in front of estate B. This door is B's reference door in the federation
// (DEPLOYER.md: a production door is the estate's own edge; this one stands in front of ONE estate's A2A door and
// is honest about it). What it does, in order, every time, and the stage order of spec 339 is not changed:
//
//   1. application authentication — a principal-signed REQUEST PROOF (spec 339 §13): the presenter's own key
//      signed THIS request (method, authority, path, body digest, audience, replay id, expiry). Verified through
//      UniversalSignatureValidator on the presenter's chain (ERC-1271 / ERC-6492 / ECDSA), replay consumed
//      BEFORE the signature check. An OAuth bearer would carry a request through; it could never say a principal
//      stood behind it (admission's binding position), so this door accepts only the proof.
//   2. canonical resolution — the acting agent IS the proof's signer (CAIP-10, an account, never a name).
//   3. admission — `createAdmissionEngine` with the FOREIGN-ESTATE EVALUATOR: the presentation this request
//      carried is verified against roots READ FROM NEUTRAL GROUND now (never cached; a stale sequence is a refusal),
//      bound to the challenge THIS door issued, about THIS signer. The decision is written to a hash-chained ledger
//      and returned by reference.
//   4. forward — admitted bytes go to the estate's A2A door with the evidence in headers (`x-ap-foreign-standing`,
//      `x-ap-admission-receipt`). The estate's runtime still runs its own authority per step; this door granted
//      nothing. A refusal is a generic 403 with the receipt reference and the FEDERATION's own reason codes
//      (FOREIGN_ESTATE_*); authentication failures stay generic (their codes are a map of how to forge one).
//
//   GET  /health · GET /federation/challenge?subject=0x… · POST /federation/knock (decide, do not forward)
//   POST /a2a, /api/a2a (decide, forward) · GET /federation/receipts/<id>
import { createAdmissionEngine, foreignEstateEvaluator, verifyRequestProof, sha256Of, type AdmissionRequest, type AdmissionDecision, type AgenticRequestProofClaims, type AtomicReplayStore } from '@agenticprimitives/admission';
import { verifyAuthorityPresentation, type AuthorityPresentationV1 } from '@agenticprimitives/estate-projection';
import { createPublicClient, hashMessage, http, type Address, type Hex } from 'viem';
import { issueChallenge, verifyChallengeHeader } from './challenge';
export { DoorLedgerDO } from './ledger-do';

interface Env {
  PUBLIC_ORIGIN: string; BOUNDARY_ID: string; RECEIVING_ESTATE: string; ORIGIN_A2A: string; TARGET_AGENT_ID: string; TARGET_RUNTIME_ID: string;
  CHAIN_ID: string; REGISTRY_ADDRESS: string; UNIVERSAL_SIGNATURE_VALIDATOR: string; MAX_AGE_SECONDS: string;
  FEDERATION_RPC_URL?: string; DOOR_SECRET?: string;
  LEDGER: DurableObjectNamespace;
}

const REGISTRY_ABI = [
  { type: 'function', name: 'roots', stateMutability: 'view', inputs: [{ name: 'estateId', type: 'bytes32' }], outputs: [
    { name: 'liveGrantRoot', type: 'bytes32' }, { name: 'membershipRoot', type: 'bytes32' }, { name: 'charterHash', type: 'bytes32' },
    { name: 'sequence', type: 'uint64' }, { name: 'anchoredAt', type: 'uint64' }] },
] as const;
const VALIDATOR_ABI = [
  { type: 'function', name: 'isValidSig', stateMutability: 'view', inputs: [{ name: 'signer', type: 'address' }, { name: 'hash', type: 'bytes32' }, { name: 'sig', type: 'bytes' }], outputs: [{ type: 'bool' }] },
] as const;

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-ap-request-proof, x-ap-authority-presentation, x-ap-challenge', 'access-control-expose-headers': 'x-ap-admission-receipt, x-ap-admission-effect' };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { ...CORS, ...extra, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

const b64urlJson = <T>(s: string | null): T | null => {
  if (!s) return null;
  try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))) as T; } catch { return null; }
};
const addressOf = (caip10: string): `0x${string}` | null => (caip10.match(/^eip155:\d+:(0x[0-9a-fA-F]{40})$/)?.[1]?.toLowerCase() as `0x${string}`) ?? null;

/** The ledger DO, one per door, as the two ports the admission package asks for. */
function ledger(env: Env) {
  const stub = env.LEDGER.get(env.LEDGER.idFromName(env.BOUNDARY_ID));
  const call = async (path: string, init?: RequestInit) => { const r = await stub.fetch(new Request(`https://ledger${path}`, init)); return { status: r.status, body: await r.json() as Record<string, unknown> }; };
  const replayStore: AtomicReplayStore = {
    async consume(input) {
      const r = await call('/consume', { method: 'POST', body: JSON.stringify(input), headers: { 'content-type': 'application/json' } });
      if (r.status !== 200) throw new Error('replay store unavailable');
      return r.body.result as 'CONSUMED' | 'REPLAY' | 'CONFLICT';
    },
  };
  const audit = {
    async append(record: unknown) {
      const r = await call('/append', { method: 'POST', body: JSON.stringify(record), headers: { 'content-type': 'application/json' } });
      if (r.status !== 200) throw new Error('ledger unavailable');
      return { receiptRef: String(r.body.receiptRef), recordHash: String(r.body.recordHash) };
    },
  };
  return { replayStore, audit, receipt: (id: string) => call(`/receipt/${encodeURIComponent(id)}`), recent: () => call('/receipts') };
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface Knock {
  decision: AdmissionDecision;
  /** What the door can say publicly: the federation's own codes; never the authentication codes. */
  publicReasons: string[];
  standing: { estateId: string; set: string; sequence: number } | null;
  actingAgentId: string;
  presentationRef: string | null;
}

/** The whole pipeline for one request. Returns a Response only when the request never reached admission. */
async function admit(req: Request, env: Env, rawBody: Uint8Array): Promise<Knock | Response> {
  if (!env.FEDERATION_RPC_URL || !env.DOOR_SECRET) return json({ error: 'door_unconfigured', detail: 'FEDERATION_RPC_URL and DOOR_SECRET are secrets this deployment lacks' }, 503);
  const url = new URL(req.url);
  const chain = { id: Number(env.CHAIN_ID), name: `chain-${env.CHAIN_ID}`, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [env.FEDERATION_RPC_URL] } } } as const;
  const pub = createPublicClient({ chain, transport: http(env.FEDERATION_RPC_URL) });
  const L = ledger(env);
  const nowSec = Math.floor(Date.now() / 1000);

  // ── 1. The request proof ─────────────────────────────────────────────────────────────────────
  const proof = b64urlJson<{ claims: AgenticRequestProofClaims; signature: string }>(req.headers.get('x-ap-request-proof'));
  if (!proof?.claims || typeof proof.signature !== 'string') return json({ error: 'authentication_required', hint: 'x-ap-request-proof: base64url({ claims: AgenticRequestProofClaims, signature })' }, 401);
  const signer = addressOf(proof.claims.actingAgentId ?? '');
  if (!signer || addressOf(proof.claims.principalAgentId ?? '') === null) return json({ error: 'authentication_failed' }, 401);
  const verified = await verifyRequestProof({
    claims: proof.claims, signature: proof.signature,
    observed: { method: req.method, authority: url.host, pathAndQuery: url.pathname + url.search, rawBody },
    expectedAudience: env.PUBLIC_ORIGIN,
    // The principal's own key signed the proof digest (EIP-191 over the digest string); the universal validator
    // answers for an EOA, a deployed Smart Agent (ERC-1271) or a counterfactual one (ERC-6492) alike.
    verifySignature: async ({ keyId, digest, signature }) => (await pub.readContract({ address: env.UNIVERSAL_SIGNATURE_VALIDATOR as Address, abi: VALIDATOR_ABI, functionName: 'isValidSig', args: [keyId as Address, hashMessage(digest), signature as Hex] })) as boolean,
    keyId: signer,
    replayStore: L.replayStore, replayNamespace: env.BOUNDARY_ID,
  });
  if (!verified.ok) {
    // Logged with its precise code; answered generically (spec 339 §26.2).
    await L.audit.append({ kind: 'door.authentication', effect: 'DENY', code: verified.code, detail: verified.detail, actingAgentId: proof.claims.actingAgentId, at: new Date().toISOString() }).catch(() => undefined);
    return json({ error: 'authentication_failed' }, 401);
  }

  // ── 2. The presentation this request carried, held by the door under a reference it derives itself ──
  const pres = b64urlJson<AuthorityPresentationV1>(req.headers.get('x-ap-authority-presentation'));
  const presRef = pres ? `estate:${String(pres.estateId).toLowerCase()}:presentation:${(await sha256Of(JSON.stringify(pres))).slice(7, 39)}` : null;
  const challengeHeader = req.headers.get('x-ap-challenge');

  // ── 3. Admission ──────────────────────────────────────────────────────────────────────────────
  // The challenge is verified once, here, against the SIGNER (the subject a presentation must be about).
  const challenge = await verifyChallengeHeader(env.DOOR_SECRET, challengeHeader, signer, env.PUBLIC_ORIGIN, () => nowSec);
  const engine = createAdmissionEngine({
    boundaryId: env.BOUNDARY_ID, audit: L.audit, sign: async (digest) => `hmac-sha256:${await hmacHex(env.DOOR_SECRET!, digest)}`, grantTtlSeconds: 300,
    evaluators: [foreignEstateEvaluator({
      resolvePresentation: async (ref) => (pres && ref === presRef ? pres : null),
      readRoots: async (estateId) => {
        const r = (await pub.readContract({ address: env.REGISTRY_ADDRESS as Address, abi: REGISTRY_ABI, functionName: 'roots', args: [estateId] })) as readonly [Hex, Hex, Hex, bigint, bigint];
        return { estateId, liveGrantRoot: r[0], membershipRoot: r[1], sequence: Number(r[3]), anchoredAt: Number(r[4]) };
      },
      verify: (p, roots, expect) => verifyAuthorityPresentation(p as AuthorityPresentationV1, roots, expect),
      challengeFor: () => (challenge.ok ? { nonce: challenge.nonce, audience: challenge.audience } : null),
      maxAgeSeconds: Number(env.MAX_AGE_SECONDS) || 86400,
      now: () => nowSec,
    })],
  });
  const at = new Date(nowSec * 1000).toISOString();
  const request: AdmissionRequest = {
    schemaVersion: '1', requestId: crypto.randomUUID(), receivedAt: at, boundaryId: env.BOUNDARY_ID,
    targetAgentId: env.TARGET_AGENT_ID, targetRuntimeId: env.TARGET_RUNTIME_ID,
    actor: { principalAgentId: proof.claims.principalAgentId, actingAgentId: proof.claims.actingAgentId, runtimeId: proof.claims.runtimeId, authenticationMethods: ['AGENTIC_REQUEST_PROOF'], resolvedAt: at, cacheUntil: at, evidenceRefs: [verified.proofDigest] },
    transport: { protocol: 'HTTPS', mtls: false, assurance: 'HTTPS' },
    authentication: { requestProof: { keyId: signer, proofDigest: verified.proofDigest, replayId: proof.claims.replayId, issuedAt: new Date(proof.claims.issuedAt * 1000).toISOString(), expiresAt: new Date(proof.claims.expiresAt * 1000).toISOString(), claims: proof.claims } },
    a2a: { protocolVersion: proof.claims.a2a.protocolVersion, protocolBinding: proof.claims.a2a.protocolBinding, operation: proof.claims.a2a.operation, ...(proof.claims.a2a.requestedCapabilityId ? { requestedCapabilityId: proof.claims.a2a.requestedCapabilityId } : {}) },
    relationshipRefs: [], delegationRefs: presRef ? [presRef] : [], entitlementRefs: [],
    situation: { timestamp: at, environment: 'prod' },
  };
  const decision = await engine.evaluate(request);
  const publicReasons = decision.reasonCodes.filter((c) => c.startsWith('FOREIGN_ESTATE_') || c === 'AUDIT_SINK_UNAVAILABLE' || c === 'POLICY_DEPENDENCY_UNAVAILABLE');
  const live = decision.contributions.find((c) => c.contributorId === 'foreign-estate-presentation');
  const standing = pres && (decision.effect === 'ADMIT' || decision.effect === 'ADMIT_CONSTRAINED') && live?.reasonCodes.some((c) => c === 'FOREIGN_ESTATE_LIVE_GRANT' || c === 'FOREIGN_ESTATE_MEMBER')
    ? { estateId: String(pres.estateId).toLowerCase(), set: pres.set, sequence: pres.sequence } : null;
  return { decision, publicReasons, standing, actingAgentId: proof.claims.actingAgentId, presentationRef: presRef };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const p = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'GET' && (p === '/' || p === '/health')) return json({ ok: true, service: 'ap-federation-door', boundaryId: env.BOUNDARY_ID, receivingEstate: env.RECEIVING_ESTATE, origin: env.ORIGIN_A2A, registry: env.REGISTRY_ADDRESS, chainId: Number(env.CHAIN_ID), configured: !!(env.FEDERATION_RPC_URL && env.DOOR_SECRET), says: 'it admits on evidence read from neutral ground; it never decides what the agent may do' });
    if (req.method === 'GET' && p === '/federation/challenge') {
      const subject = (url.searchParams.get('subject') ?? '').toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(subject)) return json({ error: 'subject_required', hint: '?subject=0x… the account the presentation will be about (the proof signer)' }, 400);
      if (!env.DOOR_SECRET) return json({ error: 'door_unconfigured' }, 503);
      const c = await issueChallenge(env.DOOR_SECRET, subject as `0x${string}`, env.PUBLIC_ORIGIN);
      return json({ ...c, header: `${c.nonce}.${c.expiresAt}.${c.ticket}`, present: `projector present --estate <yours> --digest 0x… --audience ${env.PUBLIC_ORIGIN} --nonce ${c.nonce}` });
    }
    if (req.method === 'GET' && p.startsWith('/federation/receipts/')) {
      const r = await ledger(env).receipt(p.slice('/federation/receipts/'.length));
      return json(r.body, r.status);
    }
    if (req.method === 'POST' && (p === '/federation/knock' || p === '/a2a' || p === '/api/a2a')) {
      const rawBody = new Uint8Array(await req.arrayBuffer());
      const k = await admit(req, env, rawBody);
      if (k instanceof Response) return k;
      const admitted = k.decision.effect === 'ADMIT' || k.decision.effect === 'ADMIT_CONSTRAINED';
      const headers = { 'x-ap-admission-receipt': k.decision.receiptRef, 'x-ap-admission-effect': k.decision.effect };
      const summary = { effect: k.decision.effect, reasonCodes: k.publicReasons, receiptRef: k.decision.receiptRef, decisionId: k.decision.decisionId, evaluatedAt: k.decision.evaluatedAt, actingAgentId: k.actingAgentId, presentationRef: k.presentationRef, standing: k.standing, says: admitted ? 'admitted on evidence; whether anything runs is the estate\'s own mandate, verified per step' : 'refused at admission' };
      if (p === '/federation/knock') return json(summary, admitted ? 200 : 403, headers);
      if (!admitted) return json({ error: 'admission denied', ...summary }, 403, headers);
      // ── 4. Forward the exact bytes; the evidence rides in headers the origin may read and may ignore ──
      const fwd = new Headers();
      req.headers.forEach((v, h) => { if (!h.startsWith('x-ap-') && h !== 'host' && h !== 'content-length') fwd.set(h, v); });
      fwd.set('x-ap-admission-receipt', k.decision.receiptRef);
      fwd.set('x-ap-admission-boundary', env.BOUNDARY_ID);
      if (k.standing) fwd.set('x-ap-foreign-standing', `${k.standing.estateId}:${k.standing.set}@${k.standing.sequence}`);
      let origin: Response;
      // ORIGIN_A2A is the receiving agent's A2A JSON-RPC door itself (the edge-addressed form `<edge>/api/a2a/<handle>`
      // when the estate mints no per-agent hosts, spec 346 §5); the path the presenter used is this door's, not the origin's.
      try { origin = await fetch(`${env.ORIGIN_A2A}${url.search}`, { method: 'POST', headers: fwd, body: rawBody, signal: AbortSignal.timeout(30_000) }); }
      catch (e) { return json({ error: 'origin_unreachable', detail: e instanceof Error ? e.message : String(e), ...summary }, 502, headers); }
      const out = new Headers(origin.headers);
      for (const [h, v] of Object.entries({ ...CORS, ...headers })) out.set(h, v);
      return new Response(origin.body, { status: origin.status, headers: out });
    }
    return json({ error: 'not_found' }, 404);
  },
};
