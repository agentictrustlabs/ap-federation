// THE REGISTER, READ — `federation.yaml` loaded and judged (spec 439 F1).
//
// Two things in this file are load-bearing and neither is a formality.
//
//   1. `governance` IS FOREVER. The estate id is `keccak256("eip155:<chainId>:<governance>")`, so changing
//      governance is not a config edit — it is a new estate as far as every counterparty is concerned, and
//      every reference they hold stops resolving. An estate whose register row has no governance address is
//      not "unconfigured", it is NOT PROJECTABLE, and `requireProjectable` says so with the reason from the
//      row rather than letting a job invent an id from whatever address happened to be nearby.
//   2. THE SIGNER IN THE ROW IS A CLAIM, NOT THE TRUTH. The truth is `signerOf(estateId)` on the registry,
//      and `register` is first-come-wins. So every job compares the two and refuses on a mismatch
//      (`anchor.ts`): a row that disagrees with the chain means either a stale file or a squatted id, and
//      guessing which one is not the projector's business.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { estateIdOf } from '@agenticprimitives/estate-projection';
import type { Address, Hex } from 'viem';

export interface RegistryRow {
  chainId: number;
  chain: string;
  address: Address;
  rpcEnv: string;
}

export interface EstateRow {
  id: string;
  /** Where the PROJECTION anchors and the estate id derives from. */
  chainId: number;
  /** Where the estate's PEOPLE live — where their grants are issued and revoked. Absent ⇒ `chainId`. */
  homeChainId?: number;
  home?: string;
  a2a?: string;
  /** null = this estate has no durable governance identity yet; the row says why in `blocked`. */
  governance: Address | null;
  governanceKind: 'estate-agent' | 'none' | string;
  governanceName?: string;
  signer?: Address;
  /** The env var holding the key that WRITES. Under spec 439 §4 that key is a DELEGATE under the registry agent's
   *  wire, not the signer itself — `anchorDelegateKeyEnv` is the name for that, and `signerKeyEnv` is the older
   *  shape kept for an estate that has not moved yet. One of them, never both. */
  signerKeyEnv?: string;
  anchorDelegateKeyEnv?: string;
  signerKind?: 'key' | 'registry-agent';
  anchoringWire?: string;
  /** The estate's own chain endpoint, when it is not neutral ground's. An estate on a second chain MUST name it. */
  rpcEnv?: string;
  /** Where revocation is read from on the estate's chain (`DelegationManager`). No address ⇒ nothing prunes ⇒ nothing is vouched for. */
  delegationManager?: Address;
  /** Is the signer declared where the estate's OWN chain says it (the first-come-wins cross-check)? */
  /** The register's own claim; the chain's answer (`readDeclaredSigner`) is what a run reports. Kept so a reviewer sees both. */
  declaredOnChain?: boolean;
  /** The AgentProfileResolver on the estate's chain, where its agent declares `atl:projectionSigner` (spec 439 F2.5). */
  profileResolver?: Address;
  blocked?: string;
}

/** A credential ISSUER the federation lists (spec 443 §2 `credentials.issuers[]`; Ring 0 zkID Z4). Its row on neutral ground is
 *  `estateIdOf(chainId, sa)` tagged `ISSUER_ROW_TAG` — the same registry, a distinct id (an issuer is never an estate's
 *  governance agent, or the two rows would collide). The signer is the issuer SA itself and the key that writes is a
 *  delegate under its anchoring wire, exactly as an estate's (spec 439 §4). */
export interface IssuerRow {
  id: string;
  estate: string;
  sa: Address;
  chainId: number;
  kind?: string;
  attestationRegistry?: Address;
  universalSignatureValidator?: Address;
  rpcEnv?: string;
  anchorDelegateKeyEnv?: string;
  signerKeyEnv?: string;
  anchoringWire?: string;
  facets?: Array<{ keyId: string; thumbprint?: string; attestation?: Hex; revocationRoot?: string; document?: unknown }>;
}

