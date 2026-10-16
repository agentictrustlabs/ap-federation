#!/usr/bin/env tsx
// BIND pap.svc's OUTWARD KEY — spec 442 §3 / spec 443 W1. The estate's personal-agent SERVICE gets ONE service-scoped
// `ClientKeyBindingV1`: the Smart Agent's EIP-712 statement that this P-256 JWK may PRESENT for it at companies' doors,
// under its current custody epoch, for 90 days, published under its clientId. Signed by the service's CUSTODIAN through the
// Home (persona-sign; ERC-1271 validates it against the service's account), and the public half written on chain as the
// SA-keyed `atl:clientKeys` record in ONE sponsored userOp from the service's own account (set-service-facets' pattern).
//
//   set -a; . .secrets/ops.env; set +a
//   npx tsx scripts/bind-client-key.mts --sa 0x… --by demo-admin --client-id https://pap.faithnet.io/client.json \
//     [--home https://www.faithnet.me] [--days 90] [--dry-run]
//
// WHAT IT WRITES. `.secrets/pap-faithnet-client-key.env` (0600): the private JWK — the key the pap Worker signs with
// until faithkms has a P-256 kind (zkID backlog Z6; a Worker secret is the honest state and said so). `.secrets/
// pap-faithnet-binding.json`: the signed binding + public JWK — what the Worker serves as client.json / jwks.json.
// A credential, never a delegation: this grants the key NO authority to act; what the service may do at a door is a
// person's mandate, verified per step.
import { readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { buildSignedClientKeyBinding, buildSetClientKeysCall, clientKeyRecordRow, decodeClientKeys, CLIENT_KEYS, agentProfileResolverAbi, type ClientKeyBindingV1, type ClientKeysRecordV1 } from '@agenticprimitives/agent-profile';
import { LocalEs256Signer } from '@agenticprimitives/key-custody';
import { buildExecuteBatchCallData } from '@agenticprimitives/agent-account';
import { createPublicClient, http, parseAbi, type Address, type Hex } from 'viem';

const arg = (k: string): string | undefined => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const SA = (arg('sa') ?? '').toLowerCase() as Address;
const BY = arg('by') ?? 'demo-admin';
const CLIENT_ID = arg('client-id') ?? 'https://pap.faithnet.io/client.json';
const HOME = arg('home') ?? 'https://www.faithnet.me';
const DAYS = Number(arg('days') ?? '90');
const DRY = process.argv.includes('--dry-run');
const CHAIN_ID = 34348;
const RPC = (process.env.FEDERATION_RPC_URL ?? '').trim() || (() => { throw new Error('FEDERATION_RPC_URL is not set (set -a; . .secrets/ops.env)'); })();
const PROFILE_RESOLVER = (arg('profile-resolver') ?? process.env.PROFILE_RESOLVER ?? '0xB03F7C06ad3274F584AB72794406D639c02A45e1') as Address;
if (!/^0x[0-9a-f]{40}$/.test(SA)) { console.error('--sa 0x… (the personal-agent service\'s Smart Agent) is required'); process.exit(1); }
const KEY_FILE = `.secrets/pap-faithnet-client-key.env`;
const OUT = `.secrets/pap-faithnet-binding.json`;

process.env.A2A_ALLOW_LOCAL_DEVICE_KEY = 'true'; // the local signer is the stand-in until faithkms has P-256 (Z6)
const pc = createPublicClient({ transport: http(RPC) });
const j = async (r: Response) => { const t = await r.text(); try { return JSON.parse(t) as Record<string, unknown>; } catch { return { _raw: t.slice(0, 200), _status: r.status }; } };

// ── the key: reuse the one on disk (a re-run re-binds under a new epoch or window), else generate ──
let privHex: string;
if (existsSync(KEY_FILE)) { privHex = /^PAP_CLIENT_KEY_P256=(0x[0-9a-f]{64})/m.exec(readFileSync(KEY_FILE, 'utf8'))?.[1] ?? ''; }
else { privHex = ''; }
const signer = privHex ? new LocalEs256Signer({ privateKeyHex: privHex }) : LocalEs256Signer.generate();
const jwk = signer.publicJwk();
console.log(`key ${existsSync(KEY_FILE) ? 'reused' : 'generated'}: kid ${signer.kid}`);

// ── the custody epoch: generation-3 accounts answer custodyEpoch(); faithchain's generation-1 accounts do not (epoch 0) ──
let custodyEpoch = 0;
try { custodyEpoch = Number(await pc.readContract({ address: SA, abi: parseAbi(['function custodyEpoch() view returns (uint64)']), functionName: 'custodyEpoch' })); console.log(`custody epoch ${custodyEpoch}`); }
catch { console.log('custody epoch: the account answers no custodyEpoch() (generation 1) — bound under epoch 0; a rotation ceremony on a generation-3 account re-binds'); }

const now = Math.floor(Date.now() / 1000);
const binding: ClientKeyBindingV1 = { canonicalAgentId: `eip155:${CHAIN_ID}:${SA}`, scope: 'service', clientId: CLIENT_ID, jwkThumbprint: signer.kid, alg: 'ES256', custodyEpoch, notBefore: now - 60, notAfter: now + DAYS * 86400 };
console.log(`binding: ${binding.canonicalAgentId} scope ${binding.scope} clientId ${binding.clientId} notAfter ${new Date(binding.notAfter * 1000).toISOString()}`);
if (DRY) { console.log('--dry-run: nothing signed, nothing written'); process.exit(0); }

// ── the custodian signs through the Home ──
const si = await j(await fetch(`${HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: BY, client_id: 'demo-web' }) }));
if (!si.homeSession) { console.error(`${BY} could not sign in at ${HOME}: ${JSON.stringify(si).slice(0, 200)}`); process.exit(1); }
const sign = async (digest: Hex): Promise<Hex> => { const b = await j(await fetch(`${HOME}/connect/persona-sign`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${si.homeSession}` }, body: JSON.stringify({ digest }) })); if (!b.signature) throw new Error(`persona-sign: ${JSON.stringify(b).slice(0, 160)}`); return b.signature as Hex; };
const signed = await buildSignedClientKeyBinding({ binding, chainId: CHAIN_ID, smartAgent: SA, signer: sign, posture: { naming: 'public' } });
console.log(`signed by ${BY}'s credential as the service's custodian: ${signed.signature.slice(0, 18)}…`);

