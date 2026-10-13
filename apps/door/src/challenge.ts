// THE CHALLENGE — the door's half of a presentation's replay bound (spec 410 §4.2; estate-projection
// `makeAuthorityPresentation` takes { nonce, audience }). Stateless: the door hands out a nonce with an expiry and a
// ticket (an HMAC over nonce · expiry · subject · audience under the door's own secret), and recognises its own
// ticket when the presentation comes back. No table of outstanding challenges, nothing to clean up, and a ticket
// forged without the secret fails the MAC. The presentation itself carries the nonce and audience the verifier
// compares (`verifyAuthorityPresentation`), so the ticket only has to prove the door issued this nonce to this
// subject for this audience recently.
const enc = new TextEncoder();

export interface ChallengeV1 { nonce: `0x${string}`; audience: string; subject: `0x${string}`; expiresAt: number; ticket: string }

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const material = (c: Pick<ChallengeV1, 'nonce' | 'expiresAt' | 'subject' | 'audience'>) => `${c.nonce.toLowerCase()}|${c.expiresAt}|${c.subject.toLowerCase()}|${c.audience}`;

export async function issueChallenge(secret: string, subject: `0x${string}`, audience: string, ttlSeconds = 300, now = () => Math.floor(Date.now() / 1000)): Promise<ChallengeV1> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const nonce = (`0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`) as `0x${string}`;
  const expiresAt = now() + ttlSeconds;
  const c = { nonce, audience, subject: subject.toLowerCase() as `0x${string}`, expiresAt };
  return { ...c, ticket: await hmacHex(secret, material(c)) };
}

/** The wire form the presenter sends back: `<nonce>.<expiresAt>.<ticket>`. */
export const encodeChallengeHeader = (c: ChallengeV1): string => `${c.nonce}.${c.expiresAt}.${c.ticket}`;

export type ChallengeVerdict = { ok: true; nonce: `0x${string}`; audience: string } | { ok: false; code: 'malformed' | 'expired' | 'ticket_mismatch' };

/** Recognise the door's own ticket for this subject and audience. Constant-time compare on the MAC. */
export async function verifyChallengeHeader(secret: string, header: string | null, subject: `0x${string}`, audience: string, now = () => Math.floor(Date.now() / 1000)): Promise<ChallengeVerdict> {
  const m = /^(0x[0-9a-fA-F]{64})\.(\d{1,12})\.([0-9a-f]{64})$/.exec(header ?? '');
  if (!m) return { ok: false, code: 'malformed' };
  const nonce = m[1]!.toLowerCase() as `0x${string}`; const expiresAt = Number(m[2]); const ticket = m[3]!;
  if (expiresAt <= now()) return { ok: false, code: 'expired' };
  const want = await hmacHex(secret, material({ nonce, expiresAt, subject: subject.toLowerCase() as `0x${string}`, audience }));
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ ticket.charCodeAt(i);
  if (diff !== 0) return { ok: false, code: 'ticket_mismatch' };
  return { ok: true, nonce, audience };
}
