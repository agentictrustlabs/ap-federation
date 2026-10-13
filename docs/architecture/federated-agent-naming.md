# Federated agent naming — one coherent approach across towns and chains

**Status:** DRAFT 2026-10-13 (decision document; nothing below is built unless a status says so). Companion to
[`federation-principles.md`](federation-principles.md) (P1, P7, P8, P9 are the ones naming leans on) and
[`naming-landscape-crosswalk.md`](naming-landscape-crosswalk.md) (every external claim here, dated and sourced).
Ring 0 holds the naming substrate and doctrine; this document decides how that substrate is *used across a
federation*, and lists what it asks of Ring 0 as backlog (§7). Ring 0 documents are cited by identifier, never
linked: the substrate repository is private, and a link into it is a 404 for the reader this repository exists for.

**The owner's brief (2026-10-13):** *"We need a federated approach of agent naming. We might say that naming is a
trust issue and we take the ERC-8004 approach of allowing names to be reused but build trust around a name; or we
might look at using an ENS-v2 approach, or some other federated naming concept … HCS has input, GoDaddy, the Linux
Foundation. ap-federation needs a coherent approach to agent naming."*

---

## 0. Decisions in one screen

| # | Decision |
| --- | --- |
| N1 | **Naming is a trust question, and the answer is layered, not chosen.** A name is a facet (Ring 0 ADR-0010); the identity is the chain-qualified account. So "may two agents share a name?" is not one question: it is one question per layer, with a different answer at each. |
| N2 | **L0 — the identifier needs no naming authority.** `eip155:<chainId>:<address>` (CAIP-10) is globally unique by construction and is the only thing a verifier ever binds to. Nothing below changes that. |
| N3 | **L1 — a town's handle is unique in that town and nowhere else.** `alice.me` is one record in one `AgentNameRegistry` on one chain, typed, paid, gate-signed and domain-protected (Ring 0 specs 346/431). That registry is the one authority for its handles (the ENS v2 principle, applied **per town**): another town never re-registers them and never claims to serve them; it resolves them by proof or not at all. |
| N4 | **L2 — across towns, a handle is always qualified by its town, and the same handle may be issued by two towns to two subjects.** This is the ERC-8004 reading: names may recur; the identity does not. The machine form of a federated name is the pair `{ name, chain }` (CAIP-2), never a new syntax — Ring 0 already refused ERC-7828's `name@chain` because `@` means *context* here (spec 346 §3), and the chain belongs in the record. A name shown outside its home town is shown with its town, every time (the ENSIP-19 rule turned into a display rule). |
| N5 | **L3 — the DNS projection is the federation's globally-unique human-readable locator, and it is only a locator.** `<label>-<type>.<estate zone>` (spec 346 §5) is unique because DNS is, reversible by function, and rented rather than owned: we take DNS's root for *routing* and refuse it for *identity*. Every AP agent publishes the DNS-anchored discovery records the field reads (`_agent` TXT per AID v2 and HCS-14, the well-known card and registration paths), so an ANS, AID or HCS-14 resolver finds an AP agent, and what it finds is a pointer to the account with a proof the account signed. |
| N6 | **L4 — trust around a name is a set of named signals, never a score.** Named · typed · listed · reachable (spec 430 D5), plus three federation signals: *issued by* (which town, which estate's gate), *projected* (the estate's roots are anchored on neutral ground at sequence N), *presented* (a live leaf verified against that root). A fifth line stays: *authorized* is the caller's own mandate. Reuse of a label across towns is answered by these signals and by the domain rule, not by a global root. |
| N7 | **No federation root is created.** The federation does not run a `.me` above the towns. A future federation-wide typed root on public ground (spec 407 D-03) is recorded as an **opt-in** path a town may take when it needs one name to be a person's on every chain (§5.6); it is the ENS v2 path, and it is not required for any of N2–N6. |
| N8 | **Names never carry capability, protocol, provider, version or certification.** The one derived fact in a name is the agent type, checked on chain (ADR-0061). OWASP ANS v1's six-component name and ANS v2's `ans://v1.0.0.host` versioned form are refused for the reason Ring 0's response to NANDA gives: every one of those changes without the agent becoming a different agent. |

