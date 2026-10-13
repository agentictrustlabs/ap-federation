// WHAT IS STILL LIVE — the prune (spec 439 F1).
//
// A root over "every grant currently live" is only worth anchoring if "currently" is decided by something
// other than the estate's memory. Two things decide it, and neither is a submission:
//
//   · REVOCATION — `DelegationManager.isRevoked(digest)` on the estate's own chain, world-readable. A
//     revoked leaf leaves the set even if nobody tells the projector.
//   · EXPIRY — the issuer's `expiresAt`, when the submission carried one. The estate does not hold the
//     wire, so this is the issuer's statement rather than a check of the caveat; it is treated as a reason
//     to DROP (which can only narrow what the estate vouches for) and never as a reason to keep.
//
// AN UNREADABLE CHAIN DROPS THE LEAF. There is no third mechanism and no cached answer (ADR-0013): if the
// revocation state cannot be read, the projector does not vouch. The failure direction matters — a root
// that over-states what is live is a verifier accepting a dead grant; a root that under-states it is a
// counterparty being told to come back, which the presenter can see and fix.
import type { Hex } from 'viem';
import type { ProjectionSet, SubmissionV1 } from './ledger.js';

export interface LivenessDeps {
  /** True when the chain says this delegation is revoked. THROWS when it cannot be read — never guesses. */
  isRevoked(digest: Hex): Promise<boolean>;
  now?: () => Date;
}

export interface PruneOutcome {
  kept: SubmissionV1[];
  dropped: Array<{ row: SubmissionV1; reason: string }>;
}

export async function pruneLive(rows: readonly SubmissionV1[], set: ProjectionSet, deps: LivenessDeps): Promise<PruneOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const kept: SubmissionV1[] = [];
  const dropped: PruneOutcome['dropped'] = [];
  for (const row of rows) {
    if (row.set !== set) continue;
    if (row.retired) { dropped.push({ row, reason: `retired: ${row.retired.reason}` }); continue; }
    if (row.expiresAt && new Date(row.expiresAt).getTime() <= now.getTime()) { dropped.push({ row, reason: `the issuer said it expires at ${row.expiresAt}` }); continue; }
    // MEMBERSHIP IS NOT A DELEGATION HASH. A countersigned relationship credential's digest is not a
    // delegation the DelegationManager knows, so asking it would get a meaningless "not revoked". The
    // membership set is narrowed by retirement and expiry only, and spec 439 F2 is where a membership's
    // own on-chain state (AgentRelationship edge status) joins this.
    if (set === 'membership') { kept.push(row); continue; }
    let revoked: boolean;
    try { revoked = await deps.isRevoked(row.digest); }
    catch (e) { dropped.push({ row, reason: `the chain could not be read for its revocation state, so it is not vouched for: ${e instanceof Error ? e.message : String(e)}` }); continue; }
    if (revoked) { dropped.push({ row, reason: 'the chain says it is revoked' }); continue; }
    kept.push(row);
  }
  return { kept, dropped };
}
