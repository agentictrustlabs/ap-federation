// PUBLISHING THE ENTRY — the estate's own act, in three steps, each one explicit.
//
// The projection prints; this publishes, and the split is deliberate. Registering puts a record about our agent in
// someone else's directory under a domain we had to prove we own, and that is not a thing a script should do as a
// side effect of being run. So nothing here happens without a token the operator fetched and a flag they typed, no
// step implies the next, and the token is never written anywhere.
//
// WHAT THE INDEX ACTUALLY REQUIRES (read from its live OpenAPI, 2026-10-14 — `api.nandaindex.org/docs/json`):
//   POST /auth/register                            {email, password, display_name}  → an account
//   GET  /api/v1/verify-email?…                    the link in the mailbox          → a verified contact
//   POST /auth/login                               {email, password} → {token}      → a bearer for everything below
//   POST /api/v1/orgs                              the entry                        → the index record, inactive
//   POST /api/v1/orgs/{id}/domain-challenge                                         → a DNS TXT value
//   POST /api/v1/orgs/{id}/verify-domain           after the TXT resolves           → active, `domainVerified`
//
// The first three are the operator's: they involve a password and a mailbox, and neither belongs in a tool. This
// module does the last three, from `--token` onward.
//
// NOTE ON A DIFFERENT SERVICE. `nanda-registry.com` — a Django/JWT registry some earlier notes used — no longer
// resolves (NXDOMAIN from the gTLD servers, checked 2026-10-14). It is not this index and an account there reaches
// nothing. The live index is the one above, which is what `docs/standards-lock.json` pins as `nanda-index`.
import type { NandaIndexEntryV1 } from './types.js';

export const NANDA_API_BASE = 'https://api.nandaindex.org';

export interface RegisterOrgInput {
  entry: NandaIndexEntryV1;
  /** The org id the index keys the record by — the URN's short name is the natural choice. */
  orgId: string;
  /** The domain to be verified. Must be the one in the entry's identifier, or the URN describes a domain nobody proved. */
  domain: string;
  contactEmail: string;
  /** Where the card is served. The index points at it and never holds a copy. */
  registryUrl: string;
  ttlSeconds?: number;
}

/** The exact body `POST /api/v1/orgs` takes, built from the projected entry so the two cannot disagree. */
export function orgRegistrationBody(input: RegisterOrgInput): Record<string, unknown> {
  const urnDomain = input.entry.identifier.split(':')[2];
  if (urnDomain !== input.domain) {
    throw new Error(`the entry's URN is for ${urnDomain} and the domain to verify is ${input.domain} — a URN naming a domain nobody proved is worse than no entry`);
  }
  return {
    org_id: input.orgId,
    display_name: input.entry.displayName,
    identifier: input.entry.identifier,
    media_type: input.entry.type,
    registry_url: input.registryUrl,
    domain: input.domain,
    contact_email: input.contactEmail,
    ...(input.entry.description ? { description: input.entry.description } : {}),
    ...(input.entry.tags?.length ? { tags: input.entry.tags } : {}),
    ...(input.entry.extensions ? { extensions: input.entry.extensions } : {}),
    ttl_seconds: input.ttlSeconds ?? 86_400,
  };
}

export interface NandaCallResult { status: number; ok: boolean; body: unknown }

async function call(path: string, init: { method: string; token?: string; body?: unknown }, base = NANDA_API_BASE): Promise<NandaCallResult> {
  const r = await fetch(`${base}${path}`, {
    method: init.method,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await r.text();
  let body: unknown; try { body = JSON.parse(text); } catch { body = text.slice(0, 400); }
  return { status: r.status, ok: r.ok, body };
}

/** Who the token belongs to, and which orgs it already has. Read first, always: it is the cheapest way to find out
 *  that a token is stale before a write half-succeeds. */
export const whoAmI = (token: string, base?: string) => call('/api/v1/me', { method: 'GET', token }, base);

export const createOrg = (token: string, body: Record<string, unknown>, base?: string) =>
  call('/api/v1/orgs', { method: 'POST', token, body }, base);

export const requestDomainChallenge = (token: string, orgId: string, base?: string) =>
  call(`/api/v1/orgs/${encodeURIComponent(orgId)}/domain-challenge`, { method: 'POST', token, body: {} }, base);

export const verifyDomain = (token: string, orgId: string, base?: string) =>
  call(`/api/v1/orgs/${encodeURIComponent(orgId)}/verify-domain`, { method: 'POST', token, body: {} }, base);

export const readOrg = (token: string, orgId: string, base?: string) =>
  call(`/api/v1/orgs/${encodeURIComponent(orgId)}`, { method: 'GET', token }, base);

/** Pull the TXT name and value out of whatever shape the challenge came back in. The index's OpenAPI documents no
 *  response schema for it, so this reads the obvious fields and otherwise hands the operator the raw body rather
 *  than guessing — a DNS record placed from a guess is a verification that silently never completes. */
export function txtRecordFrom(body: unknown): { name?: string; value?: string; raw: unknown } {
  const b = (body ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => { for (const k of keys) { const v = b[k]; if (typeof v === 'string' && v) return v; } return undefined; };
  const nested = (b.challenge ?? b.record ?? b.dns) as Record<string, unknown> | undefined;
  const from = (o: Record<string, unknown> | undefined, ...keys: string[]) => { if (!o) return undefined; for (const k of keys) { const v = o[k]; if (typeof v === 'string' && v) return v; } return undefined; };
  return {
    name: pick('txt_name', 'name', 'host', 'record_name') ?? from(nested, 'txt_name', 'name', 'host'),
    value: pick('txt_value', 'value', 'token', 'challenge_token', 'record_value') ?? from(nested, 'txt_value', 'value', 'token'),
    raw: body,
  };
}