export interface FederationCredentials {
  suite: string;
  backend?: { package: string; version: string; role: string };
  verifierPlacement?: string;
  issuerTrust?: string;
  issuers?: IssuerRow[];
}

export interface Federation {
  federation: string;
  credentials?: FederationCredentials;
  registry: RegistryRow;
  estates: EstateRow[];
}

export function loadFederation(path = 'federation.yaml'): Federation {
  const raw = parse(readFileSync(path, 'utf8')) as Federation;
  if (!raw?.registry?.address || !raw.registry.chainId) throw new Error(`${path}: no registry address/chainId`);
  if (!Array.isArray(raw.estates) || !raw.estates.length) throw new Error(`${path}: no estates`);
  for (const e of raw.estates) {
    if (!e.id) throw new Error(`${path}: an estate row has no id`);
    if (!e.chainId) throw new Error(`${path}: estate ${e.id} has no chainId`);
    if (e.governance === undefined) throw new Error(`${path}: estate ${e.id} must state its governance address or null (never omit it)`);
  }
  return raw;
}

export function issuerById(f: Federation, id: string): IssuerRow & { issuerId: Hex } {
  const row = (f.credentials?.issuers ?? []).find((i) => i.id === id);
  if (!row) throw new Error(`no issuer "${id}" under credentials.issuers in the register (have: ${(f.credentials?.issuers ?? []).map((i) => i.id).join(', ') || 'none'})`);
  if (!row.sa || !row.chainId) throw new Error(`issuer ${id}: sa and chainId are required`);
  const issuerId = estateIdOf(row.chainId, row.sa);
  // The row must not be an estate's: same registry, same id function, and `register` is first-come-wins.
  for (const e of f.estates) if (e.governance && estateIdOf(e.chainId, e.governance).toLowerCase() === issuerId.toLowerCase()) throw new Error(`issuer ${id} IS estate ${e.id}'s governance agent — an issuer row would collide with the estate's row; issue from a distinct SA`);
  return { ...row, issuerId };
}

export function estateById(f: Federation, id: string): EstateRow {
  const row = f.estates.find((e) => e.id === id);
  if (!row) throw new Error(`no estate "${id}" in the register (have: ${f.estates.map((e) => e.id).join(', ')})`);
  return row;
}

/** An estate that may be registered and anchored, or a refusal carrying the row's own reason. */
export interface ProjectableEstate extends EstateRow { governance: Address; estateId: Hex }

export function requireProjectable(row: EstateRow): ProjectableEstate {
  if (!row.governance) {
    throw new Error(
      `estate ${row.id} has no governance address, so it has no estate id to anchor under — ${row.blocked ?? 'the register does not say why'}\n` +
      '  An estate id is permanent and `register` is first-come-wins: minting one from a provisional address is not undoable.',
    );
  }
  return { ...row, governance: row.governance, estateId: estateIdOf(row.chainId, row.governance) };
}

/** The RPC endpoint for neutral ground, from the environment the register names. It carries an app token, so
 *  it is never written into the register and never printed. */
export function registryRpc(f: Federation, env: NodeJS.ProcessEnv = process.env): string {
  const url = (env[f.registry.rpcEnv] ?? '').trim();
  if (!url) throw new Error(`${f.registry.rpcEnv} is not set — the projector reads neutral ground over it (it carries an app token, so it is not in federation.yaml)`);
  return url;
}

/** The estate's anchoring key, from the environment its row names. */
export function signerKey(row: Pick<EstateRow, 'id' | 'anchorDelegateKeyEnv' | 'signerKeyEnv'>, env: NodeJS.ProcessEnv = process.env): Hex {
  const name = row.anchorDelegateKeyEnv ?? row.signerKeyEnv;
  if (!name) throw new Error(`estate ${row.id} names no anchorDelegateKeyEnv (or signerKeyEnv), so nothing here can anchor for it`);
  const k = (env[name] ?? '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error(`${name} is not set to a 32-byte key — ${row.anchorDelegateKeyEnv ? "it is the key this estate's registry agent lent the right to anchor" : "that key is the estate's voice on neutral ground"}`);
  return k as Hex;
}
