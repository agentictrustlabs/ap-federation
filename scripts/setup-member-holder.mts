#!/usr/bin/env tsx
// setup-member-holder — spec 444 W4: a MEMBER holds the credential her ORGANIZATION issued her (through its own agent's
// `credential.issue`, never a script's key) and keeps it where it belongs: her vault. Given the organization's issuance
// results (the act's output), this writes, AS HER AGENT under the vault credential her custodian minted for the gate's
// runtime key (ap-home issue-self-host-vault-credentials.mts), each read back:
//
//   credential.anonymous:<digest>            the live credential, and the one the issuer revoked (with its kept status)
//   credential.device-key:<thumbprint>       the device key the credential binds (local scalar standing in for a KMS)
//   credential.holder-secret:member-holder   what her pairwise accounts derive from
//   credential.presentation-mandate:<ref>    her standing credential.present wire for ONE door, ONE predicate program,
//                                            ONE issuer facet — signed at her Home on HER chain
//
//   set -a && . .secrets/ops.env && set +a
//   npx tsx scripts/setup-member-holder.mts --holder hannah --holder-home https://www.impact-agent.me --agent-name hannah.me \
//     --vault https://mcp.impact-agent.io --creds .secrets/vault-creds-hannah.json --issuer imbnet-org \
//     --issued <act result 1>.json --revoked <act result 2>.json --stale-status <status>.json --device .secrets/hannah-device-key.json
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, hashMessage, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { parse } from 'yaml';
import { buildStandingWire, signedStandingWire, PRESENTATION_CAPABILITY, type EnforcerAddresses } from '@agenticprimitives/delegation';
import { getVaultRecord, listVaultRecords, putVaultRecord } from '../apps/projector/src/vault-ledger.js';
import { holderVaultCredentials, HOLDER_RECORDS, type HolderCredentialRecordV1, type HolderDeviceKeyRecordV1, type HolderSecretRecordV1 } from './lib/predicate-holder-vault.mts';
import { predicateDigestOf, type DoorCredentialPolicy } from './lib/predicate-holder.mts';
import { generateHolderSecret } from './lib/predicate-setup-deps.mts';

const args = process.argv.slice(2);
const flag = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const need = (n: string) => flag(n) ?? (() => { throw new Error(`--${n} is required`); })();
const file = (f: string) => { if (!existsSync(f)) throw new Error(`${f} is missing`); return JSON.parse(readFileSync(f, 'utf8')); };
const HOLDER = need('holder');
const HOLDER_HOME = need('holder-home').replace(/\/$/, '');
const ISSUER = need('issuer');
const RECEIVING = flag('receiving-estate') ?? 'impact-agent';
const fed = parse(readFileSync('federation.yaml', 'utf8')) as {
  doors: Array<{ estate: string; url: string; credentialProofs?: DoorCredentialPolicy }>;
  credentials: { issuers: Array<{ id: string; chainId: number; universalSignatureValidator: Address; rpcEnv?: string; facets?: Array<{ keyId: string; document: { facet: { publicKeyJwk: Record<string, unknown> } } }> }> };
  estates: Array<{ id: string; chainId: number; homeChainId?: number; home?: string }>;
};
const issuer = fed.credentials.issuers.find((i) => i.id === ISSUER) ?? (() => { throw new Error(`no issuer ${ISSUER}`); })();
const door = fed.doors.find((d) => d.estate === RECEIVING && d.credentialProofs) ?? (() => { throw new Error(`no door for ${RECEIVING} with credentialProofs`); })();
const DOOR = door.url.replace(/\/$/, '');
const estate = fed.estates.find((e) => (e.home ?? '').replace(/\/$/, '') === HOLDER_HOME) ?? (() => { throw new Error(`no estate whose home is ${HOLDER_HOME}`); })();
const chainId = estate.homeChainId ?? estate.chainId;
// The HOLDER'S chain's enforcers: a wire is verified where its delegator lives (hopechain for an imbnet resident).
const deployments = file(flag('deployments') ?? `../agenticprimitives/packages/contracts/deployments-${chainId === 34349 ? 'hopechain' : 'faithchain'}.json`) as Record<string, string>;
const D = (deployments.contracts ?? deployments) as unknown as Record<string, Address>;
const ENFORCERS: EnforcerAddresses = { delegationManager: D.delegationManager!, timestamp: D.timestampEnforcer!, value: D.valueEnforcer!, allowedTargets: D.allowedTargetsEnforcer!, allowedMethods: D.allowedMethodsEnforcer!, digestBinding: D.digestBindingEnforcer!, payment: D.paymentEnforcer! };
for (const [k, v] of Object.entries(ENFORCERS)) if (!/^0x[0-9a-fA-F]{40}$/.test(String(v))) throw new Error(`deployments for chain ${chainId} have no ${k}`);
const rpc = (process.env[issuer.rpcEnv ?? 'FEDERATION_RPC_URL'] ?? '').trim() || (() => { throw new Error(`${issuer.rpcEnv} is not set`); })();
const pub = createPublicClient({ transport: http(rpc) });
const VALIDATOR_ABI = [{ type: 'function', name: 'isValidSig', stateMutability: 'view', inputs: [{ name: 'signer', type: 'address' }, { name: 'hash', type: 'bytes32' }, { name: 'sig', type: 'bytes' }], outputs: [{ type: 'bool' }] }] as const;
const j = async (r: Response) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 200) }; } };

const env = readFileSync('.secrets/predicate-visitor.env', 'utf8');
const runtime = privateKeyToAccount((/^PREDICATE_RUNTIME_KEY=(0x[0-9a-fA-F]{64})/m.exec(env)?.[1] ?? (() => { throw new Error('PREDICATE_RUNTIME_KEY missing'); })()) as Hex);
const c = holderVaultCredentials({ credsFile: need('creds'), vaultUrl: need('vault'), agentName: flag('agent-name') ?? `${HOLDER}.me`, chainId });