---

## 1. The problem, stated without the vocabulary

Three things are true at once and pull in different directions:

1. **A federation is towns on different chains that do not join one another's trust domain** (spec 439 §0). There is
   no operator above the towns, by design.
2. **People want short names that mean the same thing everywhere.** `alice.me` on faithchain should be Alice when a
   Base-town agent reads it, and nobody else should be able to be `alice.me` to that reader.
3. **Short, globally unique, decentralized: pick two.** Zooko's triangle (2001) is not a slogan; it is why DNS has a
   root, why ENS has a root registry on L1, why ERC-8004 does not make names unique, and why SDSI gave up global names
   altogether. A federation that keeps (1) cannot promise (2) by fiat.

Today we have two namespaces and neither is federation-wide:

| Namespace | Example | Unique within | Authority | What it is for |
| --- | --- | --- | --- | --- |
| the town's typed handle | `alice.me`, `vault.svc@richcanvas.org` | one `AgentNameRegistry` on one chain | the chain record, the type record, the estate's naming gate, the domain rule | the name a person claims and presents |
| the DNS projection | `alice.faithnet.ai`, `vault-svc.richcanvas.org` | the world (DNS) | the zone owner, as a routing fact; `endpointControlProof` on the publication (spec 338) | where the agent is reached; the well-known card |

The gap: with a second town on a second chain, `alice.me` exists twice, and nothing in the handle says which. Ring 0's
`chains-and-estates.md` §3.2 item 3 proposed "one home registry per typed root; no parallel `.me` on another chain",
which is right for one *person* on many chains (her satellites never re-register her name) and silent on whether a
second *town* may issue `alice.me` to a second person. This document decides that question.

---

## 2. Naming is a trust issue: what a reader infers from a name

