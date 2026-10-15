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
//   GET  /health · POST /federation/challenge { subject } · POST /federation/knock (decide, do not forward)
//   POST /a2a, /api/a2a (decide, forward) · GET /federation/receipts (counts + codes + subject digests, no ids)
//   GET  /federation/receipts/<id> (the full record + its companions — the id is the capability; spec 442 §7.6)
//   GET  /federation/credentials — the door's `predicate` grade (spec 443 W5): its credential policy, the issuers it
//        trusts (from the register), the verifier's health. POST /federation/present { presentation } → a reference the
//        door holds for ten minutes; the knock then carries `x-ap-credential-presentation: <reference>`.
import { createAdmissionEngine, credentialPresentationEvaluator, foreignEstateEvaluator, verifyRequestProof, sha256Of, type AdmissionRequest, type AdmissionDecision, type AgenticRequestProofClaims, type AtomicReplayStore } from '@agenticprimitives/admission';
import { credentialVerify, parsePresentation, parsePresentationRef, predicateDigestOf, presentationRef, proofRequestFor, verifierChains, verifierClient, type DoorCredentialPolicy, type RegisterIssuer } from './credential';
import type { PrivatePresentationV1 } from '@agenticprimitives/privacy-credentials';
import { verifyAuthorityPresentation, type AuthorityPresentationV1 } from '@agenticprimitives/estate-projection';
import { createPublicClient, hashMessage, http, keccak256, toHex, type Address, type Hex } from 'viem';
import { issueChallenge, verifyChallengeHeader } from './challenge';
import { parse as parseYaml } from 'yaml';
import federationYaml from '../../../federation.yaml';
export { DoorLedgerDO } from './ledger-do';
export { VerifierContainer } from './verifier-container';

interface Env {
  PUBLIC_ORIGIN: string; BOUNDARY_ID: string; RECEIVING_ESTATE: string; ORIGIN_A2A: string; TARGET_AGENT_ID: string; TARGET_RUNTIME_ID: string;
  CHAIN_ID: string; REGISTRY_ADDRESS: string; UNIVERSAL_SIGNATURE_VALIDATOR: string; MAX_AGE_SECONDS: string; PROFILE_RESOLVER: string;
  FEDERATION_RPC_URL?: string; DOOR_SECRET?: string;
  /** The `predicate` grade's verifier (spec 443 W5): the Container binding OR a URL, never both; the secret it is called with. */
  VERIFIER?: DurableObjectNamespace; VERIFIER_URL?: string; VERIFIER_SECRET?: string;
  /** Any other chain's endpoint, under the name the register's town row gives it (`towns[].rpcEnv`, e.g. HOPECHAIN_RPC_URL). */
  [rpcEnv: string]: unknown;
  LEDGER: DurableObjectNamespace;
}

const REGISTRY_ABI = [
  { type: 'function', name: 'roots', stateMutability: 'view', inputs: [{ name: 'estateId', type: 'bytes32' }], outputs: [
    { name: 'liveGrantRoot', type: 'bytes32' }, { name: 'membershipRoot', type: 'bytes32' }, { name: 'charterHash', type: 'bytes32' },
    { name: 'sequence', type: 'uint64' }, { name: 'anchoredAt', type: 'uint64' }] },
] as const;
const PROFILE_RESOLVER_ABI = [
  { type: 'function', name: 'getAddressProperty', stateMutability: 'view', inputs: [{ name: 'agent', type: 'address' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'address' }] },
] as const;
const ATL_PROJECTION_SIGNER = keccak256(toHex('atl:projectionSigner'));
/** Ring 0 estate-projection `ISSUER_ROW_TAG`: the charterHash slot of a credential ISSUER's row (zkID Z3). Such a row is
 *  not an estate's, and a leaf of it is never standing — the door refuses a presentation read against one. */
const ISSUER_ROW_TAG = keccak256(toHex('ap.issuer-projection.v1'));
const SIGNER_OF_ABI = [{ type: 'function', name: 'signerOf', stateMutability: 'view', inputs: [{ name: 'estateId', type: 'bytes32' }], outputs: [{ type: 'address' }] }] as const;

