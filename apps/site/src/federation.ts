// The register, typed and checked (spec 440). `federation.yaml` is the one source; this module parses it for the
// site and for `scripts/check-federation.mts`, and says what is wrong with it in words. It imports nothing from the
// Worker runtime so the check script can run it under tsx.
import { parse } from 'yaml';

export type TownStatus = 'live' | 'demo' | 'retired';

export interface FederationTown {
  id: string;
  chainId: number;
  status: TownStatus;
  repo?: string;
  manifest?: string;
  /** The town agent (ap-town apps/town-agent): /api/health · /api/town · /api/estates · /api/services. Custom domain only (CF-1042). */
  agent?: string;
  portal?: string;
  /** The town's naming read API (spec 430 §4). Custom domain only. */
  naming?: string;
  registry?: string;
  rpc?: string;
  note?: string;
}

export interface FederationEstate {
  id: string;
  chainId: number;
  home?: string;
  a2a?: string;
  governance: string | null;
  governanceKind: string;
  governanceName?: string;
  signer?: string;
  declaredOnChain?: boolean;
  blocked?: string;
}

export interface KmsCaller {
  subject: string;
  worker?: string;
  operations: string[];
  protectionLevels: string[];
  /** Named only when AZURE_HSM_DIRECT is among the levels — the estate that pays for a billable HSM key. */
  billedTo?: string;
  since?: string;
}

export interface KmsTenant {
  tenant: string;
  estate: string;
  town: string;
  backend: 'akcs';
  /** `null` = not recorded here; the operator's record on the CVM is authoritative and this row says so. */
  callers: KmsCaller[] | null;
  /** True while one credential is shared by several Workers — spec 407 D10. Refused by check:federation for a NEW town's estate. */
  sharedCredential?: boolean;
  note?: string;
}

export interface KmsCondition { id: number; condition: string; status: 'met' | 'open'; detail?: string }

export interface KmsPlatformRoot { provider: string; vault?: string; key: string; state?: string; billable: boolean }

export interface FederationKms {
  operator: string;
  /** The keys the cloud bills for. Everything else derives under them for free (the owner's cost rule). */
  platformRoots?: KmsPlatformRoot[];
  /** How many billable keys the federation allows itself — "a couple" as a number the check refuses to exceed. */
  billableKeyBudget?: number;
  evidence?: { checked: string; logicalKeys: number; byProtection: Record<string, number>; keyVaultCostMonthToDate?: string; note?: string };
  operatorRole: string;
  repo?: string;
  backend: 'akcs';
  host: string;
  hostPlanned?: string;
  probe: string;
  attestation?: string | null;
  azureResources?: string[];
  protectionLevels: string[];
  costRule?: string;
  tenants: KmsTenant[];
  conditions: KmsCondition[];
}

export interface FederationNaming {
  rootChain: number;
  rootRegistry: string;
  universalResolver: string;
  roots: string[];
  resolver: string;
  note?: string;
}

export interface Federation {
  federation: string;
  registry: { chainId: number; chain: string; address: string; deployed?: string; rpcEnv?: string };
  estates: FederationEstate[];
  towns: FederationTown[];
  kms: FederationKms;
  naming: FederationNaming;
}

export function parseFederation(text: string): Federation {
  const raw = parse(text) as Partial<Federation> | null;
  if (!raw || typeof raw !== 'object') throw new Error('federation.yaml is empty or not a mapping');
  return {
    federation: String(raw.federation ?? ''),
    registry: raw.registry as Federation['registry'],
    estates: (raw.estates ?? []) as FederationEstate[],
    towns: (raw.towns ?? []) as FederationTown[],
    kms: raw.kms as FederationKms,
    naming: raw.naming as FederationNaming,
  };
}

const HEX40 = /^0x[0-9a-fA-F]{40}$/;
const isUrl = (s: unknown): s is string => typeof s === 'string' && /^https:\/\/[^/\s]+/.test(s);
/** A Worker cannot fetch a same-account workers.dev host (CF-1042), so a town surface the site reads must be a custom domain. */
const isWorkersDev = (s: string) => /\.workers\.dev(\/|$)/.test(s);