When an agent in town B receives `alice.me` from town A, it will infer some of the following. Each inference is
either evidence (checkable by B against something B reads) or trust (B taking someone's word). The design goal is
that every inference a reader *acts on* is evidence.

| Inference | Is it evidence? | What makes it so |
| --- | --- | --- |
| *this name exists and points at an account* | yes | the forward record in A's registry, resolved by proof (N3) or read on A's chain |
| *this account presents this name* | yes | the reverse record round-trips (`reverseResolveString`, spec 222; ENSIP-19's rule) |
| *this is a person / an org / a service* | yes | the suffix is a claim checked against the on-chain `atl:agentType` record; mismatch fails closed (ADR-0061) |
| *this name was issued by town A, under estate E's gate* | yes | the registry's chain id, and the `ClaimTicketV1` signer the contract trusted (spec 431 D5) |
| *this is the same Alice as last month* | yes, for the account; **no, for the label** | the account never changes (ADR-0010); a label is never transferred here (spec 431 D6), but a label in *another* town is a different record |
| *this Alice is a member of X / holds a live grant in A* | yes, when presented | a Merkle leaf verified against A's root on neutral ground at the anchored sequence (spec 410 §4) |
| *this Alice is reachable at this host* | yes | the signed `AgentServicePublication` with its endpoint-control proof; DNS is the route, not the claim |
| *this Alice is trustworthy / reputable / certified* | **no** | not a naming signal. Attestations and receipts are separate signals a reader weighs itself (P7) |
| *this Alice may do Y in B* | **no, ever** | B's own mandate, verified per step (P2) |

The row that decides the design is the fifth. **Continuity of a label is not evidence**, in any naming system: the
DANE-DID draft says a DNS name-to-key binding "MUST NOT be read as providing continuity of holding" because a
drop-catch or sale yields a new valid binding under the same name; ENS names expire and "vanish from the registry
immediately"; ERC-8004 ids transfer with the NFT. We are stricter than all three (a town handle is bought once and
never released), and it is still true that a label in town B is not the label in town A. So the federation cannot let
a bare label carry the inference "same party". The town qualifier does that work (N4), and the account does the
binding (N2).

---

## 3. The landscape, briefly (the crosswalk has the detail)

### 3.1 ERC-8004 — names recur; the id is the identity; trust is built around the id

Identity is `{namespace}:{chainId}:{identityRegistry}` + `agentId` (an ERC-721 token). The registration file has a
`name`, and the spec requires nothing of it beyond ERC-721 compatibility. Reputation and validation attach to the id.
ENS appears only as one optional `services` entry (`"name": "ENS", "endpoint": "vitalik.eth"`). Domain control is
proved by round trip through `/.well-known/agent-registration.json`.

What the field learned running it (arXiv 2606.26028, June 2026, 170k registrations on three chains): most
registrations are placeholders (3 %, 4 % and 15 % expose a valid file with a live endpoint on Ethereum, BSC and Base);
reputation is dominated by sybil-flagged reviewers (73.5 %, 59.2 %, 90.6 %) and costs cents to move; scores are
uncorrelated across chains. The authors' conclusion is that the protocol "succeeds at what it explicitly provides"
and that this does "not necessarily establish trust".

**What we take:** the identity model is ours already (P1); names may recur across registries; trust is a set of
signals keyed to the id, plural and downstream. **What we refuse:** the id as a transferable token; a score of any
kind in the resolution result.

### 3.2 ENS v2 — one root, hierarchical registries, resolution elsewhere by proof

ENS v2 (2026): Namechain, its planned L2, was cancelled in February and v2 deploys only on Ethereum L1; the
executable proposal to activate it on mainnet was submitted on 2026-10-13 and the vote is pending as this is written.
Architecture: "every ENS name has its own registry" forming "a directed graph structure rooted at a single root
registry"; roles replace fuses; off-chain data is read through CCIP-Read with "resolution finalized on-chain";
ENSIP-19 gives a primary name per chain, valid only when the forward record on the home chain agrees, and the L2
Primary Name app is live on Base, Arbitrum, Optimism, Linea and Scroll. ERC-7930 (Interoperable Addresses, close to
final) and ERC-7828 (`name@chain`) add chain-qualified address and name forms; ERC-7785 (chain objects in ENS) is not
finalized; `on.eth` is the working chain registry.

**What we take (already taken by Ring 0 `chains-and-estates.md` §5.1):** one authoritative registry per name,
resolved elsewhere by proof and never re-registered; address records keyed by chain (ENSIP-9/11); a reverse claim per
chain valid only with the forward (ENSIP-19); CCIP-Read's shape for a proof-backed resolver; CAIP-2/CAIP-10.
**What we refuse:** `name@chain` (`@` is context here); names as tradable tokens, pricing decay, commit–reveal (spec
430 §1.2); a free choice of suffix; and, for this federation, **the single root** (N7), because the root is the thing
every town would have to join.

### 3.3 The DNS-anchored family — GoDaddy, OWASP, the IETF draft, the Linux Foundation, AID, DNS-AID

Five efforts converge on *the domain is the agent's name and DNS plus PKI is its trust anchor*:

- **OWASP ANS v1.0** (May 2025, Ken Huang, Vineeth Sai Narajala et al.): a DNS-inspired directory with a
  six-component name (protocol, capability, provider, version, …), PKI, JSON schemas, adapters for A2A/MCP/ACP.
- **GoDaddy's ANS Registry** (marketplace December 2025; registry launch February 2026; MuleSoft partnership):
  "a unique, human-readable name and a cryptographically verifiable identity" tied to a domain; an "ANS-verified"
  badge; extended verification shows organizational identity; a W3C DID-compatible open spec.
- **ANS v2** (IETF individual draft `draft-narajala-courtney-ansv2-01`, April 2026; authors from OWASP and GoDaddy):
  `ans://v1.0.0.host`; a Registration Authority verifies domain control by ACME; two X.509 certificates (public CA for
  the FQDN, private CA for the versioned ANSName); `_ans` and `_ans-badge` TXT, DANE TLSA, HTTPS records; an
  append-only Transparency Log run as a SCITT service with COSE receipts and HCS-27 consensus checkpoints; lifecycle
  states with idempotent revocation; verification tiers Bronze (PKI) / Silver (+DANE) / Gold (+log) that "describe
  what the client checked, not what the RA assigned". Stated limits: a single trusted RA ("federation is future
  work"), no query privacy, an "application integrity gap", clients must install the private CA root.
- **The Linux Foundation's intended ANS** (announced 2026-06-23; supporters quoted from GoDaddy, Cloudflare, Infoblox,
  Salesforce, Cisco, DistributedApps.ai, Hashgraph Online, OWASP): "anchors agent identity directly to DNS", "supports
  DIDs and LEIs", a "federated" layer "without relying on centralized or proprietary registries". No specification
  yet; repositories at `github.com/agentnameservice`.
