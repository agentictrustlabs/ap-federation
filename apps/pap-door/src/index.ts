// A PAP COMPANY'S DOOR in front of ONE service agent — spec 443 §1.2 / W2 (Ring 0 spec 442 §5, §7.3, §7.6, §9).
//
//   GET  /.well-known/poppy.json                   the company-door profile projected to PAP; 404 for listing: none
//   GET  /.well-known/oauth-authorization-server   RFC 8414; the issuer is this origin
//   POST /oauth/token                              jwt-bearer sessions for a FOREIGN client_id (its metadata document + JWKS
//                                                   fetched and checked, RFC 7523 client + session assertions, DPoP, jti replay);
//                                                   device_code and refresh_token grants; errors as PAP 4.2 names them
//   POST /oauth/device · POST /oauth/device/approve device sign-in: the person approves by SIGNING the user code with her own
//                                                   agent (persona-sign at her Home) — validated through ERC-1271; no password
//   POST /oauth/revoke                              the Account Token revoked; sessions signed out
//   POST /api/orders/exchange                       the company's API: proposes an operation (HTTP 202, PAP Operations 4.1)
//   GET/POST /poppy/operations/:id[/confirm|/cancel] the Operations extension. A confirm RECORDS the presenter's approved_by as its
//                                                   claim and FORWARDS the act to the company agent's own A2A door as the door's
//                                                   service agent — the act parks there for the owner's mandate; in_progress until
//   GET  /federation/receipts · /receipts/:id       counts + subject digests; the full receipt by its unguessable id
// OAuth is the ingress envelope, never the authority (ADR-0041): a session token admits a request to be heard; nothing in
// approved_by, scope or sign-in grants an act. The authority decision is the company agent's own harness, under the owner's
// mandate, per step.
import { companyDoorProfile } from '@agenticprimitives/registry-kit';
import { sessionWireSigner, type DelegationWireV1 } from '@agenticprimitives/a2a/standard';
import { requestProofDigest, sha256Of, type AgenticRequestProofClaims } from '@agenticprimitives/admission';
import { createPublicClient, http, parseAbi, keccak256, toBytes, type Address, type Hex } from 'viem';
import { keyServiceAccount, type KeyServiceAccount } from '@ap-federation/key-service-account';
import type { AccountTokenRow, DeviceRow, OperationRow, SessionRow } from './do.js';
export { PapDoorDO } from './do.js';

