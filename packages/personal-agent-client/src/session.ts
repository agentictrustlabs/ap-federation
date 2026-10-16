// SESSIONS — PAP 4.2 / 4.3 / 4.8 / 4.9. Start with a JWT-bearer grant (the session assertion names the client and the
// pairwise subject; the client assertion authenticates the client); DPoP on every call, nonce honoured; renew; sign-in
// tokens via the Account Token; sign out = revoke at the revocation endpoint. Tokens never ride in a URL; Account Tokens
// never leave the vault unsealed except for the one request that uses them.
import { derivePairwiseSubject } from '@agenticprimitives/key-custody';
import type { Company } from './discovery.js';
import { clientAssertion, dpopProof, sessionAssertion } from './jws.js';
import type { ClientKeyPort, DpopKeyPort, VaultPort, JwsSignerPort } from './ports.js';

export interface Session {
  issuer: string;
  sessionId: string;
  accessToken: string;
  tokenType: 'DPoP' | 'Bearer';
  expiresAt: number;
  scope: string[];
  signedIn: boolean;
  /** The DPoP key this session's token is bound to. */
  dpop: JwsSignerPort & { keyRef: string };
  /** The company's last DPoP nonce, when it requires one. */
  nonce?: string;
}

export type OAuthErrorCode = 'invalid_client' | 'invalid_grant' | 'invalid_session' | 'account_mismatch' | 'invalid_dpop_proof' | 'use_dpop_nonce' | 'extension_required' | 'rate_limited' | 'invalid_scope' | 'sign_in_required' | 'insufficient_scope' | 'invalid_token' | (string & {});

export type SessionResult = { ok: true; session: Session } | { ok: false; error: OAuthErrorCode; status: number; retryAfterSeconds?: number; extension?: string; detail?: string };

export interface SessionDeps {
  clientKey: ClientKeyPort;
  dpopKeys: DpopKeyPort;
  vault: VaultPort;
  fetch: typeof fetch;
  now: () => number;
  random: (n: number) => Uint8Array;
}

