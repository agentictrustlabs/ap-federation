#!/usr/bin/env tsx
// F2 SETUP — a REAL grant for the door's gate (spec 439 F2; run once per estate).
//
// The leaf an acting agent can present about ITSELF is a grant whose delegate IS that agent (F1 §7.1). So the gate
// needs an account it holds that is the delegate of a live grant in the projecting estate. This script:
//   1. makes (or reads) the gate's test account — an EOA in .secrets/f2-test-agent.env, never committed;
//   2. asks a resident of the estate (default: maya at imbnet) to sign a NARROW delegation to it — `harness.read`
//      only, one year — through her Home's demo sign-in and persona-sign (the same path ap-home's own scripts use);
//      the signature is checked through UniversalSignatureValidator before anything is written;
//   3. keeps the wire in .secrets/f2-test-wire.json (the holder's copy) and SUBMITS its leaf to the projector's
//      ledger (inclusion is a submission, F1 §7.1a) — then tells you to `projector project` so it is anchored.
//
//   set -a && . .secrets/ops.env && set +a
//   npx tsx scripts/setup-f2-test-grant.mts [--estate imbnet] [--by maya] [--home https://www.impact-agent.me]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createPublicClient, hashMessage, http, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { buildCaveat, encodeAllowedMethodsTerms, encodeTimestampTerms, hashDelegation, ROOT_AUTHORITY, type Delegation } from '@agenticprimitives/delegation';
import { skillSelector } from '@agenticprimitives/a2a';
import { parse } from 'yaml';

const args = process.argv.slice(2);
const flag = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const estateId = flag('estate') ?? 'imbnet';
const by = flag('by') ?? 'maya';
const HOME = flag('home') ?? 'https://www.impact-agent.me';
const rpc = process.env.FEDERATION_RPC_URL ?? (() => { throw new Error('FEDERATION_RPC_URL is not set (set -a && . .secrets/ops.env)'); })();
const fed = parse(readFileSync('federation.yaml', 'utf8')) as { registry: { chainId: number }; estates: { id: string; chainId: number; delegationManager?: string }[] };
const estate = fed.estates.find((e) => e.id === estateId) ?? (() => { throw new Error(`no estate ${estateId} in federation.yaml`); })();
const chainId = estate.chainId;
// Ring 0 deployments-faithchain.json — the enforcers a narrow wire names (the pinned contracts release carries them).
const CONTRACTS = { delegationManager: '0x710cb1bF08C234Df397e0910331e0A29710EF4F7', timestampEnforcer: '0x73A7B878168b7DE48677617179A8bE894f0Dfe96', allowedMethodsEnforcer: '0xdBb2E47793393C499efB0f3fcbf6Ca8669791a41', universalSignatureValidator: '0xeDd56f500325D4701B9985A34e5Fa6EED6716137' } as const;
if (estate.delegationManager && estate.delegationManager.toLowerCase() !== CONTRACTS.delegationManager.toLowerCase()) throw new Error('federation.yaml names another DelegationManager than this script knows');

// 1. the test account
mkdirSync('.secrets', { recursive: true });
const keyFile = '.secrets/f2-test-agent.env';
if (!existsSync(keyFile)) writeFileSync(keyFile, `F2_TEST_AGENT_KEY=${generatePrivateKey()}\n`, { mode: 0o600 });
const key = /F2_TEST_AGENT_KEY=(0x[0-9a-fA-F]{64})/.exec(readFileSync(keyFile, 'utf8'))?.[1] as Hex;
const me = privateKeyToAccount(key);
console.log(`test agent (the delegate, held by the gate): ${me.address}`);

// 2. the resident signs a narrow wire to it, at her Home
const j = async (r: Response) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 200) }; } };
const signin = await j(await fetch(`${HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: by, client_id: 'demo-jp' }) }));
const token: string = signin.homeSession; const delegator = String(signin.agent ?? signin.smartAgent ?? signin.address ?? '').toLowerCase();
if (!token) throw new Error(`no session for ${by} at ${HOME}: ${JSON.stringify(signin).slice(0, 200)}`);
if (!/^0x[0-9a-f]{40}$/.test(delegator)) throw new Error(`demo-signin did not name ${by}'s agent: ${JSON.stringify(signin).slice(0, 200)}`);
const validUntil = Math.floor(Date.now() / 1000) + 365 * 86_400;
const bytes = crypto.getRandomValues(new Uint8Array(16)); let salt = 0n; for (const b of bytes) salt = (salt << 8n) | BigInt(b);
const d: Delegation = {
  delegator: delegator as Address, delegate: me.address, authority: ROOT_AUTHORITY,
  caveats: [buildCaveat(CONTRACTS.timestampEnforcer, encodeTimestampTerms(0, validUntil)), buildCaveat(CONTRACTS.allowedMethodsEnforcer, encodeAllowedMethodsTerms([skillSelector('harness.read')]))],
  salt, signature: '0x',
};
const digest = hashDelegation(d, chainId, CONTRACTS.delegationManager);
const signed = await j(await fetch(`${HOME}/connect/persona-sign`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ digest }) }));
if (!signed.signature) throw new Error(`persona-sign refused: ${JSON.stringify(signed).slice(0, 200)}`);
d.signature = signed.signature;
const pub = createPublicClient({ chain: { id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } }, transport: http(rpc) });
const VALIDATOR_ABI = [{ type: 'function', name: 'isValidSig', stateMutability: 'view', inputs: [{ name: 'signer', type: 'address' }, { name: 'hash', type: 'bytes32' }, { name: 'sig', type: 'bytes' }], outputs: [{ type: 'bool' }] }] as const;
// A persona signs EIP-191 over the digest (memory: EOA delegator signs EIP-191); her Smart Agent accepts its custodian under ERC-1271.
const okRaw = await pub.readContract({ address: CONTRACTS.universalSignatureValidator, abi: VALIDATOR_ABI, functionName: 'isValidSig', args: [d.delegator, digest, d.signature] }).catch(() => false);
const ok191 = okRaw ? true : await pub.readContract({ address: CONTRACTS.universalSignatureValidator, abi: VALIDATOR_ABI, functionName: 'isValidSig', args: [d.delegator, hashMessage({ raw: digest }), d.signature] }).catch(() => false);
if (!okRaw && !ok191) throw new Error(`the wire's signature does not verify for ${d.delegator} on chain ${chainId} — nothing written`);
console.log(`wire ${digest} — ${by} (${d.delegator}) → ${me.address}, harness.read, 365d; signature verified (${okRaw ? 'raw digest' : 'EIP-191'})`);
writeFileSync(`.secrets/f2-test-wire${estateId === 'imbnet' ? '' : `-${estateId}`}.json`, JSON.stringify({ estate: estateId, chainId, delegationManager: CONTRACTS.delegationManager, digest, delegation: { ...d, salt: d.salt.toString() }, by, issuedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });

// 3. submit the leaf
const out = execFileSync('pnpm', ['-s', 'projector', 'submit', '--estate', estateId, '--set', 'live-grant', '--digest', digest, '--subject', me.address.toLowerCase(), '--by', `${by} (persona-sign at ${HOME})`, '--source', 'f2-setup'], { encoding: 'utf8' });
console.log(out.trim());
console.log(`\nnext: pnpm projector project --estate ${estateId}   # anchors the leaf; then pnpm gate:door`);
