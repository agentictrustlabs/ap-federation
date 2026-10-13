import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFederation, validateFederation } from '../src/federation';

const text = readFileSync(new URL('../../../federation.yaml', import.meta.url), 'utf8');

describe('the register', () => {
  it('parses and is fit to publish', () => {
    const fed = parseFederation(text);
    expect(validateFederation(fed)).toEqual([]);
    expect(fed.towns.some((t) => t.status === 'live' && t.chainId === fed.naming.rootChain)).toBe(true);
  });
  it('refuses two estates on one tenant and one estate on two (spec 440 condition 2)', () => {
    const fed = parseFederation(text);
    const t0 = fed.kms.tenants[0]!;
    fed.kms.tenants.push({ ...t0, estate: 'other-estate' });
    expect(validateFederation(fed).some((e) => e.includes('never shared'))).toBe(true);
  });
  it('refuses a billable HSM level without a payer (condition 3)', () => {
    const fed = parseFederation(text);
    fed.kms.tenants[0]!.callers = [{ subject: 'x', operations: ['mac-generate'], protectionLevels: ['AZURE_HSM_DIRECT'] }];
    expect(validateFederation(fed).some((e) => e.includes('billedTo'))).toBe(true);
  });
  it('refuses a root chain that is not a live town', () => {
    const fed = parseFederation(text);
    fed.naming.rootChain = 1;
    expect(validateFederation(fed).some((e) => e.includes('rootChain'))).toBe(true);
  });
  it('refuses a workers.dev town surface (CF-1042)', () => {
    const fed = parseFederation(text);
    fed.towns[0]!.naming = 'https://x.richardpedersen3.workers.dev';
    expect(validateFederation(fed).some((e) => e.includes('CF-1042'))).toBe(true);
  });
});
