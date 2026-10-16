// THE HOLDER'S VAULT, from the gate's side: the record keys her credentials live under (bound by IRI in Ring 0's
// ontology `vault-records.ts` — `appc:AnonymousCredential`, `appc:DeviceKey`, `appc:PairwiseAccount`,
// `appc:PresentationMandate`), the credential the gate presents at her vault's door, and the read that assembles what
// the holder half needs. One mechanism (ADR-0013): the gate reads her records from her vault, never from a file.
import { readFileSync } from 'node:fs';
import type { Address, Hex } from 'viem';
import type { StandingWireV1 } from '@agenticprimitives/delegation';
import { getVaultRecord, listVaultRecords, type VaultCredentials } from '../../apps/projector/src/vault-ledger.js';
import type { IssuedCredential } from './predicate-holder.mts';
import type { DeviceKeyRef } from './predicate-device-key.mts';

export const HOLDER_RECORDS = {
  credential: (digest: Hex) => `credential.anonymous:${digest.toLowerCase()}`,
  deviceKey: (thumbprint: string) => `credential.device-key:${thumbprint}`,
  holderSecret: (label: string) => `credential.holder-secret:${label}`,
  mandate: (ref: Hex) => `credential.presentation-mandate:${ref.toLowerCase()}`,
} as const;

export interface HolderCredentialRecordV1 {
  type: 'ap.anonymous-credential.v1';
  issuerKeyId: string; jwt: string; disclosures: string[]; issuerPublicKeyJwk: Record<string, unknown>;
  digest: Hex; claimSchema: string[]; deviceKeyThumbprint: string; issuedAt: string;
  /** Set when the issuer revoked it: the status the holder kept from the sequence where it was live (the gate's twin). */
  revoked?: { staleStatus: unknown; revokedAtSequence: number };
}
/** The device key, as her vault records it: the scalar itself (local custody), or WHERE it is held (the key service's key id — the
 *  scalar never leaves the service; the record is a reference, ADR-0055). */
export type HolderDeviceKeyRecordV1 =
  | { type: 'ap.device-key.v1'; thumbprint: string; privateKeyHex: string; /** The public half, so her agent can name the key (spec 444 `credential.request`) without reading the scalar. */ publicJwk?: { kty: 'EC'; crv: 'P-256'; x: string; y: string }; createdAt: string }
  | { type: 'ap.device-key.v1'; thumbprint: string; managed: { backend: 'akcs'; keyId: string; baseUrl: string; tenantId: string }; publicJwk?: { kty: 'EC'; crv: 'P-256'; x: string; y: string }; createdAt: string };
export function deviceRefOf(r: HolderDeviceKeyRecordV1): DeviceKeyRef {
  if ('managed' in r && r.managed) return { kind: 'akcs', keyId: r.managed.keyId, baseUrl: r.managed.baseUrl, tenantId: r.managed.tenantId };
  if ('privateKeyHex' in r && r.privateKeyHex) return { kind: 'local', privateKeyHex: r.privateKeyHex };
  throw new Error('the device-key record names neither a scalar nor a managed key');
}
export interface HolderSecretRecordV1 { type: 'ap.holder-secret.v1'; secret: Hex; createdAt: string }

/** The vault credential the gate presents AS HER AGENT: the grant + leaf her custodian minted for the runtime key
 *  (ap-home issue-self-host-vault-credentials.mts) and the runtime key itself from the gate's own env. */
export function holderVaultCredentials(i: { credsFile: string; vaultUrl: string; agentName: string; envFile?: string; /** The holder's HOME chain (her grant is verified there): faithchain by default, hopechain for an imbnet resident. */ chainId?: number }): VaultCredentials {
  const raw = JSON.parse(readFileSync(i.credsFile, 'utf8')) as { agent: Address; delegate: Address; interactionsService: Address; grant: VaultCredentials['grant']; sessionLeaf: VaultCredentials['leaf'] };
  const env = readFileSync(i.envFile ?? '.secrets/predicate-visitor.env', 'utf8');
  const key = /^PREDICATE_RUNTIME_KEY=(0x[0-9a-fA-F]{64})/m.exec(env)?.[1] as Hex | undefined;
  if (!key) throw new Error('PREDICATE_RUNTIME_KEY missing from .secrets/predicate-visitor.env');
  return { agent: raw.agent, agentName: i.agentName, vaultUrl: i.vaultUrl, interactionsService: raw.interactionsService, chainId: i.chainId ?? 34348, grant: raw.grant, leaf: raw.sessionLeaf, signerKey: key };
}

