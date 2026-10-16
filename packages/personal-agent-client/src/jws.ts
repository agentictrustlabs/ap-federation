// COMPACT JWS OVER A SIGNER PORT — client assertions (RFC 7523), session assertions (PAP 4.2), DPoP proofs (RFC 9449).
// ES256 only today: the signer port returns raw `r||s`, which is exactly the JWS ES256 signature encoding.
import type { JwsSignerPort } from '@agenticprimitives/key-custody';

const enc = new TextEncoder();
export const b64url = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const b64urlJson = (o: unknown): string => b64url(enc.encode(JSON.stringify(o)));
export const b64urlDecode = (s: string): Uint8Array => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=')), (c) => c.charCodeAt(0));

export async function sha256b64url(s: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));
}

export async function signCompactJws(signer: JwsSignerPort, header: Record<string, unknown>, payload: Record<string, unknown>): Promise<string> {
  const signingInput = `${b64urlJson({ alg: signer.alg, ...header })}.${b64urlJson(payload)}`;
  const sig = await signer.sign(enc.encode(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}

export const randomId = (random: (n: number) => Uint8Array, bytes = 16): string => b64url(random(bytes));

/** RFC 7523 §2.2 client assertion: the client speaks for itself at the token endpoint. */
export function clientAssertion(signer: JwsSignerPort, clientId: string, tokenEndpoint: string, now: number, random: (n: number) => Uint8Array): Promise<string> {
  return signCompactJws(signer, { typ: 'JWT', kid: signer.kid }, { iss: clientId, sub: clientId, aud: tokenEndpoint, iat: now, exp: now + 60, jti: randomId(random) });
}

/** PAP 4.2 session assertion: `iss` = the client, `sub` = the pairwise subject, `aud` = the token endpoint, one minute. */
export function sessionAssertion(signer: JwsSignerPort, clientId: string, sub: string, tokenEndpoint: string, now: number, random: (n: number) => Uint8Array): Promise<string> {
  return signCompactJws(signer, { typ: 'JWT', kid: signer.kid }, { iss: clientId, sub, aud: tokenEndpoint, iat: now, exp: now + 60, jti: randomId(random) });
}

/** RFC 9449 DPoP proof. `htu` without query or fragment; `ath` when a token rides with it; `nonce` when the company asks. */
export async function dpopProof(key: JwsSignerPort, htm: string, htu: string, now: number, random: (n: number) => Uint8Array, opts: { accessToken?: string; nonce?: string } = {}): Promise<string> {
  const u = new URL(htu); u.search = ''; u.hash = '';
  const jwk = key.publicJwk();
  const payload: Record<string, unknown> = { jti: randomId(random), htm: htm.toUpperCase(), htu: u.toString(), iat: now };
  if (opts.accessToken) payload.ath = await sha256b64url(opts.accessToken);
  if (opts.nonce) payload.nonce = opts.nonce;
  return signCompactJws(key, { typ: 'dpop+jwt', jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } }, payload);
}
