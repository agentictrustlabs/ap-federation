// WHAT A VERIFIER LEARNS, AND WHAT IT MUST REFUSE — against Ring 0's own leaf construction (spec 410 §4).
//
// These are the invariants the receiving edge will depend on in F2, checked here without a chain: the roots
// are a function of the SET, a verifier reads the anchor itself, and every mismatch is a refusal with a code.
//
// Since Ring 0 spec 445 §3.8 (audit H-14) a presentation is PROOF OF POSSESSION: the leaf commits to its subject and
// the subject signs the verifier's challenge (EIP-712, on the chain its account lives on). The estate's half
// (`makeAuthorityPresentation`) is therefore unsigned and not yet presentable; the subject's runtime signs it.
import { describe, expect, it } from 'vitest';
import {
  authorityPresentationDigest, authorityPresentationTypedData, buildProjection, commitmentOf, commitmentOfV1, estateIdOf,
  makeAuthorityPresentation, verifyAuthorityPresentation, type AnchoredRoots, type AuthorityPresentationV1,
} from '@agenticprimitives/estate-projection';
import { recoverAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const GOV = '0x4457aadf6adeb31ba8f166fafcc0d0579ecd1015' as const;
const CHAIN = 34348;
/** The chain the SUBJECT's account lives on (the EIP-712 domain) — deliberately not the estate's anchoring chain. */
const SUBJECT_CHAIN = 34349;
// Test-only keys (well-known anvil vectors): the subject is an EOA here, which the universal validator answers for as
// it does for a Smart Agent; the check below is the offline equivalent (ecrecover).
const subjectAccount = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const otherAccount = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const SUBJECT = subjectAccount.address.toLowerCase() as `0x${string}`;
const OTHER = otherAccount.address.toLowerCase() as `0x${string}`;
const leaf = (d: string, b: string, subject: `0x${string}` = SUBJECT) => ({ digest: `0x${d.repeat(32)}` as Hex, blind: `0x${b.repeat(32)}` as Hex, subject });

const L1 = leaf('11', 'a1');
const L2 = leaf('22', 'a2', OTHER);
const L3 = leaf('33', 'a3');

const projectionOf = (grants: ReturnType<typeof leaf>[], sequence = 4) =>
  buildProjection({ chainId: CHAIN, governance: GOV, sequence, liveGrants: grants, memberships: [], now: () => new Date('2026-10-13T00:00:00.000Z') });

const anchorOf = (p: ReturnType<typeof projectionOf>, over: Partial<AnchoredRoots> = {}): AnchoredRoots => ({
  estateId: p.estateId, signer: '0x5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e', sequence: p.sequence, liveGrantRoot: p.liveGrantRoot, membershipRoot: p.membershipRoot, anchoredAt: 1_760_000_000, ...over,
});
const challenge = { nonce: `0x${'cc'.repeat(32)}` as Hex, audience: 'https://edge.faithnet.io' };
const expectFor = (subject: `0x${string}`, over: Partial<{ now: number; maxAgeSeconds: number }> = {}) =>
  ({ subject, ...challenge, now: 1_760_000_100, maxAgeSeconds: 3600, ...over });

/** The subject's half: sign the estate's unsigned presentation for THIS challenge, on the subject's chain. */
const signAs = async (account: typeof subjectAccount, pres: AuthorityPresentationV1, chainId = SUBJECT_CHAIN): Promise<AuthorityPresentationV1> =>
  ({ ...pres, subjectSignature: await account.signTypedData(authorityPresentationTypedData(pres, { chainId })) });
/** The verifier's half, as the door wires it — here ecrecover stands in for the UniversalSignatureValidator read. */
let signatureReads = 0;
const opts = {
  chainId: SUBJECT_CHAIN,
  verifySubjectSignature: async (subject: `0x${string}`, digest: Hex, signature: Hex) => { signatureReads++; return (await recoverAddress({ hash: digest, signature })).toLowerCase() === subject.toLowerCase(); },
};
const presented = async (p: ReturnType<typeof projectionOf>, digest: Hex = L1.digest) => signAs(subjectAccount, makeAuthorityPresentation(p, 'live-grant', digest, challenge)!);

describe('the estate id', () => {
  it('derives from the chain and the governance address, and matches what the DEPLOYED contract returns', () => {
    // Vector read from EstateProjectionRegistry 0xb4E116F5C6915a4f1e649E0877e4a0A7a1c1147b on faithchain
    // (`estateIdOf(34348, 0x…dEaD)`), so the SDK and the contract are pinned to each other here.
    expect(estateIdOf(34348, '0x000000000000000000000000000000000000dEaD')).toBe('0xaf931cb3336bd0a0f7a22b439badafd19b7e488c9bbd57969aa633e361b36e36');
  });

  it('is chain-scoped: the same governance on another chain is another estate', () => {
    expect(estateIdOf(1, GOV)).not.toBe(estateIdOf(CHAIN, GOV));
  });
});

describe('the roots', () => {
  it('are a function of the SET, not of the order it was submitted in', () => {
    expect(projectionOf([L1, L2, L3]).liveGrantRoot).toBe(projectionOf([L3, L1, L2]).liveGrantRoot);
  });

  it('move when a leaf leaves the set — which is how revocation reaches a verifier', () => {
    expect(projectionOf([L1, L2, L3]).liveGrantRoot).not.toBe(projectionOf([L1, L3]).liveGrantRoot);
  });

  it('are 0x00…00 for an empty set — the same value as "never anchored", and both refuse everything', () => {
    expect(projectionOf([]).liveGrantRoot).toBe(`0x${'00'.repeat(32)}`);
  });
});

describe('a presentation', () => {
  it('verifies one leaf against the roots the verifier read, and says only live / member — graded standing', async () => {
    const p = projectionOf([L1, L2, L3]);
    const pres = await presented(p);
    expect(pres.suite).toBe('merkle-membership-v2');
    const v = await verifyAuthorityPresentation(pres, anchorOf(p), expectFor(SUBJECT), opts);
    expect(v).toEqual({ ok: true, estateId: p.estateId, set: 'live-grant', sequence: 4, subject: SUBJECT, grade: 'standing' });
  });

  it('is refused when it is about someone else', async () => {
    const p = projectionOf([L1, L2, L3]);
    expect(await verifyAuthorityPresentation(await presented(p), anchorOf(p), expectFor(OTHER), opts)).toMatchObject({ ok: false, code: 'subject_mismatch' });
  });

  it('is refused when the anchor has moved on — a stale sequence is never a cached acceptance', async () => {
    const p = projectionOf([L1, L2, L3]);
    expect(await verifyAuthorityPresentation(await presented(p), anchorOf(p, { sequence: 5 }), expectFor(SUBJECT), opts)).toMatchObject({ ok: false, code: 'stale' });
  });

  it('is refused when it names a sequence the registry has not anchored — not fetched', async () => {
    const p = projectionOf([L1, L2, L3]);
    expect(await verifyAuthorityPresentation(await presented(p), anchorOf(p, { sequence: 3 }), expectFor(SUBJECT), opts)).toMatchObject({ ok: false, code: 'ahead_of_anchor' });
  });

  it('is refused once the anchored projection is older than the verifier\'s own freshness window', async () => {
    const p = projectionOf([L1, L2, L3]);
    expect(await verifyAuthorityPresentation(await presented(p), anchorOf(p), expectFor(SUBJECT, { maxAgeSeconds: 10 }), opts)).toMatchObject({ ok: false, code: 'stale' });
  });

  it('is refused when the opening does not commit to the leaf', async () => {
    const p = projectionOf([L1, L2, L3]);
    const tampered = { ...(await presented(p)), opening: { digest: L1.digest, blind: L2.blind } };
    expect(await verifyAuthorityPresentation(tampered, anchorOf(p), expectFor(SUBJECT), opts)).toMatchObject({ ok: false, code: 'opening_mismatch' });
  });

  it('cannot be made for a leaf the estate does not vouch for', () => {
    expect(makeAuthorityPresentation(projectionOf([L1, L2]), 'live-grant', L3.digest, challenge)).toBeNull();
  });

  it('cannot be forged from a GUESSED digest, because the blind is not derived from anything public', () => {
    const p = projectionOf([L1, L2, L3]);
    // Someone who knows the grant hash (they are on chain when spent) still cannot produce the leaf.
    expect(commitmentOf(L1.digest, `0x${'ff'.repeat(32)}`, SUBJECT)).not.toBe(commitmentOf(L1.digest, L1.blind, SUBJECT));
    expect(p.leaves.liveGrant.some((l) => l.commitment === commitmentOf(L1.digest, `0x${'ff'.repeat(32)}`, SUBJECT))).toBe(false);
  });
});

// Ring 0 spec 445 §3.8 (audit H-14) — the twins a bearer value would have passed.
describe('a presentation is proof of possession, not a bearer value', () => {
  it('the estate\'s half alone is not presentable: without the subject\'s signature it is refused, and no account is read', async () => {
    const p = projectionOf([L1, L2, L3]);
    const unsigned = makeAuthorityPresentation(p, 'live-grant', L1.digest, challenge)!;
    expect(unsigned.subjectSignature).toBeUndefined();
    const before = signatureReads;
    expect(await verifyAuthorityPresentation(unsigned, anchorOf(p), expectFor(SUBJECT), opts)).toMatchObject({ ok: false, code: 'subject_signature_missing' });
    expect(signatureReads).toBe(before);
  });

  it('a presentation someone SAW and re-aimed at themselves does not open the leaf — even when they sign it', async () => {
    const p = projectionOf([L1, L2, L3]);
    const seen = await presented(p);
    // The thief rewrites the subject to its own account and signs the challenge with its own key: under v1 that passed.
    const reaimed = await signAs(otherAccount, { ...seen, subject: OTHER });
    expect(await verifyAuthorityPresentation(reaimed, anchorOf(p), expectFor(OTHER), opts)).toMatchObject({ ok: false, code: 'opening_mismatch' });
  });

  it('a signature by anyone but the committed subject is refused', async () => {
    const p = projectionOf([L1, L2, L3]);
    const forged = await signAs(otherAccount, makeAuthorityPresentation(p, 'live-grant', L1.digest, challenge)!);
    expect(await verifyAuthorityPresentation(forged, anchorOf(p), expectFor(SUBJECT), opts)).toMatchObject({ ok: false, code: 'subject_signature_invalid' });
  });

  it('a signature for one door\'s challenge is useless at the next (nonce and audience are inside what was signed)', async () => {
    const p = projectionOf([L1, L2, L3]);
    const forDoorA = await presented(p);
    const atDoorB = { ...forDoorA, nonce: `0x${'dd'.repeat(32)}` as Hex, audience: 'https://another.door.example' };
    expect(await verifyAuthorityPresentation(atDoorB, anchorOf(p), { ...expectFor(SUBJECT), nonce: atDoorB.nonce, audience: atDoorB.audience }, opts)).toMatchObject({ ok: false, code: 'subject_signature_invalid' });
  });

  it('the chain is declared or it is an error: signed for one chain, verified on another, is refused; no chain is refused by name', async () => {
    const p = projectionOf([L1, L2, L3]);
    const pres = await presented(p);
    expect(await verifyAuthorityPresentation(pres, anchorOf(p), expectFor(SUBJECT), { ...opts, chainId: CHAIN })).toMatchObject({ ok: false, code: 'subject_signature_invalid' });
    expect(await verifyAuthorityPresentation(pres, anchorOf(p), expectFor(SUBJECT), { verifySubjectSignature: opts.verifySubjectSignature })).toMatchObject({ ok: false, code: 'chain_undeclared' });
    expect(await verifyAuthorityPresentation(pres, anchorOf(p), expectFor(SUBJECT), { chainId: SUBJECT_CHAIN })).toMatchObject({ ok: false, code: 'subject_signature_unverifiable' });
    expect(() => authorityPresentationDigest(pres, {} as { chainId: number })).toThrow(/chainId must be declared/);
  });

  it('a v1 (pre-445) presentation is refused by default, and graded BEARER when a verifier opts in', async () => {
    const p = projectionOf([L1, L2, L3]);
    // What an estate that has not re-anchored still holds: the same rows under the subject-free leaf.
    const v1Commitment = commitmentOfV1(L1.digest, L1.blind);
    const v1: AuthorityPresentationV1 = { type: 'ap.authority-presentation.v1', suite: 'merkle-membership-v1', estateId: p.estateId, set: 'live-grant', sequence: 4, opening: { digest: L1.digest, blind: L1.blind }, commitment: v1Commitment, proof: [], subject: SUBJECT, ...challenge };
    const anchoredV1 = anchorOf(p, { liveGrantRoot: v1Commitment }); // a one-leaf tree: the root is the leaf
    expect(await verifyAuthorityPresentation(v1, anchoredV1, expectFor(SUBJECT), opts)).toMatchObject({ ok: false, code: 'bearer_v1_refused' });
    expect(await verifyAuthorityPresentation(v1, anchoredV1, expectFor(SUBJECT), { ...opts, acceptBearerV1: true })).toMatchObject({ ok: true, grade: 'bearer' });
  });
});