- **AID v2.0.0** (agentcommunity.org, 2026-06-01; IETF individual draft) and **DNS-AID** (`draft-cui`, Tsinghua,
  December 2025, expired June 2026): one TXT record at `_agent.<domain>` (AID adds an Ed25519 endpoint proof; DNS-AID
  adds SVCB under the same label and says "DNS TXT and SVCB records serve as the single source of truth for agent
  identity").
- **The security reading** (Cloud Security Alliance, *Anchoring Agent Identity in DNS*): registry and cache poisoning
  (SAD DNS), registrar compromise (Sea Turtle), route hijack (Route 53, 2018), CA mis-issuance (DigiNotar),
  homograph and typosquatting against readers that are machines, and revocation lag bounded by TTLs. Its verdict:
  deploy "with eyes open, governed by fail-closed defaults, monitored as a systemic dependency", and get delegation
  and human accountability "from other mechanisms".

**What we take:** the records (`_agent` TXT, well-known paths) as *projections* every AP agent publishes (N5); DANE
and DNSSEC as optional transport evidence on a separate hostname (ADR-0057); the transparency-log shape, which we
already have as a sequence on neutral ground (P3); the three-layer split (identity / maturity / behaviour), which is
P7. **What we refuse:** the domain as the identity (P1); a registration authority in the authority path; a versioned
or capability-bearing name (N8); the DNS root as *our* root (N7). GoDaddy and the LF effort are the right place for an
AP estate to be *listed*; they are not where an AP agent *is*.

### 3.4 HCS-14 and the Hashgraph Online family

HCS-14 (draft, September 2025) mints a Universal Agent ID either deterministically from `{registry, name, version,
protocol, nativeId, skills}` with `nativeId` in CAIP-10 (`uaid:aid:…`), or by wrapping an existing DID (`uaid:did:…`)
so "self-sovereign identity where it exists" is preserved. Resolution reads `_uaid`, `_agent` and `_ans` TXT records;
the Go and TypeScript SDKs expose `resolveUAID`. HOL and GoDaddy co-authored an ANS profile for UAIDs, which is why
HOL appears beside GoDaddy in the LF announcement. Ring 0 ADR-0008 already took the one part that matters to naming:
`nativeId` is CAIP-10, and we do not mint UAIDs (a consumer can derive one). HCS-10 (OpenConvAI) and HCS-11 (profiles)
are projection targets, pinned in `standards-lock.json` as drafts.

**What we take:** CAIP-10 as the join (done); the `_agent` TXT convention (N5). **What we refuse:** a hash of
`{name, version, skills}` as an identifier, because every one of those changes without the agent changing.

### 3.5 Project NANDA and NandaIndex

*Beyond DNS* (2025) proposes a lean index returning a signed `AgentAddr` that points at a signed `AgentFacts`
document; the July 2026 **NandaIndex** draft (authors from MIT, Cisco and Google) narrows that to a switchboard that
"maps a stable identity to a discovery object" (a catalog entry, a DNS-AID record, an agent card) and "does not
replace existing discovery systems but routes requesters to them"; `draft-raskar-agentic-web-federated-resolution-01`
(2026-07-20) is an individual submission. Ring 0's response to NANDA records the structural difference: NANDA signs
the address at the index, the facts at an issuer and the session at a resolver, leaving the agent as the thing pointed
at; we start from an agent that is an account and let every index entry be a projection of it.

**What we take:** the switchboard shape is exactly a rootless federation's discovery tier (P9), and our ARD/ACP
registry already serves that role for a town. **What we refuse:** a resolver that mints tokens; a name grammar with
capability in it.

### 3.6 AGNTCY Agent Directory Service

The ADS drafts (`draft-mp-agntcy-ads-02`, July 2026) describe a distributed directory of OASF records interconnected by
content routing; storage "centers on globally unique Content Identifiers". A record has no name; it has a CID and a
signature. This is the clearest statement in the field that a name is not an identity, and it is also why a directory
of CIDs still needs a naming layer above it for people.

### 3.7 The older theory, which decided it first

- **SDSI** (Rivest and Lampson, 1996) and **SPKI** (RFC 2693): every principal is a namespace; `alice's bob` is a
  linked local name; no global root is required and none is assumed. Our `x@ctx` contextual names (spec 346 §3.2:
  "a name issued by `ctx` in its namespace for `x`'s subject") are SDSI names with the issuance recorded in the
  context's vault and anchored on chain only when public.
- **Zooko's triangle** (2001): secure, decentralized, human-meaningful; a system gets two. ENS and DNS buy
  human-meaningful plus secure with a root; SPKI buys secure plus decentralized with local names.
- **Petname systems** (Stiegler, 2005): keep the key as the identity, let each party assign its own label, and
  display a *nickname* a party cannot be sure of distinctly from a *petname* it chose. The display rule in N4 (a name
  outside its town is always shown with its town) is a petname-system rule: a label you did not issue is shown with
  its issuer.

---

## 4. The three options the owner named, compared honestly

| | **A. The ERC-8004 reading** — names may recur; trust is built around the identity | **B. The ENS v2 reading** — one authoritative registry; resolve elsewhere by proof | **C. The DNS-anchored reading** — the domain is the name; DNS + PKI anchor it |
| --- | --- | --- | --- |
| Who guarantees uniqueness | nobody, by design | the root registry (on L1, or on public ground for us) | ICANN and the registrars |
| What a bare label tells a reader in another town | nothing by itself; look at the id and its signals | exactly one party, if the proof verifies | exactly one zone owner, if DNSSEC/DANE verify |
| What it costs the federation | a display rule and a tuple `{name, chain}` everywhere a name crosses a town | **a root every town must join** — a trust domain above the towns, which spec 439 §0 refuses | a dependency on DNS's root, registrars, CAs and route security, plus a registration authority |
| What it does to our doctrine | nothing; P1 and P7 already say it | contradicts P9 unless the root is a contract nobody administers *and* opt-in | contradicts P1 if the domain is the identity; compatible if the domain is a projection |
| Squatting | per town, answered by the domain rule (spec 431 §3) and the signals | per root, answered by price and the domain rule | per TLD, answered by UDRP, which the CSA analysis notes does not protect a machine reader from homographs |
| Where it is strong | honesty: it never promises what it cannot verify | people: one name, everywhere, with proof | reach: every resolver in the field already speaks DNS |
| Where it is weak | people must learn that `alice.me` needs a town | governance: who runs the root, and what joining it means | identity: "the name presently controls this key" is all DNS can say |

None of the three is wrong, and each is right about a different layer. That is the decision: **take A for identity and
trust, B for each town's own registry (and as an opt-in federation root later), C for routing and reach.**

---

## 5. The decision: five layers

### 5.1 L0 — the identifier: CAIP-10, no naming authority

`eip155:<chainId>:<address>`. Unique by construction, bound to nothing but a deployed account and its custody.
Everything a verifier checks (a signature, a grant, a leaf, a receipt) is keyed here. Status: **live**, Ring 0
ADR-0010/0008.

### 5.2 L1 — the town handle: typed, unique per town, the town's registry is the one authority

`alice.me`, `richcanvas.org`, `vault.svc@richcanvas.org`. One `AgentNameRegistry` per chain with ten priced typed
roots (`.me .org .team .svc .workspace .treasury .registry .church .circle .household`) and the `.estate` root for
estate agents; forced-unique; the suffix checked against the on-chain type record; a claim ticket signed by the
*estate's* naming gate (so the chain records which Home issued the name); the domain rule (a label that is a `.com`
or `.org` needs a verified email at that domain); bought once, never released, never transferred. Status: **live** on
faithchain (specs 346, 430, 431; `names.faithnet.io`).

