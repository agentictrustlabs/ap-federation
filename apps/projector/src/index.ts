// @ap-federation/projector — spec 439 F1. An estate's authority, projected onto neutral ground.
//
// The estate commits to its live set; a counterparty in another estate proves one leaf against the root it
// reads itself. Nothing here is authority: a presentation says "this subject holds a live grant in estate E
// as of sequence N", and whether anything may happen is the receiving estate's own mandate (ADR-0056).
export { loadFederation, estateById, requireProjectable, registryRpc, signerKey, type Federation, type EstateRow, type RegistryRow, type ProjectableEstate } from './config.js';
export { fileLedger, leafOf, newBlind, type SubmissionLedger, type SubmissionV1, type ProjectionSet } from './ledger.js';
export { pruneLive, type LivenessDeps, type PruneOutcome } from './liveness.js';
export { registryClient, anchorDecision, ESTATE_PROJECTION_REGISTRY_ABI, ZERO_32, type RegistryClient, type AnchoredState, type AnchorDecision } from './anchor.js';
export { isRevokedReader, estateRpc, IS_REVOKED_ABI } from './revocation.js';
export { projectEstate, buildForSequence, type ProjectionRun, type ProjectDeps } from './project.js';
