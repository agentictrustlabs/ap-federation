// INCLUSION NEEDS A SUBMISSION; EXCLUSION NEEDS ONLY THE TRUTH.
import { describe, expect, it, vi } from 'vitest';
import { pruneLive } from '../src/liveness.js';
import type { SubmissionV1 } from '../src/ledger.js';

const row = (over: Partial<SubmissionV1> = {}): SubmissionV1 => ({
  type: 'ap.federation-submission.v1', estate: 'imbnet', set: 'live-grant',
  digest: `0x${'11'.repeat(32)}`, blind: `0x${'22'.repeat(32)}`,
  subject: '0x000000000000000000000000000000000000beef', submittedBy: 'test', source: 'test',
  submittedAt: '2026-10-13T00:00:00.000Z', ...over,
});

describe('pruneLive', () => {
  it('keeps a grant the chain says is live', async () => {
    const out = await pruneLive([row()], 'live-grant', { isRevoked: async () => false });
    expect(out.kept).toHaveLength(1);
    expect(out.dropped).toHaveLength(0);
  });

  it('drops a grant the chain says is revoked, with nobody having to tell it', async () => {
    const out = await pruneLive([row()], 'live-grant', { isRevoked: async () => true });
    expect(out.kept).toHaveLength(0);
    expect(out.dropped[0]!.reason).toMatch(/revoked/);
  });

  it('drops a grant whose revocation state could not be READ — an error is not a "probably live"', async () => {
    const out = await pruneLive([row()], 'live-grant', { isRevoked: async () => { throw new Error('rpc down'); } });
    expect(out.kept).toHaveLength(0);
    expect(out.dropped[0]!.reason).toMatch(/could not be read/);
  });

  it('drops an expired leaf and a retired one without asking the chain', async () => {
    const isRevoked = vi.fn(async () => false);
    const out = await pruneLive([
      row({ expiresAt: '2026-10-12T00:00:00.000Z' }),
      row({ digest: `0x${'33'.repeat(32)}`, retired: { at: '2026-10-13T00:00:00.000Z', reason: 'the person withdrew it' } }),
    ], 'live-grant', { isRevoked, now: () => new Date('2026-10-13T12:00:00.000Z') });
    expect(out.kept).toHaveLength(0);
    expect(out.dropped.map((d) => d.reason)).toEqual([expect.stringMatching(/expires/), expect.stringMatching(/withdrew/)]);
    expect(isRevoked).not.toHaveBeenCalled();
  });

  it('does not ask the DelegationManager about a MEMBERSHIP digest — it is not a delegation hash', async () => {
    const isRevoked = vi.fn(async () => true);
    const out = await pruneLive([row({ set: 'membership' })], 'membership', { isRevoked });
    expect(out.kept).toHaveLength(1);
    expect(isRevoked).not.toHaveBeenCalled();
  });

  it('ignores rows belonging to the other set', async () => {
    const out = await pruneLive([row({ set: 'membership' })], 'live-grant', { isRevoked: async () => false });
    expect(out.kept).toHaveLength(0);
    expect(out.dropped).toHaveLength(0);
  });
});