The ENS v2 principle applied per town: **another town never re-registers or re-serves a handle issued here.** It
resolves it by proof against this town's anchored naming root (§5.5, designed) or returns empty (ADR-0013). "One home
registry per typed root" in Ring 0 `chains-and-estates.md` §3.2 item 3 is read as *one home registry per name*: the
town that issued `alice.me` is its home, and her satellites on other chains claim it only in reverse, valid only with
the forward (ENSIP-19, item 4).

### 5.3 L2 — the federated reference: a handle qualified by its town

**Machine form.** A name that crosses a town boundary travels as a pair:

```
FederatedAgentNameV1 { name: 'alice.me', chain: 'eip155:34348' }        // CAIP-2 qualifies the handle
```

No new grammar. `@` keeps its one meaning (a context: org, team, workspace), `/` keeps its one meaning (the URL-safe
rendering of `@`), and the chain is a *record* beside the name, exactly where Ring 0 put it when it refused
ERC-7828's `name@chain`. ERC-7930's "chain-specific address with an optional human-readable name" is the same
tuple seen from the address side; a binary encoding of ours can be 7930-compatible if an adapter needs one.

**Display rule.** Inside its home town a handle is shown bare. Outside it, a handle is shown with its town, always,
and a reader's UI distinguishes "a name this town issued" from "a name another town issued" the way ENSIP-19 shows a
primary name only when it round-trips and a petname system shows a nickname differently from a petname. The town's
display name comes from the town's own manifest (`ap-town` `town.yaml`), never from the foreign name itself. The
exact rendering (`alice.me · faithchain town`, a badge, a prefix) is a Home and portal decision; the rule that it is
*never bare* is this document's.

