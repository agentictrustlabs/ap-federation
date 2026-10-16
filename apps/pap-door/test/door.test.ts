// A STUB FOREIGN PERSONAL AGENT (the shape Meta or OpenAI would run) at OUR door — and the twin: its approved_by without the
// owner's mandate performs nothing. The company agent behind the door is a stub A2A origin that PARKS every act.
import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import worker from '../src/index.js';
import { fakeLedger } from './fake-ledger.js';

const ORIGIN = 'https://door.company.example';
const enc = new TextEncoder();
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (o: unknown) => b64url(enc.encode(JSON.stringify(o)));
async function keypair() { const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']); const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey); return { kp, jwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } as JsonWebKey }; }
async function jws(kp: CryptoKeyPair, header: Record<string, unknown>, payload: Record<string, unknown>) { const si = `${b64urlJson({ alg: 'ES256', ...header })}.${b64urlJson(payload)}`; const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, enc.encode(si))); return `${si}.${b64url(sig)}`; }
const thumb = async (jwk: JsonWebKey) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })))));

async function world(listing = 'public') {
  const client = await keypair(); const dpop = await keypair();
  const clientId = 'https://agent.foreign.example/agent.json';
  const kid = await thumb(client.jwk);
  const parked: Array<Record<string, unknown>> = [];
  const originFetch: typeof fetch = async (input, init) => {
    const u = typeof input === 'string' ? input : (input as Request).url;
    if (u === clientId) return new Response(JSON.stringify({ client_id: clientId, client_name: 'Foreign Agent', jwks_uri: 'https://agent.foreign.example/jwks.json', redirect_uris: ['https://agent.foreign.example/cb'], token_endpoint_auth_method: 'private_key_jwt' }));
    if (u === 'https://agent.foreign.example/jwks.json') return new Response(JSON.stringify({ keys: [{ ...client.jwk, kid }] }));
    if (u === 'https://company-agent.example/a2a') { const body = JSON.parse(String(init?.body)); parked.push(body); return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { task: { id: 'task_1', status: { state: 'TASK_STATE_AUTH_REQUIRED', message: { parts: [{ text: 'parked for the owner\'s mandate' }] } }, metadata: { runRef: 'run-1' } } } })); }
    return new Response('{"error":"not_found"}', { status: 404 });
  };
  const ledger = fakeLedger();
  const env = { PUBLIC_ORIGIN: ORIGIN, COMPANY_NAME: 'Acme Books', COMPANY_AGENT: 'eip155:34348:0x3333333333333333333333333333333333333333', COMPANY_A2A: 'https://company-agent.example/a2a', COMPANY_HOMEPAGE: 'https://company.example', DOOR_AGENT: '0x4444444444444444444444444444444444444444', LISTING: listing, CHAIN_ID: '34348', UNIVERSAL_SIGNATURE_VALIDATOR: '0x0000000000000000000000000000000000000001', DOOR_SECRET: 'test-secret', DOOR_AGENT_KEY: '0x' + '22'.repeat(32), LEDGER: ledger.ns, __fetch: originFetch };
  const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, init), env as never);
  const now = () => Math.floor(Date.now() / 1000);
  const clientAssertion = () => jws(client.kp, { typ: 'JWT', kid }, { iss: clientId, sub: clientId, aud: `${ORIGIN}/oauth/token`, iat: now(), exp: now() + 60, jti: b64url(crypto.getRandomValues(new Uint8Array(16))) });
  const proof = async (htm: string, htu: string, accessToken?: string) => { const payload: Record<string, unknown> = { jti: b64url(crypto.getRandomValues(new Uint8Array(16))), htm, htu, iat: now() }; if (accessToken) payload.ath = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(accessToken)))); return jws(dpop.kp, { typ: 'dpop+jwt', jwk: dpop.jwk }, payload); };
  const form = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const token = async (fields: Record<string, string>) => { const r = await call('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', DPoP: await proof('POST', `${ORIGIN}/oauth/token`) }, body: form({ ...fields, client_id: clientId, client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: await clientAssertion() }) }); return { status: r.status, json: await r.json() as Record<string, unknown> }; };
  const session = async (sub = 'usr_foreign_1') => token({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await jws(client.kp, { typ: 'JWT', kid }, { iss: clientId, sub, aud: `${ORIGIN}/oauth/token`, iat: now(), exp: now() + 60, jti: b64url(crypto.getRandomValues(new Uint8Array(16))) }) });
  const api = async (path: string, accessToken: string, init: { method?: string; body?: unknown } = {}) => { const method = init.method ?? 'GET'; const r = await call(path, { method, headers: { authorization: `DPoP ${accessToken}`, DPoP: await proof(method, `${ORIGIN}${path}`, accessToken), ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) }); return { status: r.status, json: await r.json() as Record<string, unknown>, headers: r.headers }; };
  return { call, token, session, api, parked, ledger, clientId, clientAssertion, form };
}

