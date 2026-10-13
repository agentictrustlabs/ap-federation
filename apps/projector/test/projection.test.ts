// WHAT A VERIFIER LEARNS, AND WHAT IT MUST REFUSE — against Ring 0's own leaf construction (spec 410 §4).
//
// These are the invariants the receiving edge will depend on in F2, checked here without a chain: the roots
// are a function of the SET, a verifier reads the anchor itself, and every mismatch is a refusal with a code.
import { describe, expect, it } from 'vitest';
import { buildProjection, commitmentOf, estateIdOf, makeAuthorityPresentation, verifyAuthorityPresentation, type AnchoredRoots } from '@agenticprimitives/estate-projection';
import type { Hex } from 'viem';

const GOV = '0x4457aadf6adeb31ba8f166fafcc0d0579ecd1015' as const;
const CHAIN = 34348;
const SUBJECT = '0x013fb41c28fe7919f9abfa03884110ef629006e5' as const;
const OTHER = '0x813945dcebcaa1bdde46629ba19b2cb37280bc35' as const;
const leaf = (d: string, b: string, subject: `0x${string}` = SUBJECT) => ({ digest: `0x${d.repeat(32)}` as Hex, blind: `0x${b.repeat(32)}` as Hex, subject });

const L1 = leaf('11', 'a1');
const L2 = leaf('22', 'a2', OTHER);
const L3 = leaf('33', 'a3');

const projectionOf = (grants: ReturnType<typeof leaf>[], sequence = 4) =>
  buildProjection({ chainId: CHAIN, governance: GOV, sequence, liveGrants: grants, memberships: [], now: () => new Date('2026-10-13T00:00:00.000Z') });

const anchorOf = (p: ReturnType<typeof projectionOf>, over: Partial<AnchoredRoots> = {}): AnchoredRoots => ({
  estateId: p.estateId, sequence: p.sequence, liveGrantRoot: p.liveGrantRoot, membershipRoot: p.membershipRoot, anchoredAt: 1_760_000_000, ...over,
});
const challenge = { nonce: `0x${'cc'.repeat(32)}` as Hex, audience: 'https://edge.faithnet.io' };
const expectFor = (subject: `0x${string}`, over: Partial<{ now: number; maxAgeSeconds: number }> = {}) =>
  ({ subject, ...challenge, now: 1_760_000_100, maxAgeSeconds: 3600, ...over });

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
  it('verifies one leaf against the roots the verifier read, and says only live / member', () => {
    const p = projectionOf([L1, L2, L3]);
    const pres = makeAuthorityPresentation(p, 'live-grant', L1.digest, challenge)!;
    const v = verifyAuthorityPresentation(pres, anchorOf(p), expectFor(SUBJECT));
    expect(v).toEqual({ ok: true, estateId: p.estateId, set: 'live-grant', sequence: 4, subject: SUBJECT });
  });

  it('is refused when it is about someone else', () => {
    const p = projectionOf([L1, L2, L3]);
    const pres = makeAuthorityPresentation(p, 'live-grant', L1.digest, challenge)!;
    expect(verifyAuthorityPresentation(pres, anchorOf(p), expectFor(OTHER))).toMatchObject({ ok: false, code: 'subject_mismatch' });
  });

  it('is refused when the anchor has moved on — a stale sequence is never a cached acceptance', () => {
    const p = projectionOf([L1, L2, L3]);
    const pres = makeAuthorityPresentation(p, 'live-grant', L1.digest, challenge)!;
    expect(verifyAuthorityPresentation(pres, anchorOf(p, { sequence: 5 }), expectFor(SUBJECT))).toMatchObject({ ok: false, code: 'stale' });
  });

  it('is refused when it names a sequence the registry has not anchored — not fetched', () => {
    const p = projectionOf([L1, L2, L3]);
    const pres = makeAuthorityPresentation(p, 'live-grant', L1.digest, challenge)!;
    expect(verifyAuthorityPresentation(pres, anchorOf(p, { sequence: 3 }), expectFor(SUBJECT))).toMatchObject({ ok: false, code: 'ahead_of_anchor' });
  });

  it('is refused once the anchored projection is older than the verifier\'s own freshness window', () => {
    const p = projectionOf([L1, L2, L3]);
    const pres = makeAuthorityPresentation(p, 'live-grant', L1.digest, challenge)!;
    expect(verifyAuthorityPresentation(pres, anchorOf(p), expectFor(SUBJECT, { maxAgeSeconds: 10 }))).toMatchObject({ ok: false, code: 'stale' });
  });

  it('is refused when the opening does not commit to the leaf', () => {
    const p = projectionOf([L1, L2, L3]);
    const pres = makeAuthorityPresentation(p, 'live-grant', L1.digest, challenge)!;
    const tampered = { ...pres, opening: { digest: L1.digest, blind: L2.blind } };
    expect(verifyAuthorityPresentation(tampered, anchorOf(p), expectFor(SUBJECT))).toMatchObject({ ok: false, code: 'opening_mismatch' });
  });

  it('cannot be made for a leaf the estate does not vouch for', () => {
    expect(makeAuthorityPresentation(projectionOf([L1, L2]), 'live-grant', L3.digest, challenge)).toBeNull();
  });

  it('cannot be forged from a GUESSED digest, because the blind is not derived from anything public', () => {
    const p = projectionOf([L1, L2, L3]);
    // Someone who knows the grant hash (they are on chain when spent) still cannot produce the leaf.
    expect(commitmentOf(L1.digest, `0x${'ff'.repeat(32)}`)).not.toBe(commitmentOf(L1.digest, L1.blind));
    expect(p.leaves.liveGrant.some((l) => l.commitment === commitmentOf(L1.digest, `0x${'ff'.repeat(32)}`))).toBe(false);
  });
});
