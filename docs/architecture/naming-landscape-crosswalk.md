# The naming and federation landscape — a dated crosswalk

**Checked:** 2026-10-13, from primary sources where a primary source exists (the specification, the draft, the
announcement) and from press where that is all there is; the *checked* column says which. Status words are the
source's own ("draft", "individual submission", "intent to launch"). A row with *unverified* has not been read in the
primary; a claim this document cannot source is not made. Ring 0 pins what it adopts in `docs/standards-lock.json`;
§3 lists the entries this repository proposes.

Read with [`federation-principles.md`](federation-principles.md) (the P-numbers) and
[`federated-agent-naming.md`](federated-agent-naming.md) (the N-numbers and layers L0–L4).

---

## 1. Standards and bodies, one row each

| Standard / body | What it is | Status (checked) | Its name model | Its identity model | Its trust model | We take | We refuse | Pinned? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **ERC-8004** Trustless Agents | identity (ERC-721), reputation and validation registries; off-chain registration file | final; mainnet since 2026-01-29, 30+ chains (spec; study arXiv 2606.26028, 2026-06) | `name` is a display field, no uniqueness; ENS is one optional `services` entry | `{namespace}:{chainId}:{identityRegistry}` + `agentId` | raw feedback per id, "platforms build their own scoring"; domain proved by `/.well-known/agent-registration.json` round trip | chain-scoped id (P1); round-trip verification (P3); recurring names (N4); deterministic registries | id as transferable NFT; any score in a resolution result | `erc8004` (draft note; projection target only) |
| **ENS v2** + ENSIP-10/19, ERC-3668 | hierarchical registries ("every name has its own registry"), roles, CCIP-Read; per-chain primary names | Namechain cancelled 2026-02; L1 only; activation proposal submitted 2026-10-13, vote pending (ENS blog, forum, press) | one root; `name.eth`; ERC-7828 `name@chain` proposed beside it | a name resolves to an address per chain (ENSIP-9/11) | "resolution is finalized on-chain"; reverse valid only with forward (ENSIP-19) | one authority per name, resolve elsewhere by proof (N3, §5.5); chain-keyed addr; reverse round trip; CCIP-Read shape | the single root for this federation (N7); `name@chain`; tokens, pricing decay, commit–reveal | proposal: `ensip-19`, `erc3668` (§3) |
| **ERC-7930** Interoperable Addresses · **ERC-7828** · **ERC-7785** · `on.eth` | binary chain-qualified address with optional name; chain-qualified ENS names; chain objects in ENS; the working chain registry | 7930 "close to final" (ENS ecosystem call, 2026-01); 7785 not finalized; `on.eth` live (ENS docs) | `name@chain` (7828) | `(chain, address)` | n/a | the tuple (N4, `FederatedAgentNameV1`); CAIP-2/10 | the `@` syntax | proposal: `erc7930` |
| **CAIP-2 / CAIP-10** | chain id; chain-qualified account id | final (ChainAgnostic) | n/a | `eip155:<chainId>:<address>` | n/a | adopted everywhere (ADR-0008) | — | implicit in `ap-naming` |
| **OWASP GenAI ANS v1.0** | DNS-inspired agent directory; PKI; six-component name; A2A/MCP/ACP adapters; MAESTRO threat model | paper 2025-05 (arXiv 2505.10609); superseded by ANS v2 for the same authors | `protocol.capability.provider.version.…` | an X.509 identity under a name | PKI; ZKP capability proofs contemplated | the threat modelling habit | capability/provider/version in the name (N8); resolver as trusted agent | `ans` (1.0 API, no source digest) |
| **ANS v2** (IETF `draft-narajala-courtney-ansv2-01`) | domain-anchored registration authority; two X.509 certs; `_ans`/`_ans-badge` TXT, DANE TLSA, HTTPS RR; SCITT transparency log with COSE receipts and HCS-27 checkpoints; Bronze/Silver/Gold | individual Internet-Draft, 2026-04; "not endorsed by the IETF" (datatracker) | `ans://v{version}.{host}`; "the domain is the agent's permanent address" | the FQDN, plus optional DID principal binding (did:web/did:ethr future) | tiers "describe what the client checked, not what the RA assigned"; three layers (identity / maturity / behaviour); RA "does not evaluate whether the agent is well-governed" | log shape (P3); layer split (P7); DNS records as projections (L3); DANE as transport evidence | domain as identity (P1); RA in the authority path; versioned name; single RA ("federation is future work") | proposal: re-point `ans` |
| **Linux Foundation ANS** | "intent to launch" an open standard for agent identity, verification, discovery on DNS; supports DIDs and LEIs | announced 2026-06-23; no specification yet; repos at `github.com/agentnameservice` (press release) | DNS names | DNS-anchored; DIDs/LEIs supported | "verify who an agent represents, what permissions it has, whether its code and history are unchanged" | a listing target when a spec exists; the convening (GoDaddy, Cloudflare, Infoblox, Salesforce, Cisco, HOL, OWASP) | the DNS root as ours (N7); "what permissions it has" from a name (P2) | no (nothing to pin) |
| **GoDaddy ANS Registry** | registry tying an agent identity to a domain; "ANS-verified" badge; extended verification; marketplace; MuleSoft as relying party | marketplace 2025-12; registry 2026-02 (press, GoDaddy newsroom); adoption numbers *unverified* | a domain-based agent name | a cert/DID under a domain | registrar verification; a badge | a listing target; a named signal if displayed | the badge as a trust decision (P7) | no |
| **AID v2.0.0** (agentcommunity.org; IETF `draft-nemethi`) | one TXT record at `_agent.<domain>`; Ed25519 endpoint proof; `aid2` wire format | v2 normative 2026-06-01; v1 2025-07; individual draft (spec site) | the domain | the domain + a proof key | key proof of endpoint control | the `_agent` record as a projection (L3, §7c) | FQDN as identity | proposal: `aid` |
| **DNS-AID** (`draft-cui`, Tsinghua) | `_agent` TXT (key, signature) + SVCB (endpoint, version, protocols); `/.well-known/agent-dns.json` mirror | individual draft 2025-12, expired 2026-06 | the FQDN; "version changes do not introduce new identities" | "DNS TXT and SVCB records serve as the single source of truth for agent identity" | DNSSEC recommended, "MUST NOT rely on DNSSEC as the sole security mechanism" | SVCB as a later upgrade of the same label | DNS as the source of truth for identity | no |
| **DANE-DID** (`draft-ranjbar-dane-did-01`) | a DID verification key as a TLSA record under a DNSSEC-signed `_did` name | individual draft 2026-07/08 | the DNS name | "the name presently controls this key"; "MUST NOT be read as providing continuity of holding" | DNSSEC chain to the root; fail closed on bogus/insecure; transfers look like rotations | its own limits as the clearest statement of P1/P2 in the DNS camp | — | no |
| **CSA** *Anchoring Agent Identity in DNS* | security analysis of the ANS family | v1.0 (CSA labs) | — | — | "identity and discovery … but not which person authorized it"; fail-closed; revocation latency budget; monitor DNS "as a systemic dependency" | the threat list (naming doc §6) | — | n/a |
| **HCS-14** Universal Agent ID (Hashgraph Online) | `uaid:aid:` deterministic from `{registry,name,version,protocol,nativeId,skills}`, `uaid:did:` wraps a DID; `_uaid`/`_agent`/`_ans` TXT resolution; ANS profile co-authored with GoDaddy | draft, 2025-09 (hol.org; GitHub discussion #135) | n/a (ids) | CAIP-10 `nativeId` (ADR-0008) | adapter system; network-agnostic | CAIP-10 as the join; `_agent` TXT (L3) | a hash of mutable fields as an id | `hcs14` (draft) |
| **HCS-10 / HCS-11** | OpenConvAI messaging; profiles | drafts | n/a | Hedera account (CAIP-10) | — | projection targets | — | `hcs11` (draft); `hcs10` via memory `reference_hcs_ontology_sources` |
| **Project NANDA** · *Beyond DNS* · **NandaIndex** · `draft-raskar-…-01` | lean index → signed AgentFacts → adaptive resolver; the July 2026 switchboard draft maps "a stable identity to a discovery object" and "routes requesters" to existing systems | arXiv 2507.14263; NandaIndex V0.1 2026-07 (MIT, Cisco, Google authors); individual draft 2026-07-20 | hierarchical path names; "capability-first" grammar in the blueprint | URN/DID pointed at by index, issuer and resolver | index signs the address; resolver may issue tokens | the switchboard as a rootless discovery tier (P9) | resolver-minted tokens (P2); capability in the name (N8) | none yet (spec 439 §10: arrives with its source digested or `null`) |
| **AGNTCY ADS** (`draft-mp-agntcy-ads-02`, Cisco) | distributed directory of OASF records; content routing; storage "centers on globally unique Content Identifiers" | individual draft 2026-07 (expires 2027-01) | none — a CID | CID + signature | signatures over content | the statement that a name is not an identity | operator-populated directory as a model for *people's* records (P5) | `oasf` pinned |
| **SPKI / SDSI** (RFC 2693; Rivest & Lampson 1996) | key-centric authorization; linked local names; delegation as intersection | RFC (Experimental), 1999 | `alice's bob` — local names, no root | the key | authorization chains intersect (P6) | contextual names `x@ctx` (spec 346) are SDSI names; no root (P9) | — | n/a |
| **Petname systems** (Stiegler 2005) · **Zooko's triangle** (2001) | key is identity; per-party labels; nickname ≠ petname display | essays | per-party labels | the key | the display distinction | the never-bare display rule (N4) | — | n/a |
| **W3C DID Core** · **Verifiable Credentials** (status lists) | identifier ≠ document; issuance under holder/issuer, status world-readable | W3C Recommendations | n/a | a DID | — | the issuance/status split (P5); `did:ethr` over the SA (Ring 0 response to NANDA) | — | implicit |
| **RFC 6698 DANE** · **RFC 9162 CT** · **SCITT** · **RFC 8615** well-known | name→key via DNSSEC; append-only transparency; supply-chain receipts; well-known URIs | RFCs / IETF WG | — | — | inclusion + consistency proofs; "the same entities that manage the DNS name vouch for the key" | transparency as a sequence on neutral ground (P3); well-known paths (P8) | CT as *the* trust root (a log proves inclusion, not authority) | n/a |
| **A2A 1.0** · **ARD v0.91 / ACP registry** · **OASF** | the wire; discovery documents | pinned in Ring 0 | card `name` is display | card is a projection of the account | JWS over the released card (spec 347) | all of it (P8) | — | `a2a`, `ard`, `acp-registry`, `oasf` |

---

## 2. Principle → the sentence in the field that supports it

Each cell of the matrix in `federation-principles.md` reduces to one sentence from the source. The sentences:

| Principle | Source | The sentence |
| --- | --- | --- |
| P1 | ERC-8004 | agents are identified by `agentRegistry` + `agentId`; the `name` field "SHOULD ensure compatibility with ERC-721 apps" and nothing more |
| P1 | DANE-DID | "It certifies one fact: the name presently controls this key." / "MUST NOT be read as providing continuity of holding." |
| P1 | HCS-14 | `nativeId` MUST be CAIP-10; an existing DID is wrapped, not replaced |
| P2 | ANS v2 | the RA answers "who you are" and "does not evaluate whether the agent is well-governed or well-behaved" |
| P2 | CSA | ANS can say which organization stands behind an agent "but not which person authorized it" |
| P2 | DANE-DID | "a relying party MUST NOT infer any of them [subject identity, accountability, delegated authority, reputation] from a valid key binding alone" |
| P3 | ANS v2 | the Transparency Log is "an append-only cryptographic data structure that seals signed events and provides inclusion and consistency proofs" |
| P3 | ENS v2 | "resolution is finalized on-chain" |
| P3 | ERC-8004 | a domain is verified only when the well-known file's `registrations` entry matches the on-chain agent |
| P3 (sharpened) | CSA; DANE-DID | "may remain resolvable and verifiable for the duration of a cached answer"; "a withdrawn RRset remains replayable to any verifier not querying the authoritative path" |
| P4 | ANS v2 | the transparency property "does not hold against collusion between the RA and TL operators"; "the RA is a single trusted party in the current design" |
| P4 | ERC-8004 study | 53 % of Ethereum registrations lack a URI; 3 % / 4 % / 15 % have a valid file and a live endpoint |
| P5 | ERC-8004 | feedback cannot come from "the agent owner or an approved operator for that agent" |
| P5 | ANS v2 | the RA "hashes it and seals the hash" — a commitment, not a copy |
| P6 | SPKI | delegated authorization is the intersection along the chain |
| P6 | ANS v2 | tiers "describe what the client checked, not what the RA assigned" |
| P7 | ERC-8004 | "different platforms can build their own scoring models on top of the same raw on-chain data" |
| P7 | ERC-8004 study | sybil-flagged reviewers 73.5 % / 59.2 % / 90.6 %; median cost to cross the threshold $0.055 / $0.0042 / $0.0027; "our measurements suggest NOT" |
| P7 | NANDA governance | "reputation or analytics services should remain external to the core infrastructure" |
| P8 | AID v2; HCS-14; DNS-AID; ANS v2; ERC-8004; A2A | one label (`_agent`) or one well-known path each; none is an identity, each is a place to look |
| P9 | NandaIndex | "does not replace existing discovery systems but routes requesters to them" |
| P9 | SDSI | every principal is a namespace; names are local and linked |
| P9 (the disagreement) | LF ANS; CSA | "anchors agent identity directly to DNS"; monitor DNS "as a systemic dependency" |
| P10 | ANS v2; ERC-8004 study; ENS Labs | the draft's own limits section; "raw registration volume is a poor proxy for ecosystem maturity"; the published cancellation of Namechain |

---

## 3. `standards-lock.json` — what this repository proposes

The lock is Ring 0's and this repository may not pin its own target (spec 439 §10). Proposed entries, each to arrive
with its normative source digested or with `sourceDigest: null` and the gap visible:

| Key | Specification | Version to pin | Source | Note |
| --- | --- | --- | --- | --- |
| `ans` (re-point) | Agent Name Service v2 | `draft-narajala-courtney-ansv2-01` (2026-04) | datatracker | today's entry names a "1.0 registration API" with no source; the field has moved to the IETF draft and the LF project. A projection target only |
| `aid` | Agent Identity & Discovery | 2.0.0 (2026-06-01) | agentcommunity.org spec | the `_agent` TXT record we publish (naming doc §7c) |
| `dns-aid` | DNS-native agent naming | `draft-cui-…-00` (2025-12, expired) | datatracker | watch only; SVCB under `_agent` is the upgrade path AID names too |
| `ensip-19` | Multichain primary names | ENSIP-19 (status inconsistent across ENS pages; the standalone page says final) | docs.ens.domains | the reverse-claim rule (chains-and-estates §3.2 item 4) |
| `erc3668` | CCIP-Read | final | eips.ethereum.org | the proof-backed resolver shape (naming doc §5.5) |
| `erc7930` | Interoperable Addresses | "close to final" (2026-01) | ethereum-magicians | binary form of `{chain, address, name}` for an adapter |
| `nanda` | NandaIndex / AgentFacts | V0.1 (2026-07) | MIT PDF; `projnanda` repos | spec 439 §10's new family; `sourceDigest: null` until the normative document is digested |
| `lf-ans` | Linux Foundation ANS | none | press release 2026-06-23 | **do not pin**: there is no specification. Listed so the gap is visible |

---

## 4. Sources (primary first; press where that is all there is)

**ERC-8004.** eips.ethereum.org/EIPS/eip-8004 · github.com/erc-8004/erc-8004-contracts · *Can Trustless Agents Be
Trusted? An Empirical Study of the ERC-8004 Decentralized AI Agent Ecosystem*, arXiv 2606.26028 (2026-06) · *A
dataset of early blockchain-registered AI agents on Ethereum*, arXiv 2604.22652.

**ENS.** ens.domains/blog/post/ensv2-architecture · ens.domains/blog/post/ensv2-update · docs.ens.domains/ensip/19
(and the ENSIP index, which still lists it Draft) · docs.ens.domains/ensv2/reverse-resolution ·
discuss.ens.domains "ENS Research: Namechain, ENSIP-19 & Multichain Interop" and "ENS Labs Quarterly Progress
Reports" (Q3 2025, Q1 2026) · ens.domains/blog/post/on-eth-chain-registry · press: Cointelegraph/TradingView
"ENS abandons plans for Namechain L2" (2026-02), "ENS submits proposal to activate ENSv2 upgrade" (2026-10-13).

**Chain-qualified addresses.** ethereum-magicians.org "ERC 7930: Interoperable Addresses", "ERC-7828:
Chain-specific addresses using ENS" · DeFi Wonderland RFC *Universal Address Formats for Interoperability* ·
docs.ens.domains/resolvers/chain-registry-resolver.

**The DNS-anchored family.** genai.owasp.org *Agent Name Service (ANS) for Secure AI Agent Discovery v1.0*; arXiv
2505.10609 · datatracker.ietf.org/doc/html/draft-narajala-courtney-ansv2-01 · linuxfoundation.org press, *Linux
Foundation Announces Intent to Launch Agent Name Service* (2026-06-23) · GoDaddy newsroom, *GoDaddy advances trusted
AI agent identity with ANS API and Standards site*; press: TechRadar, TechHQ, MarTech Series, Yahoo Finance (MuleSoft),
TechAfrica News (2026-02-17) · labs.cloudsecurityalliance.org *Anchoring Agent Identity in DNS: A Security Analysis
of the Agent Name Service* v1.0 · kenhuangus.substack.com *Analysis of Agent Name Service Frameworks* ·
aid.agentcommunity.org/docs/specification (v2.0.0, 2026-06-01) and the v1.0.0 / v1.2.0 pages;
ietf.org/archive/id/draft-nemethi-dawn-aid-00 · datatracker.ietf.org/doc/html/draft-cui-dns-native-agent-naming-resolution-00
· ietf.org/archive/id/draft-ranjbar-dane-did-01.html · RFC 6698 · draft-zhang-trans-ct-dnssec-01 (expired, 2014) ·
draft-sheth-identifiers-dns-00 (Verisign).

**Hashgraph Online.** hol.org/blog/hcs-14-universal-agent-ids · hol.org/blog/hcs-14-profiles-and-agent-aid-resolution ·
github.com/hashgraph-online/hcs-improvement-proposals discussion #135 · pkg.go.dev `standards-sdk-go/pkg/hcs14` ·
hedera.com case study · PR.com release (2025-09-11).

**NANDA.** arXiv 2507.14263 (*Beyond DNS*) · arXiv 2508.03113 (*NANDA Adaptive Resolver*) ·
datatracker.ietf.org/doc/draft-raskar-agentic-web-federated-resolution (-01, 2026-07-20) · dam-prod.media.mit.edu
*A Global Switchboard for the Agentic Web* (NandaIndex V0.1, 2026-07-20) · Ring 0
`docs/architecture/product-comparison/response-to-project-nanda.md`.

**AGNTCY.** datatracker.ietf.org/doc/html/draft-mp-agntcy-ads-02 · arXiv 2509.18787 · github.com/agntcy/dir.

**Theory.** Rivest & Lampson, *SDSI — A Simple Distributed Security Infrastructure* (1996) · RFC 2693 *SPKI
Certificate Theory* (1999) · Zooko Wilcox-O'Hearn, *Names: Decentralized, Secure, Human-Meaningful: Choose Two*
(2001) · Marc Stiegler, *An Introduction to Petname Systems* (2005) · RFC 9162 · RFC 8615 · IETF SCITT WG.

**Ring 0 (private; named, not linked).** ADR-0006, 0008, 0010, 0013, 0020, 0038, 0056, 0057, 0061; specs 215, 220,
222, 338, 346, 347, 407, 410, 439; `docs/architecture/chains-and-estates.md`, `estate-architecture.md`, `scales.md`,
`dntls-comparison.md`, `product-comparison/web3-agent-substrate-landscape.md`; `docs/standards-lock.json`.
**ap-town (public).** specs 429, 430, 431, 436; `towns/faithchain/town.yaml`.
