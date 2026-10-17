// THE ISSUER ROW (Ring 0 zkID Z3 / spec 443 W5) — a credential issuer's live-credential root, anchored on neutral ground
// beside the estates' authority roots, by the same projector and the same contract.
//
// What differs from an estate's projection, and why:
//   · ONE set, `live-credential`: the credentials the issuer still stands behind. Its leaves are credential digests
//     (`credentialDigestOf(jwt)`, keccak over the issuer-signed compact JWT) with a per-leaf blind, so public ground
//     learns a root and nothing about who holds what.
//   · NO chain is asked for liveness. A credential is not a delegation; `DelegationManager.isRevoked` knows nothing
//     of it. Revocation IS the issuer's act: `retire` drops the leaf, the next `project` anchors a root without it,
//     and every status presentation built at the old sequence is stale against the chain from then on.
//   · the row's id is `estateIdOf(chainId, issuerSA)` and its charterHash slot carries `ISSUER_ROW_TAG`, which is how a
//     verifier tells an issuer row from an estate's (`issuerRootsOf` refuses the wrong tag).
//   · the signer is the issuer SA itself (registered once), and the key that writes is a delegate under the SA's
//     anchoring wire — spec 439 §4 unchanged.
// What a holder takes from here is a `CredentialStatusPresentationV1`: one leaf, its opening, a proof against the
// ANCHORED sequence, bound to the verifier's challenge. It names no subject.
import { buildIssuerProjection, issuerRowArgs, ISSUER_ROW_TAG, makeCredentialStatusPresentation, type CredentialStatusPresentationV1, type IssuerProjectionV1 } from '@agenticprimitives/estate-projection';
import type { Hex } from 'viem';
import { anchorDecision, type AnchorDecision, type AnchoredState, type AnchorAuthority, type RegistryClient } from './anchor.js';
import type { IssuerRow } from './config.js';
import { leafOf, type SubmissionLedger, type SubmissionV1 } from './ledger.js';

export type ProjectableIssuer = IssuerRow & { issuerId: Hex };

export interface IssuerRun {
  issuer: string;
  issuerId: Hex;
  anchoredBefore: AnchoredState;
  projection: IssuerProjectionV1;
  counts: { live: number; retired: number };
  decision: AnchorDecision;
  txHash?: Hex;
}

/** The live set as the ledger has it: rows of the `live-credential` set that are not retired and not past their expiry. */
export function liveCredentialRows(rows: readonly SubmissionV1[], now = new Date()): { kept: SubmissionV1[]; dropped: Array<{ row: SubmissionV1; reason: string }> } {
  const kept: SubmissionV1[] = []; const dropped: Array<{ row: SubmissionV1; reason: string }> = [];
  for (const row of rows) {
    if (row.set !== 'live-credential') continue;
    if (row.retired) { dropped.push({ row, reason: `retired: ${row.retired.reason}` }); continue; }
    if (row.expiresAt && new Date(row.expiresAt).getTime() <= now.getTime()) { dropped.push({ row, reason: `expired ${row.expiresAt}` }); continue; }
    kept.push(row);
  }
  return { kept, dropped };
}

export function buildIssuerForSequence(issuer: ProjectableIssuer, input: { ledger: SubmissionLedger; sequence: number; now?: () => Date }): { projection: IssuerProjectionV1; kept: SubmissionV1[]; dropped: Array<{ row: SubmissionV1; reason: string }> } {
  const now = input.now ?? (() => new Date());
  const { kept, dropped } = liveCredentialRows(input.ledger.list(), now());
  const projection = buildIssuerProjection({ chainId: issuer.chainId, issuer: issuer.sa, sequence: input.sequence, liveCredentials: kept.map(leafOf), now });
  if (projection.issuerId.toLowerCase() !== issuer.issuerId.toLowerCase()) throw new Error(`the issuer id the SDK derived (${projection.issuerId}) is not the register's (${issuer.issuerId}) — refusing to go on`);
  return { projection, kept, dropped };
}

