// A STUB PAP COMPANY — the shape a Walmart or a United would run, in memory, verifying what a real one verifies: the
// client's assertions against its JWKS, the session assertion's iss/sub/aud/jti, DPoP proofs (htm/htu/ath/jti, a nonce when
// asked), sessions, device sign-in, account tokens, and the Operations extension with revisions, at-most-once confirm and
// user_approval_required. It records every request so a test can prove what the company LEARNED (and never a person).
import { b64urlDecode } from '../src/jws.js';

const enc = new TextEncoder();
const dec = (s: string) => new TextDecoder().decode(b64urlDecode(s));

async function importEs256(jwk: JsonWebKey): Promise<CryptoKey> { return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']); }
async function verifyJws(jws: string, jwk: JsonWebKey): Promise<{ header: Record<string, unknown>; payload: Record<string, unknown> } | null> {
  const [h, p, s] = jws.split('.');
  if (!h || !p || !s) return null;
  const key = await importEs256(jwk);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64urlDecode(s) as unknown as ArrayBuffer, enc.encode(`${h}.${p}`) as unknown as ArrayBuffer);
  return ok ? { header: JSON.parse(dec(h)), payload: JSON.parse(dec(p)) } : null;
}

export interface StubOperation { operation_id: string; revision: number; state: string; summary: string; terms: unknown; expires_at: string; user_approval_required: boolean; confirmation: null | Record<string, unknown>; result: null | Record<string, unknown>; sessionId: string }

