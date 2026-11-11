// THE ESTATE'S RECORD OF WHAT IT VOUCHES FOR — and the opening nobody else should hold.
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileLedger, leafOf } from '../src/ledger.js';
import { buildIssuerProjection, buildProjection, commitmentOf, commitmentOfV1 } from '@agenticprimitives/estate-projection';

const dir = () => mkdtempSync(join(tmpdir(), 'ap-fed-'));
const base = { estate: 'impact-agent', set: 'live-grant' as const, subject: '0x000000000000000000000000000000000000beef' as const, submittedBy: 'maya', source: 'test' };

describe('fileLedger', () => {
  it('gives every leaf its own random blind, and the file is 0600', () => {
    const path = join(dir(), 'impact-agent.json');
    const l = fileLedger(path);
    const a = l.add({ ...base, digest: `0x${'11'.repeat(32)}` });
    const b = l.add({ ...base, digest: `0x${'22'.repeat(32)}` });
    expect(a.row.blind).not.toEqual(b.row.blind);
    expect(a.row.blind).toMatch(/^0x[0-9a-f]{64}$/);
    // Without the blind the commitment cannot be reconstructed from the digest alone — which is the whole
    // reason a root over guessable grant hashes is safe to publish.
    expect(commitmentOf(a.row.digest, b.row.blind, a.row.subject)).not.toEqual(leafOf(a.row).commitment);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toHaveLength(2);
  });

  it('refuses a second submission of the same digest in the same set, and says so', () => {
    const l = fileLedger(join(dir(), 'impact-agent.json'));
    const first = l.add({ ...base, digest: `0x${'11'.repeat(32)}` });
    const again = l.add({ ...base, digest: `0x${'11'.repeat(32)}` });
    expect(again.added).toBe(false);
    expect(again.why).toMatch(/already vouched/);
    expect(again.row.blind).toEqual(first.row.blind);
  });

  it('retires a row instead of deleting it — a projection that stopped including something is evidence', () => {
    const path = join(dir(), 'impact-agent.json');
    const l = fileLedger(path);
    const digest = `0x${'11'.repeat(32)}` as const;
    l.add({ ...base, digest });
    expect(l.retire('live-grant', digest, 'the person withdrew it')).toBe(true);
    expect(l.retire('live-grant', digest, 'again')).toBe(false);
    const rows = l.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.retired?.reason).toBe('the person withdrew it');
    // Retired, so the same digest may be vouched for again later without rewriting history.
    expect(l.add({ ...base, digest }).added).toBe(true);
    expect(l.list()).toHaveLength(2);
  });

  it('keeps the two sets apart: the same digest may be a grant here and a membership there', () => {
    const l = fileLedger(join(dir(), 'impact-agent.json'));
    const digest = `0x${'11'.repeat(32)}` as const;
    expect(l.add({ ...base, digest }).added).toBe(true);
    expect(l.add({ ...base, set: 'membership', digest }).added).toBe(true);
  });

  // Ring 0 spec 445 §3.8 (audit H-14): the estate leaf names its subject; the issuer leaf, which is about a credential, does not.
  it('commits the SUBJECT into an estate leaf — the same opening under another subject is another leaf', () => {
    const l = fileLedger(join(dir(), 'impact-agent.json'));
    const { row } = l.add({ ...base, digest: `0x${'11'.repeat(32)}` });
    const leaf = leafOf(row);
    expect(leaf.commitment).toEqual(commitmentOf(row.digest, row.blind, row.subject));
    expect(leaf.commitment).not.toEqual(commitmentOf(row.digest, row.blind, '0x000000000000000000000000000000000000dead'));
    expect(leaf.commitment).not.toEqual(commitmentOfV1(row.digest, row.blind));
    // …and it is the leaf Ring 0's builder puts on the tree, so the ledger and the anchored root cannot drift apart.
    const p = buildProjection({ chainId: 34348, governance: '0x4457aadf6adeb31ba8f166fafcc0d0579ecd1015', sequence: 1, liveGrants: [leaf], memberships: [] });
    expect(p.suite).toBe('merkle-membership-v2');
    expect(p.leaves.liveGrant[0]!.commitment).toEqual(leaf.commitment);
  });

  it('keeps an ISSUER\'s live-credential leaf subject-free — it is about a credential, not an account', () => {
    const l = fileLedger(join(dir(), 'issuer.json'));
    const { row } = l.add({ ...base, set: 'live-credential', digest: `0x${'22'.repeat(32)}` });
    const leaf = leafOf(row);
    expect(leaf.commitment).toEqual(commitmentOfV1(row.digest, row.blind));
    const p = buildIssuerProjection({ chainId: 34348, issuer: '0x4457aadf6adeb31ba8f166fafcc0d0579ecd1015', sequence: 1, liveCredentials: [leaf] });
    expect(p.leaves[0]!.commitment).toEqual(leaf.commitment);
  });
});

// REG-2 (spec 445, generation 4): the row an estate anchors under is the estate's DECLARED signer's.
import { rowSignerOf } from '../src/project.js';
describe('the row signer (generation 4)', () => {
  const estate = { id: 'e', signer: '0x1111111111111111111111111111111111111111' } as never;
  it('is the declared signer when it agrees with the register', () => {
    expect(rowSignerOf(estate, { declared: true, signer: '0x1111111111111111111111111111111111111111' })).toBe('0x1111111111111111111111111111111111111111');
  });
  it('refuses a declaration that disagrees with the register — nothing anchors under a guess', () => {
    expect(() => rowSignerOf(estate, { declared: true, signer: '0x2222222222222222222222222222222222222222' })).toThrow(/register is stale/);
  });
  it('falls back to the register claim only when nothing is declared, and refuses when there is neither', () => {
    expect(rowSignerOf(estate, { declared: false })).toBe('0x1111111111111111111111111111111111111111');
    expect(() => rowSignerOf({ id: 'e' } as never, { declared: false })).toThrow(/no projection signer/);
  });
});
