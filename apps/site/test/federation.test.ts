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
  it('refuses more billable platform roots than the budget (the cost rule as a gate)', () => {
    const fed = parseFederation(text);
    fed.kms.platformRoots = [...(fed.kms.platformRoots ?? []), { provider: 'azure-key-vault', key: 'second', billable: true }, { provider: 'azure-key-vault', key: 'third', billable: true }];
    expect(validateFederation(fed).some((e) => e.includes('exceeds the budget'))).toBe(true);
  });
  it('refuses operations * on a tenant that does not admit a shared credential', () => {
    const fed = parseFederation(text);
    const imb = fed.kms.tenants.find((t) => t.tenant === 'imb')!;
    imb.callers = [{ subject: 'x', operations: ['*'], protectionLevels: ['CVM_WRAPPED'] }];
    expect(validateFederation(fed).some((e) => e.includes('operations *'))).toBe(true);
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
  it('lets a town root its names at another town, and refuses the three ways that goes wrong', () => {
    // Spec 440 §C: the universal namespace is on ONE root chain, so a second town having no naming API is
    // the design. The rule that every town carries one was true while there was a single town and silently
    // became wrong when there were two — so what is asserted is that the absence must be DECLARED.
    const fed = parseFederation(text);
    const hopenet = fed.towns.find((x) => x.id === 'hopenet')!;
    expect(hopenet.naming).toBeUndefined();
    expect(hopenet.namesRootedAt).toBe('faithchain');
    expect(validateFederation(fed)).toEqual([]);

    const missing = parseFederation(text);
    delete missing.towns.find((x) => x.id === 'hopenet')!.namesRootedAt;
    expect(validateFederation(missing).some((e) => e.includes('namesRootedAt'))).toBe(true);

    const nowhere = parseFederation(text);
    nowhere.towns.find((x) => x.id === 'hopenet')!.namesRootedAt = 'a-town-that-is-not-here';
    expect(validateFederation(nowhere).some((e) => e.includes('is not a town in this register'))).toBe(true);

    const itself = parseFederation(text);
    itself.towns.find((x) => x.id === 'hopenet')!.namesRootedAt = 'hopenet';
    expect(validateFederation(itself).some((e) => e.includes('cannot root its names at itself'))).toBe(true);

    const both = parseFederation(text);
    both.towns.find((x) => x.id === 'hopenet')!.naming = 'https://names.example';
    expect(validateFederation(both).some((e) => e.includes('one town, one answer'))).toBe(true);
  });

  it('refuses a workers.dev town surface (CF-1042)', () => {
    const fed = parseFederation(text);
    fed.towns[0]!.naming = 'https://x.richardpedersen3.workers.dev';
    expect(validateFederation(fed).some((e) => e.includes('CF-1042'))).toBe(true);
  });
});