export interface HolderFromVault {
  live: IssuedCredential & { digest: Hex };
  revoked: IssuedCredential & { digest: Hex; staleStatus: Record<string, unknown>; revokedAtSequence: number };
  holderSecret: Hex;
  standing: StandingWireV1 & { holder: string; door: string; issuerKeyId: string };
}

/** Everything the holder half needs, read from HER vault under the gate's grant. A missing record is an error with its
 *  name; nothing is read from a file in its place. */
export async function readHolderFromVault(c: VaultCredentials, door: string): Promise<HolderFromVault> {
  const types = await listVaultRecords(c, 'credential.');
  const creds: HolderCredentialRecordV1[] = [];
  for (const t of types.filter((x) => x.startsWith('credential.anonymous:'))) { const r = await getVaultRecord<HolderCredentialRecordV1>(c, t); if (r?.type === 'ap.anonymous-credential.v1') creds.push(r); }
  // WHICH CREDENTIAL: the live one that has a presentation mandate for THIS door — and, when several issuers' credentials
  // sit in her vault (Z4's beside Z5's), the one whose mandate for this door is the NEWEST: a door's policy moves and she
  // re-derives her mandate; the old credential stays hers and proves nothing here.
  const mandatesAll: Array<StandingWireV1 & { holder: string; door: string; issuerKeyId: string; issuedAt?: string }> = [];
  for (const t of types.filter((x) => x.startsWith('credential.presentation-mandate:'))) { const r = await getVaultRecord<StandingWireV1 & { holder: string; door: string; issuerKeyId: string; issuedAt?: string }>(c, t); if (r) mandatesAll.push(r); }
  const forDoor = mandatesAll.filter((m) => m.door === door).sort((a, b) => String(b.issuedAt ?? '').localeCompare(String(a.issuedAt ?? '')));
  // Among an issuer's live credentials, the NEWEST (a re-issue over a changed layout supersedes the earlier one; both stay hers).
  const newest = <T extends { issuedAt?: string }>(xs: T[]): T | undefined => [...xs].sort((a, b) => String(b.issuedAt ?? '').localeCompare(String(a.issuedAt ?? '')))[0];
  const liveCands = creds.filter((x) => !x.revoked);
  const liveRec = forDoor.map((m) => newest(liveCands.filter((x) => x.issuerKeyId === m.issuerKeyId))).find(Boolean) ?? newest(liveCands);
  if (!liveRec) throw new Error(`her vault holds no live credential.anonymous:* record under this grant (listed ${types.length} credential.* record(s))`);
  const revokedRec = newest(creds.filter((x) => !!x.revoked && x.issuerKeyId === liveRec.issuerKeyId)) ?? newest(creds.filter((x) => !!x.revoked));
  if (!revokedRec) throw new Error('her vault holds no revoked credential (the gate\'s twin needs one)');
  const deviceKey = await getVaultRecord<HolderDeviceKeyRecordV1>(c, HOLDER_RECORDS.deviceKey(liveRec.deviceKeyThumbprint));
  if (!deviceKey) throw new Error(`her vault holds no ${HOLDER_RECORDS.deviceKey(liveRec.deviceKeyThumbprint)}`);
  const deviceRef = deviceRefOf(deviceKey);
  const secretTypes = types.filter((x) => x.startsWith('credential.holder-secret:'));
  const secret = secretTypes.length ? await getVaultRecord<HolderSecretRecordV1>(c, secretTypes[0]!) : null;
  if (!secret?.secret) throw new Error('her vault holds no credential.holder-secret:* record');
  const mandates = mandatesAll;
  const standing = forDoor.find((m) => m.issuerKeyId === liveRec.issuerKeyId);
  if (!standing) throw new Error(`her vault holds no presentation mandate for ${door} under ${liveRec.issuerKeyId} (${mandates.length} mandate(s))`);
  const asIssued = (r: HolderCredentialRecordV1): IssuedCredential & { digest: Hex } => ({ issuerKeyId: r.issuerKeyId, jwt: r.jwt, disclosures: r.disclosures, issuerPublicKeyJwk: r.issuerPublicKeyJwk, device: deviceRef, digest: r.digest });
  return { live: asIssued(liveRec), revoked: { ...asIssued(revokedRec), staleStatus: revokedRec.revoked!.staleStatus as Record<string, unknown>, revokedAtSequence: revokedRec.revoked!.revokedAtSequence }, holderSecret: secret.secret, standing };
}
