#!/usr/bin/env tsx
// VERIFY a service's client key binding the way a company that wants more than OAuth's trust would (spec 442 §3): read
// `atl:clientKeys` from the chain, decode it, and validate the signed binding through ERC-1271 on the agent's chain.
//   set -a; . .secrets/ops.env; set +a; npx tsx scripts/verify-client-key.mts [--bundle apps/pap/binding.json]
import { readFileSync } from 'node:fs';
import { decodeClientKeys, verifySignedClientKeyBinding, CLIENT_KEYS, agentProfileResolverAbi, liveClientKeys, type SignedClientKeyBindingV1 } from '@agenticprimitives/agent-profile';
import { createPublicClient, http, parseAbi, type Address, type Hex } from 'viem';
const arg = (k: string): string | undefined => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const bundle = JSON.parse(readFileSync(arg('bundle') ?? 'apps/pap/binding.json', 'utf8')) as { binding: SignedClientKeyBindingV1; publicJwk: { kid: string } };
const RPC = (process.env.FEDERATION_RPC_URL ?? '').trim(); if (!RPC) throw new Error('FEDERATION_RPC_URL is not set');
const USV = (arg('usv') ?? '0x5B4Ce0E3E1a3b8FF0f8bd2A4c1f1C6a1E3f2d9c0') as Address;
const PROFILE_RESOLVER = '0xB03F7C06ad3274F584AB72794406D639c02A45e1' as Address;
const pc = createPublicClient({ transport: http(RPC) });
const signed = bundle.binding;
const sa = signed.verifyingContract as Address;
const raw = String(await pc.readContract({ address: PROFILE_RESOLVER, abi: agentProfileResolverAbi, functionName: 'getStringProperty', args: [sa, CLIENT_KEYS] }));
const record = decodeClientKeys(raw);
const now = Math.floor(Date.now() / 1000);
console.log(`atl:clientKeys on chain: ${record ? `${record.keys.length} row(s), ${liveClientKeys(record, { currentCustodyEpoch: signed.binding.custodyEpoch, now }).length} live` : 'none / unreadable'}`);
const onChain = record?.keys.find((k) => k.thumbprint === signed.binding.jwkThumbprint);
console.log(`the bundle's key ${signed.binding.jwkThumbprint}: ${onChain ? 'listed on chain' : 'NOT on chain'}`);
let epoch = 0; try { epoch = Number(await pc.readContract({ address: sa, abi: parseAbi(['function custodyEpoch() view returns (uint64)']), functionName: 'custodyEpoch' })); } catch { /* generation 1 */ }
const erc1271Verifier = { verifyHash: async ({ address, hash, signature }: { address: Address; hash: Hex; signature: Hex }) => (await pc.readContract({ address: USV, abi: parseAbi(['function isValidSig(address,bytes32,bytes) view returns (bool)']), functionName: 'isValidSig', args: [address, hash, signature] })) as boolean };
const v = await verifySignedClientKeyBinding(signed, { erc1271Verifier, currentCustodyEpoch: epoch, now, expectThumbprint: bundle.publicJwk.kid });
console.log(v.ok ? `✓ binding verified through ERC-1271 for ${v.smartAgent} (digest ${v.digest.slice(0, 18)}…)` : `✗ binding refused: ${v.reason} ${v.detail ?? ''}`);
process.exit(v.ok && onChain ? 0 : 1);
