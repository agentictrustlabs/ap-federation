// THE DOOR'S SESSION WIRE — the service-agent-signing rule, for a PAP company door (spec 443 W2). The door's service agent
// is custodied by a PERSON (the company's steward, at her Home); the door Worker signs with a key the estate's key service
// holds. This mints the one thing that joins them: a delegation `door agent → that key`, pinned to the company agent's door
// skill (`harness.ask`), pinned to the company agent as its only target, and time-bounded — signed by the steward through
// her Home (persona-sign; her key never leaves it) and checked through ERC-1271 against the door agent before it is written.
//
// What it buys: the Worker's credentials reach a revocable delegate, never the door agent. The steward ends it with one
// on-chain revocation (scripts/revoke-delegation.mts) without touching the agent.
//
//   RPC_URL=… npx tsx scripts/issue-door-session-wire.mts --door 0x<door agent> --delegate 0x<key-service key address> \
//     --target 0x<company agent> --home https://www.faithnet.me --by alice [--days 90] --out .secrets/door-session-wire-<company>.json
import { writeFileSync } from 'node:fs';
import { buildCaveat, encodeAllowedMethodsTerms, encodeAllowedTargetsTerms, encodeTimestampTerms, hashDelegation, ROOT_AUTHORITY, type Delegation } from '@agenticprimitives/delegation';
import { checkSessionWireShape, delegationToWire, skillSelector } from '@agenticprimitives/a2a';
import { STANDARD_SURFACE_SKILL } from '@agenticprimitives/a2a/standard';
import { createPublicClient, http, type Address, type Hex } from 'viem';

const arg = (k: string): string | undefined => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const addr = (v: string | undefined) => (/^0x[0-9a-fA-F]{40}$/.test(v ?? '') ? (v!.toLowerCase() as Address) : null);
const door = addr(arg('door')); const delegate = addr(arg('delegate')); const target = addr(arg('target'));
const home = arg('home'); const by = arg('by'); const out = arg('out'); const days = Number(arg('days') ?? 90);
if (!door || !delegate || !target || !home || !by || !out) { console.error('usage: issue-door-session-wire.mts --door 0x… --delegate 0x… --target 0x… --home <url> --by <steward> --out <file> [--days 90]'); process.exit(2); }
const RPC = process.env.RPC_URL ?? (() => { console.error('RPC_URL is required'); process.exit(1); })();
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 34348);
// faithchain (Ring 0 deployments-faithchain.json) — the door agent's chain.
const C = { delegationManager: '0x710cb1bF08C234Df397e0910331e0A29710EF4F7', timestampEnforcer: '0x73A7B878168b7DE48677617179A8bE894f0Dfe96', allowedTargetsEnforcer: '0x2156311097A936de1916a878bF53Bfd43c7b5715', allowedMethodsEnforcer: '0xdBb2E47793393C499efB0f3fcbf6Ca8669791a41', universalSignatureValidator: '0xeDd56f500325D4701B9985A34e5Fa6EED6716137' } as const;

const j = async (r: Response) => { const t = await r.text(); try { return JSON.parse(t) as Record<string, unknown>; } catch { return { _raw: t.slice(0, 200) }; } };
const signin = await j(await fetch(`${home}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: by, client_id: 'demo-jp' }) }));
if (!signin.homeSession) { console.error(`no session for ${by} at ${home}`); process.exit(1); }
const sign = async (digest: Hex): Promise<Hex> => {
  const b = await j(await fetch(`${home}/connect/persona-sign`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${String(signin.homeSession)}` }, body: JSON.stringify({ digest }) }));
  if (!b.signature) throw new Error(`persona-sign: ${JSON.stringify(b).slice(0, 160)}`);
  return b.signature as Hex;
};

const validUntil = Math.floor(Date.now() / 1000) + days * 86_400;
let salt = 0n; for (const b of crypto.getRandomValues(new Uint8Array(16))) salt = (salt << 8n) | BigInt(b);
const d: Delegation = {
  delegator: door, delegate, authority: ROOT_AUTHORITY, salt, signature: '0x',
  caveats: [
    buildCaveat(C.timestampEnforcer, encodeTimestampTerms(0, validUntil)),
    // The company agent is the only agent this door ever calls; the gate does not read this pin, the chain does — so a
    // redemption of this wire on chain can reach nothing else.
    buildCaveat(C.allowedTargetsEnforcer, encodeAllowedTargetsTerms([target])),
    // ONE skill: asking the company agent. Never the any-skill sentinel (the rule's item 3).
    buildCaveat(C.allowedMethodsEnforcer, encodeAllowedMethodsTerms([skillSelector(STANDARD_SURFACE_SKILL)])),
  ],
};
const digest = hashDelegation(d, CHAIN_ID, C.delegationManager);
d.signature = await sign(digest);
const wire = delegationToWire(d);
// The same shape check the company agent's gate runs on every knock — refused here, before anything is written.
const refused = checkSessionWireShape(wire, { timestamp: C.timestampEnforcer, allowedMethods: C.allowedMethodsEnforcer }, Math.floor(Date.now() / 1000), { skill: STANDARD_SURFACE_SKILL });
if (refused) { console.error(`the wire's shape is refused: ${refused}`); process.exit(1); }
const pc = createPublicClient({ transport: http(RPC) });
const valid = await pc.readContract({ address: C.universalSignatureValidator, abi: [{ type: 'function', name: 'isValidSig', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes' }], outputs: [{ type: 'bool' }] }], functionName: 'isValidSig', args: [door, digest, d.signature] });
if (valid !== true) { console.error(`the door agent ${door} does not accept ${by}'s signature (ERC-1271) — is ${by} its custodian? nothing written`); process.exit(1); }
writeFileSync(out, `${JSON.stringify({ type: 'ap.door-session-wire.v1', chainId: CHAIN_ID, delegationManager: C.delegationManager, digest, validUntil, wire, note: `signed by ${by} as the door agent's custodian; revoke it on chain to stop the door knocking` }, null, 2)}\n`, { mode: 0o600 });
console.log(`door session wire: ${door} → ${delegate} · harness.ask at ${target} · until ${new Date(validUntil * 1000).toISOString().slice(0, 10)} · ERC-1271 valid · digest ${digest} → ${out}`);