const form = (o: Record<string, string | undefined>) => Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`).join('&');
const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
const JWT_BEARER = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

/** The person's subject at THIS company (PAP 4.2; spec 442 §4): derived, never stored, never derived from PII. */
export async function subjectFor(deps: Pick<SessionDeps, 'vault'>, issuer: string): Promise<string> {
  return derivePairwiseSubject({ personSecret: await deps.vault.pairwiseSecret(), issuer });
}

interface TokenResponse { access_token: string; token_type: 'DPoP' | 'Bearer'; expires_in: number; scope?: string; session_id: string; signed_in: boolean; refresh_token?: string; refresh_token_expires_in?: number }

/** One token-endpoint request, with the DPoP nonce dance (use_dpop_nonce → retry once with the nonce). */
async function tokenRequest(deps: SessionDeps, company: Company, dpop: JwsSignerPort & { keyRef: string }, fields: Record<string, string | undefined>, nonce?: string, bearer = false): Promise<{ ok: true; token: TokenResponse; nonce?: string } | { ok: false; error: OAuthErrorCode; status: number; retryAfterSeconds?: number; extension?: string; detail?: string }> {
  const te = company.metadata.token_endpoint;
  const now = deps.now();
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
  if (!bearer) headers.DPoP = await dpopProof(dpop, 'POST', te, now, deps.random, nonce ? { nonce } : {});
  const body = form({ ...fields, client_id: deps.clientKey.binding.clientId, client_assertion_type: CLIENT_ASSERTION_TYPE, client_assertion: await clientAssertion(deps.clientKey.signer, deps.clientKey.binding.clientId, te, now, deps.random) });
  const r = await deps.fetch(te, { method: 'POST', headers, body });
  const text = await r.text();
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(text) as Record<string, unknown>; } catch { /* not json */ }
  if (r.ok) return { ok: true, token: j as unknown as TokenResponse, nonce: r.headers.get('DPoP-Nonce') ?? nonce };
  const error = String(j.error ?? `http_${r.status}`) as OAuthErrorCode;
  if (error === 'use_dpop_nonce' && !nonce && r.headers.get('DPoP-Nonce')) return tokenRequest(deps, company, dpop, fields, r.headers.get('DPoP-Nonce')!, bearer);
  const ra = r.headers.get('Retry-After');
  return { ok: false, error, status: r.status, ...(ra ? { retryAfterSeconds: Number(ra) || 0 } : {}), ...(j.extension ? { extension: String(j.extension) } : {}), ...(j.error_description ? { detail: String(j.error_description) } : {}) };
}

function sessionOf(company: Company, t: TokenResponse, dpop: Session['dpop'], now: number, nonce?: string): Session {
  return { issuer: company.issuer, sessionId: t.session_id, accessToken: t.access_token, tokenType: t.token_type, expiresAt: now + Number(t.expires_in), scope: (t.scope ?? '').split(' ').filter(Boolean), signedIn: !!t.signed_in, dpop, ...(nonce ? { nonce } : {}) };
}

/** PAP 4.2 — a signed-out session for the person at this company, or a renewal of one (`sessionId`). */
export async function startSession(deps: SessionDeps, company: Company, opts: { sessionId?: string; scope?: string[]; resource?: string } = {}): Promise<SessionResult> {
  const dpop = await deps.dpopKeys.forIssuer(company.issuer);
  const sub = await subjectFor(deps, company.issuer);
  const now = deps.now();
  const r = await tokenRequest(deps, company, dpop, {
    grant_type: JWT_BEARER,
    assertion: await sessionAssertion(deps.clientKey.signer, deps.clientKey.binding.clientId, sub, company.metadata.token_endpoint, now, deps.random),
    session_id: opts.sessionId, scope: opts.scope?.join(' '), resource: opts.resource,
  });
  if (!r.ok) return r;
  return { ok: true, session: sessionOf(company, r.token, dpop, deps.now(), r.nonce) };
}

/**
 * PAP 4.8 — a signed-in session from the Account Token in the vault. ONE mechanism (ADR-0013): a link that is revoked,
 * expired or absent means signed out until the person signs in again — never a retry with another credential.
 */
export async function signedInSession(deps: SessionDeps, company: Company, opts: { sessionId?: string; scope?: string[]; resource?: string } = {}): Promise<SessionResult | { ok: false; error: 'signed_out'; status: 0; reason: string }> {
  const link = await deps.vault.readLink(company.issuer);
  const now = deps.now();
  if (!link) return { ok: false, error: 'signed_out', status: 0, reason: 'no account at this company' };
  if (link.status === 'revoked') return { ok: false, error: 'signed_out', status: 0, reason: 'the account link was revoked' };
  if (link.expiresAt <= now) return { ok: false, error: 'signed_out', status: 0, reason: 'the account token expired; the person signs in again' };
  const dpop = await deps.dpopKeys.forIssuer(company.issuer);
  const refresh = await deps.vault.unseal(link.accountToken.sealedRef);
  const r = await tokenRequest(deps, company, dpop, { grant_type: 'refresh_token', refresh_token: refresh, session_id: opts.sessionId, scope: opts.scope?.join(' '), resource: opts.resource });
  if (!r.ok) {
    if (r.error === 'invalid_grant') await deps.vault.writeLink({ ...link, status: 'revoked', revocation: { at: now, companyNotified: false, reason: 'the company no longer honours the account token (invalid_grant)' } });
    return r;
  }
  if (r.token.refresh_token) await deps.vault.writeLink({ ...link, accountToken: { ...link.accountToken, sealedRef: await deps.vault.seal(r.token.refresh_token) }, lastUsedAt: now, ...(r.token.refresh_token_expires_in ? { expiresAt: now + Number(r.token.refresh_token_expires_in) } : {}) });
  else await deps.vault.writeLink({ ...link, lastUsedAt: now });
  return { ok: true, session: sessionOf(company, r.token, dpop, deps.now(), r.nonce) };
}

/** PAP 4.9 — revoke the Account Token at the company and retire the link: a removal is a revocation, never a quiet delete. */
export async function signOut(deps: SessionDeps, company: Company, reason = 'the person signed out'): Promise<{ ok: true; companyNotified: boolean } | { ok: false; error: 'no_account' }> {
  const link = await deps.vault.readLink(company.issuer);
  if (!link || link.status === 'revoked') return { ok: false, error: 'no_account' };
  const now = deps.now();
  let companyNotified = false;
  try {
    const refresh = await deps.vault.unseal(link.accountToken.sealedRef);
    const r = await deps.fetch(company.metadata.revocation_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ token: refresh, token_type_hint: 'refresh_token', client_id: deps.clientKey.binding.clientId, client_assertion_type: CLIENT_ASSERTION_TYPE, client_assertion: await clientAssertion(deps.clientKey.signer, deps.clientKey.binding.clientId, company.metadata.token_endpoint, now, deps.random) }) });
    companyNotified = r.ok;
  } catch { companyNotified = false; }
  await deps.vault.writeLink({ ...link, status: 'revoked', revocation: { at: now, companyNotified, reason } });
  return { ok: true, companyNotified };
}

/** A DPoP-bound call under a session (PAP 4.3): `Authorization: DPoP`, a fresh proof with `ath`, the nonce dance once. */
export async function sessionFetch(deps: Pick<SessionDeps, 'fetch' | 'now' | 'random'>, session: Session, url: string, init: RequestInit & { method?: string } = {}): Promise<{ response: Response; session: Session }> {
  const method = (init.method ?? 'GET').toUpperCase();
  const once = async (nonce?: string) => {
    const headers = new Headers(init.headers);
    headers.set('authorization', `${session.tokenType} ${session.accessToken}`);
    if (session.tokenType === 'DPoP') headers.set('DPoP', await dpopProof(session.dpop, method, url, deps.now(), deps.random, { accessToken: session.accessToken, ...(nonce ? { nonce } : {}) }));
    return deps.fetch(url, { ...init, method, headers });
  };
  let r = await once(session.nonce);
  const www = r.headers.get('WWW-Authenticate') ?? '';
  if (r.status === 401 && /error="use_dpop_nonce"/.test(www) && r.headers.get('DPoP-Nonce')) {
    const nonce = r.headers.get('DPoP-Nonce')!;
    r = await once(nonce);
    return { response: r, session: { ...session, nonce } };
  }
  return { response: r, session };
}