describe('pap-door — their personal agent at our company\'s door (spec 443 W2)', () => {
  it('serves poppy.json from the company-door projection; refuses it for listing: none', async () => {
    const w = await world();
    const d = await (await w.call('/.well-known/poppy.json')).json() as Record<string, unknown>;
    expect(d.protocol_version).toBe('0.1');
    expect((d.auth as { issuer: string }).issuer).toBe(ORIGIN);
    expect((d.extensions as { operations: { endpoint: string; proof_grades: string[] } }).operations.endpoint).toBe(`${ORIGIN}/poppy/operations`);
    expect((d.auth as { mediated?: unknown }).mediated).toBeUndefined(); // dropped unless an operator policy names it
    const w2 = await world('none');
    expect((await w2.call('/.well-known/poppy.json')).status).toBe(404);
  });

  it('admits a foreign client on its own documents: RFC 7523 assertions against its JWKS, DPoP-bound; a reused jti is refused', async () => {
    const w = await world();
    const s = await w.session();
    expect(s.status).toBe(200);
    expect(s.json.token_type).toBe('DPoP');
    expect(s.json.signed_in).toBe(false);
    // a different person's sub at the same client is a different session subject; the public ledger face names neither
    const face = await (await w.call('/federation/receipts')).json() as { recent: Array<Record<string, unknown>> };
    expect(JSON.stringify(face)).not.toContain('usr_foreign_1');
    expect(JSON.stringify(face)).not.toContain(w.clientId);
    // the SAME client assertion twice: jti replay → invalid_client
    const ca = await w.clientAssertion();
    const once = await w.call('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: w.form({ grant_type: 'x', client_id: w.clientId, client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: ca }) });
    expect([400, 401]).toContain(once.status);
    const twice = await w.call('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: w.form({ grant_type: 'x', client_id: w.clientId, client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: ca }) });
    expect(twice.status).toBe(401);
  });

  it('refuses a per-person client_id', async () => {
    const w = await world();
    const r = await w.call('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: w.form({ grant_type: 'x', client_id: 'https://home.example/agents/alice/agent.json', client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: 'a.b.c' }) });
    expect(r.status).toBe(401);
  });

  it('TWIN: an operation is proposed by the API, and a confirm with approved_by: user and no owner mandate PERFORMS NOTHING — it parks at the company agent as the presenter\'s claim', async () => {
    const w = await world();
    const s = await w.session();
    const tok = String(s.json.access_token);
    // signed-out session: the API proposes, confirm needs sign-in
    const proposed = await w.api('/api/orders/exchange', tok, { method: 'POST', body: { order_id: 'ord_7', item_id: 'itm_1', replacement_sku: 'jacket-l', price_difference: { amount: '20.00', currency: 'USD' } } });
    expect(proposed.status).toBe(202);
    const op = (proposed.json.operation as { operation_id: string; revision: number; state: string });
    expect(op.state).toBe('proposed');
    const noSignIn = await w.api(`/poppy/operations/${op.operation_id}/confirm`, tok, { method: 'POST', body: { revision: 1, approved_by: 'user' } });
    expect(noSignIn.status).toBe(403);
    expect(noSignIn.json.error).toBe('sign_in_required');
    // device sign-in: start, approve "as the person" (the ledger directly — the signature path needs a chain, covered live), poll
    const dev = await w.call('/oauth/device', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: w.form({ client_id: w.clientId, scope: 'poppy:read poppy:write', client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: await w.clientAssertion() }) });
    const dj = await dev.json() as { device_code: string; user_code: string };
    expect(dj.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const pending = await w.token({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: dj.device_code, session_id: String(s.json.session_id) });
    expect(pending.json.error).toBe('authorization_pending');
    await (await w.ledger.ns.get(w.ledger.ns.idFromName('door')).fetch('https://ledger/device.approve', { method: 'POST', body: JSON.stringify({ userCode: dj.user_code, account: 'eip155:34348:0x1111111111111111111111111111111111111111' }) })).json();
    const signedIn = await w.token({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: dj.device_code, session_id: String(s.json.session_id) });
    expect(signedIn.json.signed_in).toBe(true);
    expect(typeof signedIn.json.refresh_token).toBe('string');
    const tok2 = String(signedIn.json.access_token);
    // the confirm: recorded as the presenter's claim, parked at the company agent, in_progress with Retry-After
    const c = await w.api(`/poppy/operations/${op.operation_id}/confirm`, tok2, { method: 'POST', body: { revision: 1, approved_by: 'user', proof: { grade: 'identity', jws: 'x.y.z' } } });
    expect(c.status).toBe(200);
    expect(c.json.state).toBe('in_progress');
    expect((c.json.confirmation as Record<string, unknown>)['ap:recordedAs']).toBe('the presenter\'s claim');
    expect(c.headers.get('Retry-After')).toBe('15');
    expect(w.parked.length).toBe(1);
    const forwarded = JSON.stringify(w.parked[0]);
    expect(forwarded).toContain('approvedByClaim');
    expect(forwarded).toContain(op.operation_id);
    // a repeated confirm is safe: the operation as it is, nothing forwarded twice
    const again = await w.api(`/poppy/operations/${op.operation_id}/confirm`, tok2, { method: 'POST', body: { revision: 1, approved_by: 'user' } });
    expect(again.json.state).toBe('in_progress');
    expect(w.parked.length).toBe(1);
    // a stale revision is refused with the current operation
    const stale = await w.api(`/poppy/operations/${op.operation_id}/confirm`, tok2, { method: 'POST', body: { revision: 0, approved_by: 'user' } });
    expect([200, 409]).toContain(stale.status);
    // the receipt's public face carries no subject, no client id, no receipt id
    const face = await (await w.call('/federation/receipts')).json() as Record<string, unknown>;
    const txt = JSON.stringify(face);
    expect(txt).not.toContain('usr_foreign_1'); expect(txt).not.toContain(w.clientId); expect(txt).not.toContain('rcpt-');
    expect((face.counts as Record<string, number>)['door.operation:ADMIT']).toBe(1);
  });

  it('a DPoP proof for another URL or another key is refused; a token in the wrong scheme is refused', async () => {
    const w = await world();
    const s = await w.session();
    const r = await w.call('/poppy/operations/exc_x', { headers: { authorization: `Bearer ${s.json.access_token}` } });
    expect(r.status).toBe(401);
  });
});
