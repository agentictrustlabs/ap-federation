// REVOKE A DELEGATION ON CHAIN, AS ITS DELEGATE — the retirement half of moving a delegate key (a wire, a vault leaf) to a
// new one. `DelegationManager.revokeDelegationByOwner(delegation)` admits the delegator OR the delegate as the sender and
// checks the delegator's signature over the struct (ERC-1271), so the RETIRED key itself can end every delegation that
// named it, without a userOp from the agent and without the custodian being asked again. After this, `isRevoked` answers
// true for the hash, and every gate that reads it (the anchoring redeem, the vault's DEL-001 check, the A2A wire gate)
// refuses the old key at its next use.
//
//   RPC_URL=… npx tsx scripts/revoke-delegation.mts --file <json> [--path sessionLeaf|wire|grant] \
//     --key-file <env file> --key-var <VAR> [--chain-id 34348]
//
// --path names where in the file the delegation sits (default: `wire`, as an anchoring wire file holds it). The key is
// read from the env file and never printed; it must be the delegation's delegate (or its delegator) or nothing is sent.
import { readFileSync } from 'node:fs';
import { hashDelegation, type Delegation } from '@agenticprimitives/delegation';
import { createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const arg = (k: string): string | undefined => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const file = arg('file'); const path = arg('path') ?? 'wire'; const keyFile = arg('key-file'); const keyVar = arg('key-var');
const chainId = Number(arg('chain-id') ?? 34348);
if (!file || !keyFile || !keyVar) { console.error('usage: revoke-delegation.mts --file <json> [--path wire|sessionLeaf|grant] --key-file <env> --key-var <VAR> [--chain-id 34348]'); process.exit(2); }
const RPC = process.env.RPC_URL ?? (() => { console.error('RPC_URL is required'); process.exit(1); })();
const DELEGATION_MANAGER = '0x710cb1bF08C234Df397e0910331e0A29710EF4F7' as Address; // faithchain and hopechain (same deployer, same hex)

const raw = (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>)[path] as { delegator: Address; delegate: Address; authority: Hex; caveats: Array<{ enforcer: Address; terms: Hex; args?: Hex }>; salt: string | number; signature: Hex } | undefined;
if (!raw?.delegator) { console.error(`${file} has no delegation at .${path}`); process.exit(1); }
const d: Delegation = { ...raw, salt: BigInt(raw.salt), caveats: raw.caveats.map((c) => ({ ...c, args: c.args ?? '0x' })) } as Delegation;
const key = new RegExp(`^${keyVar}=['"]?(0x[0-9a-fA-F]{64})`, 'm').exec(readFileSync(keyFile, 'utf8'))?.[1] as Hex | undefined;
if (!key) { console.error(`${keyVar} is not in ${keyFile}`); process.exit(1); }
const sender = privateKeyToAccount(key);
const who = sender.address.toLowerCase();
if (who !== d.delegate.toLowerCase() && who !== d.delegator.toLowerCase()) { console.error(`the key is ${sender.address}, neither the delegate ${d.delegate} nor the delegator ${d.delegator} — nothing sent`); process.exit(1); }

const chain = { id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
const pc = createPublicClient({ chain, transport: http(RPC) });
const CAVEAT = { type: 'tuple[]', name: 'caveats', components: [{ name: 'enforcer', type: 'address' }, { name: 'terms', type: 'bytes' }, { name: 'args', type: 'bytes' }] } as const;
const DELEGATION = { type: 'tuple', name: 'delegation', components: [{ name: 'delegator', type: 'address' }, { name: 'delegate', type: 'address' }, { name: 'authority', type: 'bytes32' }, CAVEAT, { name: 'salt', type: 'uint256' }, { name: 'signature', type: 'bytes' }] } as const;
const ABI = [
  { type: 'function', name: 'revokeDelegationByOwner', stateMutability: 'nonpayable', inputs: [DELEGATION], outputs: [] },
  { type: 'function', name: 'isRevoked', stateMutability: 'view', inputs: [{ name: 'h', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
] as const;
const digest = hashDelegation(d, chainId, DELEGATION_MANAGER);
if (await pc.readContract({ address: DELEGATION_MANAGER, abi: ABI, functionName: 'isRevoked', args: [digest] })) { console.log(`${digest} (${d.delegator} → ${d.delegate}) is already revoked on chain ${chainId}`); process.exit(0); }
const args = [d as never] as const;
await pc.simulateContract({ address: DELEGATION_MANAGER, abi: ABI, functionName: 'revokeDelegationByOwner', args, account: sender });
const hash = await createWalletClient({ account: sender, chain, transport: http(RPC) }).writeContract({ address: DELEGATION_MANAGER, abi: ABI, functionName: 'revokeDelegationByOwner', args });
const receipt = await pc.waitForTransactionReceipt({ hash });
if (receipt.status !== 'success') { console.error(`the revocation reverted (tx ${hash}) — nothing changed`); process.exit(1); }
// A gateway may serve the read from a node a block behind the one that took the write: ask again briefly before saying no.
let revoked = false;
for (let i = 0; i < 10 && !revoked; i++) {
  revoked = await pc.readContract({ address: DELEGATION_MANAGER, abi: ABI, functionName: 'isRevoked', args: [digest] });
  if (!revoked) await new Promise((r) => setTimeout(r, 1500));
}
console.log(`${revoked ? 'revoked' : 'NOT revoked'}: ${d.delegator} → ${d.delegate} · ${digest} on chain ${chainId} (tx ${hash}, sent by the ${who === d.delegate.toLowerCase() ? 'delegate' : 'delegator'})`);
if (!revoked) process.exit(1);
