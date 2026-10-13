// THE REGISTER, JUDGED — an estate id is permanent, so a missing governance address is a refusal.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estateById, loadFederation, registryRpc, requireProjectable, signerKey } from '../src/config.js';

const write = (yaml: string) => { const p = join(mkdtempSync(join(tmpdir(), 'ap-fed-cfg-')), 'federation.yaml'); writeFileSync(p, yaml); return p; };
const REGISTRY = `federation: t\nregistry:\n  chainId: 34348\n  chain: faithchain\n  address: "0xb4E116F5C6915a4f1e649E0877e4a0A7a1c1147b"\n  rpcEnv: TEST_RPC\n`;

describe('loadFederation', () => {
  it('refuses a register that omits governance rather than defaulting it', () => {
    const p = write(`${REGISTRY}estates:\n  - id: x\n    chainId: 34348\n`);
    expect(() => loadFederation(p)).toThrow(/must state its governance address or null/);
  });

  it('accepts an explicit null and keeps the reason with the row', () => {
    const p = write(`${REGISTRY}estates:\n  - id: faithnet\n    chainId: 34348\n    governance: null\n    governanceKind: none\n    blocked: "no estate agent yet"\n`);
    const row = estateById(loadFederation(p), 'faithnet');
    expect(row.governance).toBeNull();
    expect(() => requireProjectable(row)).toThrow(/no estate agent yet/);
    expect(() => requireProjectable(row)).toThrow(/first-come-wins/);
  });

  it('derives the estate id for a projectable row', () => {
    const p = write(`${REGISTRY}estates:\n  - id: imbnet\n    chainId: 34348\n    governance: "0x4457aadf6ADeB31bA8F166fafcC0d0579ECd1015"\n    governanceKind: estate-agent\n`);
    expect(requireProjectable(estateById(loadFederation(p), 'imbnet')).estateId).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('will not guess an endpoint or a key from the environment', () => {
    const p = write(`${REGISTRY}estates:\n  - id: imbnet\n    chainId: 34348\n    governance: "0x4457aadf6ADeB31bA8F166fafcC0d0579ECd1015"\n    governanceKind: estate-agent\n    signerKeyEnv: ABSENT_KEY\n`);
    const f = loadFederation(p);
    expect(() => registryRpc(f, {})).toThrow(/TEST_RPC is not set/);
    expect(() => signerKey(estateById(f, 'imbnet'), { ABSENT_KEY: 'not-a-key' })).toThrow(/32-byte key/);
  });
});
