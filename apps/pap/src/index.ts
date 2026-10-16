// pap.svc@faithnet — THE ESTATE'S PERSONAL-AGENT SERVICE, as the world sees it (spec 443 W1; Ring 0 spec 442 §3, §7.1, §9).
//
// What this Worker serves, every byte a projection of the service's signed ClientKeyBindingV1 (apps/pap/binding.json —
// public data: the binding, its signature, the public JWK, the record the chain holds):
//   GET /client.json                                  the OAuth Client ID Metadata Document, as PAP 4.1 reads it
//   GET /jwks.json                                    the public key set (the binding's key, by RFC 7638 thumbprint)
//   GET /.well-known/http-message-signatures-directory the RFC 9421 key directory (Web Bot Auth / Visa TAP shape)
//   GET /oauth/return?code&state                       Direct Sign-In's return URL — hands the person back to HER Home
//   GET /health · GET /binding.json                    what is bound, to which agent, until when
// What it never serves: a per-person document, a `sub`, an Account Token, a private key. The person is only a pairwise
// subject at every company; this service is the client (spec 442 §7.1). The client key itself is a Worker secret here
// until faithkms has a P-256 kind (zkID backlog Z6) — said on /health, never hidden.
import { clientMetadataDocument, jwkThumbprintSync } from '@agenticprimitives/registry-kit';
import bindingJson from '../binding.json';

interface Env { PUBLIC_ORIGIN: string; HOME_RETURN: string; ESTATE?: string; PAP_CLIENT_KEY_P256?: string }
interface Bundle { binding: { binding: { canonicalAgentId: string; scope: 'service' | 'person'; clientId: string; jwkThumbprint: string; alg: 'ES256' | 'EdDSA'; custodyEpoch: number; notBefore: number; notAfter: number }; chainId: number; verifyingContract: string; signature: string }; publicJwk: JsonWebKey & { kid?: string }; record: unknown; tx?: string; at?: string }
const bundle = bindingJson as unknown as Bundle;

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b, null, 2), { status, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300', ...CORS, ...headers } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const now = Math.floor(Date.now() / 1000);
    const b = bundle.binding.binding;
    const profile = { type: 'service', displayName: `${env.ESTATE ?? 'estate'} personal-agent service`, nativeId: b.canonicalAgentId, homepage: env.PUBLIC_ORIGIN };
    const projected = clientMetadataDocument({ profile, posture: { naming: 'public', listing: 'public' }, binding: b, jwks: [bundle.publicJwk], now, client: { redirectUris: [`${env.PUBLIC_ORIGIN}/oauth/return`] } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (p === '/' || p === '/health') {
      return json({ ok: true, service: 'ap-federation-pap', estate: env.ESTATE ?? null, agent: b.canonicalAgentId, clientId: b.clientId, kid: b.jwkThumbprint, bindingNotAfter: new Date(b.notAfter * 1000).toISOString(), bindingLive: projected.ok, keyHeld: env.PAP_CLIENT_KEY_P256 ? 'worker-secret (stand-in until faithkms P-256, zkID Z6)' : 'absent', says: 'the estate\'s personal-agent service: the client at every company\'s door for people of this estate; each person is only a pairwise subject here, and nobody\'s client_id' }, 200, { 'cache-control': 'no-store' });
    }
    if (p === '/binding.json') return json(bundle);
    if (p === '/oauth/return') {
      // Direct Sign-In's return (PAP 4.5): the company sends the person back here (same domain as client_id, as the
      // protocol requires); this hands her to HER Home, which holds the state and the PKCE verifier. No code is kept here.
      const code = url.searchParams.get('code'); const state = url.searchParams.get('state'); const error = url.searchParams.get('error');
      const to = new URL(env.HOME_RETURN);
      if (code) to.searchParams.set('code', code); if (state) to.searchParams.set('state', state); if (error) to.searchParams.set('error', error);
      return Response.redirect(to.toString(), 302);
    }
    if (p !== '/client.json' && p !== '/jwks.json' && p !== '/.well-known/http-message-signatures-directory') return json({ error: 'not_found', hint: p.startsWith('/agents/') ? 'no per-person document is served here: the service is the client, the person is a pairwise subject (spec 442 §7.1)' : undefined }, 404);
    if (!projected.ok) return json({ error: 'binding_not_live', refusal: projected.refusal, detail: projected.detail }, 503, { 'cache-control': 'no-store' });
    const doc = projected.artifact;
    if (p === '/client.json') {
      // PAP 4.1 — the generic client document rendered as the OAuth Client ID Metadata Document. Every field is the projection's.
      return json({ client_id: doc.clientId, client_name: doc.clientName, ...(doc.logoUri ? { logo_uri: doc.logoUri } : {}), ...(doc.clientUri ? { client_uri: doc.clientUri } : {}), jwks_uri: `${env.PUBLIC_ORIGIN}/jwks.json`, redirect_uris: doc.redirectUris, token_endpoint_auth_method: 'private_key_jwt', extensions: { operations: { version: '1' } }, 'ap:subject': doc.subject, 'ap:scope': doc.scope });
    }
    if (p === '/jwks.json') return json({ keys: doc.keys.map((k) => ({ ...k.jwk, kid: k.thumbprint, alg: k.alg, use: 'sig', 'ap:notAfter': k.notAfter })) });
    if (p === '/.well-known/http-message-signatures-directory') {
      // RFC 9421 key directory (Web Bot Auth / Visa TAP): the same keys, keyed by thumbprint. The directory's own signature is owed.
      return json({ keys: doc.keys.map((k) => ({ ...k.jwk, kid: k.thumbprint, alg: k.alg, use: 'sig', nbf: b.notBefore, exp: k.notAfter })) }, 200, { 'content-type': 'application/http-message-signatures-directory+json' });
    }
    return json({ error: 'not_found' }, 404);
  },
};

export const thumbprintOf = jwkThumbprintSync;
