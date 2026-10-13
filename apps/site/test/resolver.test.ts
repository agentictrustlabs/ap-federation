import { describe, expect, it } from 'vitest';
import { identityOf, looksLikeName, mergeTownRows, qualify, toNameRow } from '../src/resolver';

const faith = { id: 'faithchain', chainId: 34348 };
const base = { id: 'base-town', chainId: 8453 };

describe('the never-bare rule (naming doc N4)', () => {
  it('is bare only inside its home town', () => {
    expect(qualify('alice.me', faith, 34348)).toBe('alice.me');
    expect(qualify('alice.me', faith, 8453)).toBe('alice.me · faithchain (eip155:34348)');
  });
  it('the site is in no town, so every row is qualified', () => {
    expect(qualify('alice.me', faith)).toBe('alice.me · faithchain (eip155:34348)');
    expect(toNameRow({ name: 'alice.me', status: 'registered', agent: '0xB0D11CE19B756A682E78B4904CD8D832303B3D11', kind: 'person' }, faith, 34348).display).toContain('faithchain');
  });
  it('the same label in two towns is two rows with two identities, never one', () => {
    const a = toNameRow({ name: 'alice.me', status: 'registered', agent: '0xb0d11ce19b756a682e78b4904cd8d832303b3d11' }, faith, 34348);
    const b = toNameRow({ name: 'alice.me', status: 'registered', agent: '0xb0d11ce19b756a682e78b4904cd8d832303b3d11' }, base, 34348);
    expect(a.federated).toEqual({ name: 'alice.me', chain: 'eip155:34348' });
    expect(b.federated).toEqual({ name: 'alice.me', chain: 'eip155:8453' });
    expect(a.identity).not.toBe(b.identity);
    expect(a.root).toBe(true); expect(b.root).toBe(false);
  });
});

describe('identity', () => {
  it('is CAIP-10 on the row\'s chain, lower-cased, or null when the name points at nobody', () => {
    expect(identityOf(34348, '0xB0D11CE19B756A682E78B4904CD8D832303B3D11')).toBe('eip155:34348:0xb0d11ce19b756a682e78b4904cd8d832303b3d11');
    expect(identityOf(34348, null)).toBeNull();
    expect(identityOf(34348, 'alice.me')).toBeNull();
  });
});

describe('merge', () => {
  it('registered before available, root chain first, then by name', () => {
    const rows = mergeTownRows([
      { town: 'base-town', chainId: 8453, ok: true, block: 1, rows: [toNameRow({ name: 'alice.me', status: 'registered', agent: '0x' + '1'.repeat(40) }, base, 34348), toNameRow({ name: 'alice.org', status: 'available' }, base, 34348)] },
      { town: 'faithchain', chainId: 34348, ok: true, block: 2, rows: [toNameRow({ name: 'alice.me', status: 'registered', agent: '0x' + '2'.repeat(40) }, faith, 34348), toNameRow({ name: 'alice.svc', status: 'available' }, faith, 34348)] },
    ]);
    expect(rows.map((r) => `${r.name}@${r.town}`)).toEqual(['alice.me@faithchain', 'alice.me@base-town', 'alice.svc@faithchain', 'alice.org@base-town']);
  });
});

describe('what is a name', () => {
  it('a label is not a name; a handle and a scoped handle are', () => {
    expect(looksLikeName('alice')).toBe(false);
    expect(looksLikeName('alice.me')).toBe(true);
    expect(looksLikeName('vault.svc@richcanvas.org')).toBe(true);
    expect(looksLikeName('alice.me@faithchain')).toBe(false); // the chain is never a name component
  });
});
