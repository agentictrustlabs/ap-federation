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
  /** The town's naming read API (spec 430 §4). Custom domain only. Absent when `namesRootedAt` is set. */
  naming?: string;
  /** THIS TOWN SELLS NO NAMES. Spec 440 §C puts the universal namespace on ONE root chain, so a second town
   *  legitimately has no naming API of its own — its names are resolved by the town named here. Saying so is
   *  what separates "rooted elsewhere, by design" from "somebody forgot the URL", and only one of those is
   *  something a reader of this register should accept. */
  namesRootedAt?: string;
  registry?: string;
  rpc?: string;
  /** The env var naming the gateway URL (with an app token) the federation's Workers read this chain over. */
  rpcEnv?: string;
  /** The UniversalSignatureValidator on this chain — what a door verifies a presenter's signature with. */
  universalSignatureValidator?: string;
  note?: string;
}

export interface FederationEstate {
  id: string;
  /** Where the estate's PROJECTION anchors and its permanent id derives from. Never changes. */
  chainId: number;
  /** Where the estate's PEOPLE live — accounts, Home, custody, grants. Absent ⇒ the projection chain. */
  homeChainId?: number;
  rpcEnv?: string;
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

export interface DoorCredentialPolicy { predicates: Array<{ claim: string; op: string; value: unknown }>; claimSchema: string[]; vcSize: string; acceptedVersions?: string[]; nullifier?: { require: boolean; grade: string }; status?: string; maxAgeSeconds?: number }
export interface FederationDoor { estate: string; url: string; target?: string; since?: string; credentialProofs?: DoorCredentialPolicy }

/** Spec 443 §2 `credentials:` (Ring 0 zkID Z4): the verifier side the doors run, and the issuers whose facets the
 *  federation lists — read the way a stranger reads them (attested on the issuer's chain, revocation on neutral ground). */
export interface FederationIssuerFacet { keyId: string; thumbprint?: string; attestation?: string; revocationRoot?: 'projection' | 'statusList'; document?: { facet: { type: string; subjectAgent: string; keyId: string; suite: string; publicKeyJwk?: Record<string, unknown>; validFrom: string; validUntil?: string }; facetHash: string; signature: string } }
export interface FederationIssuer { id: string; estate: string; sa: string; chainId: number; kind?: string; attestationRegistry?: string; universalSignatureValidator?: string; rpcEnv?: string; anchorDelegateKeyEnv?: string; anchoringWire?: string; since?: string; note?: string; facets?: FederationIssuerFacet[] }
export interface FederationCredentials { suite: string; backend?: { package: string; version: string; role: string }; verifierPlacement?: string; issuerTrust?: string; issuers?: FederationIssuer[] }

export interface Federation {
  federation: string;
  doors: FederationDoor[];
  registry: { chainId: number; chain: string; address: string; deployed?: string; rpcEnv?: string };
  estates: FederationEstate[];
  towns: FederationTown[];
  kms: FederationKms;
  naming: FederationNaming;
  credentials?: FederationCredentials;
}

export function parseFederation(text: string): Federation {
  const raw = parse(text) as Partial<Federation> | null;
  if (!raw || typeof raw !== 'object') throw new Error('federation.yaml is empty or not a mapping');
  return {
    federation: String(raw.federation ?? ''),
    registry: raw.registry as Federation['registry'],
    estates: (raw.estates ?? []) as FederationEstate[],
    towns: (raw.towns ?? []) as FederationTown[],
    doors: ((raw as { doors?: FederationDoor[] }).doors ?? []),
    kms: raw.kms as FederationKms,
    naming: raw.naming as FederationNaming,
    ...(raw.credentials ? { credentials: raw.credentials as FederationCredentials } : {}),
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
  // EVERY id up front, because `namesRootedAt` points ACROSS the list and a check that only knows the towns
  // it has already walked would accept or reject the same register depending on the order its rows are in.
  const declaredTowns = new Set<string>((f.towns ?? []).map((t) => t.id).filter(Boolean));
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
      // A town either serves names or says whose root serves them. The first version of this rule required a
      // naming URL from every town, which was true while there was one town and became wrong the day there
      // were two: hopenet deploys no naming contracts at all, because the namespace is rooted on faithchain.
      if (t.namesRootedAt) {
        if (!declaredTowns.has(t.namesRootedAt)) errs.push(`${at}.namesRootedAt: "${t.namesRootedAt}" is not a town in this register`);
        else if (t.namesRootedAt === t.id) errs.push(`${at}.namesRootedAt: a town cannot root its names at itself — give it a naming URL instead`);
        // A town may ALSO read its own local table while its names are rooted elsewhere: an estate's Home on that chain
        // claims into the chain's own registry (rich-impact.me on hopechain, W10, 2026-10-15), and the resolver has to be
        // able to ask the chain where the claim landed. `naming` says "read here"; `namesRootedAt` says "the root is there";
        // together they say both, and the root town's answer stays the record of the name.
        if (t.naming && !isUrl(t.naming)) errs.push(`${at}.naming: must be an https URL when declared`);
      } else if (!isUrl(t.naming)) {
        errs.push(`${at}: a ${t.status} town needs its naming read API URL (https), or namesRootedAt naming the town whose root serves it`);
      }
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
    // An estate whose people live on another chain names it, and that chain must be a town this register can verify on.
    if (e.homeChainId !== undefined) {
      const home = (f.towns ?? []).find((t) => t.chainId === e.homeChainId);
      if (!home) errs.push(`estates[${e.id}]: homeChainId ${e.homeChainId} is not a town's chain`);
      else if (e.homeChainId !== e.chainId) {
        if (!e.rpcEnv) errs.push(`estates[${e.id}]: lives on ${e.homeChainId} but names no rpcEnv — revocation is read on the home chain, and a projector with no endpoint there vouches for nothing`);
        if (!home.rpcEnv || !home.universalSignatureValidator) errs.push(`estates[${e.id}]: its home town ${home.id} declares no rpcEnv/universalSignatureValidator — a door cannot verify a presenter from there`);
      }
    }
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

  for (const d of f.doors ?? []) {
    if (!isUrl(d.url) || isWorkersDev(d.url)) errs.push(`doors[${d.estate}]: an https custom-domain URL`);
    if (!(f.estates ?? []).some((e) => e.id === d.estate)) errs.push(`doors[${d.estate}]: not an estate in the register`);
    const cp = d.credentialProofs;
    if (cp) {
      if (!f.credentials) errs.push(`doors[${d.estate}].credentialProofs: a door with a predicate grade needs the top-level credentials block`);
      if (!Array.isArray(cp.predicates) || !cp.predicates.length) errs.push(`doors[${d.estate}].credentialProofs.predicates: at least one predicate — a door that asks nothing verifies nothing`);
      for (const pr of cp.predicates ?? []) if (!pr.claim || !['gte', 'lte', 'in-set', 'before', 'after'].includes(pr.op)) errs.push(`doors[${d.estate}].credentialProofs: predicate ${JSON.stringify(pr)} is not { claim, op: gte|lte|in-set|before|after, value }`);
      if (!Array.isArray(cp.claimSchema) || !cp.claimSchema.length) errs.push(`doors[${d.estate}].credentialProofs.claimSchema: the credential layout the door accepts, claim per slot`);
      if (!['1k', '2k', '4k', '8k'].includes(cp.vcSize)) errs.push(`doors[${d.estate}].credentialProofs.vcSize: 1k | 2k | 4k | 8k`);
      if (cp.nullifier && !['asserted', 'in-circuit'].includes(cp.nullifier.grade)) errs.push(`doors[${d.estate}].credentialProofs.nullifier.grade: asserted | in-circuit`);
      if (cp.status && !['required', 'none'].includes(cp.status)) errs.push(`doors[${d.estate}].credentialProofs.status: required | none`);
    }
  }
  // ── credentials (spec 443 §2; zkID Z4): a verifier declaration and issuers read the way a stranger reads them ──
  const c = f.credentials;
  if (c) {
    if (c.suite !== 'openac-sd-jwt-p256') errs.push(`credentials.suite: openac-sd-jwt-p256 is the one suite Ring 0 Z1 ships (got ${c.suite})`);
    if (c.backend && c.backend.role !== 'verifier') errs.push('credentials.backend.role: verifier — a federation never holds a proving key');
    if (c.verifierPlacement && !['node', 'worker'].includes(c.verifierPlacement)) errs.push('credentials.verifierPlacement: node | worker');
    if (c.issuerTrust && c.issuerTrust !== 'chain') errs.push('credentials.issuerTrust: chain — never a fetch to the issuer');
    const ids = new Set<string>();
    for (const i of c.issuers ?? []) {
      const at = `credentials.issuers[${i.id ?? '?'}]`;
      if (!i.id || ids.has(i.id)) errs.push(`${at}: a unique id`); ids.add(i.id ?? '');
      if (!HEX40.test(i.sa ?? '')) errs.push(`${at}.sa: the issuing agent's address (an org or a service, never a person)`);
      if (typeof i.chainId !== 'number') errs.push(`${at}.chainId: the chain the issuer SA lives on`);
      if (!(f.estates ?? []).some((e) => e.id === i.estate)) errs.push(`${at}.estate: not an estate in the register`);
      const governs = (f.estates ?? []).find((e) => e.governance && e.governance.toLowerCase() === (i.sa ?? '').toLowerCase());
      if (governs) errs.push(`${at}.sa IS estate ${governs.id}'s governance agent — its issuer row would collide with the estate's row on neutral ground; issue from a distinct SA`);
      if (i.attestationRegistry && !HEX40.test(i.attestationRegistry)) errs.push(`${at}.attestationRegistry: 0x…40`);
      for (const fc of i.facets ?? []) {
        const fat = `${at}.facets[${fc.keyId ?? '?'}]`;
        if (!fc.keyId) errs.push(`${fat}: keyId is required`);
        if (fc.attestation && !/^0x[0-9a-fA-F]{64}$/.test(fc.attestation)) errs.push(`${fat}.attestation: the AttestationRegistry uid (bytes32)`);
        if (fc.revocationRoot && !['projection', 'statusList'].includes(fc.revocationRoot)) errs.push(`${fat}.revocationRoot: projection | statusList`);
        if (fc.document) {
          if (fc.document.facet?.keyId !== fc.keyId) errs.push(`${fat}.document.facet.keyId must equal keyId`);
          if ((fc.document.facet?.subjectAgent ?? '').toLowerCase() !== (i.sa ?? '').toLowerCase()) errs.push(`${fat}.document.facet.subjectAgent must be the issuer SA`);
          if (!/^sha256:[0-9a-f]{64}$/.test(fc.document.facetHash ?? '')) errs.push(`${fat}.document.facetHash: sha256:<hex>`);
          if (!/^0x[0-9a-fA-F]+$/.test(fc.document.signature ?? '')) errs.push(`${fat}.document.signature: the SA's signature over the facet hash`);
          const jwk = fc.document.facet?.publicKeyJwk as { d?: unknown } | undefined;
          if (jwk && 'd' in jwk) errs.push(`${fat}.document.facet.publicKeyJwk carries a private component — never`);
        }
      }
    }
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
