// WHEN TO SPEND A SEQUENCE — the one policy decision the projector makes on its own.
import { describe, expect, it } from 'vitest';
import { anchorDecision, ZERO_32, type AnchoredState } from '../src/anchor.js';

const A = '0xaaaa000000000000000000000000000000000000000000000000000000000001' as const;
const B = '0xbbbb000000000000000000000000000000000000000000000000000000000002' as const;
const anchored = (over: Partial<AnchoredState> = {}): AnchoredState => ({
  liveGrantRoot: A, membershipRoot: B, charterHash: ZERO_32, sequence: 7, anchoredAt: 1_000_000, never: false, ...over,
});

describe('anchorDecision', () => {
  it('anchors at sequence 1 when nothing has ever been anchored', () => {
    const d = anchorDecision({ anchored: anchored({ sequence: 0, never: true, liveGrantRoot: ZERO_32, membershipRoot: ZERO_32 }), liveGrantRoot: A, membershipRoot: B, now: 1_000_000, refreshAfterSeconds: 3600 });
    expect(d).toMatchObject({ anchor: true, sequence: 1, changed: true });
  });

  it('anchors at the next sequence when what the estate vouches for has changed', () => {
    const d = anchorDecision({ anchored: anchored(), liveGrantRoot: B, membershipRoot: B, now: 1_000_010, refreshAfterSeconds: 3600 });
    expect(d).toMatchObject({ anchor: true, sequence: 8, changed: true });
  });

  it('does NOT anchor an unchanged, still-fresh projection — the sequence would invalidate presentations in flight', () => {
    const d = anchorDecision({ anchored: anchored(), liveGrantRoot: A, membershipRoot: B, now: 1_000_600, refreshAfterSeconds: 3600 });
    expect(d.anchor).toBe(false);
    expect(d.sequence).toBe(7);
    expect(d.why).toMatch(/in flight/);
  });

  it('re-anchors an UNCHANGED projection once the anchor ages past the refresh window', () => {
    // There is no way to refresh `anchoredAt` without raising the sequence, so an estate whose set never
    // moves must still anchor or every presentation against it ages out of every verifier's window.
    const d = anchorDecision({ anchored: anchored(), liveGrantRoot: A, membershipRoot: B, now: 1_000_000 + 3601, refreshAfterSeconds: 3600 });
    expect(d).toMatchObject({ anchor: true, sequence: 8, changed: false });
    expect(d.why).toMatch(/freshness window/);
  });

  it('treats a changed charter hash as a change', () => {
    const d = anchorDecision({ anchored: anchored(), liveGrantRoot: A, membershipRoot: B, charterHash: A, now: 1_000_001, refreshAfterSeconds: 3600 });
    expect(d).toMatchObject({ anchor: true, changed: true });
  });
});