export async function projectIssuer(issuer: ProjectableIssuer, deps: { registry: RegistryClient; ledger: SubmissionLedger; refreshAfterSeconds: number; anchor?: AnchorAuthority; now?: () => Date }): Promise<IssuerRun> {
  const now = deps.now ?? (() => new Date());
  const signer = await deps.registry.signerOf(issuer.issuerId);
  if (!signer) throw new Error(`issuer ${issuer.id} is not registered on neutral ground yet — run \`projector register --issuer ${issuer.id}\` first`);
  const expectedSigner = (issuer.rowSigner ?? issuer.sa).toLowerCase();
  if (signer.toLowerCase() !== expectedSigner) throw new Error(`issuer ${issuer.id}: neutral ground has ${signer} as the signer of ${issuer.issuerId}; the register says ${issuer.rowSigner ? `its row signer ${issuer.rowSigner}` : `the issuer SA ${issuer.sa}`} is — resolve this first`);
  const anchoredBefore = await deps.registry.roots(issuer.issuerId);
  if (!anchoredBefore.never && anchoredBefore.charterHash.toLowerCase() !== ISSUER_ROW_TAG.toLowerCase()) throw new Error(`the row under ${issuer.issuerId} is not tagged as an issuer row (charterHash ${anchoredBefore.charterHash}) — something else anchored here`);
  const built = buildIssuerForSequence(issuer, { ledger: deps.ledger, sequence: anchoredBefore.sequence + 1, now });
  const args = issuerRowArgs(built.projection);
  const decision = anchorDecision({ anchored: anchoredBefore, liveGrantRoot: args.liveGrantRoot, membershipRoot: args.membershipRoot, charterHash: args.charterHash, now: Math.floor(now().getTime() / 1000), refreshAfterSeconds: deps.refreshAfterSeconds });
  const run: IssuerRun = { issuer: issuer.id, issuerId: issuer.issuerId, anchoredBefore, projection: built.projection, counts: { live: built.kept.length, retired: built.dropped.length }, decision };
  if (!decision.anchor || !deps.anchor) return run;
  run.txHash = await deps.registry.setRoots({ ...args, sequence: decision.sequence }, deps.anchor.account, deps.anchor.wire);
  return run;
}

/** A status presentation for one credential at the ANCHORED sequence, or null when the set has moved since or the
 *  credential is not live. Built from the ledger, checked against what the chain holds — a presentation against a tree
 *  nobody anchored is a dead proof, and saying so beats handing one over. */
export async function presentCredentialStatus(issuer: ProjectableIssuer, deps: { registry: RegistryClient; ledger: SubmissionLedger; digest: Hex; nonce: string; audience: string }): Promise<{ ok: true; presentation: CredentialStatusPresentationV1; sequence: number } | { ok: false; reason: string }> {
  const anchored = await deps.registry.roots(issuer.issuerId);
  if (anchored.never) return { ok: false, reason: `${issuer.id} has nothing anchored — there is no root to prove against` };
  const built = buildIssuerForSequence(issuer, { ledger: deps.ledger, sequence: anchored.sequence });
  if (built.projection.liveCredentialRoot.toLowerCase() !== anchored.liveGrantRoot.toLowerCase()) return { ok: false, reason: `the live-credential set has moved since sequence ${anchored.sequence} (rebuilt ${built.projection.liveCredentialRoot}, anchored ${anchored.liveGrantRoot}). Re-anchor (\`projector project --issuer ${issuer.id}\`) and present again.` };
  const presentation = makeCredentialStatusPresentation(built.projection, deps.digest, { nonce: deps.nonce, audience: deps.audience });
  if (!presentation) return { ok: false, reason: `${deps.digest} is not in ${issuer.id}'s live set at sequence ${anchored.sequence} — revoked, retired or never vouched for; nothing to present` };
  return { ok: true, presentation, sequence: anchored.sequence };
}
