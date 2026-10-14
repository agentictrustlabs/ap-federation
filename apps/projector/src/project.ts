// THE JOB — read what the estate vouches for, prune it against the chain, anchor the roots (spec 439 F1).
//
// One pass, in this order, and the order is the design:
//
//   1. READ the register and refuse an estate with no durable governance identity (an estate id is forever).
//   2. CHECK that the signer the register claims is the signer the registry holds. A mismatch is either a
//      stale file or a squatted id — `register` is first-come-wins and public ground cannot verify who
//      governs an estate on another chain — and the projector refuses rather than guess which.
//   3. PRUNE the submissions against the chain's revocation state. Inclusion needs a submission; exclusion
//      needs only the truth (`liveness.ts`).
//   4. BUILD both trees with `buildProjection` — Ring 0's leaf construction, so the estate and the verifier
//      compute the same commitment from the same opening.
//   5. ANCHOR only when the set moved or the anchor is going stale (`anchorDecision`), under a sequence
//      strictly above the last.
//
// WHAT IT NEVER DOES: read a person's records to find something to vouch for; anchor an invented set;
// re-anchor to refresh a root it did not rebuild; or claim a live-grant root it did not prune. The empty
// set's root is `0x00…00`, which is also what an estate that has never anchored reads as — an ambiguity
// that is safe in exactly one direction, since every presentation against it fails inclusion.
import type { AnchoringWireV1, DeclaredSigner } from './anchor.js';
import { buildProjection, type EstateProjectionV1 } from '@agenticprimitives/estate-projection';
import type { Hex } from 'viem';
import { anchorDecision, type AnchorDecision, type AnchoredState, type RegistryClient } from './anchor.js';
import type { ProjectableEstate } from './config.js';
import { leafOf, type SubmissionLedger, type SubmissionV1 } from './ledger.js';
import { pruneLive, type LivenessDeps } from './liveness.js';

export interface ProjectionRun {
  estate: string;
  estateId: Hex;
  anchoredBefore: AnchoredState;
  projection: EstateProjectionV1;
  counts: { liveGrant: number; membership: number };
  dropped: Array<{ set: string; digest: Hex; reason: string }>;
  decision: AnchorDecision;
  txHash?: Hex;
  /** Stated on every run while the estate's signer is not declared on its own chain (the F2 cross-check). */
  warnings: string[];
}

export interface ProjectDeps {
  registry: RegistryClient;
  ledger: SubmissionLedger;
  liveness: LivenessDeps;
  /** Seconds after which an unchanged projection is re-anchored so presentations do not age out. */
  refreshAfterSeconds: number;
  now?: () => Date;
  /** Absent in a dry run: the job then reports the decision it would have taken and writes nothing. */
  signerKey?: Hex;
  /** What the estate agent declares on its own chain (spec 439 F2.5), when the run read it. */
  declaredSigner?: DeclaredSigner;
  /** The wire the estate's registry agent lent this key to anchor under (spec 439 §4). Absent ⇒ the key is the
   *  registered signer itself, which is what §4 says to leave behind. */
  anchoringWire?: AnchoringWireV1;
}

/**
 * The trees as they stand, built at a GIVEN sequence. Two callers need this and they need different
 * sequences: the job builds at `anchored + 1` (what it is about to write), a presentation builds at
 * `anchored` (what a verifier can check). Passing the sequence in keeps that difference explicit — a
 * projection built under a sequence that is never anchored is a presentation nobody can verify.
 */
export async function buildForSequence(estate: ProjectableEstate, input: {
  ledger: SubmissionLedger; liveness: LivenessDeps; sequence: number; now?: () => Date;
}): Promise<{ projection: EstateProjectionV1; kept: { liveGrant: SubmissionV1[]; membership: SubmissionV1[] }; dropped: Array<{ set: string; digest: Hex; reason: string }> }> {
  const now = input.now ?? (() => new Date());
  const rows = input.ledger.list();
  const live = await pruneLive(rows, 'live-grant', input.liveness);
  const members = await pruneLive(rows, 'membership', input.liveness);
  const projection = buildProjection({
    chainId: estate.chainId, governance: estate.governance, sequence: input.sequence,
    liveGrants: live.kept.map(leafOf), memberships: members.kept.map(leafOf), now,
  });
  if (projection.estateId.toLowerCase() !== estate.estateId.toLowerCase()) {
    throw new Error(`the estate id the SDK derived (${projection.estateId}) is not the one the register derived (${estate.estateId}) — refusing to go on`);
  }
  return {
    projection,
    kept: { liveGrant: live.kept, membership: members.kept },
    dropped: [...live.dropped, ...members.dropped].map((d) => ({ set: d.row.set, digest: d.row.digest, reason: d.reason })),
  };
}