**Recurrence.** Two towns may each issue `alice.me` to two different subjects. This is the ERC-8004 reading and it is
the honest one for a federation with no root: the alternative is a root. The label recurs; the identity does not; the
pair does not.

**Reserved labels across the federation.** A town's reserved-label rule (the type words, `www`, `mtls`, `edge`, `api`,
`well-known`; spec 346 §3.1) is a Ring 0 rule every town's registry enforces, so it is federation-wide without a root.
The domain rule (spec 431 §3) is likewise reproducible by any town from public DNS, so a label that is a `.com` is
protected in every town the same way, for the same reason.

Status: **decided here; proposed to Ring 0** (§7, items a–b).

### 5.4 L3 — the DNS projection: the globally-unique locator, rented from DNS, routing only

`<label>-<type>.<estate zone>` (persons and legacy roots drop the type label): `alice.faithnet.ai`,
`vault-svc.richcanvas.org`, `discovery-registry.faithnet.io`. Unique because DNS is; reversible by `handleForDnsHost`
against the closed suffix set; the zone is the estate's (`agentZone` in `town.yaml`: `faithnet.ai`,
`impact-agent.ai`), so the estate, not the federation, is the qualifier in the human-readable locator. A host
proves zone control and nothing else; the agent proves it controls the host with the publication's
`endpointControlProof` (spec 338 §3). DNS is the route; the chain record is the claim. Status: **live** (spec 346 §5).

**The projections every AP agent publishes under that host**, so that the DNS-anchored resolvers find it:

| Record | Who reads it | What it carries | Status |
| --- | --- | --- | --- |
| `https://<host>/.well-known/agent-card.json` | A2A clients, ARD/ACP, NandaIndex | the released, JWS-signed card (spec 347) | live |
| `https://<host>/.well-known/agent-registration.json` | ERC-8004 verifiers (domain round trip) | `registrations: [{ agentRegistry, agentId }]` for the agent's 8004 projection | with the 8004 adapter (spec 407 D-10) |
| `_agent.<host>` TXT | AID v2 clients, HCS-14 resolvers, DNS-AID clients | `v=aid2; u=<a2a endpoint>; p=a2a; …` plus the CAIP-10 `nativeId` and the card URI; AID's endpoint proof key is a delegate key the account authorised, never a custody credential | **proposed** (§7 item c) |
| `_ans.<host>` / `_ans-badge.<host>` TXT, DANE TLSA | ANS v2 / LF ANS clients | written **only** when the estate registers the agent with an ANS registration authority, as a projection with its own loss report; the badge points at *their* log | adapter, when the LF specification exists |
| DNSSEC on the zone; DANE on `mtls.<host>` | any | transport evidence (ADR-0057), never identity | per estate's zone operator |

