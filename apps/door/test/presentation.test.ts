// THE DOOR'S HALF OF A PRESENTATION'S PROOF OF POSSESSION (Ring 0 spec 445 §3.8, audit H-14) — checked without a chain.
//
// What must hold at the door: the subject's signature is read on the PRESENTING ESTATE's declared home chain (never
// this door's by default), an estate the register does not know or a chain the door cannot reach is refused by name,
// a v1 (bearer) presentation is refused unless the deployment opted in — and then it is graded bearer, all the way
// to the admission receipt.
import { describe, expect, it } from 'vitest';
import { authorityPresentationTypedData, buildProjection, commitmentOfV1, makeAuthorityPresentation, type AnchoredRoots, type AuthorityPresentationV1 } from '@agenticprimitives/estate-projection';
import { foreignEstateEvaluator, type AdmissionRequest } from '@agenticprimitives/admission';
import { recoverAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { acceptBearerV1From, presentationVerifier, type ChainSide } from '../src/presentation';

const GOV = '0x4457aadf6adeb31ba8f166fafcc0d0579ecd1015' as const;
const ANCHOR_CHAIN = 34348; // where the projection anchors and the door's registry lives
const HOME_CHAIN = 34349;   // where the presenting estate's people live — the chain a subject signs on
// Test-only keys (anvil vectors). The subject is an EOA here; the fake validator below is ecrecover, which is what the
// universal validator answers with for an EOA.
const subject = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const thief = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const SUBJECT = subject.address.toLowerCase() as `0x${string}`;
const THIEF = thief.address.toLowerCase() as `0x${string}`;
const VALIDATOR = '0xC70f4897A92D16a9CF04c1B8646A268cA0fBfE55' as Address;

const L1 = { digest: `0x${'11'.repeat(32)}` as Hex, blind: `0x${'a1'.repeat(32)}` as Hex, subject: SUBJECT };
const projection = buildProjection({ chainId: ANCHOR_CHAIN, governance: GOV, sequence: 4, liveGrants: [L1, { digest: `0x${'22'.repeat(32)}`, blind: `0x${'a2'.repeat(32)}`, subject: THIEF }], memberships: [] });
const DECLARED_SIGNER = ('0x' + '5e'.repeat(20)) as `0x${string}`;
const roots: AnchoredRoots = { estateId: projection.estateId, signer: DECLARED_SIGNER, sequence: 4, liveGrantRoot: projection.liveGrantRoot, membershipRoot: projection.membershipRoot, anchoredAt: 1_760_000_000 };
const challenge = { nonce: `0x${'cc'.repeat(32)}` as Hex, audience: 'https://door.example' };
const expectFor = (s: `0x${string}`) => ({ subject: s, ...challenge, now: 1_760_000_100, maxAgeSeconds: 3600 });

const signed = async (by: typeof subject, pres: AuthorityPresentationV1, chainId = HOME_CHAIN): Promise<AuthorityPresentationV1> =>
  ({ ...pres, subjectSignature: await by.signTypedData(authorityPresentationTypedData(pres, { chainId })) });
const estatesHalf = () => makeAuthorityPresentation(projection, 'live-grant', L1.digest, challenge)!;

/** A chain side that records where it was asked, and answers as the validator would for an EOA. */
function sides() {
  const asked: Array<{ chainId: number; validator: Address; signer: Address }> = [];
  const side = (chainId: number): ChainSide => ({
    validator: VALIDATOR,
    pub: { readContract: async ({ address, args }) => { asked.push({ chainId, validator: address, signer: args[0] }); return (await recoverAddress({ hash: args[1], signature: args[2] })).toLowerCase() === args[0].toLowerCase(); } },
  });
  return { asked, side };
}
const verifierWith = (over: Partial<Parameters<typeof presentationVerifier>[0]> = {}) => {
  const s = sides();
  const verify = presentationVerifier({ homeChainOf: (id) => (id === projection.estateId.toLowerCase() ? HOME_CHAIN : null), clientFor: (c) => s.side(c), ...over });
  return { verify, asked: s.asked };
};

describe('the door verifies the subject\'s signature on the presenting estate\'s home chain', () => {
  it('admits a v2 presentation the subject signed for this challenge — graded standing, asked on the HOME chain, once', async () => {
    const { verify, asked } = verifierWith();
    const v = await verify(await signed(subject, estatesHalf()), roots, expectFor(SUBJECT));
    expect(v).toMatchObject({ ok: true, set: 'live-grant', subject: SUBJECT, grade: 'standing' });
    expect(asked).toEqual([{ chainId: HOME_CHAIN, validator: VALIDATOR, signer: SUBJECT }]);
  });

  it('refuses the estate\'s half presented unsigned — and reads no account', async () => {
    const { verify, asked } = verifierWith();
    expect(await verify(estatesHalf(), roots, expectFor(SUBJECT))).toMatchObject({ ok: false, code: 'subject_signature_missing' });
    expect(asked).toEqual([]);
  });

  it('refuses a presentation someone saw and re-aimed at their own account, even signed by them', async () => {
    const { verify } = verifierWith();
    const reaimed = await signed(thief, { ...(await signed(subject, estatesHalf())), subject: THIEF });
    expect(await verify(reaimed, roots, expectFor(THIEF))).toMatchObject({ ok: false, code: 'opening_mismatch' });
  });

  it('refuses a signature made for another chain than the estate\'s home chain (the door\'s own chain is not a default)', async () => {
    const { verify } = verifierWith();
    expect(await verify(await signed(subject, estatesHalf(), ANCHOR_CHAIN), roots, expectFor(SUBJECT))).toMatchObject({ ok: false, code: 'subject_signature_invalid' });
  });

  it('refuses by name when the register has no row for the estate — no chain is guessed', async () => {
    const { verify, asked } = verifierWith({ homeChainOf: () => null });
    expect(await verify(await signed(subject, estatesHalf()), roots, expectFor(SUBJECT))).toMatchObject({ ok: false, code: 'subject_chain_undeclared' });
    expect(asked).toEqual([]);
  });

  it('refuses by name when the door cannot reach the estate\'s home chain — never verified on another', async () => {
    const { verify } = verifierWith({ clientFor: () => null });
    expect(await verify(await signed(subject, estatesHalf()), roots, expectFor(SUBJECT))).toMatchObject({ ok: false, code: 'subject_chain_unreachable' });
  });

  it('an unreadable chain is a refusal, not an acceptance', async () => {
    const { verify } = verifierWith({ clientFor: () => ({ validator: VALIDATOR, pub: { readContract: async () => { throw new Error('rpc down'); } } }) });
    expect(await verify(await signed(subject, estatesHalf()), roots, expectFor(SUBJECT))).toMatchObject({ ok: false, code: 'subject_signature_invalid' });
  });
});

describe('ACCEPT_BEARER_V1 — off unless the deployment says exactly "true"', () => {
  const v1Commitment = commitmentOfV1(L1.digest, L1.blind);
  const v1: AuthorityPresentationV1 = { type: 'ap.authority-presentation.v1', suite: 'merkle-membership-v1', estateId: projection.estateId, set: 'live-grant', sequence: 4, opening: { digest: L1.digest, blind: L1.blind }, commitment: v1Commitment, proof: [], subject: SUBJECT, ...challenge };
  const v1Roots: AnchoredRoots = { ...roots, liveGrantRoot: v1Commitment }; // a one-leaf tree: the root is the leaf

  it('reads the setting strictly', () => {
    expect(acceptBearerV1From('true')).toBe(true);
    for (const off of [undefined, '', 'TRUE', '1', 'yes', true, ' true']) expect(acceptBearerV1From(off)).toBe(false);
  });

  it('refuses a v1 presentation by default', async () => {
    const { verify } = verifierWith();
    expect(await verify(v1, v1Roots, expectFor(SUBJECT))).toMatchObject({ ok: false, code: 'bearer_v1_refused' });
  });

  it('admits it only when opted in, graded bearer — and the admission receipt says so', async () => {
    const { verify } = verifierWith({ acceptBearerV1: true });
    expect(await verify(v1, v1Roots, expectFor(SUBJECT))).toMatchObject({ ok: true, grade: 'bearer' });
    const ref = `estate:${projection.estateId.toLowerCase()}:presentation:${'ab'.repeat(16)}`;
    const request = { requestId: 'r1', actor: { actingAgentId: `eip155:${HOME_CHAIN}:${SUBJECT}` }, relationshipRefs: [], delegationRefs: [ref], entitlementRefs: [] } as unknown as AdmissionRequest;
    const evaluator = (accept: boolean) => foreignEstateEvaluator({
      resolvePresentation: async () => v1, declaredSigner: async () => DECLARED_SIGNER, readRoots: async () => v1Roots, verify: verifierWith({ acceptBearerV1: accept }).verify,
      challengeFor: () => challenge, maxAgeSeconds: 3600, now: () => 1_760_000_100,
    });
    const allowed = await evaluator(true).evaluate(request);
    expect(allowed.effect).toBe('ALLOW');
    expect(allowed.reasonCodes).toEqual(expect.arrayContaining(['FOREIGN_ESTATE_LIVE_GRANT', 'FOREIGN_ESTATE_BEARER_GRADE']));
    const refused = await evaluator(false).evaluate(request);
    expect(refused.effect).toBe('DENY');
    expect(refused.reasonCodes).toContain('FOREIGN_ESTATE_BEARER_V1_REFUSED');
  });

  it('opting in never weakens a v2 presentation: unsigned is still refused', async () => {
    const { verify } = verifierWith({ acceptBearerV1: true });
    expect(await verify(estatesHalf(), roots, expectFor(SUBJECT))).toMatchObject({ ok: false, code: 'subject_signature_missing' });
  });
});
