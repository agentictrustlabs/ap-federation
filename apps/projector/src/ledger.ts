// WHAT THE ESTATE VOUCHES FOR — the submission ledger (spec 439 F1).
//
// THE PROJECTOR IS A COLLECTOR, NOT A SCRAPER, and that is forced by the substrate rather than chosen for
// tidiness. A person's grants live in their own object and are read under THEIR OWN session or under a
// grant they issued; the Home's HMAC bridge was deleted precisely so that no estate-held secret could read
// a person's records (ap-home spec 341 §1). So the estate holds no key with which to enumerate what its
// people have granted — and an estate that cannot read its people's records cannot project them behind
// their backs. Inclusion is therefore a SUBMISSION: the holder (or the issuer, under their own session)
// hands the estate's registry agent one leaf to vouch for.
//
// EXCLUSION IS NOT A SUBMISSION — it is the chain. `DelegationManager.isRevoked(digest)` is world-readable,
// so a revoked leaf leaves the live set whether or not anybody tells the projector (`liveness.ts`). The
// asymmetry is the safety property: adding requires consent, dropping requires only the truth.
//
// THE BLIND. Each submission carries a random 32-byte blind, and the leaf on the tree is
// `keccak256(digest ‖ blind)`. The roots are public and a grant digest is often guessable, so without the
// blind anyone could test membership against the root. The blind is held by the estate (to build the tree)
// and by the holder (to open their leaf) and by nobody else.
//
// WHERE THIS LIVES. A file under `.submissions/<estate>.json`, 0600, gitignored. That is honest for F1 and
// wrong for F2: the estate's copy belongs in the registry service agent's own vault and the holder's copy in
// the holder's (ADR-0055 — the vault is the record, DO/disk is a serving plane). The port is this module's
// interface so moving it is a binding change, not a rewrite.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { commitmentOf } from '@agenticprimitives/estate-projection';
import type { Hex } from 'viem';

/** The estate's two sets (spec 439 F1) and, since Z4, an ISSUER's one: `live-credential` is the set of credentials an issuer
 *  still stands behind (Ring 0 estate-projection's issuer row, zkID Z3). Its digest is `credentialDigestOf(jwt)`; its
 *  liveness is the issuer's own ledger (retire = revoke) — no chain is asked, because a credential is not a delegation. */
export type ProjectionSet = 'live-grant' | 'membership' | 'live-credential';

export interface SubmissionV1 {
  type: 'ap.federation-submission.v1';
  estate: string;
  set: ProjectionSet;
  /** The delegation hash (live-grant) or the relationship credential digest (membership). */
  digest: Hex;
  /** The holder's opening. Random, per leaf, never derived from anything public. */
  blind: Hex;
  /** Whom the leaf is ABOUT: the delegate that holds the grant, or the member. The verifier binds its
   *  counterparty to this, so a leaf submitted for the wrong subject proves nothing about the right one. */
  subject: `0x${string}`;
  /** Who asked for it to be vouched for, and how it was read. Evidence for the estate's own audit; it is
   *  not an authorization and no gate reads it. */
  submittedBy: string;
  source: string;
  submittedAt: string;
  /** The issuer's statement of when it expires, when it has one. The estate vouches for it as a statement,
   *  not as a check — the chain is checked for revocation, the wire (which the estate does not hold) is not. */
  expiresAt?: string;
  /** Set when the leaf has left the live set, with the reason. Rows are never deleted: a projection that
   *  stopped including something is exactly what an auditor needs to see. */
  retired?: { at: string; reason: string };
}

export interface SubmissionLedger {
  list(): SubmissionV1[];
  add(row: Omit<SubmissionV1, 'type' | 'blind' | 'submittedAt'> & { blind?: Hex }): { added: boolean; row: SubmissionV1; why?: string };
  retire(set: ProjectionSet, digest: Hex, reason: string, at?: Date): boolean;
}

export function newBlind(): Hex {
  return `0x${randomBytes(32).toString('hex')}` as Hex;
}

/** The leaf as it reaches the tree — recomputed from the opening every time, never stored and trusted. */
export function leafOf(row: SubmissionV1): { digest: Hex; blind: Hex; subject: `0x${string}`; commitment: Hex } {
  return { digest: row.digest, blind: row.blind, subject: row.subject, commitment: commitmentOf(row.digest, row.blind) };
}

export function fileLedger(path: string, now: () => Date = () => new Date()): SubmissionLedger {
  const read = (): SubmissionV1[] => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as SubmissionV1[]) : []);
  const write = (rows: SubmissionV1[]) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600 });
    chmodSync(path, 0o600);
  };
  return {
    list: read,
    add(input) {
      const rows = read();
      const digest = input.digest.toLowerCase() as Hex;
      const dup = rows.find((r) => r.set === input.set && r.digest.toLowerCase() === digest && !r.retired);
      if (dup) return { added: false, row: dup, why: 'already vouched for in this set' };
      const row: SubmissionV1 = {
        type: 'ap.federation-submission.v1',
        estate: input.estate, set: input.set, digest,
        blind: input.blind ?? newBlind(),
        subject: input.subject.toLowerCase() as `0x${string}`,
        submittedBy: input.submittedBy, source: input.source,
        submittedAt: now().toISOString(),
        ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      };
      write([...rows, row]);
      return { added: true, row };
    },
    retire(set, digest, reason, at) {
      const rows = read();
      const i = rows.findIndex((r) => r.set === set && r.digest.toLowerCase() === digest.toLowerCase() && !r.retired);
      if (i < 0) return false;
      rows[i] = { ...rows[i]!, retired: { at: (at ?? now()).toISOString(), reason } };
      write(rows);
      return true;
    },
  };
}