The rule for every row: the record is a projection of the signed profile, carries a back-link to the account, and
could be deleted without the agent losing anything but reach. A DNS-anchored resolver that reads one of them learns
where the agent is and which account it is; it does not learn that the agent is trustworthy or what it may do, and
nothing in the record claims otherwise.

### 5.5 Resolution across towns: by proof, or empty

A town's naming service reads its own chain at request time (spec 430 D1). For a name from another town it has two
honest options and one dishonest one:

- **by proof** (designed, Ring 0 `chains-and-estates.md` §3.2 item 5): the issuing estate anchors a *naming root* (the
  storage root of its name records) beside its live-grant and membership roots on neutral ground; a verifying
  resolver in town B answers `{alice.me, eip155:34348}` against that root, the way an ENS CCIP-Read resolver answers
  against an L2 state root. Proof-backed or empty.
- **by the chain itself**: when B can read A's chain (both private chains of one operator, or A is public), B reads
  A's registry directly. One mechanism per deployment, chosen in configuration, never a fallback from the other.
- **by asking A's naming service and believing it**: refused. A gateway's answer is a claim; ADR-0056 and P3 both say a
  resolver's word is not a verifier's check.

Status: **designed**, not built; the naming root is the third root the projector would anchor (§7 item d).

### 5.6 The opt-in federation root, recorded and not built

If the owner later wants `alice.me` to be *one* person's on every chain, there is exactly one way to get it without a
registrar: a typed root registry on public ground (the public L2 of spec 407 D-03), administered by nobody (the P4
property), that towns opt into by treating it as the home registry for the roots it serves. That is ENS v2's design
with its root on neutral ground, and chains-and-estates §3.2 items 3–5 then apply with "home registry" meaning
public ground. It is worth doing when a Home person is meant to be herself in an estate on another chain *by name*,
and not before; custody propagation to satellites (item 7, the part no standard has) must exist first, or a global
name would point at a satellite under a retired credential. Until then, N4 holds and the cost of N4 (a qualifier on
foreign names) is paid honestly.

---

## 6. Threat model: the CSA list, applied to this design

| Threat (CSA, *Anchoring Agent Identity in DNS*) | Where it lands here | Answer |
| --- | --- | --- |
| **Registry or cache poisoning** of a lookup | L3 only (DNS) | a poisoned host reaches a wrong server, whose publication fails its endpoint-control proof and whose card fails its JWS; identity and authority never came from DNS. Blast radius = reachability. |
| **Impersonation** (a spoofed record) | L2/L3 | the display rule (a foreign name is never bare); the reverse round trip; the signed card; admission under the caller's own credentials. |
| **Registrar or zone compromise** (Sea Turtle); **route hijack** (Route 53) | L3 | same as poisoning: a route, not an identity. DANE on the mTLS hostname and DNSSEC on the zone are evidence an estate may add; absence is not a failure of identity. |
| **CA mis-issuance** | L3 | TLS is transport evidence (ADR-0057). No certificate establishes an agent. |
| **Name squatting, homographs, typosquats** | L1 | forced-unique labels with the label grammar (`[a-z0-9-]`, no Unicode confusables, reserved words); the domain rule; a price; the type suffix checked on chain. Across towns, recurrence is *allowed* and *qualified* (N4), so a squat in town B is visibly a town-B name. |
| **Revocation lag** (TTL, CRL/OCSP) | L1/L4 | a name is never revoked (bought once); standing is a sequence on neutral ground, read live, and a stale sequence is a refusal (P3). |
| **Transfer indistinguishable from rotation** (DANE-DID) | L1 | a handle is never transferred (spec 431 D6) and an account never changes (ADR-0010); rotation is a custody ceremony that re-approves standing wires (spec 410 §1). |
| **Denial of service against resolution** | L3, L5 (neutral ground RPC) | fail closed; a town that cannot read neutral ground refuses foreign presentations rather than accepting cached ones. |
| **Discovery-metadata leakage** (DNS has no confidentiality) | L3 | naming ≠ listing ≠ resolution ≠ inbound (ADR-0056): a person's default posture is *named, unlisted, resolvable by invitation*; the DNS projection exists only for agents whose posture publishes a host. |
| **First-come-wins on neutral ground** (ours, from F1) | L4 | the estate's own on-chain declaration of its projection signer (F2.5); the verifier cross-checks both. |