export async function projectEstate(estate: ProjectableEstate, deps: ProjectDeps): Promise<ProjectionRun> {
  const now = deps.now ?? (() => new Date());
  const warnings: string[] = [];

  const onChainSigner = await deps.registry.signerOf(estate.estateId);
  if (onChainSigner && estate.signer && onChainSigner.toLowerCase() !== estate.signer.toLowerCase()) {
    throw new Error(
      `estate ${estate.id}: the registry's signer for ${estate.estateId} is ${onChainSigner}, the register claims ${estate.signer}.\n` +
      '  `register` is first-come-wins, so this is either a stale register or an id someone else bound first. Resolve it before anchoring.',
    );
  }
  if (!onChainSigner) throw new Error(`estate ${estate.id} is not registered on neutral ground yet — run \`projector register --estate ${estate.id}\` first`);
  // F2.5 — THE CROSS-CHECK, read from the estate's own chain when the run can reach it. The register's
  // `declaredOnChain` is a claim; `atl:projectionSigner` on the estate agent is the fact, and `signerOf` on neutral
  // ground is what it must agree with. Three outcomes, each said: declared and equal; declared and DIFFERENT (the
  // registration is somebody else's — stop); undeclared (reviewable here, not chain-verifiable).
  if (deps.declaredSigner) {
    const registered = await deps.registry.signerOf(estate.estateId);
    if (deps.declaredSigner.declared && registered && deps.declaredSigner.signer.toLowerCase() !== registered.toLowerCase()) {
      throw new Error(`the estate agent declares ${deps.declaredSigner.signer} as its projection signer but neutral ground has ${registered} registered for ${estate.estateId}: this registration is not the estate's — nothing anchored`);
    }
    if (deps.declaredSigner.declared) warnings.length = 0; // nothing to warn about: chain-verifiable both ways
    else warnings.push('the estate agent has not declared `atl:projectionSigner` on its own chain — reviewable in this register and ap-town, not yet chain-verifiable (spec 439 F2.5; ap-home scripts/set-projection-signer.mts writes it)');
  } else if (!estate.declaredOnChain) {
    warnings.push(
      'the signer is not declared on the estate\'s own chain, so a verifier can only cross-check it against this repository and ap-town — ' +
      'until `atl:projectionSigner` exists (spec 439 F2), a first-come-wins registration is reviewable but not chain-verifiable.',
    );
  }

  const anchoredBefore = await deps.registry.roots(estate.estateId);
  const built = await buildForSequence(estate, { ledger: deps.ledger, liveness: deps.liveness, sequence: anchoredBefore.sequence + 1, now });
  const { projection, dropped } = built;

  const decision = anchorDecision({
    anchored: anchoredBefore,
    liveGrantRoot: projection.liveGrantRoot,
    membershipRoot: projection.membershipRoot,
    now: Math.floor(now().getTime() / 1000),
    refreshAfterSeconds: deps.refreshAfterSeconds,
  });

  const run: ProjectionRun = {
    estate: estate.id, estateId: estate.estateId, anchoredBefore, projection,
    counts: { liveGrant: built.kept.liveGrant.length, membership: built.kept.membership.length },
    dropped, decision, warnings,
  };
  if (!decision.anchor || !deps.signerKey) return run;

  run.txHash = await deps.registry.setRoots({
    estateId: estate.estateId,
    liveGrantRoot: projection.liveGrantRoot,
    membershipRoot: projection.membershipRoot,
    sequence: decision.sequence,
  }, deps.signerKey, deps.anchoringWire);
  return run;
}
