import { describe, expect, it } from 'vitest';
import { collapseRecord, fullRecordUntil, retentionDays } from '../src/receipt-retention';

describe('receipt retention — the parties leave, the chain stays', () => {
  it('a collapsed receipt keeps kind · effect · codes · decision · the predicate facts, and drops the account, the detail, the references', () => {
    const c = collapseRecord({ kind: 'door.decision', effect: 'ADMIT', reasonCodes: ['CREDENTIAL_PREDICATE_HELD'], decisionId: 'd1', estateId: 'impact-agent', at: '2026-10-16T00:00:00.000Z', actingAgentId: 'eip155:1:0xabc', subjectDigest: 'sha256:x', detail: 'who', reference: 'member-1', credential: { issuerKeyId: 'k', predicateDigest: '0x1', nullifierGrade: 'asserted', ref: 'credential:k:presentation:abc' } }, '2026-11-16T00:00:00.000Z');
    expect(c).toEqual({ kind: 'door.decision', effect: 'ADMIT', reasonCodes: ['CREDENTIAL_PREDICATE_HELD'], decisionId: 'd1', estateId: 'impact-agent', at: '2026-10-16T00:00:00.000Z', credential: { issuerKeyId: 'k', predicateDigest: '0x1', nullifierGrade: 'asserted' }, collapsed: true, collapsedAt: '2026-11-16T00:00:00.000Z' });
    expect(JSON.stringify(c)).not.toMatch(/0xabc|sha256:x|who|member-1|presentation:abc/);
  });
  it('names the window and refuses a nonsense retention', () => {
    expect(fullRecordUntil('2026-10-16T00:00:00.000Z', 30)).toBe('2026-11-15T00:00:00.000Z');
    expect(retentionDays(undefined)).toBe(30);
    expect(retentionDays('7')).toBe(7);
    expect(() => retentionDays('0')).toThrow(/positive integer/);
  });
});