interface Env {
  PUBLIC_ORIGIN: string; COMPANY_NAME: string; COMPANY_AGENT: string; COMPANY_A2A: string; COMPANY_HOMEPAGE: string; DOOR_AGENT: string; LISTING: string; CHAIN_ID: string; UNIVERSAL_SIGNATURE_VALIDATOR: string;
  DOOR_SECRET?: string; FEDERATION_RPC_URL?: string; LEDGER: DurableObjectNamespace;
  /** THE DOOR'S SIGNER IS A DELEGATE (the service-agent-signing rule). Its service agent is custodied by a PERSON (the
   *  company's steward), never by this Worker; the steward signed a session wire `door agent → this key-service key`, pinned
   *  to the company door's one skill and time-bounded, and the Worker holds that wire and a caller token for the key. */
  AKCS_BASE_URL?: string; AKCS_TENANT?: string; DOOR_KEY_ID?: string; AKCS_TOKEN?: string;
  /** `{ type: 'ap.door-session-wire.v1', wire, digest, validUntil }`, as `issue-door-session-wire.mts` wrote it. */
  DOOR_SESSION_WIRE?: string;
  /** Tests inject a fetch for the client's documents and the company agent's door. */
  __fetch?: typeof fetch;
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization, dpop' };
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS, ...headers } });
const oauthError = (error: string, status: number, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) => json({ error, ...extra }, status, headers);
const enc = new TextEncoder();
const b64urlDecode = (s: string): Uint8Array => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=')), (c) => c.charCodeAt(0));
const b64url = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decJson = (s: string): Record<string, unknown> => JSON.parse(new TextDecoder().decode(b64urlDecode(s))) as Record<string, unknown>;
const rid = (p: string) => { const b = new Uint8Array(16); crypto.getRandomValues(b); return `${p}_${b64url(b)}`; };
/** A device user code, XXXX-XXXX, from 32 letters and digits with no look-alikes (no 0/O, 1/I); 32 divides 256, so unbiased. */
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const userCode = () => { const b = new Uint8Array(8); crypto.getRandomValues(b); const c = [...b].map((x) => USER_CODE_ALPHABET[x % 32]).join(''); return `${c.slice(0, 4)}-${c.slice(4)}`; };
const ledger = (env: Env) => { const stub = env.LEDGER.get(env.LEDGER.idFromName('door')); return async (op: string, body: unknown = {}) => (await (await stub.fetch(`https://ledger/${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()) as Record<string, unknown>; };
const f = (env: Env) => env.__fetch ?? fetch;

// ─── JWS (ES256 via WebCrypto) ───────────────────────────────────────────────────────────────────────
async function verifyJws(jws: string, jwk: JsonWebKey): Promise<{ header: Record<string, unknown>; payload: Record<string, unknown> } | null> {
  const [h, p, s] = jws.split('.'); if (!h || !p || !s) return null;
  let header: Record<string, unknown>; try { header = decJson(h); } catch { return null; }
  if (header.alg !== 'ES256') return null;
  try {
    const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64urlDecode(s) as unknown as ArrayBuffer, enc.encode(`${h}.${p}`) as unknown as ArrayBuffer);
    return ok ? { header, payload: decJson(p) } : null;
  } catch { return null; }
}
async function jwkThumbprint(jwk: JsonWebKey): Promise<string> { return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }))))); }

// ─── the foreign client: its metadata document and keys, checked as PAP 4.1 says ────────────────────
interface ClientDoc { client_id: string; client_name?: string; jwks_uri: string; redirect_uris?: string[]; token_endpoint_auth_method?: string; extensions?: Record<string, unknown> }
async function clientKeys(env: Env, clientId: string): Promise<{ doc: ClientDoc; keys: JsonWebKey[] } | { error: 'invalid_client'; detail: string }> {
  if (!/^https:\/\//.test(clientId)) return { error: 'invalid_client', detail: 'client_id must be an https URL' };
  let doc: ClientDoc;
  try { const r = await f(env)(clientId, { headers: { accept: 'application/json' } }); if (!r.ok) return { error: 'invalid_client', detail: `metadata HTTP ${r.status}` }; doc = (await r.json()) as ClientDoc; } catch (e) { return { error: 'invalid_client', detail: (e as Error).message }; }
  if (doc.client_id !== clientId) return { error: 'invalid_client', detail: 'client_id in the document differs from the URL it was fetched from' };
  const host = new URL(clientId).host;
  if (!doc.jwks_uri || new URL(doc.jwks_uri).host !== host) return { error: 'invalid_client', detail: 'jwks_uri must be on the client_id domain' };
  for (const u of doc.redirect_uris ?? []) if (new URL(u).host !== host) return { error: 'invalid_client', detail: 'redirect_uris must be on the client_id domain' };
  if (/\/(agents|people|persons|members|u)\/[^/]+\//i.test(clientId)) return { error: 'invalid_client', detail: 'a per-person client_id is refused at this door (spec 442 §7.1)' };
  let keys: JsonWebKey[];
  try { const r = await f(env)(doc.jwks_uri, { headers: { accept: 'application/json' } }); keys = ((await r.json()) as { keys?: JsonWebKey[] }).keys ?? []; } catch { return { error: 'invalid_client', detail: 'jwks unreachable' }; }
  if (keys.some((k) => (k as { d?: string }).d)) return { error: 'invalid_client', detail: 'the key set contains a private key' };
  return { doc, keys };
}

async function verifyAssertion(env: Env, L: ReturnType<typeof ledger>, jws: string, keys: JsonWebKey[], expect: { iss: string; aud: string; sub?: string }, ns: string, now: number): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; error: 'invalid_client' | 'invalid_grant'; detail: string }> {
  const [h] = jws.split('.'); let kid: string | undefined; try { kid = decJson(h!).kid as string | undefined; } catch { /* no header */ }
  const candidates = kid ? keys.filter((k) => (k as { kid?: string }).kid === kid) : keys;
  let v: Awaited<ReturnType<typeof verifyJws>> = null;
  for (const k of candidates) { v = await verifyJws(jws, k); if (v) break; }
  const err = ns === 'client' ? 'invalid_client' as const : 'invalid_grant' as const;
  if (!v) return { ok: false, error: err, detail: 'signature does not verify against the client\'s keys' };
  const p = v.payload;
  if (p.iss !== expect.iss) return { ok: false, error: err, detail: 'iss is not the authenticated client_id' };
  if (expect.sub !== undefined && p.sub !== expect.sub) return { ok: false, error: err, detail: 'sub mismatch' };
  if (p.aud !== expect.aud) return { ok: false, error: err, detail: 'aud is not this token endpoint' };
  if (typeof p.exp !== 'number' || p.exp < now || (typeof p.iat === 'number' && p.iat > now + 60)) return { ok: false, error: err, detail: 'expired or not yet valid' };
  if (typeof p.jti !== 'string' || p.jti.length < 16) return { ok: false, error: err, detail: 'jti required (≥128 bits)' };
  const c = await L('jti.consume', { ns, jti: p.jti, expiresAt: p.exp });
  if (c.result === 'REPLAY') return { ok: false, error: err, detail: 'jti reused' };
  return { ok: true, payload: p };
}

/** RFC 9449 §4.3, as PAP 4.3 narrows it: one header, typ dpop+jwt, ES256, public jwk, htm/htu, iat window, jti, ath when a token rides. */
async function verifyDpop(L: ReturnType<typeof ledger>, req: Request, url: string, now: number, accessToken?: string): Promise<{ ok: true; jkt: string } | { ok: false; error: 'invalid_dpop_proof'; detail: string }> {
  const proofs = req.headers.get('DPoP'); if (!proofs || proofs.includes(',')) return { ok: false, error: 'invalid_dpop_proof', detail: 'exactly one DPoP header' };
  const [h] = proofs.split('.'); let header: { typ?: string; alg?: string; jwk?: JsonWebKey & { d?: string } }; try { header = decJson(h!) as typeof header; } catch { return { ok: false, error: 'invalid_dpop_proof', detail: 'malformed' }; }
  if (header.typ !== 'dpop+jwt' || header.alg !== 'ES256' || !header.jwk || header.jwk.d) return { ok: false, error: 'invalid_dpop_proof', detail: 'typ/alg/jwk' };
  const v = await verifyJws(proofs, header.jwk); if (!v) return { ok: false, error: 'invalid_dpop_proof', detail: 'signature' };
  const u = new URL(url); u.search = ''; u.hash = '';
  if (v.payload.htm !== req.method.toUpperCase() || v.payload.htu !== u.toString()) return { ok: false, error: 'invalid_dpop_proof', detail: 'htm/htu' };
  if (typeof v.payload.iat !== 'number' || Math.abs(v.payload.iat - now) > 60) return { ok: false, error: 'invalid_dpop_proof', detail: 'iat outside the window' };
  if (typeof v.payload.jti !== 'string') return { ok: false, error: 'invalid_dpop_proof', detail: 'jti' };
  if (accessToken) { const ath = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(accessToken)))); if (v.payload.ath !== ath) return { ok: false, error: 'invalid_dpop_proof', detail: 'ath' }; }
  else { const c = await L('jti.consume', { ns: 'dpop', jti: v.payload.jti, expiresAt: now + 120 }); if (c.result === 'REPLAY') return { ok: false, error: 'invalid_dpop_proof', detail: 'jti reused at the token endpoint' }; }
  return { ok: true, jkt: await jwkThumbprint(header.jwk) };
}

// ─── the session behind a request ───────────────────────────────────────────────────────────────────
async function sessionOf(env: Env, L: ReturnType<typeof ledger>, req: Request, url: string, now: number): Promise<{ ok: true; session: SessionRow } | { ok: false; response: Response }> {
  const m = /^DPoP (.+)$/i.exec(req.headers.get('authorization') ?? '');
  const unauthorized = (error: string) => ({ ok: false as const, response: json({ error }, 401, { 'WWW-Authenticate': `DPoP error="${error}"` }) });
  if (!m) return unauthorized('invalid_token');
  const s = (await L('session.byToken', { token: m[1] })).session as SessionRow | null;
  if (!s || s.expiresAt < now) return unauthorized('invalid_token');
  const d = await verifyDpop(L, req, url, now, m[1]);
  if (!d.ok) return unauthorized('invalid_dpop_proof');
  if (d.jkt !== s.jkt) return unauthorized('invalid_token');
  return { ok: true, session: s };
}

async function subjectDigest(env: Env, s: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.DOOR_SECRET ?? 'unconfigured'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`subject:${s}`))).slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function receipt(env: Env, L: ReturnType<typeof ledger>, record: Record<string, unknown>): Promise<string> {
  const r = await L('receipt.append', { record: { ...record, boundaryId: `pap-door:${new URL(env.PUBLIC_ORIGIN).host}` } });
  return String(r.receiptRef ?? '');
}

// ─── the company agent's door: the act parks THERE, under the owner's mandate ────────────────────────
/** The steward's wire and the key it names, or null when this door has none (an act then waits, said). */
interface DoorSessionWireV1 { type: 'ap.door-session-wire.v1'; wire: DelegationWireV1; digest: Hex; validUntil: number }
const doorConfigured = (env: Env) => !!(env.AKCS_TOKEN && env.AKCS_TENANT && env.DOOR_KEY_ID && env.DOOR_SESSION_WIRE);
async function doorSigner(env: Env): Promise<{ key: KeyServiceAccount; wire: DoorSessionWireV1 }> {
  const wire = JSON.parse(env.DOOR_SESSION_WIRE!) as DoorSessionWireV1;
  const key = await keyServiceAccount({ tenant: env.AKCS_TENANT!, keyId: env.DOOR_KEY_ID! }, { token: env.AKCS_TOKEN!, ...(env.AKCS_BASE_URL ? { baseUrl: env.AKCS_BASE_URL } : {}), ...(env.__fetch ? { fetch: env.__fetch } : {}) });
  // The wire must be the door agent's, to THIS key — a mismatch is a deployment mistake, refused before anything is sent.
  if (wire.wire.delegator.toLowerCase() !== env.DOOR_AGENT.toLowerCase()) throw new Error(`the session wire is ${wire.wire.delegator}'s, not the door agent ${env.DOOR_AGENT}'s`);
  if (wire.wire.delegate.toLowerCase() !== key.address.toLowerCase()) throw new Error(`the session wire names ${wire.wire.delegate} and the key service's key is ${key.address}`);
  return { key, wire };
}

/** The two things the company agent's edge asks of an agent that knocks: a signed REQUEST PROOF (spec 339 §13 — this exact
 *  request, this audience, single use) and the A2A-Session CALLER ASSERTION (spec 372 S3c). Both are signed by the door's
 *  key-service key, AS the door agent: the assertion's signature is session-wrapped (`0x51`) with the steward's wire, so the
 *  company agent verifies the wire against the door agent (ERC-1271), its pin, its window and its revocation — and the
 *  request proof names the key and the wire it acts under. */
async function knockHeaders(env: Env, method: string, body: string): Promise<Record<string, string>> {
  const { key, wire } = await doorSigner(env);
  const u = new URL(env.COMPANY_A2A); const now = Math.floor(Date.now() / 1000); const agent = env.DOOR_AGENT.toLowerCase() as Address;
  const claims: AgenticRequestProofClaims = { schemaVersion: '1', principalAgentId: `eip155:${env.CHAIN_ID}:${agent}`, actingAgentId: `eip155:${env.CHAIN_ID}:${agent}`, runtimeId: `urn:ap:runtime:ap-federation:pap-door:${new URL(env.PUBLIC_ORIGIN).host}`, sessionKeyId: key.address.toLowerCase(), delegationRefs: [wire.digest], audience: u.origin, issuedAt: now, expiresAt: now + 120, replayId: crypto.randomUUID(), http: { method: 'POST', authority: u.host, pathAndQuery: u.pathname + u.search, bodySha256: await sha256Of(body) }, a2a: { protocolVersion: '1.0', protocolBinding: 'HTTP+JSON', operation: method } };
  const proofSig = await key.signMessage({ message: await requestProofDigest(claims) });
  const assertion = await sessionWireSigner({ agent, wire: wire.wire, signDigest: (d) => key.sign({ hash: d }), audience: u.origin })(body, method);
  return { 'content-type': 'application/json', ...assertion, 'x-ap-request-proof': b64url(enc.encode(JSON.stringify({ claims, signature: proofSig }))) };
}
async function forwardToCompanyAgent(env: Env, op: OperationRow, approvedByClaim: string, proof: unknown): Promise<{ state: 'in_progress' | 'succeeded' | 'failed'; taskId: string | null; runRef: string | null; said: string }> {
  if (!doorConfigured(env)) return { state: 'in_progress', taskId: null, runRef: null, said: 'the door has no session wire or key-service key; the act waits' };
  const text = `A personal agent at the company door confirms operation ${op.operationId} (revision ${op.revision}): ${op.summary}. The presenter says approved_by=${approvedByClaim} — recorded as its claim; the owner's mandate decides.`;
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message: { messageId: crypto.randomUUID(), role: 'ROLE_USER', parts: [{ text }, { data: { papOperation: { operationId: op.operationId, revision: op.revision, terms: op.terms, summary: op.summary }, approvedByClaim, ...(proof ? { proof } : {}) } }], metadata: { papOperationId: op.operationId, approvedByClaim } } } });
  let r: Response;
  try { r = await f(env)(env.COMPANY_A2A, { method: 'POST', headers: await knockHeaders(env, 'SendMessage', body), body, signal: AbortSignal.timeout(60_000) }); }
  catch (e) { return { state: 'in_progress', taskId: null, runRef: null, said: `the company agent's door did not answer (${(e as Error).message}); the act waits` }; }
  const j = (await r.json().catch(() => ({}))) as { result?: { task?: { id?: string; status?: { state?: string; message?: { parts?: Array<{ text?: string }> } }; metadata?: { runRef?: string } } }; error?: { message?: string } };
  const task = j.result?.task; const state = task?.status?.state ?? ''; const said = task?.status?.message?.parts?.find((p) => p.text)?.text ?? j.error?.message ?? '';
  if (state === 'TASK_STATE_COMPLETED') return { state: 'succeeded', taskId: task?.id ?? null, runRef: task?.metadata?.runRef ?? null, said };
  if (state === 'TASK_STATE_REJECTED' || state === 'TASK_STATE_FAILED') return { state: 'failed', taskId: task?.id ?? null, runRef: task?.metadata?.runRef ?? null, said };
  return { state: 'in_progress', taskId: task?.id ?? null, runRef: task?.metadata?.runRef ?? null, said: said || `the act is parked at the company agent (${state || r.status}) for the owner's mandate` };
}
async function trackCompanyAgent(env: Env, op: OperationRow): Promise<OperationRow> {
  if (!op.taskId || !doorConfigured(env)) return op;
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'GetTask', params: { id: op.taskId } });
  const r = await f(env)(env.COMPANY_A2A, { method: 'POST', headers: await knockHeaders(env, 'GetTask', body), body, signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!r) return op;
  const j = (await r.json().catch(() => ({}))) as { result?: { task?: { status?: { state?: string; message?: { parts?: Array<{ text?: string }> } } } } };
  const state = j.result?.task?.status?.state ?? ''; const said = j.result?.task?.status?.message?.parts?.find((p) => p.text)?.text ?? '';
  if (state === 'TASK_STATE_COMPLETED') return { ...op, state: 'succeeded', result: { summary: said || 'done', data: { taskId: op.taskId, runRef: op.runRef } } };
  if (state === 'TASK_STATE_REJECTED' || state === 'TASK_STATE_FAILED' || state === 'TASK_STATE_CANCELED') return { ...op, state: 'failed', result: { summary: said || 'the owner did not approve', data: { taskId: op.taskId } } };
  return op;
}