/** The register, bundled as text. From it the door needs which GOVERNANCE an estate id belongs to (and on which chain
 *  that agent declares its signer), and, per TOWN, how to reach that chain and which validator answers for a signature
 *  there — because a presenter signs on the chain its account lives on, which since 2026-10-15 is not always the
 *  registry's (W4: impact-agent's people live on 34349 while its projection anchors on 34348). */
interface RegisterEstate { id: string; chainId: number; homeChainId?: number; governance: string | null; profileResolver?: string }
interface RegisterTown { id: string; chainId: number; rpcEnv?: string; universalSignatureValidator?: string; attestationRegistry?: string }
interface RegisterDoor { estate: string; url: string; credentialProofs?: DoorCredentialPolicy }
interface Register { estates: RegisterEstate[]; towns: RegisterTown[]; doors: RegisterDoor[]; issuers: RegisterIssuer[]; registry: { chainId: number; address: string; rpcEnv?: string } }
let registerCache: Register | null = null;
function register(): Register {
  if (!registerCache) {
    const raw = parseYaml(federationYaml) as { estates?: RegisterEstate[]; towns?: RegisterTown[]; doors?: RegisterDoor[]; credentials?: { issuers?: RegisterIssuer[] }; registry: Register['registry'] };
    registerCache = { estates: (raw.estates ?? []).filter((e) => !!e.governance), towns: raw.towns ?? [], doors: raw.doors ?? [], issuers: raw.credentials?.issuers ?? [], registry: raw.registry };
  }
  return registerCache;
}
function registerEstates(): RegisterEstate[] { return register().estates; }
const chainOf = (caip10: string): number | null => { const m = caip10.match(/^eip155:(\d+):0x[0-9a-fA-F]{40}$/); return m ? Number(m[1]) : null; };
/** A read client for one chain, with that chain's signature validator: the registry's own for its chain, else the town's
 *  declared endpoint and validator. `null` when this deployment cannot reach that chain — which is an answer (refuse),
 *  never a reason to verify on some other chain (ADR-0013). */
function clientFor(env: Env, chainId: number): { pub: ReturnType<typeof createPublicClient>; validator: Address } | null {
  const mk = (rpc: string) => createPublicClient({ chain: { id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } }, transport: http(rpc) });
  if (chainId === Number(env.CHAIN_ID)) return env.FEDERATION_RPC_URL ? { pub: mk(env.FEDERATION_RPC_URL), validator: env.UNIVERSAL_SIGNATURE_VALIDATOR as Address } : null;
  const town = register().towns.find((t) => t.chainId === chainId);
  const rpc = town?.rpcEnv ? String(env[town.rpcEnv] ?? '').trim() : '';
  if (!town || !rpc || !town.universalSignatureValidator) return null;
  return { pub: mk(rpc), validator: town.universalSignatureValidator as Address };
}

const VALIDATOR_ABI = [
  { type: 'function', name: 'isValidSig', stateMutability: 'view', inputs: [{ name: 'signer', type: 'address' }, { name: 'hash', type: 'bytes32' }, { name: 'sig', type: 'bytes' }], outputs: [{ type: 'bool' }] },
] as const;

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-ap-request-proof, x-ap-authority-presentation, x-ap-credential-presentation, x-ap-challenge', 'access-control-expose-headers': 'x-ap-admission-receipt, x-ap-admission-effect' };
/** This door's credential policy (`doors[].credentialProofs` in the register), keyed by the receiving estate. Absent ⇒ the door has no `predicate` grade. */
const credentialPolicyOf = (env: Env): DoorCredentialPolicy | null => register().doors.find((d) => d.estate === env.RECEIVING_ESTATE)?.credentialProofs ?? null;
const json = (body: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { ...CORS, ...extra, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

const b64urlJson = <T>(s: string | null): T | null => {
  if (!s) return null;
  try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))) as T; } catch { return null; }
};
const addressOf = (caip10: string): `0x${string}` | null => (caip10.match(/^eip155:\d+:(0x[0-9a-fA-F]{40})$/)?.[1]?.toLowerCase() as `0x${string}`) ?? null;