// ── the record: merge the row into atl:clientKeys (live rows kept, this thumbprint replaced) ──
const currentRaw = String(await pc.readContract({ address: PROFILE_RESOLVER, abi: agentProfileResolverAbi, functionName: 'getStringProperty', args: [SA, CLIENT_KEYS] }).catch(() => ''));
const current = decodeClientKeys(currentRaw) ?? { v: 1 as const, keys: [] };
const record: ClientKeysRecordV1 = { v: 1, keys: [...current.keys.filter((k) => k.thumbprint !== signer.kid && k.notAfter > now), clientKeyRecordRow(binding)] };
const call = buildSetClientKeysCall({ profileResolver: PROFILE_RESOLVER, agent: SA, clientKeys: record });
const csrfRes = await fetch(`${HOME}/a2a/auth/csrf`, { headers: { origin: HOME } });
const csrf = (await j(csrfRes)) as { token?: string };
const H = { 'content-type': 'application/json', origin: HOME, cookie: (csrfRes.headers.get('set-cookie') ?? '').split(';')[0] ?? '', 'x-csrf-token': csrf.token ?? '' };
const callData = buildExecuteBatchCallData([{ to: call.to, value: 0n, data: call.data }]);
let txHash: string | undefined; let lastErr = '';
for (let i = 0; i < 4 && !txHash; i++) {
  if (i) await new Promise((r) => setTimeout(r, 3000));
  const b = await j(await fetch(`${HOME}/a2a/account/build-call-userop`, { method: 'POST', headers: H, body: JSON.stringify({ sender: SA, callData }) }));
  if (!b.ok || !b.userOpHash) { lastErr = `${b.error ?? ''} ${b.detail ?? JSON.stringify(b).slice(0, 200)}`; continue; }
  const s = await j(await fetch(`${HOME}/a2a/account/submit-call-userop`, { method: 'POST', headers: H, body: JSON.stringify({ userOp: { ...(b.userOp as object), signature: await sign(b.userOpHash as Hex) } }) }));
  if (s.ok) txHash = String(s.transactionHash); else lastErr = `${s.error ?? ''} ${s.detail ?? JSON.stringify(s).slice(0, 200)}`;
}
if (!txHash) { console.error(`✗ atl:clientKeys did not land: ${lastErr}`); process.exit(1); }
console.log(`atl:clientKeys written: tx ${txHash} (${record.keys.length} live row(s))`);

// ── what the Worker serves, and the key it signs with ──
if (!existsSync(KEY_FILE)) { writeFileSync(KEY_FILE, `# pap.svc@faithnet's client key — the stand-in for faithkms P-256 (zkID Z6). 0600; never in git.\nPAP_CLIENT_KEY_P256=0x${[...(signer as unknown as { priv: Uint8Array }).priv].map((b) => b.toString(16).padStart(2, '0')).join('')}\n`); chmodSync(KEY_FILE, 0o600); }
const bundle = JSON.stringify({ binding: signed, publicJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, kid: jwk.kid }, record, tx: txHash, at: new Date().toISOString() }, null, 2) + '\n';
writeFileSync(OUT, bundle);
// PUBLIC data (no key, no secret): the pap Worker bundles and serves it; committed, like a released card.
writeFileSync('apps/pap/binding.json', bundle);
console.log(`✓ ${OUT} (the signed binding + public JWK the pap Worker serves) · ${KEY_FILE} (the private key, 0600)`);