export function stubCompany(opts: { domain: string; issuer: string; clientJwks: () => Promise<JsonWebKey[]>; requireNonce?: boolean; now: () => number }) {
  const issuer = opts.issuer.replace(/\/$/, '');
  const tokenEndpoint = `${issuer}/oauth/token`;
  const seenJti = new Set<string>();
  const sessions = new Map<string, { clientId: string; sub: string; account: string | null; dpopJkt: string; token: string }>();
  const accountTokens = new Map<string, { clientId: string; sub: string; account: string; scopes: string[] }>();
  const devices = new Map<string, { sub?: string; approved: boolean; scopes: string[]; account: string }>();
  const operations = new Map<string, StubOperation>();
  const requests: Array<{ method: string; url: string; headers: Record<string, string>; body: string }> = [];
  const nonces = new Set<string>();
  let counter = 0;
  const id = (p: string) => `${p}_${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', ...headers } });

  const jkt = async (jwk: JsonWebKey) => { const c = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }); return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(c)))).map((b) => b.toString(16).padStart(2, '0')).join(''); };

  async function checkDpop(req: Request, url: string, accessToken?: string): Promise<{ ok: true; jkt: string } | { ok: false; error: 'invalid_dpop_proof' | 'use_dpop_nonce'; nonce?: string }> {
    const proof = req.headers.get('DPoP');
    if (!proof) return { ok: false, error: 'invalid_dpop_proof' };
    const [h, p] = proof.split('.');
    const header = JSON.parse(dec(h!)) as { typ?: string; alg?: string; jwk?: JsonWebKey };
    if (header.typ !== 'dpop+jwt' || header.alg !== 'ES256' || !header.jwk || (header.jwk as { d?: string }).d) return { ok: false, error: 'invalid_dpop_proof' };
    const v = await verifyJws(proof, header.jwk);
    if (!v) return { ok: false, error: 'invalid_dpop_proof' };
    const u = new URL(url); u.search = ''; u.hash = '';
    if (v.payload.htm !== req.method.toUpperCase() || v.payload.htu !== u.toString()) return { ok: false, error: 'invalid_dpop_proof' };
    if (Math.abs(Number(v.payload.iat) - opts.now()) > 60) return { ok: false, error: 'invalid_dpop_proof' };
    if (accessToken) {
      const ath = await crypto.subtle.digest('SHA-256', enc.encode(accessToken));
      const athB64 = btoa(String.fromCharCode(...new Uint8Array(ath))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (v.payload.ath !== athB64) return { ok: false, error: 'invalid_dpop_proof' };
    }
    if (opts.requireNonce) {
      if (!v.payload.nonce || !nonces.has(String(v.payload.nonce))) { const n = id('nonce'); nonces.add(n); return { ok: false, error: 'use_dpop_nonce', nonce: n }; }
    }
    return { ok: true, jkt: await jkt(header.jwk) };
  }

  async function authClient(form: URLSearchParams): Promise<{ ok: true; clientId: string } | { ok: false }> {
    const clientId = form.get('client_id'); const ca = form.get('client_assertion');
    if (!clientId || !ca || form.get('client_assertion_type') !== 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer') return { ok: false };
    const [h] = ca.split('.'); const kid = (JSON.parse(dec(h!)) as { kid?: string }).kid;
    const jwk = (await opts.clientJwks()).find((k) => (k as { kid?: string }).kid === kid);
    if (!jwk) return { ok: false };
    const v = await verifyJws(ca, jwk);
    if (!v || v.payload.iss !== clientId || v.payload.sub !== clientId || v.payload.aud !== tokenEndpoint || Number(v.payload.exp) < opts.now()) return { ok: false };
    const jti = `client:${v.payload.jti}`; if (seenJti.has(jti)) return { ok: false }; seenJti.add(jti);
    return { ok: true, clientId };
  }

  async function sessionOf(req: Request, url: string): Promise<{ ok: true; session: NonNullable<ReturnType<typeof sessions.get>>; sessionId: string } | { ok: false; response: Response }> {
    const auth = req.headers.get('authorization') ?? '';
    const m = /^DPoP (.+)$/.exec(auth);
    if (!m) return { ok: false, response: json({ error: 'invalid_token' }, 401, { 'WWW-Authenticate': 'DPoP error="invalid_token"' }) };
    const entry = [...sessions.entries()].find(([, s]) => s.token === m[1]);
    if (!entry) return { ok: false, response: json({ error: 'invalid_token' }, 401, { 'WWW-Authenticate': 'DPoP error="invalid_token"' }) };
    const d = await checkDpop(req, url, m[1]);
    if (!d.ok) return { ok: false, response: json({ error: d.error }, 401, { 'WWW-Authenticate': `DPoP error="${d.error}"`, ...(d.nonce ? { 'DPoP-Nonce': d.nonce } : {}) }) };
    if (d.jkt !== entry[1].dpopJkt) return { ok: false, response: json({ error: 'invalid_token' }, 401, { 'WWW-Authenticate': 'DPoP error="invalid_token"' }) };
    return { ok: true, session: entry[1], sessionId: entry[0] };
  }

  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input as string, init);
    const url = req.url;
    const body = init?.body ? String(init.body) : '';
    const headers: Record<string, string> = {}; req.headers.forEach((v, k) => { headers[k] = v; });
    requests.push({ method: req.method, url, headers, body });
    const u = new URL(url);
    if (u.host === opts.domain && u.pathname === '/.well-known/poppy.json') {
      return json({ protocol_version: '0.1', organization: { name: 'Acme Books', domain: opts.domain }, auth: { issuer, direct: { scopes: ['poppy:read', 'poppy:write'] }, device: { scopes: ['poppy:read', 'poppy:write'] }, mediated: { endpoint: `${issuer}/mediated`, fields: ['username', 'password'], scopes: ['poppy:read'] } }, apis: [{ type: 'openapi', url: `${issuer}/openapi.json`, description: 'orders' }], extensions: { operations: { version: '1', endpoint: `${issuer}/poppy/operations` } } });
    }
    if (url === `${issuer}/.well-known/oauth-authorization-server`) {
      return json({ issuer, token_endpoint: tokenEndpoint, revocation_endpoint: `${issuer}/oauth/revoke`, authorization_endpoint: `${issuer}/oauth/authorize`, device_authorization_endpoint: `${issuer}/oauth/device`, dpop_signing_alg_values_supported: ['ES256'], poppy_domains: [opts.domain] });
    }
    if (url === tokenEndpoint && req.method === 'POST') {
      const form = new URLSearchParams(body);
      const c = await authClient(form);
      if (!c.ok) return json({ error: 'invalid_client' }, 401);
      const d = await checkDpop(req, url);
      if (!d.ok) return json({ error: d.error }, 400, d.nonce ? { 'DPoP-Nonce': d.nonce } : {});
      const grant = form.get('grant_type');
      if (grant === 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
        const a = form.get('assertion') ?? '';
        const [h] = a.split('.'); const kid = (JSON.parse(dec(h!)) as { kid?: string }).kid;
        const jwk = (await opts.clientJwks()).find((k) => (k as { kid?: string }).kid === kid);
        const v = jwk ? await verifyJws(a, jwk) : null;
        if (!v || v.payload.iss !== c.clientId || v.payload.aud !== tokenEndpoint || Number(v.payload.exp) < opts.now()) return json({ error: 'invalid_grant' }, 400);
        const jti = `session:${v.payload.jti}`; if (seenJti.has(jti)) return json({ error: 'invalid_grant' }, 400); seenJti.add(jti);
        const sub = String(v.payload.sub);
        let sessionId = form.get('session_id');
        if (sessionId) { const s = sessions.get(sessionId); if (!s || s.clientId !== c.clientId || s.sub !== sub) return json({ error: 'invalid_session' }, 400); }
        else sessionId = id('ses');
        const token = id('tok');
        sessions.set(sessionId, { clientId: c.clientId, sub, account: sessions.get(sessionId)?.account ?? null, dpopJkt: d.jkt, token });
        return json({ access_token: token, token_type: 'DPoP', expires_in: 3600, scope: '', session_id: sessionId, signed_in: false }, 200, { 'cache-control': 'no-store' });
      }
      if (grant === 'urn:ietf:params:oauth:grant-type:device_code') {
        const dv = devices.get(form.get('device_code') ?? '');
        if (!dv) return json({ error: 'invalid_grant' }, 400);
        if (!dv.approved) return json({ error: 'authorization_pending' }, 400);
        const sessionId = form.get('session_id') ?? id('ses');
        const s = sessions.get(sessionId); if (!s) return json({ error: 'invalid_session' }, 400);
        if (s.account && s.account !== dv.account) return json({ error: 'account_mismatch' }, 400);
        const refresh = id('pat'); const token = id('tok');
        accountTokens.set(refresh, { clientId: c.clientId, sub: s.sub, account: dv.account, scopes: dv.scopes });
        sessions.set(sessionId, { ...s, account: dv.account, token, dpopJkt: d.jkt });
        return json({ access_token: token, token_type: 'DPoP', expires_in: 3600, refresh_token: refresh, refresh_token_expires_in: 2592000, scope: dv.scopes.join(' '), session_id: sessionId, signed_in: true });
      }
      if (grant === 'refresh_token') {
        const at = accountTokens.get(form.get('refresh_token') ?? '');
        if (!at || at.clientId !== c.clientId) return json({ error: 'invalid_grant' }, 400);
        const sessionId = form.get('session_id') ?? id('ses');
        const prior = sessions.get(sessionId);
        if (prior && (prior.clientId !== c.clientId || prior.sub !== at.sub)) return json({ error: 'invalid_session' }, 400);
        const token = id('tok');
        sessions.set(sessionId, { clientId: c.clientId, sub: at.sub, account: at.account, dpopJkt: d.jkt, token });
        return json({ access_token: token, token_type: 'DPoP', expires_in: 3600, scope: at.scopes.join(' '), session_id: sessionId, signed_in: true });
      }
      return json({ error: 'unsupported_grant_type' }, 400);
    }
    if (url === `${issuer}/oauth/device` && req.method === 'POST') {
      const form = new URLSearchParams(body);
      const c = await authClient(form); if (!c.ok) return json({ error: 'invalid_client' }, 401);
      const code = id('dev');
      devices.set(code, { approved: false, scopes: (form.get('scope') ?? '').split(' ').filter(Boolean), account: 'acct_alice' });
      return json({ device_code: code, user_code: 'WXYZ-1234', verification_uri: `https://${opts.domain}/device`, interval: 1, expires_in: 600 });
    }
    if (url === `${issuer}/oauth/revoke` && req.method === 'POST') {
      const form = new URLSearchParams(body);
      const c = await authClient(form); if (!c.ok) return json({ error: 'invalid_client' }, 401);
      const t = form.get('token') ?? '';
      if (accountTokens.delete(t)) for (const [k, s] of sessions) if (s.account) sessions.set(k, { ...s, account: null });
      return new Response(null, { status: 200 });
    }
    if (url.startsWith(`${issuer}/poppy/operations`)) {
      const s = await sessionOf(req, url); if (!s.ok) return s.response;
      const m = /\/poppy\/operations\/([^/]+)(\/confirm|\/cancel)?$/.exec(u.pathname);
      if (!m) return json({ error: 'not_found' }, 404);
      const op = operations.get(decodeURIComponent(m[1]!));
      if (!op || op.sessionId !== s.sessionId) return json({ error: 'operation_not_found' }, 404);
      const pub = ({ sessionId: _s, ...rest }: StubOperation) => rest;
      if (!m[2]) return json(pub(op));
      if (m[2] === '/cancel') { if (op.state === 'proposed') op.state = 'cancelled'; return json(pub(op)); }
      const b = JSON.parse(body || '{}') as { revision?: number; approved_by?: string; proof?: unknown };
      if (op.state !== 'proposed') return json(pub(op)); // a repeated confirm is safe: the operation as it is, nothing else done
      if (!s.session.account) return json({ error: 'sign_in_required' }, 403);
      if (b.revision !== op.revision) return json({ error: 'terms_changed', operation: pub(op) }, 409);
      if (b.approved_by === 'standing_permission' && op.user_approval_required) return json({ error: 'user_approval_required', operation: pub(op) }, 403);
      if (b.approved_by !== 'user' && b.approved_by !== 'standing_permission') return json({ error: 'invalid_request' }, 400);
      op.state = 'succeeded'; op.confirmation = { revision: op.revision, approved_by: b.approved_by, confirmed_at: new Date(opts.now() * 1000).toISOString(), ...(b.proof ? { proof_received: true } : {}) };
      op.result = { summary: `Done: ${op.summary}`, data: { ref: id('ord') } };
      return json(pub(op));
    }
    return json({ error: 'not_found' }, 404);
  };

  return {
    issuer, tokenEndpoint, fetch: fetchImpl, requests, sessions, accountTokens, operations,
    /** The company proposes an operation into a session (as its API or conversation would). */
    propose(sessionId: string, summary: string, terms: unknown, extra: Partial<StubOperation> = {}): StubOperation {
      const op: StubOperation = { operation_id: id('exc'), revision: 1, state: 'proposed', summary, terms, expires_at: new Date((opts.now() + 900) * 1000).toISOString(), user_approval_required: false, confirmation: null, result: null, sessionId, ...extra };
      operations.set(op.operation_id, op); return op;
    },
    revise(operationId: string, terms: unknown, summary: string): StubOperation { const op = operations.get(operationId)!; op.revision += 1; op.terms = terms; op.summary = summary; return op; },
    approveDevice(): void { for (const d of devices.values()) d.approved = true; },
  };
}