const pubOp = (o: OperationRow) => ({ operation_id: o.operationId, revision: o.revision, state: o.state, summary: o.summary, terms: o.terms, expires_at: new Date(o.expiresAt * 1000).toISOString(), user_approval_required: o.userApprovalRequired, ...(o.url ? { url: o.url } : {}), confirmation: o.confirmation, result: o.result });
const form = async (req: Request) => new URLSearchParams(await req.text());

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url); const p = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const now = Math.floor(Date.now() / 1000);
    const L = ledger(env);
    const origin = env.PUBLIC_ORIGIN.replace(/\/$/, ''); const host = new URL(origin).host;
    const tokenEndpoint = `${origin}/oauth/token`;
    const opsEndpoint = `${origin}/poppy/operations`;

    if (p === '/' || p === '/health') return json({ ok: true, service: 'ap-federation-pap-door', company: env.COMPANY_NAME, companyAgent: env.COMPANY_AGENT, doorAgent: env.DOOR_AGENT, listing: env.LISTING, configured: !!env.DOOR_SECRET && doorConfigured(env), says: 'a PAP company door: it admits sessions on a foreign client\'s own documents and parks every act at the company agent for the owner\'s mandate; approved_by is the presenter\'s claim' });

    // ── discovery: the company-door projection, rendered as PAP; refused for listing: none (the profile travels inside the invitation) ──
    if (p === '/.well-known/poppy.json') {
      const projected = companyDoorProfile({ profile: { type: 'service', displayName: env.COMPANY_NAME, nativeId: env.COMPANY_AGENT, homepage: env.COMPANY_HOMEPAGE }, posture: { naming: 'public', listing: env.LISTING, resolution: env.LISTING === 'none' ? 'invitation' : 'public', inbound: 'delegation-required' }, door: { authIssuer: origin, signInKinds: ['device', 'mediated'], surfaces: [{ kind: 'a2a', url: env.COMPANY_A2A, description: 'the company agent' }, { kind: 'openapi', url: `${origin}/openapi.json`, description: 'orders: exchanges' }], extensions: [{ id: 'operations', endpoint: opsEndpoint }] } });
      if (!projected.ok) return json({ error: 'not_found', says: projected.refusal === 'NOT_LISTED' ? 'this company is reachable by invitation only; its door profile travels inside the invitation (spec 442 §7.3)' : projected.detail }, 404);
      const d = projected.artifact;
      return json({ protocol_version: '0.1', organization: { name: d.organization.name, domain: host }, auth: { issuer: d.auth.issuer, ...(d.auth.signInKinds.includes('device') ? { device: { scopes: ['poppy:read', 'poppy:write'] } } : {}), ...(d.auth.signInKinds.includes('direct') ? { direct: { scopes: ['poppy:read', 'poppy:write'] } } : {}) }, agent: { protocols: d.surfaces.filter((s) => s.kind === 'a2a').map((s) => ({ type: 'a2a', endpoint: s.url })) }, apis: d.surfaces.filter((s) => s.kind === 'openapi').map((s) => ({ type: 'openapi', url: s.url, description: s.description ?? '' })), extensions: Object.fromEntries(d.extensions.map((e) => [e.id, { version: '1', endpoint: e.endpoint, ...(e.id === 'operations' ? { proof_grades: ['identity', 'standing'] } : {}) }])), 'ap:requiresInvitation': d.requiresInvitation, 'ap:losses': projected.losses.map((l) => `${l.category}:${l.sourcePointer ?? l.targetPointer}`) }, 200, { 'cache-control': 'public, max-age=300' });
    }
    if (p === '/.well-known/oauth-authorization-server') return json({ issuer: origin, token_endpoint: tokenEndpoint, revocation_endpoint: `${origin}/oauth/revoke`, device_authorization_endpoint: `${origin}/oauth/device`, dpop_signing_alg_values_supported: ['ES256'], poppy_domains: [host] }, 200, { 'cache-control': 'public, max-age=300' });
    if (p === '/openapi.json') return json({ openapi: '3.1.0', info: { title: `${env.COMPANY_NAME} orders`, version: '1' }, paths: { '/api/orders/exchange': { post: { summary: 'Exchange an item on an order (proposes an operation; HTTP 202)', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { order_id: { type: 'string' }, item_id: { type: 'string' }, replacement_sku: { type: 'string' } } } } } } } } } });

    // ── the token endpoint ──
    if (p === '/oauth/token' && req.method === 'POST') {
      if (!env.DOOR_SECRET) return oauthError('temporarily_unavailable', 503);
      const fm = await form(req);
      const clientId = fm.get('client_id') ?? '';
      if (fm.get('client_assertion_type') !== 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer' || !fm.get('client_assertion')) return oauthError('invalid_client', 401, { error_description: 'client_assertion required (private_key_jwt)' });
      const ck = await clientKeys(env, clientId);
      if ('error' in ck) { await receipt(env, L, { kind: 'door.authentication', effect: 'DENY', code: ck.detail, subjectDigest: await subjectDigest(env, clientId) }); return oauthError('invalid_client', 401); }
      const ca = await verifyAssertion(env, L, fm.get('client_assertion')!, ck.keys, { iss: clientId, aud: tokenEndpoint, sub: clientId }, 'client', now);
      if (!ca.ok) { await receipt(env, L, { kind: 'door.authentication', effect: 'DENY', code: ca.detail, subjectDigest: await subjectDigest(env, clientId) }); return oauthError('invalid_client', 401); }
      const dp = await verifyDpop(L, req, tokenEndpoint, now);
      if (!dp.ok) return oauthError('invalid_dpop_proof', 400, { error_description: dp.detail });
      const grant = fm.get('grant_type');
      const scopeOf = (allowed: string, asked: string | null) => (asked ? asked.split(' ').filter((s) => allowed.split(' ').includes(s)).join(' ') : allowed);
      if (grant === 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
        const sa = await verifyAssertion(env, L, fm.get('assertion') ?? '', ck.keys, { iss: clientId, aud: tokenEndpoint }, 'session', now);
        if (!sa.ok) return oauthError('invalid_grant', 400, { error_description: sa.detail });
        const sub = String(sa.payload.sub ?? ''); if (!sub) return oauthError('invalid_grant', 400, { error_description: 'sub required' });
        let sessionId = fm.get('session_id'); let account: string | null = null;
        if (sessionId) { const prior = (await L('session.get', { sessionId })).session as SessionRow | null; if (!prior || prior.clientId !== clientId || prior.sub !== sub) return oauthError('invalid_session', 400); account = prior.account; }
        else sessionId = rid('ses');
        const s: SessionRow = { sessionId, clientId, sub, account, jkt: dp.jkt, token: rid('tok'), scope: '', expiresAt: now + 3600 };
        await L('session.put', { session: s });
        await receipt(env, L, { kind: 'door.session', effect: 'ADMIT', signedIn: false, subjectDigest: await subjectDigest(env, `${clientId}|${sub}`) });
        return json({ access_token: s.token, token_type: 'DPoP', expires_in: 3600, scope: '', session_id: sessionId, signed_in: false });
      }
      if (grant === 'urn:ietf:params:oauth:grant-type:device_code') {
        const d = (await L('device.get', { deviceCode: fm.get('device_code') ?? '' })).device as DeviceRow | null;
        if (!d || d.clientId !== clientId) return oauthError('invalid_grant', 400);
        if (!d.approved || !d.account) return oauthError('authorization_pending', 400);
        const sessionId = fm.get('session_id'); if (!sessionId) return oauthError('invalid_session', 400, { error_description: 'session_id required' });
        const prior = (await L('session.get', { sessionId })).session as SessionRow | null;
        if (!prior || prior.clientId !== clientId) return oauthError('invalid_session', 400);
        if (prior.account && prior.account !== d.account) return oauthError('account_mismatch', 400);
        const refresh = rid('pat'); const scope = scopeOf('poppy:read poppy:write', d.scope);
        await L('account.put', { account: { token: refresh, clientId, sub: prior.sub, account: d.account, scope, expiresAt: now + 30 * 86400 } satisfies AccountTokenRow });
        const s: SessionRow = { ...prior, account: d.account, jkt: dp.jkt, token: rid('tok'), scope, expiresAt: now + 3600 };
        await L('session.put', { session: s });
        await receipt(env, L, { kind: 'door.sign-in', effect: 'ADMIT', signInKind: 'device', subjectDigest: await subjectDigest(env, `${clientId}|${prior.sub}`) });
        return json({ access_token: s.token, token_type: 'DPoP', expires_in: 3600, refresh_token: refresh, refresh_token_expires_in: 30 * 86400, scope, session_id: sessionId, signed_in: true });
      }
      if (grant === 'refresh_token') {
        const at = (await L('account.get', { token: fm.get('refresh_token') ?? '' })).account as AccountTokenRow | null;
        if (!at || at.clientId !== clientId) return oauthError('invalid_grant', 400);
        const sessionId = fm.get('session_id') ?? rid('ses');
        const prior = (await L('session.get', { sessionId })).session as SessionRow | null;
        if (prior && (prior.clientId !== clientId || prior.sub !== at.sub)) return oauthError('invalid_session', 400);
        if (prior?.account && prior.account !== at.account) return oauthError('account_mismatch', 400);
        const scope = scopeOf(at.scope, fm.get('scope'));
        const s: SessionRow = { sessionId, clientId, sub: at.sub, account: at.account, jkt: dp.jkt, token: rid('tok'), scope, expiresAt: now + 3600 };
        await L('session.put', { session: s });
        return json({ access_token: s.token, token_type: 'DPoP', expires_in: 3600, scope, session_id: sessionId, signed_in: true });
      }
      return oauthError('unsupported_grant_type', 400);
    }
    if (p === '/oauth/device' && req.method === 'POST') {
      const fm = await form(req); const clientId = fm.get('client_id') ?? '';
      const ck = await clientKeys(env, clientId); if ('error' in ck) return oauthError('invalid_client', 401);
      const ca = await verifyAssertion(env, L, fm.get('client_assertion') ?? '', ck.keys, { iss: clientId, aud: tokenEndpoint, sub: clientId }, 'client', now);
      if (!ca.ok) return oauthError('invalid_client', 401);
      const d: DeviceRow = { deviceCode: rid('dev'), userCode: userCode(), clientId, scope: fm.get('scope') ?? '', approved: false, account: null, expiresAt: now + 600 };
      await L('device.put', { device: d });
      return json({ device_code: d.deviceCode, user_code: d.userCode, verification_uri: `${origin}/device`, verification_uri_complete: `${origin}/device?user_code=${encodeURIComponent(d.userCode)}`, interval: 2, expires_in: 600 });
    }
    if (p === '/device') return new Response(`<!doctype html><title>${env.COMPANY_NAME} — approve your personal agent</title><h1>${env.COMPANY_NAME}</h1><p>Your personal agent asked to act for you here. Approve by signing the code below with your own agent at your Home — no password is ever entered here.</p><pre>code: ${url.searchParams.get('user_code') ?? '…'}</pre><p>POST /oauth/device/approve { user_code, agent, signature } where signature is your agent's signature (EIP-191) over keccak256("pap-device-approve:" + issuer + ":" + user_code).</p>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (p === '/oauth/device/approve' && req.method === 'POST') {
      // THE PERSON SIGNS, HER AGENT ANSWERS: the approval is a signature by her Smart Agent over the user code, validated through
      // ERC-1271 on the chain — a Home ceremony, never a password relayed by anyone.
      const b = (await req.json().catch(() => ({}))) as { user_code?: string; agent?: string; signature?: string };
      if (!b.user_code || !/^0x[0-9a-fA-F]{40}$/.test(b.agent ?? '') || !/^0x[0-9a-fA-F]+$/.test(b.signature ?? '')) return json({ error: 'invalid_request' }, 400);
      if (!env.FEDERATION_RPC_URL) return json({ error: 'temporarily_unavailable', detail: 'no chain endpoint to validate the signature' }, 503);
      const pc = createPublicClient({ transport: http(env.FEDERATION_RPC_URL) });
      const digest = keccak256(toBytes(`pap-device-approve:${origin}:${b.user_code}`));
      const ethHash = keccak256(new Uint8Array([...toBytes('\x19Ethereum Signed Message:\n32'), ...toBytes(digest)]));
      let valid = false;
      try { valid = (await pc.readContract({ address: env.UNIVERSAL_SIGNATURE_VALIDATOR as Address, abi: parseAbi(['function isValidSig(address,bytes32,bytes) view returns (bool)']), functionName: 'isValidSig', args: [b.agent as Address, ethHash, b.signature as Hex] })) as boolean; } catch { valid = false; }
      if (!valid) { await receipt(env, L, { kind: 'door.sign-in', effect: 'DENY', code: 'approval signature invalid', subjectDigest: await subjectDigest(env, b.agent!.toLowerCase()) }); return json({ error: 'access_denied', detail: 'the approval signature does not validate for that agent' }, 403); }
      const r = await L('device.approve', { userCode: b.user_code, account: `eip155:${env.CHAIN_ID}:${b.agent!.toLowerCase()}` });
      return r.ok ? json({ ok: true, says: 'approved by the person\'s own agent; the personal agent may now exchange the device code' }) : json({ error: 'invalid_request', detail: String(r.error) }, 400);
    }
    if (p === '/oauth/revoke' && req.method === 'POST') {
      const fm = await form(req); const clientId = fm.get('client_id') ?? '';
      const ck = await clientKeys(env, clientId); if ('error' in ck) return oauthError('invalid_client', 401);
      const ca = await verifyAssertion(env, L, fm.get('client_assertion') ?? '', ck.keys, { iss: clientId, aud: tokenEndpoint, sub: clientId }, 'client', now);
      if (!ca.ok) return oauthError('invalid_client', 401);
      const at = (await L('account.get', { token: fm.get('token') ?? '' })).account as AccountTokenRow | null;
      if (at && at.clientId === clientId) { await L('account.del', { token: at.token }); await L('session.signOutAccount', { account: at.account, clientId }); await receipt(env, L, { kind: 'door.sign-out', effect: 'ADMIT', subjectDigest: await subjectDigest(env, `${clientId}|${at.sub}`) }); }
      return new Response(null, { status: 200, headers: CORS });
    }

    // ── the company's API: proposes an operation (PAP Operations 4.1) ──
    if (p === '/api/orders/exchange' && req.method === 'POST') {
      const s = await sessionOf(env, L, req, req.url, now); if (!s.ok) return s.response;
      const b = (await req.json().catch(() => ({}))) as { order_id?: string; item_id?: string; replacement_sku?: string; price_difference?: { amount: string; currency: string } };
      if (!b.order_id || !b.replacement_sku) return json({ error: 'invalid_request', detail: 'order_id and replacement_sku' }, 400);
      const terms = { order_id: b.order_id, item_id: b.item_id ?? null, replacement_sku: b.replacement_sku, price_difference: b.price_difference ?? { amount: '0.00', currency: 'USD' } };
      const op: OperationRow = { operationId: rid('exc'), sessionId: s.session.sessionId, account: s.session.account, clientId: s.session.clientId, sub: s.session.sub, revision: 1, state: 'proposed', summary: `Exchange item ${terms.item_id ?? ''} on order ${terms.order_id} for ${terms.replacement_sku}${Number(terms.price_difference.amount) ? `, for ${terms.price_difference.amount} ${terms.price_difference.currency} more` : ''}.`, terms, expiresAt: now + 900, userApprovalRequired: false, confirmation: null, result: null, taskId: null, runRef: null, url: `${origin}/orders/${encodeURIComponent(b.order_id)}` };
      await L('op.put', { operation: op });
      return json({ operation: pubOp(op) }, 202);
    }

    // ── the Operations extension ──
    const om = /^\/poppy\/operations\/([^/]+)(\/confirm|\/cancel)?$/.exec(p);
    if (om) {
      const s = await sessionOf(env, L, req, req.url, now); if (!s.ok) return s.response;
      let op = (await L('op.get', { operationId: decodeURIComponent(om[1]!) })).operation as OperationRow | null;
      // PAP Operations 3.2: an operation belongs to the session, or to the account when that session was signed in.
      if (!op || op.clientId !== s.session.clientId || !(op.sessionId === s.session.sessionId || (op.account && op.account === s.session.account))) return json({ error: 'operation_not_found' }, 404);
      if (op.state === 'proposed' && op.expiresAt <= now) { op = { ...op, state: 'expired' }; await L('op.put', { operation: op }); }
      if (!om[2]) { if (op.state === 'in_progress') { op = await trackCompanyAgent(env, op); await L('op.put', { operation: op }); } return json(pubOp(op), 200, op.state === 'in_progress' ? { 'Retry-After': '15' } : {}); }
      if (om[2] === '/cancel') { if (op.state === 'proposed') { op = { ...op, state: 'cancelled', result: { summary: 'Declined before confirmation. Nothing was done.' } }; await L('op.put', { operation: op }); } return json(pubOp(op)); }
      // confirm
      if (op.state !== 'proposed') return json(pubOp(op)); // repeated confirm is safe: the operation as it is, nothing else done
      if (!s.session.account) return json({ error: 'sign_in_required' }, 403);
      if (!s.session.scope.split(' ').includes('poppy:write')) return json({ error: 'insufficient_scope' }, 403);
      const b = (await req.json().catch(() => ({}))) as { revision?: number; approved_by?: string; proof?: unknown };
      if (b.revision !== op.revision) return json({ error: 'terms_changed', operation: pubOp(op) }, 409);
      if (b.approved_by !== 'user' && b.approved_by !== 'standing_permission') return json({ error: 'invalid_request', detail: 'approved_by: user | standing_permission' }, 400);
      if (b.approved_by === 'standing_permission' && op.userApprovalRequired) return json({ error: 'user_approval_required', operation: pubOp(op) }, 403);
      // THE CLAIM IS RECORDED; THE ACT PARKS. Nothing the presenter said is read as approval here (spec 443 decision 4).
      const fwd = await forwardToCompanyAgent(env, op, b.approved_by, b.proof);
      op = { ...op, state: fwd.state, taskId: fwd.taskId, runRef: fwd.runRef, confirmation: { revision: op.revision, approved_by: b.approved_by, confirmed_at: new Date(now * 1000).toISOString(), 'ap:recordedAs': 'the presenter\'s claim', ...(b.proof ? { 'ap:proofReceived': true } : {}) }, result: fwd.state === 'in_progress' ? null : { summary: fwd.said, data: { taskId: fwd.taskId, runRef: fwd.runRef } } };
      await L('op.put', { operation: op });
      const rcpt = await receipt(env, L, { kind: 'door.operation', effect: fwd.state === 'failed' ? 'DENY' : 'ADMIT', operationId: op.operationId, revision: op.revision, approvedByClaim: b.approved_by, parkedAt: env.COMPANY_AGENT, taskId: fwd.taskId, subjectDigest: await subjectDigest(env, `${op.clientId}|${op.sub}`) });
      return json({ ...pubOp(op), 'ap:receipt': rcpt, 'ap:says': fwd.said }, 200, fwd.state === 'in_progress' ? { 'Retry-After': '15' } : {});
    }

    // ── receipts: the public face is counts and subject digests ──
    if (p === '/federation/receipts') {
      const rows = ((await L('receipts.recent')).receipts ?? []) as Array<{ record: Record<string, unknown>; at: string }>;
      const counts: Record<string, number> = {};
      for (const r of rows) counts[`${r.record.kind}:${r.record.effect}`] = (counts[`${r.record.kind}:${r.record.effect}`] ?? 0) + 1;
      return json({ boundaryId: `pap-door:${host}`, window: 50, counts, recent: rows.map((r) => ({ at: r.at, kind: r.record.kind, effect: r.record.effect, subjectDigest: r.record.subjectDigest ?? null })), says: 'no client id, no subject, no receipt id: the full receipt is read by its id, which only the presenter holds' }, 200, { 'cache-control': 'public, max-age=10' });
    }
    if (p.startsWith('/federation/receipts/')) { const r = await L('receipt.get', { receiptId: p.slice('/federation/receipts/'.length) }); return json(r, r.error ? 404 : 200); }
    return json({ error: 'not_found' }, 404);
  },
};