// What the ORGANIZATION'S act returned (run-act-via-home --out): the credential its agent issued, never one made here.
const live = file(need('issued')).result as { digest: Hex; credential: { issuerKeyId: string; jwt: string; disclosures: string[]; claimSchema: string[] } };
const revoked = file(need('revoked')).result as typeof live;
const staleStatus = file(need('stale-status')) as { sequence: number };
const device = file(need('device')) as { privateKeyHex: Hex; jwk: { kid: string } };
const facet = issuer.facets?.find((f) => f.keyId === live.credential.issuerKeyId) ?? (() => { throw new Error(`the register names no facet ${live.credential.issuerKeyId} under ${ISSUER}`); })();
const now = new Date().toISOString();
const credentialRecord = (r: typeof live, extra: Partial<HolderCredentialRecordV1> = {}): HolderCredentialRecordV1 => ({
  type: 'ap.anonymous-credential.v1', issuerKeyId: r.credential.issuerKeyId, jwt: r.credential.jwt, disclosures: r.credential.disclosures,
  issuerPublicKeyJwk: facet.document.facet.publicKeyJwk, digest: r.digest, claimSchema: r.credential.claimSchema, deviceKeyThumbprint: device.jwk.kid, issuedAt: now, ...extra,
});

// Her standing wire, at her Home, on her chain.
const predicateDigest = predicateDigestOf(door.credentialProofs!.predicates);
const signin = await j(await fetch(`${HOLDER_HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: HOLDER, client_id: 'demo-jp' }) }));
const holderAgent = String(signin.agent ?? '').toLowerCase() as Address;
if (!/^0x[0-9a-f]{40}$/.test(holderAgent) || holderAgent !== c.agent.toLowerCase()) throw new Error(`${HOLDER} at ${HOLDER_HOME} is ${holderAgent}, not the vault credential's agent ${c.agent}`);
const { standing } = buildStandingWire({ template: 'present-as-me', delegator: holderAgent, delegate: runtime.address, capability: PRESENTATION_CAPABILITY, presentation: { audiences: [DOOR], predicateDigests: [predicateDigest], issuerKeyIds: [live.credential.issuerKeyId] }, validForSeconds: 180 * 86_400, enforcers: ENFORCERS, chainId, delegationManager: ENFORCERS.delegationManager });
const signed = await j(await fetch(`${HOLDER_HOME}/connect/persona-sign`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${signin.homeSession}` }, body: JSON.stringify({ digest: standing.ref }) }));
if (!signed.signature) throw new Error(`persona-sign refused for ${HOLDER}: ${JSON.stringify(signed).slice(0, 200)}`);
const ok = await pub.readContract({ address: issuer.universalSignatureValidator, abi: VALIDATOR_ABI, functionName: 'isValidSig', args: [holderAgent, hashMessage({ raw: standing.ref }), signed.signature as Hex] }).catch(() => false);
if (!ok) throw new Error(`the standing wire's signature does not validate for ${HOLDER} (${holderAgent}) on eip155:${chainId} — nothing written`);
const wire = { ...signedStandingWire(standing, signed.signature as Hex), holder: HOLDER, holderHome: HOLDER_HOME, door: DOOR, predicateDigest, issuerKeyId: live.credential.issuerKeyId, issuedAt: now };
console.log(`standing wire ${standing.ref}: ${HOLDER} (${holderAgent}) → runtime ${runtime.address} · audience ${DOOR} · predicate ${predicateDigest} · issuer ${live.credential.issuerKeyId}`);

const existingSecret = (await listVaultRecords(c, 'credential.holder-secret:')).length ? null : generateHolderSecret();
const writes: Array<[string, unknown]> = [
  [HOLDER_RECORDS.credential(live.digest), credentialRecord(live)],
  [HOLDER_RECORDS.credential(revoked.digest), credentialRecord(revoked, { revoked: { staleStatus, revokedAtSequence: staleStatus.sequence + 1 } })],
  [HOLDER_RECORDS.deviceKey(device.jwk.kid), { type: 'ap.device-key.v1', thumbprint: device.jwk.kid, privateKeyHex: device.privateKeyHex, publicJwk: { kty: 'EC', crv: 'P-256', x: (device.jwk as { x: string }).x, y: (device.jwk as { y: string }).y }, createdAt: now } as HolderDeviceKeyRecordV1],
  ...(existingSecret ? [[HOLDER_RECORDS.holderSecret('member-holder'), { type: 'ap.holder-secret.v1', secret: existingSecret as Hex, createdAt: now } satisfies HolderSecretRecordV1] as [string, unknown]] : []),
  [HOLDER_RECORDS.mandate(standing.ref), wire],
];
for (const [recordType, data] of writes) {
  await putVaultRecord(c, recordType, data);
  const back = await getVaultRecord<Record<string, unknown>>(c, recordType);
  if (!back || JSON.stringify(back) !== JSON.stringify(data)) throw new Error(`${recordType}: not read back as written`);
  console.log(`  ✓ ${recordType}`);
}
console.log(`her vault lists ${(await listVaultRecords(c, 'credential.')).length} credential.* record(s) under this grant`);
writeFileSync(`.secrets/member-holder-${HOLDER}.json`, JSON.stringify({ holder: HOLDER, agent: holderAgent, vaultUrl: c.vaultUrl, records: writes.map(([k]) => k), writtenAt: now }, null, 2) + '\n', { mode: 0o600 });
