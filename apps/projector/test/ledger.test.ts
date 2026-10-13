// THE ESTATE'S RECORD OF WHAT IT VOUCHES FOR — and the opening nobody else should hold.
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileLedger, leafOf } from '../src/ledger.js';
import { commitmentOf } from '@agenticprimitives/estate-projection';

const dir = () => mkdtempSync(join(tmpdir(), 'ap-fed-'));
const base = { estate: 'imbnet', set: 'live-grant' as const, subject: '0x000000000000000000000000000000000000beef' as const, submittedBy: 'maya', source: 'test' };

describe('fileLedger', () => {
  it('gives every leaf its own random blind, and the file is 0600', () => {
    const path = join(dir(), 'imbnet.json');
    const l = fileLedger(path);
    const a = l.add({ ...base, digest: `0x${'11'.repeat(32)}` });
    const b = l.add({ ...base, digest: `0x${'22'.repeat(32)}` });
    expect(a.row.blind).not.toEqual(b.row.blind);
    expect(a.row.blind).toMatch(/^0x[0-9a-f]{64}$/);
    // Without the blind the commitment cannot be reconstructed from the digest alone — which is the whole
    // reason a root over guessable grant hashes is safe to publish.
    expect(commitmentOf(a.row.digest, b.row.blind)).not.toEqual(leafOf(a.row).commitment);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toHaveLength(2);
  });

  it('refuses a second submission of the same digest in the same set, and says so', () => {
    const l = fileLedger(join(dir(), 'imbnet.json'));
    const first = l.add({ ...base, digest: `0x${'11'.repeat(32)}` });
    const again = l.add({ ...base, digest: `0x${'11'.repeat(32)}` });
    expect(again.added).toBe(false);
    expect(again.why).toMatch(/already vouched/);
    expect(again.row.blind).toEqual(first.row.blind);
  });

  it('retires a row instead of deleting it — a projection that stopped including something is evidence', () => {
    const path = join(dir(), 'imbnet.json');
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
    const l = fileLedger(join(dir(), 'imbnet.json'));
    const digest = `0x${'11'.repeat(32)}` as const;
    expect(l.add({ ...base, digest }).added).toBe(true);
    expect(l.add({ ...base, set: 'membership', digest }).added).toBe(true);
  });
});
