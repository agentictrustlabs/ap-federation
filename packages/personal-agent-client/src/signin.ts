// SIGN-IN — PAP 4.4–4.7 as HOME ceremonies. Direct: the person opens the company's page in HER browser and the Home is
// the registered return URL. Device: the Home shows her a link and a code. Both end with an Account Token the vault
// SEALS and an `ExternalAccountLinkV1` the Security section lists (spec 442 §8). Mediated Sign-In (the Home relays a
// password) is REFUSED unless a named operator policy allows it at that issuer, and then every use is fail-hard audit.
import { signInKindRefusal, pairwiseSubjectDigest, type ExternalAccountLinkV1 } from '@agenticprimitives/key-custody';
import type { Company } from './discovery.js';
import { b64url, clientAssertion, dpopProof, sha256b64url } from './jws.js';
import type { OperatorPolicy } from './ports.js';
import { subjectFor, type Session, type SessionDeps, type SessionResult } from './session.js';

const form = (o: Record<string, string | undefined>) => Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`).join('&');
const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

export interface DirectSignInStart { url: string; state: string; codeVerifier: string; redirectUri: string }

/** PAP 4.5 step 1 — the authorization URL for the person's browser (PKCE S256, random state), bound to this session. */
export async function directSignInStart(deps: SessionDeps, company: Company, session: Session, scopes: string[]): Promise<DirectSignInStart | { refusal: 'DIRECT_NOT_OFFERED' | 'NO_REDIRECT_URI' }> {
  if (!company.poppy.auth?.direct || !company.metadata.authorization_endpoint) return { refusal: 'DIRECT_NOT_OFFERED' };
  const redirectUri = deps.clientKey.redirectUris[0];
  if (!redirectUri) return { refusal: 'NO_REDIRECT_URI' };
  const state = b64url(deps.random(16));
  const codeVerifier = b64url(deps.random(32));
  const u = new URL(company.metadata.authorization_endpoint);
  u.search = form({ response_type: 'code', client_id: deps.clientKey.binding.clientId, redirect_uri: redirectUri, scope: scopes.join(' '), state, code_challenge: await sha256b64url(codeVerifier), code_challenge_method: 'S256', session_id: session.sessionId });
  return { url: u.toString(), state, codeVerifier, redirectUri };
}

/** PAP 4.5 step 3 — the Home received the callback; exchange the code (with `session_id`) and record the account. */
export async function directSignInComplete(deps: SessionDeps, company: Company, session: Session, started: DirectSignInStart, callback: { code: string; state: string }): Promise<SessionResult> {
  if (callback.state !== started.state) return { ok: false, error: 'invalid_grant', status: 0, detail: 'state mismatch' };
  const now = deps.now();
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', DPoP: await dpopProof(session.dpop, 'POST', company.metadata.token_endpoint, now, deps.random, session.nonce ? { nonce: session.nonce } : {}) };
  const r = await deps.fetch(company.metadata.token_endpoint, { method: 'POST', headers, body: form({ grant_type: 'authorization_code', code: callback.code, redirect_uri: started.redirectUri, code_verifier: started.codeVerifier, session_id: session.sessionId, client_id: deps.clientKey.binding.clientId, client_assertion_type: CLIENT_ASSERTION_TYPE, client_assertion: await clientAssertion(deps.clientKey.signer, deps.clientKey.binding.clientId, company.metadata.token_endpoint, now, deps.random) }) });
  return recordSignIn(deps, company, session, 'direct', r);
}

export interface DeviceSignInStart { deviceCode: string; userCode: string; verificationUri: string; verificationUriComplete?: string; intervalSeconds: number; expiresAt: number }

/** PAP 4.6 step 1 — the link and code the Home shows the person. */
export async function deviceSignInStart(deps: SessionDeps, company: Company, scopes: string[]): Promise<DeviceSignInStart | { refusal: 'DEVICE_NOT_OFFERED' } | { refusal: 'DEVICE_START_FAILED'; status: number }> {
  if (!company.poppy.auth?.device || !company.metadata.device_authorization_endpoint) return { refusal: 'DEVICE_NOT_OFFERED' };
  const now = deps.now();
  const r = await deps.fetch(company.metadata.device_authorization_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ client_id: deps.clientKey.binding.clientId, scope: scopes.join(' '), client_assertion_type: CLIENT_ASSERTION_TYPE, client_assertion: await clientAssertion(deps.clientKey.signer, deps.clientKey.binding.clientId, company.metadata.token_endpoint, now, deps.random) }) });
  if (!r.ok) return { refusal: 'DEVICE_START_FAILED', status: r.status };
  const j = (await r.json()) as { device_code: string; user_code: string; verification_uri: string; verification_uri_complete?: string; interval?: number; expires_in: number };
  return { deviceCode: j.device_code, userCode: j.user_code, verificationUri: j.verification_uri, ...(j.verification_uri_complete ? { verificationUriComplete: j.verification_uri_complete } : {}), intervalSeconds: j.interval ?? 5, expiresAt: now + j.expires_in };
}

/** PAP 4.6 step 2 — one poll. `authorization_pending` / `slow_down` mean "ask again later"; a token means she signed in. */
export async function deviceSignInPoll(deps: SessionDeps, company: Company, session: Session, started: DeviceSignInStart): Promise<SessionResult | { ok: false; error: 'authorization_pending' | 'slow_down' | 'expired_token' | 'access_denied'; status: number }> {
  const now = deps.now();
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', DPoP: await dpopProof(session.dpop, 'POST', company.metadata.token_endpoint, now, deps.random, session.nonce ? { nonce: session.nonce } : {}) };
  const r = await deps.fetch(company.metadata.token_endpoint, { method: 'POST', headers, body: form({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: started.deviceCode, session_id: session.sessionId, client_id: deps.clientKey.binding.clientId, client_assertion_type: CLIENT_ASSERTION_TYPE, client_assertion: await clientAssertion(deps.clientKey.signer, deps.clientKey.binding.clientId, company.metadata.token_endpoint, now, deps.random) }) });
  return recordSignIn(deps, company, session, 'device', r) as Promise<SessionResult | { ok: false; error: 'authorization_pending' | 'slow_down' | 'expired_token' | 'access_denied'; status: number }>;
}

/** PAP 4.7 — refused by default. The Home never takes a person's password to forward it (spec 442 §8). */
export function mediatedSignIn(company: Company, operatorPolicy?: OperatorPolicy): { refusal: string } | { allowed: true; policyRef: string; audit: 'fail-hard' } {
  const refusal = signInKindRefusal('mediated', operatorPolicy?.allowMediatedSignIn ? { allowMediatedSignIn: { policyRef: operatorPolicy.allowMediatedSignIn.policyRef } } : undefined);
  if (refusal) return { refusal };
  if (!operatorPolicy!.allowMediatedSignIn!.allowedIssuers.includes(company.issuer)) return { refusal: `mediated sign-in is not allowed at ${company.issuer} under policy ${operatorPolicy!.allowMediatedSignIn!.policyRef}` };
  return { allowed: true, policyRef: operatorPolicy!.allowMediatedSignIn!.policyRef, audit: 'fail-hard' };
}

/** All three end the same way (PAP 4.4): an Account Token → sealed → an ExternalAccountLinkV1 in the vault. */
async function recordSignIn(deps: SessionDeps, company: Company, session: Session, kind: 'direct' | 'device' | 'mediated', r: Response): Promise<SessionResult> {
  const text = await r.text();
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(text) as Record<string, unknown>; } catch { /* not json */ }
  if (!r.ok) return { ok: false, error: String(j.error ?? `http_${r.status}`), status: r.status, ...(j.error_description ? { detail: String(j.error_description) } : {}) };
  const now = deps.now();
  const t = j as { access_token: string; token_type: 'DPoP' | 'Bearer'; expires_in: number; scope?: string; session_id: string; signed_in: boolean; refresh_token?: string; refresh_token_expires_in?: number };
  if (!t.refresh_token) return { ok: false, error: 'invalid_grant', status: r.status, detail: 'the company issued no account token' };
  const scopes = (t.scope ?? '').split(' ').filter(Boolean);
  const prior = await deps.vault.readLink(company.issuer);
  const link: ExternalAccountLinkV1 = {
    type: 'ap.external-account-link.v1', issuer: company.issuer,
    pairwiseSubjectDigest: pairwiseSubjectDigest(await subjectFor(deps, company.issuer), await deps.vault.subjectDigestKey()),
    signInKind: kind,
    accountToken: { sealedRef: await deps.vault.seal(t.refresh_token), scopes },
    sessionKey: { keyRef: session.dpop.keyRef, alg: 'ES256', thumbprint: session.dpop.kid },
    grantedAt: now, expiresAt: now + Number(t.refresh_token_expires_in ?? 30 * 86400), lastUsedAt: now,
    consents: prior?.status === 'active' ? prior.consents : [],
    status: 'active',
  };
  await deps.vault.writeLink(link);
  return { ok: true, session: { ...session, accessToken: t.access_token, tokenType: t.token_type, expiresAt: now + Number(t.expires_in), scope: scopes, signedIn: !!t.signed_in, sessionId: t.session_id ?? session.sessionId } };
}
