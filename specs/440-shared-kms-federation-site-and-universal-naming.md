# Spec 440 — The shared KMS operator, the federation site, and the universal naming service

**Status:** DRAFT 2026-10-14, with wave 1 of each part built the same day (§A6, §B4, §C8 say what is live).
**Owner's brief (2026-10-14):** *"Bring our ap-home Azure KMS to the ap-federation level so multiple towns can use
our single Azure KMS. Create an ap-federation.faithnet.io site that supports viewing of all the towns we have and any
KMS view. Put together a universal naming service similar to ENS v2 that builds off of one chain, faithchain today,
just like ENS v2 does, but we can bring in other chains into a seamless naming service and be a federated
capability."*
**Builds on:** Ring 0 spec 439 (this repository's charter) and spec 410 §4; Ring 0 `chains-and-estates.md` §3.2
(one principal on many chains; the ported ENS and ERC-8004 principles) and §5.1; ap-town specs 429 (the town),
430 (the naming service), 431 (paid names, the gate per estate), 436 (the four contexts); this repository's
`docs/architecture/federated-agent-naming.md` (which §C amends) and `federation-principles.md`.
**Does not change:** any contract, any Ring 0 package, any estate's Workers, any key.

---

## 0. Decisions in one screen

| # | Decision |
| --- | --- |
| A1 | **One shared AKCS operator at the federation scale; one tenant per estate, always.** The operator is recorded here (`federation.yaml#kms`, `DEPLOYER.md`); each town declares it by reference; each estate's tenant is a derivation root and is never shared. Federation-level means more tenants, never a shared one. |
| A2 | **It is shared infrastructure with an operator of record, not neutral ground and not a root.** Someone can pause it; it is metered per estate; it is optional (`key-custody` is a port; a town running its own tenant elsewhere is still in the federation). |
| A3 | **Four conditions gate a second town's use of it**: per-caller least-privilege bindings (closing spec 407 D10's shared credential); one tenant per estate; CVM protection levels only (the cost rule); the CVM attestation published. The gate is `scripts/check-federation.mts` (the record) plus the operator runbook (the actions). |
| A4 | **The honest caveat is written into the record, and it is CONDITIONAL** (corrected 2026-10-14 — ap-home spec 441 §6): *if* an estate derives custody in its tenant, residents who signed in with Google, email or phone have their custody seed there and the operator custodies them. **No estate does that today** — both set `A2A_CUSTODY_KMS_BACKEND = "local-aes"`, so custody derives from a Worker secret of the estate; faithnet's tenant holds one `oidc-custodian` key, provisioned and never selected. ap-home spec 441 D4 keeps it that way on all estates until the cost is decided. The operator role is named. |
| B1 | **`ap-federation.faithnet.io` is the federation's own site**, deployed from this repository (`apps/site`): the towns we have, their estates and services with live probes; the KMS operator record with its tenants and a live probe; and the universal name resolver. Public, read-only, keyless. It lists; it never grants. |
| B2 | **The site reads each town's own surfaces** (the town agent's API, the naming read API, the registry) and the federation register. It holds no copy of any town's manifest and no record of anyone. |
| C1 | **One universal namespace, rooted on one chain — faithchain today — the way ENS v2 is rooted on Ethereum L1.** The typed roots on the root chain (`.me .org .team .svc .workspace .treasury .registry .church .circle .household`, and `.estate`) are the federation's names. This amends the naming document's N7: the federation has a root, by the owner's decision, and it is a contract set on the root chain, not an operator. |
| C2 | **Other chains join without a second registry.** An estate on another chain gets a naming gate on the root chain's priced roots (`PricedSubregistry.setGate`, which exists); its residents' names are owned on the root chain by their root-chain account (home or satellite); the name's address records are keyed by chain (ENSIP-9/11 ported); each chain's account claims the name in reverse, valid only with the forward (ENSIP-19 ported); and the name resolves on other chains by proof against the root chain's state (ERC-3668's shape) or by reading the root chain where it can be read. No town re-registers a name; no town runs a parallel `.me`. |
| C3 | **The universal resolver is a federation capability**: one read API that answers a name across every town, returns the chain-qualified identity and the issuing estate, and never shows a name bare outside its home. Wave 1 is read-only over the towns' naming services (live today); later waves read the root chain and its proofs directly. |
| C4 | **Governance of the root is the one new trust position, and it is said.** The priced roots' governor is `naming.svc` under the town clerk persona (spec 431). A root that serves many towns needs a governor those towns accept; this spec names the position and leaves its custody shape (a council of town clerks as a `CustodyPolicy` quorum) to a Ring 0 spec. Until then the root chain's operator governs, as ENS Labs did before the DAO. |