---

## 7. What this asks of Ring 0 and the towns (backlog, not pivots)

| # | Item | Where | Depends on |
| --- | --- | --- | --- |
| a | `FederatedAgentNameV1 { name, chain }` in `@agenticprimitives/agent-naming`, with `parse`/`format` and the rule that `chain` is CAIP-2; a `displayName(ref, viewerTown)` that is never bare outside the home town | Ring 0 (spec 346 amendment) | — |
| b | A town-qualifier in the places a name crosses a town: the A2A card's `name` stays bare, the card gains `atl:town` (chain) as a field; the projector's `present` output carries the pair; the registry's ARD record carries it | Ring 0 spec 347 projection; this repo's projector | a |
| c | `_agent.<host>` TXT published by the estate's zone operator from the signed publication, with a gate that the TXT round-trips to the chain record (`nativeId`, card URI) and that its proof key is a delegate key | ap-home (the zone is the estate's); a Ring 0 projector in `agent-projections` | spec 347 |
| d | A **naming root** beside the live-grant and membership roots: the projector anchors the estate's name-record storage root; `EstateProjectionRegistry` either carries a third root or a second instance keyed by root kind — a Ring 0 contract decision | Ring 0 spec 410 §4 amendment; this repo's projector | F2 |
| e | A proof-backed cross-town resolver (the CCIP-Read shape with the gateway as a Ring 1 adapter) in ap-town's naming service, answering only for `{name, chain}` pairs whose naming root it can verify | ap-town spec 430; adapter here | d |
| f | `atl:addr` keyed by CAIP-2 chain, replacing the single record and the one-way `nativeId` (chains-and-estates §3.2 item 3); the satellite reverse claim (item 4) | Ring 0 contracts (`AgentNameAttributeResolver`) | — |
| g | `standards-lock.json` proposals: `ans` re-pointed at the IETF ANS v2 draft and the LF project (today it names a 1.0 registration API with no source); new `aid`, `dns-aid`, `ensip-19`, `erc7930` entries, each with a source digest or `null` and the gap visible | Ring 0 accepts; this repo proposes | — |
| h | The opt-in federation root on public ground (§5.6): a decision gate, not a wave, opened only after custody propagation (chains-and-estates item 7) is specified | Ring 0 spec 407 D-03 | item 7 there |

Waves in this repository that follow from the table: **N-F1** (a + b: the pair everywhere a name crosses, the display
rule in the projector's own output, a gate that no foreign name is printed bare) → **N-F2** (c: the `_agent` record and
its round-trip gate, with an AID v2 and an HCS-14 resolver run against a live estate as the proof) → **N-F3** (d + e:
the naming root and the proof-backed resolver, with the negative twin: a name at a stale naming sequence is refused)
→ **N-F4** (f: chain-keyed addresses and the satellite reverse claim, once a second chain exists to claim from).

---

## 8. What this document does not decide

- The rendering of a town qualifier in a Home or the portal (a UX decision; only *never bare* is fixed here).
- Whether `.estate` names should be claimable by anyone or remain registered by the root owner one per estate (today
  the latter, by `AddEstateName.s.sol`; the federation does not need to change it).
- Whether a town may run more than one `AgentNameRegistry` (nothing here assumes it; N3 speaks of "a town's
  registry" and a second would be a second town for naming purposes).
- Anything about reputation. A name carries none; an attestation does; the two are different documents.

---

## Sources

Dated primary sources for every external claim are in [`naming-landscape-crosswalk.md`](naming-landscape-crosswalk.md)
§4. Ring 0 documents cited: ADR-0006, ADR-0008, ADR-0010, ADR-0013, ADR-0020, ADR-0038, ADR-0056, ADR-0057, ADR-0061;
specs 215, 220, 222, 338, 346, 347, 407, 410, 439; `docs/architecture/chains-and-estates.md`,
`estate-architecture.md`, `scales.md`, `product-comparison/response-to-project-nanda.md`,
`product-comparison/web3-agent-substrate-landscape.md`, `dntls-comparison.md`. ap-town specs 429, 430, 431, 436.