/** Every reason the register is not fit to publish, in words. Empty = fit. */
export function validateFederation(f: Federation): string[] {
  const errs: string[] = [];
  if (!f.registry || typeof f.registry.chainId !== 'number' || !HEX40.test(f.registry.address ?? '')) errs.push('registry: chainId (number) and address (0x…40) are required');

  const townIds = new Set<string>();
  const liveChains = new Set<number>();
  for (const t of f.towns ?? []) {
    const at = `towns[${t.id ?? '?'}]`;
    if (!t.id) errs.push(`${at}: id is required`);
    if (townIds.has(t.id)) errs.push(`${at}: duplicate town id`);
    townIds.add(t.id);
    if (typeof t.chainId !== 'number') errs.push(`${at}: chainId (number) is required`);
    if (!['live', 'demo', 'retired'].includes(t.status)) errs.push(`${at}: status must be live | demo | retired`);
    if (t.status !== 'retired') {
      if (!isUrl(t.agent)) errs.push(`${at}: a ${t.status} town needs its town agent URL (https)`);
      if (!isUrl(t.naming)) errs.push(`${at}: a ${t.status} town needs its naming read API URL (https)`);
      for (const [k, v] of [['agent', t.agent], ['naming', t.naming], ['registry', t.registry]] as const) {
        if (typeof v === 'string' && isWorkersDev(v)) errs.push(`${at}.${k}: a workers.dev host cannot be fetched from the site's Worker (CF-1042) — declare a custom domain`);
      }
    }
    if (t.status === 'live') liveChains.add(t.chainId);
  }
  if (!townIds.size) errs.push('towns: at least one town');

  const estateIds = new Set<string>();
  for (const e of f.estates ?? []) {
    estateIds.add(e.id);
    if (!townIds.size) continue;
    if (![...(f.towns ?? [])].some((t) => t.chainId === e.chainId)) errs.push(`estates[${e.id}]: chainId ${e.chainId} is not a town's chain`);
  }

  const k = f.kms;
  if (!k) errs.push('kms: the shared operator record is required (spec 440 §A)');
  else {
    if (!k.operator || !k.operatorRole) errs.push('kms: operator and operatorRole are required (spec 440 A4)');
    if (!isUrl(k.probe)) errs.push('kms.probe: https URL required');
    if (!Array.isArray(k.protectionLevels) || k.protectionLevels.includes('AZURE_HSM_DIRECT')) errs.push('kms.protectionLevels: CVM levels only by default (the cost rule); AZURE_HSM_DIRECT may appear only on a caller with billedTo');
    const byEstate = new Map<string, string>();
    const byTenant = new Map<string, string>();
    for (const t of k.tenants ?? []) {
      const at = `kms.tenants[${t.tenant}]`;
      if (t.backend !== 'akcs') errs.push(`${at}: backend must be akcs`);
      if (!townIds.has(t.town)) errs.push(`${at}: town ${t.town} is not in towns`);
      if (byEstate.has(t.estate)) errs.push(`${at}: estate ${t.estate} already has tenant ${byEstate.get(t.estate)} — one tenant per estate (condition 2)`);
      if (byTenant.has(t.tenant)) errs.push(`${at}: tenant is already ${byTenant.get(t.tenant)}'s — a tenant is a derivation root and is never shared (condition 2)`);
      byEstate.set(t.estate, t.tenant); byTenant.set(t.tenant, t.estate);
      const town = f.towns.find((x) => x.id === t.town);
      if (t.sharedCredential && town && town.id !== f.registry.chain) errs.push(`${at}: a shared caller credential is refused for an estate outside the first town (condition 1) — bind one caller per Worker first`);
      for (const c of t.callers ?? []) {
        if (!c.subject) errs.push(`${at}.callers: subject required`);
        if (!Array.isArray(c.operations) || !c.operations.length) errs.push(`${at}.callers[${c.subject}]: operations must be an explicit list`);
        // `*` is the over-broad credential of spec 407 D10. Tolerated only where the row SAYS it is shared (the open
        // condition, acknowledged), never on a tenant that claims to be clean.
        else if (c.operations.includes('*') && !t.sharedCredential) errs.push(`${at}.callers[${c.subject}]: operations * is the shared credential — mark the tenant sharedCredential: true (condition 1 open) or re-bind per operation`);
        if (c.protectionLevels?.includes('AZURE_HSM_DIRECT') && !c.billedTo) errs.push(`${at}.callers[${c.subject}]: AZURE_HSM_DIRECT needs billedTo (condition 3)`);
      }
    }
    // The cost rule as a gate: billable platform roots stay within the budget, and every root names its provider and key.
    const budget = k.billableKeyBudget ?? 2;
    const billable = (k.platformRoots ?? []).filter((r) => r.billable).length;
    if (billable > budget) errs.push(`kms.platformRoots: ${billable} billable key(s) exceeds the budget of ${budget} — a tenant or a caller never needs a new Key Vault key; who asked for one, and who pays?`);
    for (const r of k.platformRoots ?? []) if (!r.provider || !r.key) errs.push('kms.platformRoots[]: provider and key are required');
    for (const c of k.conditions ?? []) if (!['met', 'open'].includes(c.status)) errs.push(`kms.conditions[${c.id}]: status must be met | open`);
    if ((k.conditions ?? []).length !== 4) errs.push('kms.conditions: the four conditions of spec 440 A3, each with a status');
  }

  const n = f.naming;
  if (!n) errs.push('naming: the universal namespace record is required (spec 440 §C)');
  else {
    if (!liveChains.has(n.rootChain)) errs.push(`naming.rootChain ${n.rootChain} must be a live town's chain (spec 440 C1)`);
    if (!HEX40.test(n.rootRegistry ?? '')) errs.push('naming.rootRegistry: 0x…40 required');
    if (!HEX40.test(n.universalResolver ?? '')) errs.push('naming.universalResolver: 0x…40 required');
    if (!Array.isArray(n.roots) || !n.roots.length) errs.push('naming.roots: the typed roots on the root chain');
    if (!isUrl(n.resolver)) errs.push('naming.resolver: https URL of the universal resolver');
    const roots = (f.towns ?? []).filter((t) => t.status === 'live' && t.chainId === n.rootChain);
    if (roots.length !== 1) errs.push('naming: exactly one live town on the root chain');
  }
  return errs;
}