---

## A. The shared KMS operator

### A1 What is true today, and what changes

AKCS runs on one Azure confidential VM (`vm-akcs-pilot-0`, tunnel `vm-akcs-tunnel-pilot`, resource group
`RG-AKCS-PILOT-WESTUS`; code in `agentictrustlabs/faithkms`), reached at `akcs-pilot.faithnet.io`. It is declared in
faithchain's `town.yaml` as commons (`kms`), with a tenant per estate: `faithnet` (callers for the faithnet Workers,
its second deployment `faithnet-b` and the service `skills-a2a`) and `imb` (callers `imb-vault-2`, `imb-runtime-2`,
CVM levels only). A tenant is the seed its keys derive from: the vault's per-person KEKs (`vault-kek:<owner>`), the
runtime→vault MAC keys, and the OIDC-custody seed for residents who sign in with Google, email or phone.

Nothing in that is chain-bound. A key signs for an account on any chain; a tenant is an estate boundary wherever the
estate stands. So the change is **who is recorded as operator, where a town looks for it, and who may request a
tenant** — not the mechanism.

| | Before | After |
| --- | --- | --- |
| operator of record | implicit (the owner, on the CVM); declared as a town service of faithchain | **ap-federation** (`federation.yaml#kms`, `DEPLOYER.md` "shared operators") |
| declared by | faithchain's `town.yaml` `kms` row | every town's `town.yaml` `kms` row, by reference to the federation record; each estate row keeps `kms: { tenant }` |
| host | `akcs-pilot.faithnet.io` (a pilot name on an estate's zone — spec 436 §8 flagged it) | `kms.faithnet.io` (planned, A5 step 3); the pilot host stays until every caller is re-pointed |
| tenants | one per estate on faithchain | one per estate in any town; requested through the runbook `docs/runbooks/kms-tenant-for-an-estate.md` |
| callers | some per-Worker, one credential shared across estates (407 D10) | one least-privilege caller per Worker per estate, no shared credential (A3 condition 1) |
| cost rule | in a memory and a runbook | in the record: `protectionLevels: [CVM_WRAPPED, CVM_DERIVED]`, HSM-direct refused by default |
| attestation | not published | the CVM attestation document published at the operator host, linked from the record (A3 condition 4) |

### A2 What it is, and is not

- **Shared infrastructure with an operator of record** (436 C6's test: wiping it costs a rebuild — of delegate
  keys, re-minted under wires custodians still hold). Metered per estate (436 C8).
- **Not neutral ground.** `EstateProjectionRegistry` has no admin; a KMS has an operator who can pause it, and a
  record that said otherwise would be false.
- **Not a root and not a context.** The four contexts hold what they hold (436 §1); a KMS holds delegate keys for
  estates and is used by them. It appears in a town's manifest as a service the town *reaches*, like the chain
  gateway, never as something the town *is*.
- **Not required.** `@agenticprimitives/key-custody` is a port. An estate may run its tenant on another AKCS
  instance or another backend; the federation offers one shared operator as a convenience. A town that uses it does
  not join faithnet's trust domain (tenant = derivation root per estate; callers per Worker), but it does trust the
  operator — bounded, for most residents, to delegates under revocable wires.
- **The caveat (A4).** For residents custodied through OIDC, the tenant root is their custody root. The operator is
  therefore a custodian of those residents, in every town that opts in. The record names the operator role and who
  holds it (one person today), and the attestation is what a town verifies before trusting it.

### A3 The four conditions (the gate)

| # | Condition | How it is checked | Status 2026-10-14 |
| --- | --- | --- | --- |
| 1 | **No shared caller credential.** Every Worker of every estate has its own `bind-caller` with exact `--audiences`, `--purposes`, `--operations` and CVM `--protection-levels` | `federation.yaml#kms.tenants[].callers` lists each caller by Worker; `check:federation` refuses a tenant with `sharedCredential: true`; the operator's record on the CVM is authoritative | impact-agent: met (two callers, 2026-10-11). faithnet: **open** — the pilot credential shared across faithnet's Workers is 407 D10's finding; close before a third estate binds |
| 2 | **One tenant per estate.** | `check:federation` refuses two estates on one tenant and one estate on two | met |
| 3 | **CVM levels only.** `AZURE_HSM_DIRECT` is never in a caller's levels unless the record names the estate that pays for it | `check:federation` refuses `AZURE_HSM_DIRECT` without `billedTo` | met |
| 4 | **Attestation published.** The CVM's attestation document (Azure Attestation JWT over the VM's TPM/SEV-SNP report) is served at the operator host and linked from the record | the KMS view shows it; a town's `kms` row may pin its digest | **open** — operator action (A5 step 4) |

