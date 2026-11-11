// THE PRESENTATION'S SUBJECT SIGNATURE, AS THIS DOOR CHECKS IT (Ring 0 spec 445 §3.8, audit H-14).
//
// A cross-estate authority presentation is PROOF OF POSSESSION, not a bearer value: its leaf commits to its subject
// (`merkle-membership-v2`) and the subject's Smart Agent signs THIS door's challenge — EIP-712, domain
// `AgenticAuthorityPresentation` v2. `estate-projection.verifyAuthorityPresentation` does the judging; this module is
// what the door binds into it: WHICH CHAIN the subject's account is asked on, and the read itself.
//
// WHICH CHAIN. The subject is a FOREIGN agent, so the chain is never this door's because it is at hand, and it is never
// defaulted. It is the presenting estate's declared HOME chain — `homeChainId` (where its people live: their accounts,
// their custody) or, absent that, `chainId` — read from the register row whose governance derives the presentation's
// estate id. That is the chain where the estate's custody is current: an account address can exist counterfactually on
// another chain under credentials its owner has since rotated out, and a signature read there would speak for them.
//   · the estate is not in the register        → `subject_chain_undeclared`  (refused: nothing declares a chain)
//   · the door cannot reach that chain          → `subject_chain_unreachable` (refused; never verified elsewhere)
// The request proof is a separate check with its own chain (the one the signer's CAIP-10 names); the two usually
// coincide and nothing here assumes they do.
//
// THE READ. One mechanism (ADR-0013): that chain's `UniversalSignatureValidator.isValidSig(subject, digest, signature)`
// — ECDSA for an EOA, ERC-1271 for a deployed Smart Agent, ERC-6492 for a counterfactual one. The digest is the EIP-712
// digest, passed as it is (the request proof's EIP-191 wrapping is that proof's form, not this one's).
//
// BEARER (v1). A presentation built from a projection anchored before spec 445 names no subject in its leaf and carries
// no signature: anyone who saw it could present it. It is refused unless the door was DEPLOYED with
// `ACCEPT_BEARER_V1 = "true"` — off by default, a changeover allowance only (docs/runbooks/before-real-users.md) — and
// then the verdict is graded `bearer`, the receipt carries `FOREIGN_ESTATE_BEARER_GRADE`, and the door forwards no
// standing header for it.
import { verifyAuthorityPresentation, type AnchoredRoots, type AuthorityPresentationV1, type PresentationVerdict } from '@agenticprimitives/estate-projection';
import type { Address, Hex } from 'viem';

export const VALIDATOR_ABI = [
  { type: 'function', name: 'isValidSig', stateMutability: 'view', inputs: [{ name: 'signer', type: 'address' }, { name: 'hash', type: 'bytes32' }, { name: 'sig', type: 'bytes' }], outputs: [{ type: 'bool' }] },
] as const;

/** What the door needs of a chain to ask an account about a signature: a contract read and that chain's validator. */
export interface ChainSide {
  pub: { readContract(args: { address: Address; abi: typeof VALIDATOR_ABI; functionName: 'isValidSig'; args: readonly [Address, Hex, Hex] }): Promise<unknown> };
  validator: Address;
}

export interface PresentationVerifierDeps {
  /** The presenting estate's declared home chain, from the register — `null` when the register has no row for the id. */
  homeChainOf(estateId: string): number | null;
  /** A read client and validator for one chain, or `null` when this deployment cannot reach it. Never another chain's. */
  clientFor(chainId: number): ChainSide | null;
  /** `ACCEPT_BEARER_V1` as deployed. Anything but true is off. */
  acceptBearerV1?: boolean;
}

export type DoorPresentationVerdict =
  | PresentationVerdict
  | { ok: false; code: 'subject_chain_undeclared' | 'subject_chain_unreachable'; reason: string };

type Expect = { subject: `0x${string}`; nonce: Hex; audience: string; now: number; maxAgeSeconds: number };

/** Only the exact string "true" turns the allowance on — an empty var, "1", "yes" or a typo leaves the door strict. */
export const acceptBearerV1From = (value: unknown): boolean => value === 'true';

/** The `verify` the foreign-estate evaluator is handed: Ring 0's verifier with this door's chain and signature read bound in. */
export function presentationVerifier(deps: PresentationVerifierDeps) {
  const acceptBearerV1 = deps.acceptBearerV1 === true;
  return async (presentation: unknown, roots: AnchoredRoots, expect: Expect): Promise<DoorPresentationVerdict> => {
    const pres = presentation as AuthorityPresentationV1;
    // A v1 presentation carries no signature, so there is no chain to ask: Ring 0 refuses it, or grades it bearer.
    if (pres?.suite !== 'merkle-membership-v2') return verifyAuthorityPresentation(pres, roots, expect, { acceptBearerV1 });
    const chainId = deps.homeChainOf(String(pres.estateId ?? '').toLowerCase());
    if (chainId === null) return { ok: false, code: 'subject_chain_undeclared', reason: 'the presenting estate is not in this door\'s register, so nothing declares the chain its subjects sign on; a chain is never defaulted' };
    const side = deps.clientFor(chainId);
    if (!side) return { ok: false, code: 'subject_chain_unreachable', reason: `this door has no endpoint or validator for eip155:${chainId}, the presenting estate's home chain; the signature is never read on another chain` };
    return verifyAuthorityPresentation(pres, roots, expect, {
      chainId, acceptBearerV1,
      verifySubjectSignature: async (subject, digest, signature) =>
        (await side.pub.readContract({ address: side.validator, abi: VALIDATOR_ABI, functionName: 'isValidSig', args: [subject, digest, signature] })) === true,
    });
  };
}
