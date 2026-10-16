#!/usr/bin/env tsx
// setup-predicate-holder-vault — THE HOLDER'S RECORDS GO WHERE THEY BELONG: her vault (ADR-0055; Ring 0 ontology
// `tbox/privacy-credential.ttl` + `vault-records.ts`). The issuer ceremony (setup-predicate-issuer.mts) left them as files in
// .secrets/; this writes them into her vault AS HER AGENT, through her Home's native door, under a credential her custodian
// minted for the gate's runtime key (ap-home scripts/issue-self-host-vault-credentials.mts <her agent> --by <handle>
// --delegate <runtime key> --scope vault:credential.anonymous:* … --ops read,write → .secrets/vault-creds-alice.json), and
// reads each back. From then on the gate reads her records from the vault and nothing else (ADR-0013).
//
//   credential.anonymous:<digest>            the credential made to be proved about (and the revoked one, marked)
//   credential.device-key:<thumbprint>       the custodied holder-binding key (a local signer standing in for a KMS)
//   credential.holder-secret:<label>         what her pairwise accounts derive from
//   credential.presentation-mandate:<ref>    her standing credential.present wire
//
// Why each is a bereavement, not a cache: lose the credential and the issuer holds only its digest; lose the device key and
// no presentation can ever be made; lose the secret and every pairwise account at every verifier is unreachable.
//
//   set -a && . .secrets/ops.env && set +a
//   npx tsx scripts/setup-predicate-holder-vault.mts [--holder alice.me] [--vault https://mcp.faithnet.io] [--creds .secrets/vault-creds-alice.json]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getVaultRecord, listVaultRecords, putVaultRecord, type VaultCredentials } from '../apps/projector/src/vault-ledger.js';
import { holderVaultCredentials, HOLDER_RECORDS, type HolderCredentialRecordV1, type HolderDeviceKeyRecordV1, type HolderSecretRecordV1 } from './lib/predicate-holder-vault.mts';
import { devicePublicJwk, type DeviceKeyRef } from './lib/predicate-device-key.mts';

const args = process.argv.slice(2);
const flag = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const need = (f: string) => { if (!existsSync(f)) throw new Error(`${f} is missing`); return f; };
const c: VaultCredentials = holderVaultCredentials({ credsFile: flag('creds') ?? '.secrets/vault-creds-alice.json', vaultUrl: flag('vault') ?? 'https://mcp.faithnet.io', agentName: flag('holder') ?? 'alice.me' });

const env = readFileSync(need('.secrets/predicate-visitor.env'), 'utf8');
const envGet = (k: string) => new RegExp(`^${k}=(\\S+)`, 'm').exec(env)?.[1] ?? (() => { throw new Error(`${k} missing from .secrets/predicate-visitor.env`); })();
const live = JSON.parse(readFileSync(need('.secrets/predicate-credential.json'), 'utf8')) as Record<string, unknown> & { digest: Hex; device: DeviceKeyRef; claims?: Record<string, string> };
const revoked = JSON.parse(readFileSync(need('.secrets/predicate-credential-revoked.json'), 'utf8')) as Record<string, unknown> & { digest: Hex; staleStatus: unknown; revokedAtSequence: number };
const standing = JSON.parse(readFileSync(need('.secrets/predicate-standing-wire.json'), 'utf8')) as Record<string, unknown> & { ref: Hex };
// The device key the credential file names (local scalar or the key service's key); its thumbprint keys the vault record.
if (!live.device) throw new Error('.secrets/predicate-credential.json names no device key (re-run setup-predicate-issuer)');
const thumbprint = (await devicePublicJwk(live.device, envGet)).kid;
const deviceRecord: HolderDeviceKeyRecordV1 = live.device.kind === 'akcs'
  ? { type: 'ap.device-key.v1', thumbprint, managed: { backend: 'akcs', keyId: live.device.keyId, baseUrl: live.device.baseUrl, tenantId: live.device.tenantId }, createdAt: new Date().toISOString() }
  : { type: 'ap.device-key.v1', thumbprint, privateKeyHex: live.device.privateKeyHex, createdAt: new Date().toISOString() };
const claimSchema = live.claims ? Object.keys(live.claims) : ['age', 'roc_birthday'];
const now = new Date().toISOString();
console.log(`holder ${c.agentName} (${c.agent}) · vault ${c.vaultUrl} · writing as delegate ${privateKeyToAccount(c.signerKey).address}`);

const credentialRecord = (src: Record<string, unknown>, extra: Record<string, unknown> = {}): HolderCredentialRecordV1 => ({
  type: 'ap.anonymous-credential.v1', issuerKeyId: String(src.issuerKeyId), jwt: String(src.jwt), disclosures: src.disclosures as string[],
  issuerPublicKeyJwk: src.issuerPublicKeyJwk as Record<string, unknown>, digest: src.digest as Hex, claimSchema,
  deviceKeyThumbprint: thumbprint, issuedAt: now, ...extra,
});
const writes: Array<[string, unknown]> = [
  [HOLDER_RECORDS.credential(live.digest), credentialRecord(live)],
  [HOLDER_RECORDS.credential(revoked.digest), credentialRecord(revoked, { revoked: { staleStatus: revoked.staleStatus, revokedAtSequence: revoked.revokedAtSequence } })],
  [HOLDER_RECORDS.deviceKey(thumbprint), deviceRecord],
  [HOLDER_RECORDS.holderSecret('predicate-visitor'), { type: 'ap.holder-secret.v1', secret: envGet('PREDICATE_HOLDER_SECRET') as Hex, createdAt: now } satisfies HolderSecretRecordV1],
  [HOLDER_RECORDS.mandate(standing.ref), standing],
];
for (const [recordType, data] of writes) {
  await putVaultRecord(c, recordType, data);
  const back = await getVaultRecord<Record<string, unknown>>(c, recordType);
  if (!back) throw new Error(`${recordType}: written and not read back`);
  const a = JSON.stringify(data), b = JSON.stringify(back);
  if (a !== b) throw new Error(`${recordType}: changed in the round trip`);
  console.log(`  ✓ ${recordType}`);
}
const listed = await listVaultRecords(c, 'credential.');
console.log(`her vault lists ${listed.length} credential.* record(s) under this grant`);
writeFileSync('.secrets/predicate-holder-vault.json', JSON.stringify({ holder: c.agentName, agent: c.agent, vaultUrl: c.vaultUrl, records: writes.map(([k]) => k), writtenAt: now }, null, 2) + '\n', { mode: 0o600 });
console.log('next: pnpm gate:predicate reads her records from the vault (the .secrets/predicate-*.json copies are the ceremony\'s scratch; the vault is the record)');