/** `EstateProjectionRegistry.estateIdOf`: keccak256("eip155:<chainId>:<governance>") with the address lower-cased (spec 410 §4). */
const estateIdOf = (chainId: number, governance: Address): string => keccak256(toHex(`eip155:${chainId}:${governance.toLowerCase()}`)).toLowerCase();

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
  return {
    replayStore, audit, receipt: (id: string) => call(`/receipt/${encodeURIComponent(id)}`), recent: () => call('/receipts'),
    present: (ref: string, presentation: PrivatePresentationV1, expiresAt: string) => call('/present', { method: 'POST', body: JSON.stringify({ ref, body: JSON.stringify(presentation), expiresAt }), headers: { 'content-type': 'application/json' } }),
    presentation: async (ref: string): Promise<PrivatePresentationV1 | null> => { const r = await call(`/presentation/${encodeURIComponent(ref)}`); return r.status === 200 ? (JSON.parse(String(r.body.body)) as PrivatePresentationV1) : null; },
  };
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
  /** The `predicate` grade's evidence when a credential was presented and held: never a claim value, never the person. */
  credential: { ref: string; issuerKeyId: string; predicateDigest: string; nullifierGrade: string | null; statusSequence: number | null; verifierPlacement: string | null } | null;
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
  // THE SIGNATURE IS VERIFIED ON THE SIGNER'S CHAIN — the one its CAIP-10 names, where its account lives — never on the
  // registry's because that is the chain at hand. A chain this door cannot reach is refused and logged as such.
  const signerChain = chainOf(proof.claims.actingAgentId ?? '');
  const signerSide = signerChain === null ? null : clientFor(env, signerChain);
  if (!signerSide) {
    await L.audit.append({ kind: 'door.authentication', effect: 'DENY', code: 'SIGNER_CHAIN_UNREACHABLE', detail: `no endpoint or validator for eip155:${signerChain ?? '?'}`, actingAgentId: proof.claims.actingAgentId, at: new Date().toISOString() }).catch(() => undefined);
    return json({ error: 'authentication_failed' }, 401);
  }
  const verified = await verifyRequestProof({
    claims: proof.claims, signature: proof.signature,
    observed: { method: req.method, authority: url.host, pathAndQuery: url.pathname + url.search, rawBody },
    expectedAudience: env.PUBLIC_ORIGIN,
    // The principal's own key signed the proof digest (EIP-191 over the digest string); the universal validator
    // answers for an EOA, a deployed Smart Agent (ERC-1271) or a counterfactual one (ERC-6492) alike.
    verifySignature: async ({ keyId, digest, signature }) => (await signerSide.pub.readContract({ address: signerSide.validator, abi: VALIDATOR_ABI, functionName: 'isValidSig', args: [keyId as Address, hashMessage(digest), signature as Hex] })) as boolean,
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
  // ── 2b. The CREDENTIAL presentation (spec 443 W5, the `predicate` grade): held under a reference the door derives; the proof
  // request is THE DOOR'S (its policy + its challenge); the verifier is the Node service beside this Worker. A malformed
  // header is refused here, in words; a door with no credential policy ignores the header and says so in the reasons.
  const credHeader = parsePresentationRef(req.headers.get('x-ap-credential-presentation'));
  if (credHeader && 'malformed' in credHeader) return json({ error: 'credential_presentation_malformed', hint: 'x-ap-credential-presentation: the reference POST /federation/present answered with (credential:<issuerKeyId>:presentation:<digest>)' }, 400);
  const credPolicy = credentialPolicyOf(env);
  const credRef = credHeader?.ref ?? null;
  // The bytes the door HOLDS under that reference (POSTed ahead of the knock, minutes of life) — or nothing, which the
  // evaluator refuses as CREDENTIAL_PRESENTATION_MISSING. Never fetched from the presenter.
  const held = credRef ? await L.presentation(credRef) : null;
  const cred = credHeader && held ? { issuerKeyId: credHeader.issuerKeyId, presentation: held } : null;

  // ── 3. Admission ──────────────────────────────────────────────────────────────────────────────
  // The challenge is verified once, here, against the SIGNER (the subject a presentation must be about).
  const challenge = await verifyChallengeHeader(env.DOOR_SECRET, challengeHeader, signer, env.PUBLIC_ORIGIN, () => nowSec);
  let rootsReadFromIssuerRow = false;
  // The credential's proof request: this door's policy under the challenge it issued to THIS signer. A credential
  // knock with no valid challenge has no request to be verified against — it resolves to nothing and is refused as
  // missing, which is the evaluator's word for "the door holds no request for this reference".
  const credRequest = credRef && credPolicy && challenge.ok ? proofRequestFor(credPolicy, env.PUBLIC_ORIGIN, { nonce: challenge.nonce, audience: challenge.audience }) : null;
  // The challenge nonce is single-use for a credential proof (1/OPENAC §Challenge Freshness): consumed in the ledger DO
  // before the verifier is asked, so a second proof under the same nonce never reaches it.
  if (credRequest) {
    const used = await L.replayStore.consume({ namespace: `credential-challenge:${env.PUBLIC_ORIGIN}`, replayId: challenge.ok ? challenge.nonce : '', digest: credRef!, expiresAt: new Date((nowSec + 600) * 1000).toISOString() });
    if (used !== 'CONSUMED') { await L.audit.append({ kind: 'door.credential', effect: 'DENY', code: 'CHALLENGE_REPLAYED', actingAgentId: proof.claims.actingAgentId, at: new Date().toISOString() }).catch(() => undefined); return json({ error: 'credential_challenge_replayed' }, 403); }
  }
  const verifier = credRequest ? verifierClient(env) : null;
  const credEvaluator = credRequest && verifier && !('error' in verifier)
    ? credentialPresentationEvaluator({
      resolve: async (ref) => (ref === credRef && cred ? { presentation: cred.presentation, request: credRequest } : null),
      verify: credentialVerify({ client: verifier, issuers: register().issuers, chains: verifierChains(register(), register().issuers), policy: credPolicy!, consume: async (namespace, id, digest) => L.replayStore.consume({ namespace, replayId: id, digest, expiresAt: new Date((nowSec + (credPolicy!.nullifier?.windowSeconds ?? 365 * 86400)) * 1000).toISOString() }) }),
      predicateDigestOf,
      ...(credPolicy!.nullifier ? { nullifier: credPolicy!.nullifier } : {}),
      now: () => nowSec,
    })
    : null;
  if (credRequest && verifier && 'error' in verifier) await L.audit.append({ kind: 'door.credential', effect: 'DENY', code: 'VERIFIER_UNCONFIGURED', detail: verifier.error, at: new Date().toISOString() }).catch(() => undefined);
  const engine = createAdmissionEngine({
    boundaryId: env.BOUNDARY_ID, audit: L.audit, sign: async (digest) => `hmac-sha256:${await hmacHex(env.DOOR_SECRET!, digest)}`, grantTtlSeconds: 300,
    evaluators: [...(credEvaluator ? [credEvaluator] : []), foreignEstateEvaluator({
      resolvePresentation: async (ref) => (pres && ref === presRef ? pres : null),
      readRoots: async (estateId) => {
        const r = (await pub.readContract({ address: env.REGISTRY_ADDRESS as Address, abi: REGISTRY_ABI, functionName: 'roots', args: [estateId] })) as readonly [Hex, Hex, Hex, bigint, bigint];
        // An issuer's row shares the registry and the id function with the estates'. Its liveGrantRoot slot holds a
        // credential root, so a credential leaf would verify as a "live grant" of a row that is not an estate. Read as
        // never anchored, and refused below by name.
        if (r[2].toLowerCase() === ISSUER_ROW_TAG.toLowerCase()) { rootsReadFromIssuerRow = true; return { estateId, liveGrantRoot: r[0], membershipRoot: r[1], sequence: 0, anchoredAt: 0 }; }
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
    // A credential reference rides in entitlementRefs (Ring 0 Z3's carrier). A credential presented at a door with no
    // policy, or no verifier, is cited and then refused as MISSING/UNAVAILABLE by the stages — never silently dropped.
    relationshipRefs: [], delegationRefs: presRef ? [presRef] : [], entitlementRefs: credRef ? [credRef] : [],
    situation: { timestamp: at, environment: 'prod' },
  };
  let decision = await engine.evaluate(request);
  if (rootsReadFromIssuerRow) decision = { ...decision, effect: 'DENY', reasonCodes: [...decision.reasonCodes, 'FOREIGN_ESTATE_ROW_IS_AN_ISSUER_ROW'] };
  // ── 3b. F2.5 — the cross-check that closes first-come-wins. The evaluator trusted the registry's roots for this
  // estate id; whoever REGISTERED that id controls them. So, once admitted on a presentation, read what the estate's
  // own agent declares on its own chain and compare with `signerOf`. Declared and different ⇒ the registration is
  // somebody else's ⇒ refused. Undeclared ⇒ admitted, with the gap said in the reason codes.
  if (pres && (decision.effect === 'ADMIT' || decision.effect === 'ADMIT_CONSTRAINED')) {
    const estateId = String(pres.estateId).toLowerCase();
    const row = registerEstates().find((e) => e.governance && estateIdOf(e.chainId, e.governance as Address) === estateId);
    const extra: string[] = [];
    if (!row) extra.push('FOREIGN_ESTATE_SIGNER_UNKNOWN_ESTATE');
    else {
      try {
        // The estate agent declares its signer on the chain its PROJECTION anchors on (`row.chainId`), which may not be the registry's.
        const estateSide = clientFor(env, row.chainId);
        if (!estateSide) throw new Error(`no endpoint for eip155:${row.chainId}`);
        const [registered, declared] = await Promise.all([
          pub.readContract({ address: env.REGISTRY_ADDRESS as Address, abi: SIGNER_OF_ABI, functionName: 'signerOf', args: [estateId as Hex] }) as Promise<Address>,
          estateSide.pub.readContract({ address: (row.profileResolver ?? env.PROFILE_RESOLVER) as Address, abi: PROFILE_RESOLVER_ABI, functionName: 'getAddressProperty', args: [row.governance as Address, ATL_PROJECTION_SIGNER] }) as Promise<Address>,
        ]);
        if (/^0x0{40}$/i.test(declared)) extra.push('FOREIGN_ESTATE_SIGNER_UNDECLARED');
        else if (declared.toLowerCase() !== registered.toLowerCase()) extra.push('FOREIGN_ESTATE_SIGNER_MISMATCH');
        else extra.push('FOREIGN_ESTATE_SIGNER_DECLARED');
      } catch { extra.push('FOREIGN_ESTATE_SIGNER_UNREADABLE'); }
    }
    const refuse = extra.includes('FOREIGN_ESTATE_SIGNER_MISMATCH') || extra.includes('FOREIGN_ESTATE_SIGNER_UNREADABLE');
    decision = { ...decision, effect: refuse ? 'DENY' : decision.effect, reasonCodes: [...decision.reasonCodes, ...extra] };
    if (refuse) await L.audit.append({ kind: 'door.signer-cross-check', decisionId: decision.decisionId, estateId, reasonCodes: extra, at: new Date().toISOString() }).catch(() => undefined);
  }
  // A credential cited where the door holds no evaluator for it: refused, with the reason the door can say.
  if (credRef && !credEvaluator) decision = { ...decision, effect: 'DENY', reasonCodes: [...decision.reasonCodes, !credPolicy ? 'CREDENTIAL_NOT_ACCEPTED_HERE' : !challenge.ok ? 'CREDENTIAL_CHALLENGE_INVALID' : 'CREDENTIAL_VERIFIER_UNAVAILABLE'] };
  const publicReasons = decision.reasonCodes.filter((c) => c.startsWith('FOREIGN_ESTATE_') || c.startsWith('CREDENTIAL_') || c === 'AUDIT_SINK_UNAVAILABLE' || c === 'POLICY_DEPENDENCY_UNAVAILABLE');
  const credContribution = decision.contributions.find((c) => c.contributorId === 'binding-credential-presentation');
  const credEvidence = credContribution?.evidenceRefs ?? [];
  const credential: Knock['credential'] = credRef && credContribution?.effect === 'ALLOW' && credContribution.reasonCodes.includes('CREDENTIAL_PREDICATE_HELD')
    ? {
      ref: credRef, issuerKeyId: credHeader!.issuerKeyId,
      predicateDigest: credEvidence.find((r) => /:predicate:/.test(r))?.split(':predicate:')[1] ?? '',
      nullifierGrade: credEvidence.find((r) => /:nullifier:/.test(r))?.split(':nullifier:')[1]?.split(':')[0] ?? null,
      statusSequence: Number(credEvidence.find((r) => /:status-sequence:/.test(r))?.split(':status-sequence:')[1] ?? NaN) || null,
      verifierPlacement: verifier && !('error' in verifier) ? `node:${verifier.placement}` : null,
    }
    : null;
  const live = decision.contributions.find((c) => c.contributorId === 'foreign-estate-presentation');
  const standing = pres && (decision.effect === 'ADMIT' || decision.effect === 'ADMIT_CONSTRAINED') && live?.reasonCodes.some((c) => c === 'FOREIGN_ESTATE_LIVE_GRANT' || c === 'FOREIGN_ESTATE_MEMBER')
    ? { estateId: String(pres.estateId).toLowerCase(), set: pres.set, sequence: pres.sequence } : null;
  // The predicate held, as a record of its own beside the minimized decision: the facet, the program, the nullifier grade,
  // the status sequence, where it was verified — what an auditor asks of a `predicate` admission. No claim, no person.
  if (credential) await L.audit.append({ kind: 'door.credential', decisionId: decision.decisionId, actingAgentId: proof.claims.actingAgentId, ...credential, at: new Date().toISOString() }).catch(() => undefined);
  return { decision, publicReasons, standing, actingAgentId: proof.claims.actingAgentId, presentationRef: presRef, credential };
}

/** HMAC-SHA256 under the door's secret, first 16 bytes hex: stable per visitor at THIS door, meaningless anywhere else. */
async function subjectDigest(env: Env, actingAgentId: string): Promise<string | null> {
  if (!env.DOOR_SECRET || !actingAgentId) return null;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.DOOR_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`subject:${actingAgentId.toLowerCase()}`)));
  return [...mac.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const PUBLIC_CODE = /^(FOREIGN_ESTATE_|CREDENTIAL_)/;

/** The public list: counts · codes · recent rows with a subject digest. What a stranger may learn from a door's ledger. */
async function minimizeReceipts(env: Env, rows: Array<{ record?: Record<string, unknown>; at?: string }>) {
  const byCode: Record<string, number> = {};
  const counts = { records: rows.length, decisions: 0, admitted: 0, refused: 0, authentication: 0, credential: 0 };
  const recent: Array<{ at: string | null; kind: string; effect: string | null; reasonCodes: string[]; subjectDigest: string | null }> = [];
  for (const r of rows) {
    const rec = r.record ?? {};
    const kind = String(rec.kind ?? 'unknown');
    const effect = typeof rec.effect === 'string' ? rec.effect : null;
    const codes = (Array.isArray(rec.reasonCodes) ? (rec.reasonCodes as unknown[]).map(String) : []).filter((c) => PUBLIC_CODE.test(c));
    if (kind === 'admission.decision') { counts.decisions++; if (effect && /^ADMIT/.test(effect)) counts.admitted++; else counts.refused++; for (const c of codes) byCode[c] = (byCode[c] ?? 0) + 1; }
    else if (kind === 'door.authentication') counts.authentication++;
    else if (kind === 'door.credential') counts.credential++;
    recent.push({ at: r.at ?? null, kind, effect, reasonCodes: codes, subjectDigest: await subjectDigest(env, String(rec.actingAgentId ?? '')) });
  }
  return { boundaryId: env.BOUNDARY_ID, window: 50, counts, byCode, recent, says: 'counts and decision codes; a subject digest tells the same visitor from another and names nobody; the full receipt is read by its id, which only the presenter and the receiving estate hold' };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const p = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'GET' && (p === '/' || p === '/health')) return json({ ok: true, service: 'ap-federation-door', boundaryId: env.BOUNDARY_ID, receivingEstate: env.RECEIVING_ESTATE, origin: env.ORIGIN_A2A, registry: env.REGISTRY_ADDRESS, chainId: Number(env.CHAIN_ID), configured: !!(env.FEDERATION_RPC_URL && env.DOOR_SECRET), says: 'it admits on evidence read from neutral ground; it never decides what the agent may do' });
    if (p === '/federation/challenge') {
      // THE SUBJECT NEVER RIDES IN A URL (spec 442 §7.6, finding P4): a query string lands in logs, referers and caches —
      // the placement ban of spec 338 §4. The subject comes in the body; a GET is refused with the reason, never served.
      if (req.method !== 'POST') return json({ error: 'method_not_allowed', hint: 'POST /federation/challenge { "subject": "0x…" } — the account the presentation will be about (the proof signer); a subject is never put in a URL' }, 405, { allow: 'POST' });
      let body: { subject?: unknown } = {};
      try { body = (await req.json()) as { subject?: unknown }; } catch { return json({ error: 'not_json', hint: '{ "subject": "0x…" }' }, 400); }
      const subject = String(body.subject ?? '').toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(subject)) return json({ error: 'subject_required', hint: '{ "subject": "0x…" } — the account the presentation will be about (the proof signer)' }, 400);
      if (!env.DOOR_SECRET) return json({ error: 'door_unconfigured' }, 503);
      const c = await issueChallenge(env.DOOR_SECRET, subject as `0x${string}`, env.PUBLIC_ORIGIN);
      // The subject is not echoed: the presenter knows whom it asked for.
      return json({ nonce: c.nonce, audience: c.audience, expiresAt: c.expiresAt, ticket: c.ticket, header: `${c.nonce}.${c.expiresAt}.${c.ticket}`, present: `projector present --estate <yours> --digest 0x… --audience ${env.PUBLIC_ORIGIN} --nonce ${c.nonce}` });
    }
    if (req.method === 'GET' && p === '/federation/credentials') {
      // THE `predicate` GRADE, declared: what this door asks a credential to prove, which issuer facets it trusts (from
      // the register, attested on their chains), where the proof is verified and whether that verifier answers now.
      const policy = credentialPolicyOf(env);
      const v = policy ? verifierClient(env) : null;
      const health = v && !('error' in v) ? await v.health() : null;
      return json({
        boundaryId: env.BOUNDARY_ID, receivingEstate: env.RECEIVING_ESTATE, audience: env.PUBLIC_ORIGIN,
        accepts: !!policy, policy,
        predicateDigest: policy ? predicateDigestOf(proofRequestFor(policy, env.PUBLIC_ORIGIN, { nonce: '0x00', audience: env.PUBLIC_ORIGIN })) : null,
        issuers: register().issuers.map((i) => ({ id: i.id, estate: i.estate, sa: i.sa, chainId: i.chainId, facets: (i.facets ?? []).map((f) => ({ keyId: f.keyId, attestation: f.attestation ?? null, thumbprint: f.document?.facet ? (f.document.facet as { publicKeyJwk?: { kid?: string } }).publicKeyJwk?.kid ?? null : null })) })),
        verifier: v ? ('error' in v ? { configured: false, error: v.error } : { configured: true, placement: `node:${v.placement}`, ...health }) : { configured: false, error: 'this door has no credential policy' },
        challenge: `POST /federation/challenge { subject: <the pairwise account> }; POST /federation/present { presentation } → ref; then knock with x-ap-request-proof (signed by it), x-ap-challenge and x-ap-credential-presentation: <ref>`,
        says: 'A predicate held is evidence about a credential, never a claim about a person and never authority: the estate\'s own mandate still governs every act.',
      }, 200, { 'cache-control': 'public, max-age=30' });
    }
    if (req.method === 'POST' && p === '/federation/present') {
      // THE PRESENTATION, AHEAD OF THE KNOCK. Held under the reference the door derives, for ten minutes; the knock cites
      // it in a header the edge will carry. Nothing is verified here — a presentation nobody knocks with expires unread.
      const raw = await req.text();
      if (raw.length > 1_000_000) return json({ error: 'too_large' }, 413);
      let o: unknown; try { o = JSON.parse(raw); } catch { return json({ error: 'not_json' }, 400); }
      const parsed = parsePresentation(o);
      if (!parsed.ok) return json({ error: 'credential_presentation_malformed', hint: parsed.code === 'suite' ? 'this door verifies openac-sd-jwt-p256 only' : '{ presentation: PrivatePresentationV1 } with an openac payload naming issuerKeyId' }, 400);
      const ref = await presentationRef(parsed.issuerKeyId, parsed.presentation);
      const expiresAt = new Date(Date.now() + 600_000).toISOString();
      const r = await ledger(env).present(ref, parsed.presentation, expiresAt);
      if (r.status !== 200) return json({ error: 'ledger_unavailable' }, 503);
      return json({ ref, expiresAt, knock: `x-ap-credential-presentation: ${ref}`, says: 'held, not verified: the knock that cites it is where the proof is checked' });
    }
    if (req.method === 'GET' && p === '/federation/receipts') {
      // THE PUBLIC FACE OF THE LEDGER CARRIES NO SUBJECT (spec 442 §7.6, finding P4): counts, decision codes, and a
      // subjectDigest (HMAC under the door's secret) so a reader can tell "the same visitor again" from "another one" and
      // nothing else. No receipt ids (the id is the capability to read the full record), no acting account, no bodies.
      const r = await ledger(env).recent();
      if (r.status !== 200) return json(r.body, r.status);
      return json(await minimizeReceipts(env, (r.body as { receipts?: Array<{ record?: Record<string, unknown>; at?: string }> }).receipts ?? []), 200, { 'cache-control': 'public, max-age=10' });
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
      const summary = { effect: k.decision.effect, reasonCodes: k.publicReasons, receiptRef: k.decision.receiptRef, decisionId: k.decision.decisionId, evaluatedAt: k.decision.evaluatedAt, actingAgentId: k.actingAgentId, presentationRef: k.presentationRef, standing: k.standing, credential: k.credential, says: admitted ? 'admitted on evidence; whether anything runs is the estate\'s own mandate, verified per step' : 'refused at admission' };
      if (p === '/federation/knock') return json(summary, admitted ? 200 : 403, headers);
      if (!admitted) return json({ error: 'admission denied', ...summary }, 403, headers);
      // ── 4. Forward the exact bytes; the evidence rides in headers the origin may read and may ignore ──
      const fwd = new Headers();
      req.headers.forEach((v, h) => { if (!h.startsWith('x-ap-') && h !== 'host' && h !== 'content-length') fwd.set(h, v); });
      fwd.set('x-ap-admission-receipt', k.decision.receiptRef);
      fwd.set('x-ap-admission-boundary', env.BOUNDARY_ID);
      if (k.standing) fwd.set('x-ap-foreign-standing', `${k.standing.estateId}:${k.standing.set}@${k.standing.sequence}`);
      // The predicate held, as evidence the origin may read: which facet, which program, at which status sequence. No claim.
      if (k.credential) fwd.set('x-ap-credential-predicate', `${k.credential.issuerKeyId}:${k.credential.predicateDigest}@${k.credential.statusSequence ?? '-'}`);
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