### A4 The operator role

One privileged position: the AKCS operator (`akcs operator …` on the CVM, via `az vm run-command`). Today the owner.
The record names it; the runbook says what it may do (create a tenant, bind and disable a caller, mint a caller token)
and what it may never do (read a key, export a seed, bind a caller with `*` operations). A second holder is a
posture item (407 D10's "single KMS operator"), listed, not scheduled.

### A5 Operator actions (not code; the runbook carries the commands)

1. **Re-bind faithnet's Workers** to per-Worker callers (condition 1), then disable the shared one.
2. **Record every caller** in `federation.yaml#kms.tenants[]` as it is bound.
3. **Move the host**: DNS `kms.faithnet.io` → the tunnel; re-point `AKCS_URL` per estate at the Workers' next
   deploy; retire `akcs-pilot` once no caller uses it.
4. **Publish the attestation** at `https://kms.faithnet.io/.well-known/attestation` (the document the CVM can
   produce; the format is Azure Attestation's). Link it from the record.
5. **For a new town's estate**: the runbook, end to end; the estate's `town.yaml` row gains `kms: { tenant,
   backend: akcs }` and the town's `kms` service row references the federation record.

### A6 Wave 1, built 2026-10-14

`federation.yaml#kms` (the operator record: host, probe, Azure resources, protection levels, tenants with their
callers where known, the four conditions with status, the operator role); `docs/runbooks/kms-tenant-for-an-estate.md`;
`scripts/check-federation.mts` (conditions 1–3 as refusals over the record); the KMS view on the site (§B). The
operator actions in A5 are **not done** — they need the CVM and are the owner's.

### A7 Cost evidence (2026-10-14) — the federation adds no Azure key cost, and the record now proves it

Read from the CVM (`akcs operator status`, non-secret metadata) and from Azure Cost Management, not assumed:

| | |
| --- | --- |
| platform roots in Key Vault (the keys Azure bills for) | **1** — `akcs-platform-root-wrap`, Key Vault Premium, private link only |
| Key Vault cost, month to date | **5.00 USD** (one Premium HSM-protected advanced key); key operations 0.00 USD |
| logical keys under the root | **433** — faithnet 423, imb 7, impact 3 — every one `CVM_WRAPPED`, none billable |
| Azure spend, month to date | 323.85 USD, of which keys are the 5.00: the rest is the confidential VM, Bastion, the Postgres, the registry, disks |

What the federation approach changes in that table: **nothing.** A tenant is a set of purpose roots derived under the
platform root; a caller is a binding; a logical key is wrapped by the CVM. None of them touches Key Vault. The two
things that *would* add a billable key are a second platform root (a deliberate ceremony, `akcs operator init`) and
a caller bound with `AZURE_HSM_DIRECT`, and both are now refusals in `check:federation` unless the record names
them: `billableKeyBudget: 2` (the owner's "a couple of root keys" as a number) and `billedTo` on any HSM-direct
caller. The register carries the evidence (`kms.platformRoots`, `kms.evidence`) so the site's KMS view shows
"keys the cloud bills for: 1 of 2" beside the 433 that cost nothing.

Two things the status read surfaced, recorded and not acted on: `demo-a2a-faithnet` is bound with operations `*`
(the concrete form of condition 1; the check tolerates it only because the faithnet row says `sharedCredential:
true`), and tenant `impact` — the retired base-sepolia town's estate — still has three active callers (disable or
keep is the owner's call).

---

## B. The federation site — `ap-federation.faithnet.io`

### B1 What it shows

| View | Source | What it says | What it never says |
| --- | --- | --- | --- |
| **Towns** | `federation.yaml#towns` + each town agent's `/api/health`, `/api/town`, the naming service's `/api/town` | every town we have: chain, status (live · demo · retired), its estates (Home, A2A, zone, name roots), its services and their probes, root name counts | "authorized"; a score |
| **KMS** | `federation.yaml#kms` + the operator host's `/healthz` (+ the attestation when published) | the operator record; each tenant → estate → town; each caller and its operations; the four conditions and their status; the cost rule | any key, token, seed or caller credential; anything about a resident |
| **Names** | the universal resolver (§C), wave 1 over each live town's naming read API | a label or a name across every town: for each row the town, the chain, the CAIP-10 identity, the type, the status, and the **qualified display** (never bare); which estate's gate issued it when the town says | a resolution as authority; a bare foreign name |
| **Neutral ground** | `federation.yaml#registry` + the estates' projection rows | the registry address, each projecting estate's id, governance and signer, `declaredOnChain` | the leaves |

### B2 Shape

`apps/site`: one Worker (`ap-federation-site`, env `faithnet`, custom domain `ap-federation.faithnet.io`), the
page inline, the register bundled as text at build time (`federation.yaml` is the source; the Worker holds no copy of
any town's manifest and fetches live). Routes: `/` the page; `/api/federation`, `/api/towns`, `/api/kms`,
`/api/names?q=`, `/api/names/<name>`. CORS `*`, cached seconds. No key, no secret, no Durable Object.

The town-agent pattern is followed and not copied: ap-town's Worker reads its own manifest and probes its own
services; this one reads the *towns'* public surfaces and probes *them*. A same-account `workers.dev` host cannot be
fetched from a Worker (CF-1042), which is why every town surface the site reads must be on a custom domain, and the
register says so.

### B3 Rules

- **Public, read-only, keyless.** The site answers from the register and from other services' public answers.
- **One mechanism per read** (ADR-0013): a town surface that cannot be reached is shown as unreachable with the
  reason, never substituted by a cached or inferred answer.
- **The never-bare rule** (naming doc N4) holds on every name the site prints: the site is in no town, so every name
  carries its town.
- **No link into a private repository** (`check:public-links`).

### B4 Wave 1, built 2026-10-14

`apps/site` deployed; `scripts/gate-federation-site.mts` in `live-gates.json` (the towns view lists faithchain live,
the KMS probe answers, `alice` resolves with every row qualified; twin: no row is ever bare and a retired town is
never queried).

---

## C. The universal naming service

### C1 The decision, and what it amends

Yesterday's naming document chose *no federation root* (N7) and recorded the ENS v2 path as an opt-in for later
(§5.6). The owner chose it today: **one universal namespace rooted on one chain, faithchain, the way ENS v2 is rooted
on Ethereum L1, bringing other chains in without a second registry.** N1–N6 and N8 stand unchanged; N7 is amended in
the naming document to point here. What makes the decision safe is that the root is a *contract set*, not an
operator: `AgentNameRegistry` and the priced typed subregistries on the root chain, whose governor is the one trust
position §C7 names.

### C2 The ENS v2 crosswalk, applied

| ENS v2 | Here | Status |
| --- | --- | --- |
| One root registry on L1; names resolve from L1 for every chain | the root chain's `AgentNameRegistry` with its typed roots; every name in the federation is a record there | **live**; since 2026-10-14 a second town (hopenet, hopechain) roots its names here and issues none (C10) |
| "Every name has its own registry" (a directed graph rooted at one root) | the registry is multi-root with per-root subregistries (priced, gate-signed) and per-name subregistries (an owner hands child-issuing to a contract); scoped names `x@ctx` are the context's subtree | live |
| Registrations from any chain: pay with stablecoins from any EVM chain without bridging | a claim is a user operation on the root chain, sponsored by the town paymaster, with a ticket the resident's own estate's gate signed; the resident's root-chain account is the owner (C3) | **designed** (C3); one chain today |
| ENSIP-9/11 multi-coin `addr(node, coinType)` | `atl:addr` keyed by CAIP-2 chain, replacing the single record (Ring 0 contract change: `AgentNameAttributeResolver` currently "no multi-coin address records") | **proposed** to Ring 0 (chains-and-estates §3.2 item 3) |
| ENSIP-19 primary name per chain, valid only with the forward | a reverse claim per chain, honoured only when the root record's `atl:addr[chain]` names that account; the universal resolver enforces the round trip exactly as `reverseResolveString` does on one chain | **proposed** (item 4) |
| ERC-3668 CCIP-Read, verifiable resolvers on other chains | a verifying resolver on another chain answers against the root chain's state: the estate's **naming root** anchored on neutral ground beside its live-grant and membership roots (spec 410 §4 amendment), or a direct read where the root chain is readable; proof-backed or empty | **proposed** (item 5; this repository's projector anchors the root) |
| Roles replace fuses; per-record permissions | the registry's one-sentence write rule per contract (430 §3.3); nothing to import | live |
| Expiry: a name "vanishes immediately" | no expiry on typed roots (bought once, never released, 431 D6) | live, deliberate divergence |
| The ENS DAO governs the root | the priced roots' governor (`naming.svc`, custodied by the town clerk persona) — to become a federation position (C7) | **open** |
| The Universal Resolver hides the hierarchy from clients | the universal resolver (C5): one API, every town, chain-qualified answers | **live** wave 1 (over naming services); on-chain and proof reads later |

### C3 How a resident of another chain owns a name on the root chain

> **Amended 2026-10-15 (C10).** This section assumed the resident's satellite is the SAME account at the same CREATE2 address
> on every chain. On the chains that exist it is not: faithchain's factory is `0x464eEe75…` and hopechain's is `0x73A7B878…`, so
> one custodian key yields a DIFFERENT Smart Agent per chain (maya: `0x013f…06e5` on the root, `0x3F96…33d3` at home). The
> link between them is a record, not an address: `atl:accounts` (CAIP-10 per chain) and `atl:nativeId` (the home account) on
> the name, each written by that chain's account. Step 2 therefore reads "the resident's root-chain account, named in the
> ticket by its CAIP-10 and listed in the name's `atl:accounts`", and the custody-propagation item (C9 item 7) is what makes
> that pair one identity rather than two accounts that happen to share a key today.

Three parts, all of which Ring 0 already described for one principal on many chains (chains-and-estates §3.2) and
spec 431 already built for one chain:

1. **The gate.** The estate on chain X runs a Home; its naming gate (a key the Home holds in KMS — the shared
   operator of §A makes this one tenant away) is named on the root chain's priced roots by the governor
   (`PricedSubregistry.setGate`). A ticket it signs is accepted exactly as faithnet's and impact-agent's are today, and the
   chain records which estate issued the name (431 D5). **Nothing new on chain.**
2. **The owner.** `ClaimTicket.owner` is a root-chain address. For a resident whose home account is on chain X it is
   their **satellite** on the root chain: an `AgentAccount` at the same CREATE2 address when the factory,
   implementation and custody configuration match (item 6), deployed counterfactually and signing by ERC-6492 until
   its first transaction. The claim is a root-chain user operation sponsored by the town paymaster; the resident
   signs it at their Home on chain X with the custodians the satellite shares. The name is theirs on the root chain
   by an account they control, never by an operator holding it for them. Where the deterministic deployment is not
   available (a chain without the same factory), the fallback is **not** operator custody: it is no name until it is.
3. **The records.** `atl:addr[eip155:X]` names the home account; `atl:addr[eip155:<root>]` the satellite;
   `atl:nativeId` stays the home account (CAIP-10). The home account's reverse claim on chain X is honoured only when
   the forward on the root chain agrees.

The custody half (a rotation or recovery at the home account reaching the satellite by its own custody ceremony,
item 7) is the piece no standard has and the one that must exist before a global name may point at a satellite in
production. It is a Ring 0 spec, named here as the precondition of wave U3.

### C4 Resolution from another chain

Two honest mechanisms, chosen per deployment in configuration, never one falling back to the other (ADR-0013):

- **Direct read** where the root chain is readable from the resolving town (one operator's private chains; or a
  public root chain). The town's naming service reads the root chain's registry through its own gateway token, as it
  reads its own today.
- **By proof** where it is not: the estate (or the root chain's naming service agent) anchors a **naming root** on
  neutral ground; a verifying resolver on chain X answers `{name, eip155:<root>}` against that root with a Merkle
  path, CCIP-Read's shape with the gateway as a Ring 1 adapter. A stale naming sequence is a refusal.

### C5 The universal resolver (this repository, `apps/site` wave 1 → its own app later)

```
GET /api/names?q=<label or name>         rows across every live town, each { name, town, chain, identity, kind, status, display }
GET /api/names/<name>                    the name across every live town: the root-chain record, per-chain addresses (when C3 lands), the issuing estate, the reverse round trip per chain
```

Every row carries the pair `{ name, chain }` (naming doc N4) and `display` is never bare: the site is in no town.
`identity` is CAIP-10 of the agent on the chain the row came from. Wave 1 answers by asking each live town's naming
read API (spec 430 §4), which reads its chain at request time, so an answer is as fresh as the town's block. Later
waves read the root chain directly and verify proofs; the response shape does not change.

### C6 What this does not do

- Create a second root, or let a town's registry be a root. One root chain; towns join it.
- Transfer names, price by chain, or expire anything.
- Put a chain in the name (`alice.me@faithchain` is refused; the chain is a record).
- Hold any name for any resident (C3 step 2's refusal of operator custody).

### C7 Governance of the root — the position this creates

ENS has a DAO; we have a governor key under one persona. A root that other towns' estates register under needs a
governor those towns accept and that no single town can replace. The shape that fits the substrate is a
`CustodyPolicy` quorum over `naming.svc` with the town clerks of the joining towns as custodians (T-floors as the
towns agree), so `setGate` for a new estate is a quorum act with a receipt. That is a Ring 0 spec (custody of a
service agent by a council), listed here as **wave U4's precondition**, not designed here.

### C8 Wave 1, built 2026-10-14 — and U2's record half the same day

`federation.yaml#naming` (root chain, root registry and universal resolver addresses, the roots, which town's naming
service answers for which chain); the universal resolver over the towns' naming services, on the site; the
never-bare rule as pure functions with tests (`apps/site/src/resolver.ts`); the naming document's N7 amendment.

### C9 Waves

| Wave | Delivers | Gate | Needs |
| --- | --- | --- | --- |
| **U1** (built) | the register, the resolver over town naming services, the never-bare rule, the site | `gate-federation-site` | — |
| **U2** | `FederatedAgentNameV1 { name, chain }` and `displayAgentName` in `agent-naming` (**built 2026-10-14**, Ring 0 `35fc6955`); **`atl:accounts`** — CAIP-10 ids keyed by chain, one per chain, on the existing `string[]` storage (**registered on faithchain 2026-10-14 and hopechain 2026-10-15**, shape v3, Ring 0 spec 346 §3.8); the per-chain reverse claim (**written on both chains for the impact-agent roster 2026-10-15**, C10) | Ring 0 `check:agent-naming` green (164 tests); the resolver's `/api/names/<name>` shows `accounts` once a town's naming service exposes the record | the resolver half: a naming read API that exposes `atl:accounts`, and the round trip enforced on the second chain |
| **U2b** (built 2026-10-16, ap-town) | the TOWN naming services put each chain in its place: a town rooted elsewhere (`town.yaml` `chain.namesRootedAt`) answers existence from the root town's read API and shows its table only as `local`; the root marks a free name `claimedElsewhere` when another chain's table holds it; `?local=1` answers from a table alone so the ask never loops; `check:town` holds the manifest and the binding (ap-town spec 430 §3.2a) | `alice.me` on names.hopenet.town reads *registered, on the root*; `rich-impact.me` on names.faithnet.town reads *free on the root, claimed on hopenet* and is not offered; a root that cannot be asked is an error, not the table | the root's and the rooted town's naming Workers bound to each other (`PEER_<TOWN>`); closing the table's typed roots (`pnpm naming:close-local-roots`) is the chain-side half |
| **U3** | a second town's estate gate named on the root roots; a resident of that chain claims a root-chain name through their satellite (C3) | the claim lands on the root chain with that estate's gate in the ticket; the negative twin: a ticket from an un-named gate is refused `NotAGate` | impact-agent's gate named on the root (the chain exists since 2026-10-14); Ring 0 custody propagation (item 7) before production |
| **U4** | the naming root anchored on neutral ground; the proof-backed resolver on the second chain | a name at a stale naming sequence is refused | spec 410 §4 amendment; `EstateProjectionRegistry` third root or a second instance |
| **U5** | the root's governor becomes a council (C7) | `setGate` is a quorum act with a receipt | Ring 0 spec |

### C10 What the second chain showed (2026-10-15)

hopenet (hopechain, `eip155:34349`) has been live since 2026-10-14, and impact-agent's runtime moved to it. Read from
both chains on 2026-10-15:

- **hopechain issues no names.** Its `AgentNameRegistry` (`0x60c7…318c`) is a local table with no priced roots and
  no gate (`federation.yaml` `towns[hopenet].namesRootedAt: faithchain`). It exists because the town's discovery index
  lists only agents named on its own chain.
- **One label on both chains.** `maya-fernandes.me` points at `0x013f…06e5` on the root and at `0x3F96…33d3` on
  hopechain: one custodian key, one account per chain. Both reverse lookups round-trip. The first local label
  (`maya.me`) was handed to the chain's root owner and expired, so it resolves to nobody.
- **`atl:accounts` joins them.** Both records list both accounts, each written by that chain's account. That is U2's
  record half across two real chains.
- **Not U3.** The root name was not claimed from hopechain through impact-agent's gate, maya's root account is not at
  her home address, and no custody ceremony carries a rotation between them. The hopechain record is a copy, and the
  root record is the name.

---

## D. What this changes in the documents of record

- `docs/architecture/federated-agent-naming.md`: N7 amended (the root exists; §5.6 is now §C here); L1's "the town's
  registry is the one authority" becomes "the **root chain's** registry is the one authority; a town's naming service
  reads it".
- `CLAUDE.md`: the drift trigger "give the federation its own `.me`" is replaced by "create a second root / let a
  town's registry be a root / hold a name for a resident".
- `DEPLOYER.md`: a "shared operators" clause and the site row.
- `federation.yaml`: `towns`, `kms`, `naming` blocks beside `registry` and `estates`.

## E. Not built, and said

The KMS operator actions (A5) — CVM work, the owner's. Everything on chain in §C beyond wave 1 — Ring 0's, listed in
C9. A second chain exists since 2026-10-14 (hopechain, C10); U3 now waits on impact-agent's gate being named on the
root and on custody propagation, not on a chain.

## Reference: smart-agent patterns to port

None for a shared KMS or a multi-chain root: `smart-agent` (branch `003-intent-marketplace-proposal`) has one
deployment, one tenant and one chain, which spec 439 §9 already found. The deliberate divergence is the one this
whole repository is: several towns, one root, proof between them.
