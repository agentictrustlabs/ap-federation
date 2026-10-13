# Federation principles, and where the field agrees with them

**Status:** 2026-10-13, written after F1; still accurate after F2, F2.5 and F3 on one chain (2026-10-14) — what each wave built is in [`how-it-works.md`](how-it-works.md), and P4's cross-check (F2.5) is now live for both estates. Every claim about an external standard or
body is dated and sourced in [`naming-landscape-crosswalk.md`](naming-landscape-crosswalk.md); a claim this document
cannot source is marked *unverified*. Ring 0 doctrine is cited by its identifier (an ADR or a spec number) and never
restated: the rules are projected into this repository by digest (`CLAUDE.md`, the managed block), and a product
repository may not paraphrase a rule.

**What this is for.** A reader who did not build F1 should be able to tell, for each principle, (1) what it says,
(2) what it rules out, (3) where it is enforced in code or on chain, and (4) where the wider field has arrived at the
same conclusion, under its own vocabulary and for its own reasons. Where the field has arrived at the *opposite*
conclusion, that is said too, because a principle nobody disagrees with is not carrying weight.

The ten principles fall into three groups: what an agent **is** across a boundary (P1–P2), how a claim **crosses** a
boundary (P3–P6), and how a federation is **governed** (P7–P10).

---

## P1 — The identity is an account, qualified by its chain. Everything with a name is a facet of it.

**Says.** An agent is its ERC-4337 Smart Agent address on its own chain, written `eip155:<chainId>:<address>`
(CAIP-10). A name, a card, a registry entry, a DNS host, a DID, a UAID, an ERC-8004 token: each is a facet that
points at the account, carries a proof the account signed, and can be dropped without losing a grant, a receipt or a
relationship. The same hex on two chains is two accounts until a signed statement joins them.

**Rules out.** A name as the principal. A registry id as the principal. A DNS domain as the principal. "Rename" as a
security event. A facet without a back-link.

**Enforced by.** Ring 0 ADR-0010, ADR-0020, ADR-0008 (`nativeId` is CAIP-10); `CanonicalAgentId` in
`@agenticprimitives/types`; every cross-package API takes an `Address`, not a name; `federation.yaml` derives an estate
id from the estate *agent's* address and refuses a key (the faithnet row is the refusal, written down).

**Where the field agrees.**

- **ERC-8004** identifies an agent as `{namespace}:{chainId}:{identityRegistry}` plus an `agentId`; the `name` in the
  registration file is a display field with no uniqueness requirement, and reputation is keyed to the id, not the
  name. That is P1 in a different coat: the identifier is chain-scoped and the name is a facet.
- **HCS-14** derives a Universal Agent ID from a CAIP-10 `nativeId`, and wraps an existing DID rather than replacing
  it. The id is a function of the account; the account is not a function of the id.
- **CAIP-2 / CAIP-10** exist because an address without its chain is ambiguous; **ERC-7930** (Interoperable
  Addresses) is the same observation made binary, for on-chain consumers.
- **W3C DID Core** separates the identifier from the document that describes it; the document rotates, the identifier
  does not.
- **AGNTCY ADS** stores content-addressed records (a CID names the bytes); a record has no global name, which is the
  strongest possible statement that a name is not an identity.

**Where the field disagrees.** The DNS-anchored family makes the domain the agent's permanent address: ANS v2 says in
so many words that "the domain is the agent's permanent address; the version number changes, the domain does not",
and DNS-AID says "each agent is uniquely identified by a stable Fully Qualified Domain Name". We treat that as a
*locator* binding (P8, and [`federated-agent-naming.md`](federated-agent-naming.md) §5 L3), for the reason the
DANE-DID draft itself gives: a name-to-key binding "certifies one fact: the name presently controls this key", and
"MUST NOT be read as providing continuity of holding". A drop-catch, a UDRP transfer or a sale produces a new,
validly signed binding under the same name. An account does not have that failure mode; a name always does.

---

## P2 — Authority is chain-local by construction. Evidence crosses a boundary; authority never does.

**Says.** A grant is signed into one chain (the EIP-712 domain carries `block.chainid` and the manager's address), is
revoked by one read on that chain, and is redeemed on that chain. When an agent of town A acts in town B, the act
runs under a B-chain mandate that B's own principal signed; what A contributes is *standing*, proved as evidence.

**Rules out.** Bridging a delegation. Re-issuing B-side grants for A-side agents. Accepting an issuer's signed
assertion that a grant exists. A resolver that mints session tokens. A cross-chain message that executes a call.

**Enforced by.** `DelegationManager.DOMAIN_SEPARATOR`; PMT-INV-03 (a payment mandate names its chain; cross-chain
replay fails by test); Ring 0 spec 410 §4.4 and spec 439 §3.1; the three `CLAUDE.md` drift triggers that begin "just
bridge the delegation", "map the foreign run grant", "cache the estate root".

**Where the field agrees.**

- **EIP-712** domain separation is the reason, not merely the mechanism: typed data is bound to one chain and one
  verifying contract, so the field's own signing standard already refuses the cross-chain replay.
- **ANS v2** draws exactly this line at the registration authority: it answers "who you are" and "does not evaluate
  whether the agent is well-governed or well-behaved"; a third tier of "behavioral reputation" is explicitly someone
  else's layer.
- The **Cloud Security Alliance** analysis of DNS-anchored identity concludes that ANS establishes identity and
  discovery and can say which organization stands behind an agent "but not which person authorized it"; delegation
  chains and human accountability "must come from other mechanisms".
- The **DANE-DID** draft states that real-world subject identity, controller accountability, delegated authority and
  reputation are not established by a key binding, and "a relying party MUST NOT infer any of them from a valid key
  binding alone".
- **Project NANDA** lists "can agents authorize credentialing on the fly … via smart contracts?" as an open question
  (*Beyond DNS* §XI.F). Our reading, recorded in Ring 0's response to NANDA: that is not a feature of an index; it is
  why the anchor must be an account.

**Where the field disagrees.** NANDA's Adaptive Resolver may "issue temporary credentials or endpoint tokens", and
OWASP ANS v1 made the resolver "itself a registered and trusted agent". ERC-5164 and the cross-chain execution
family let a message on chain A execute a call on chain B. Each puts an authority in the call path that every
client must trust. Ring 0 `chains-and-estates.md` §5.2 records the verdict: a message is not a mandate.

---

## P3 — Proof over trust: a commitment on neutral ground, a leaf proved against a root the verifier reads itself.

**Says.** An estate publishes a Merkle commitment to its live-grant set (and its membership set) on ground no estate
controls, with a monotonic sequence. A counterparty presents one leaf and its path; the receiving edge reads the root
from the registry, verifies the proof, enforces freshness, and records the digest on its admission receipt. The
registry learns one fact about an estate: its governance address on its chain.

**Rules out.** Trusting a cached root. Accepting a presentation at a sequence other than the anchored one. A
presentation as anything but evidence. Private data on neutral ground (a root reveals cardinality at most, which is
why the leaves stay the estate's record).

**Enforced by.** `EstateProjectionRegistry` (`setRoots` cannot refresh `anchoredAt` without raising the sequence);
`verifyAuthorityPresentation` in `@agenticprimitives/estate-projection`; `foreignEstateEvaluator` in
`@agenticprimitives/admission`; `scripts/gate-f1-projection.mts`, whose eleven checks include four refusals (stale
sequence, wrong root, retired leaf, foreign signer).

**Where the field agrees.**

- **Certificate Transparency** (RFC 9162) and **SCITT** (IETF) are the same shape at the certificate and
  supply-chain layers: an append-only structure, inclusion and consistency proofs, receipts a verifier checks
  without trusting the log operator. ANS v2 adopts it outright: its Transparency Log is "an append-only cryptographic
  data structure that seals signed events and provides inclusion and consistency proofs", intended to run as a
  SCITT service issuing COSE receipts.
- **ENS v2** resolves off-chain data through CCIP-Read with the rule that "resolution is finalized on-chain": the
  client fetches, the chain verifies. The verifier reads its own ground.
- **ERC-8004** verifies a registration by round trip: the chain names a URI, the file at the URI names the chain
  entry; a domain is "verified" only when `/.well-known/agent-registration.json` names the same `agentRegistry` and
  `agentId`. An assertion is checked against the thing it asserts about.
- The **ERC-8004 Validation Registry** lets a validator respond more than once to the same request to express "soft
  and hard finality". That is a sequence, not a TTL, which is P3's freshness rule.

**Where we sharpen it.** The field's revocation story is still TTL-shaped. The CSA analysis: an agent that should no
longer be trusted "may remain resolvable and verifiable for the duration of a cached answer". The DANE-DID draft:
"a withdrawn RRset remains replayable to any verifier not querying the authoritative path". A monotonic sequence with
an anchored timestamp, read live, closes that: the receiving edge cannot be fed yesterday's root, because yesterday's
root is at a lower sequence and a lower sequence is a refusal. The price is stated in `apps/projector/README.md` §3:
anchoring invalidates presentations in flight, so freshness costs sequences, and heartbeat and churn pull against
each other.

---

## P4 — Neutral is a property of the contract, never of the chain. And first-come-wins is an exposure, said aloud.

**Says.** `EstateProjectionRegistry` has no admin, no pause and no upgrade; the account that deployed it holds nothing
over it afterwards. That, not the chain it sits on, is what lets a town prove itself against it. Registration is
first-come-wins because public ground cannot verify who governs an estate on another chain, so a verifier that trusts
`signerOf` alone trusts whoever registered first.

**Rules out.** A registry an estate could redeploy. A chain-based claim of neutrality. Reading `signerOf` without a
cross-check against the estate's own declaration. Claiming cross-chain has been shown while both estates sit on one
chain.

**Enforced by.** The contract (no `Ownable`, no proxy); `federation.yaml` `declaredOnChain: false` and the projector
printing the gap every run; F2.5 (`atl:projectionSigner` as a Ring-0 ontology term the estate agent writes, so the
cross-check reads the estate's own chain); the `CLAUDE.md` drift trigger "say the cross-chain story is demonstrated".

**Where the field agrees.**

- **ERC-8004** deploys its registries at deterministic addresses on 30+ chains, so "which registry" collapses to
  "which chain"; and its reputation registry is permissionless, which is why the empirical study of it (arXiv
  2606.26028) is a study of squatting and sybils: 53 % of Ethereum registrations have no URI, 48 % were batch-minted,
  and only 3 % (Ethereum), 4 % (BSC) and 15 % (Base) expose a valid file with a live endpoint. First-come-wins on
  permissionless ground produces placeholders; the mitigation is a cross-check nobody can squat.
- **ENS v2**'s design note that "when a name expires, it vanishes from the registry immediately" is the same honesty
  about what a registry can and cannot promise: it promises the record, not the party.
- **ANS v2** states its own limit the same way: the transparency property "does not hold against collusion between
  the RA and TL operators", and "the RA is a single trusted party in the current design; federation is future work".

**Where the field disagrees.** Nothing here is contested. What differs is who gets to say it: GoDaddy's ANS Registry
and the Linux Foundation's intended ANS each operate the registration authority they are asking the field to trust.
The field's answer to "who registered first" is a registrar with a dispute process; ours is a second read on a chain
the estate controls. Both are legitimate; only one is permissionless.

---

## P5 — Inclusion is consent; exclusion is the chain. The projector is a collector, never a scraper.

**Says.** A person's grants live in their own object, read under their own session; the estate holds no key that can
enumerate them (ap-home deleted its HMAC bridge for exactly this reason, spec 341 §1). So a leaf enters the projected
set only when its holder or issuer submits it, and leaves the set the moment `DelegationManager.isRevoked` says so,
whether or not anyone tells the projector. An unreadable chain drops the leaf.

**Rules out.** A projector credential that reads a person's records. "Probably still live" on a read error. A
projection the estate assembled on its residents' behalf.

**Enforced by.** `apps/projector/src/ledger.ts` (submissions) and `revocation.ts` (prune, drop on error); the doctor
rules `noHmacHomeBridge` (ceiling zero) and `noCrossSubjectVaultReads` in `agentic.lock.json`; ADR-0013 (no silent
fallback from an error to an assumption); the `CLAUDE.md` drift trigger "let the projector read the person's grants".

**Where the field agrees.**

- **W3C Verifiable Credentials** split issuance (under the holder's and issuer's control) from status (a status list
  anyone can read). Revocation is world-readable precisely so a verifier need not ask the issuer; issuance is not.
- **ERC-8004** registration is an act of the owner, and feedback "cannot be submitted by the agent owner or an
  approved operator": the two sides of the record have two different hands on them.
- **ANS v2** registration begins with the developer's own SDK translating the developer's own protocol card; the RA
  "hashes it and seals the hash". The RA holds a commitment, not a copy.
- **ADR-0040**'s rule for the public knowledge base ("reading the whole KB reveals nothing reading the chain
  wouldn't") is the same principle at the discovery tier, and it holds at the federation boundary too: neutral ground
  learns roots and a governance address, nothing else.

**Where the field disagrees.** Enterprise agent directories (the AGNTCY ADS drafts, the NANDA enterprise-registry
pattern) are operator-populated; the operator reads and publishes on the agents' behalf. That is the correct shape for
an organization's own workloads and the wrong shape for a person's grants, and the difference is whose record it is.

---

## P6 — A translated permission must not widen. No mapping ⇒ refuse and say so.

**Says.** A foreign protocol's grant (a NANDA scenario run grant, an ERC-8004 operator approval, an ANS trust tier)
maps onto nothing in our authority model but a scoped, intent-digest-bound mandate for one act. Where no such mapping
exists, the adapter refuses rather than choosing the nearest available scope. Permission to deliver a message cannot
become permission to transfer funds.

**Rules out.** "Nearest scope so the demo works." Any default mapping. Any mapping that is a superset.

**Enforced by.** Ring 0 spec 439 §3.1 and the first tests F2 writes; `DigestBindingEnforcer` and the intent-derived
single-use nonce (spec 336 §8.3); ERC-7710 caveats can only attenuate.

**Where the field agrees.**

- **SPKI** (RFC 2693) defines delegation as the *intersection* of authorizations along a chain; nothing downstream
  can exceed upstream. ERC-7710 caveats are the same algebra on chain.
- **OAuth 2.0 Token Exchange** (RFC 8693) lets an exchanged token carry at most the scope of the subject token; a
  request for more is refused, not rounded.
- **ANS v2**'s verification tiers "describe what the client checked, not what the RA assigned". A tier is a report of
  evidence, not a permission.
- **ERC-8273** (attestation-gated actions) binds an attestation to one `actionDigest` (target, selector, args, nonce):
  the closest on-chain peer to a mandate that cannot widen.

---

## P7 — Separate signals, never a score.

**Says.** Resolution returns subject, context, relationship, bindings, authority references and evidence as separate
signals (spec 346 §8.3). Federation adds one more (a presentation verified against a root at a sequence). Nothing
combines them into a number; a consumer that needs a ranking builds it in its own intent layer and owns it.

**Rules out.** A trust score. A reputation field a verifier reads. A tier that stands in for a decision.

**Enforced by.** `TypedResolutionResultV1` has no `trustScore` and no `rank`; spec 430 D5 (named · typed · listed ·
reachable, and a fifth line saying what the town cannot answer); the `CLAUDE.md` drift trigger "combine the
federation signals into a trust score".

**Where the field agrees.**

- **ERC-8004** keeps raw feedback on chain and says "different platforms can build their own scoring models on top of
  the same raw on-chain data". The score is downstream and plural.
- The **ERC-8004 empirical study** is the strongest evidence in the field for P7: sybil-flagged reviewers are 73.5 %
  (Ethereum), 59.2 % (BSC) and 90.6 % (Base) of reviewers; 98.7–100 % of feedback lacks proof of payment or task
  linkage; the median cost to move an agent across the trust threshold is $0.055, $0.0042 and $0.0027 respectively;
  scores are uncorrelated across chains. The authors' answer to "can an agent rely on the reputation to make a trust
  decision" is "our measurements suggest NOT". A single score is an attack surface priced in cents.
- **NANDA**'s governance paper: "reputation or analytics services should remain external to the core infrastructure".
- **ANS v2**'s three-layer split (identity; operational maturity from attestors; behavioral reputation from scoring)
  keeps the layers apart and keeps the RA out of the last two.

**Where the field disagrees.** GoDaddy's ANS Marketplace "tells you which AI agents you can trust" with a badge;
OWASP ANS v1 contemplated zero-knowledge capability proofs feeding a trust decision. A badge is a signal from one
issuer, and we would display it as such, named, beside the others.

---

## P8 — On the wire, nothing proprietary. Every external surface is a projection of the anchor.

**Says.** A2A 1.0 over HTTPS is the normative external profile; ARD/ACP for discovery; ERC-8004 as a chain-side
registry target; DNS-anchored records (`_agent` TXT, well-known paths) as discovery projections; NANDA as a
participation surface. Each projection carries a proof the account signed and none is canonical. MCP stays inside an
estate and is absent from every card.

**Rules out.** A federation-only protocol. An adapter that pins its own standards target. A projection with no
back-link to the account.

**Enforced by.** ADR-0057, ADR-0044; Ring 0 `docs/standards-lock.json` (this repository proposes entries; Ring 0
accepts them, so an upgrade is reviewable by someone other than the adapter's author); `pnpm conform:a2a`.

**Where the field agrees.** The whole DNS-anchored family converges on one well-known label and one well-known path:
AID v2 and HCS-14 both read `_agent.<domain>` TXT; DNS-AID adds SVCB under the same label; ANS v2 uses `_ans` and
`_ans-badge` TXT plus DANE TLSA; ERC-8004 reads `/.well-known/agent-registration.json`; A2A reads
`/.well-known/agent-card.json` (RFC 8615). None of them is an identity; each is a place a verifier looks. Publishing
all of them from one signed profile is the design of Ring 0 spec 347 (one canonical profile → many projections with
loss reports), and it is how an AP agent becomes findable by an ANS, AID or HCS-14 resolver without any of them
becoming its identity ([`federated-agent-naming.md`](federated-agent-naming.md) §5 L3).

---

## P9 — A federation has no root. Towns do not join one another's trust domain; adapters earn interoperability, never membership.

**Says.** The federation is towns on many chains joined on public ground. No town's registry, naming service or
operator is above another's; public ground is a contract nobody administers; an adapter that passes a third party's
conformance suite says so and does not thereby become a member of their federation.

**Rules out.** "Call it a NANDA Town instance." A federation-wide registrar. A root name registry every town must
use. One town resolving another's names by trusting its gateway.

**Enforced by.** Ring 0 ADR-0038 (be what registries are built from, not a tenant of one); spec 439 §8; the
`CLAUDE.md` drift trigger "call it a NANDA Town instance"; the four-context model in ap-town spec 436 (Home ⊂ estate
⊂ town ⊂ federation, "a lower context is reached by link, under the viewer's own standing, never copied upward").

**Where the field agrees.**

- **SDSI/SPKI local names** (Rivest and Lampson, 1996; RFC 2693) are the original statement that a naming system
  needs no global root: every principal is a namespace, and `alice's bob` is a name that means something only
  relative to alice. Our `x@ctx` contextual names (spec 346 §3.2) are SDSI linked local names on a chain.
- **Petname systems** (Stiegler, 2005) resolve Zooko's triangle by giving up global human-readable uniqueness: a name
  is global *or* human-meaningful *or* decentralized, and a system that wants all three must let the same label mean
  different things to different parties, with the identity carried by something that is not the label.
- **NandaIndex** (the July 2026 "global switchboard" draft) explicitly "does not replace existing discovery systems
  but routes requesters to them": it maps a stable identity to whichever discovery object a system already publishes
  (a catalog entry, a DNS-AID record, an agent card). A switchboard with no root is the federated shape.
- **ERC-8004** has no global name registry and no cross-chain reputation; each chain's registry is sovereign and a
  reader aggregates.

**Where the field disagrees, and it matters.** DNS has one root, and the DNS-anchored family inherits it. The Linux
Foundation's intended ANS "anchors agent identity directly to DNS" and offers "a federated identity layer without
relying on centralized or proprietary registries", and the CSA analysis asks the field to monitor that very anchor
"as a systemic dependency", listing registrar compromise (Sea Turtle), route hijacking (the 2018 Route 53 incident)
and CA mis-issuance (DigiNotar) as the inherited failure modes. ENS has one root too (the L1 root registry), which is
what makes `.eth` globally unique and is why ENS can promise what a rootless federation cannot. Our position is not
that roots are wrong; it is that *this* federation will not create one of its own, will rent DNS's root for routing
only, and will treat a future federation-wide root on public ground as an opt-in a town may take (naming doc §5.6).

---

## P10 — Every claim about the field is dated and sourced, and an unproved property is said to be unproved.

**Says.** "Cross-estate on one chain" is not "cross-chain", and this repository says so in `README.md`,
`DEPLOYER.md`, `federation.yaml` and spec 439 §7.0 until a second chain exists. A standard is cited with its
status and the date it was checked; a draft is called a draft; an individual IETF submission is not "the IETF". A
property that holds by construction (the estate id is chain-scoped) is called a design property, not a
demonstration.

**Rules out.** Conformance claims not earned. A version pinned from memory. A press release read as a specification.

**Enforced by.** The `CLAUDE.md` drift trigger "say the cross-chain story is demonstrated"; `standards-lock.json`
entries arrive with a source digest or with `sourceDigest: null` and the gap visible; the crosswalk's *checked* column.

**Where the field agrees.** The best documents in this field are candid about their own gaps, and that candour is the
property worth copying: ANS v2 lists its single-party RA, its query-privacy gap and its "application integrity gap";
the ERC-8004 study warns that "raw registration volume is a poor proxy for ecosystem maturity"; ENS Labs published the
decision to cancel its own L2; every IETF draft cited here carries the sentence "this Internet-Draft is not endorsed by
the IETF and has no formal standing". A federation built on proof should hold itself to the standard its evidence
holds itself to.

---

## The principles as a matrix

| | P1 account | P2 chain-local | P3 proof | P4 neutral | P5 consent | P6 no widen | P7 signals | P8 wire | P9 no root | P10 dated |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ERC-8004 | ✓ | ✓ | ✓ round trip | ✓ and its cost | ✓ | — | ✓ | ✓ target | ✓ | ✓ (study) |
| ENS v2 / ENSIPs | partial | — | ✓ CCIP-Read | ✓ root is a contract | — | — | — | — | ✗ one root | ✓ |
| ANS v2 (IETF draft) | ✗ domain is identity | ✓ RA ≠ authority | ✓ SCITT log | ✓ limits stated | ✓ | ✓ tiers are reports | ✓ 3 layers | ✓ DNS records | ✗ DNS root | ✓ |
| LF ANS (intent) | ✗ | ? | ? | ? | ? | ? | ? | ✓ | ✗ | — (no spec yet) |
| GoDaddy ANS Registry | ✗ | ? | ? | ✗ operator | ✓ | ? | ✗ badge | ✓ | ✗ | — |
| HCS-14 / HCS-10 | ✓ CAIP-10 | — | — | — | — | — | — | ✓ `_agent` | ✓ wraps any DID | ✓ draft |
| AID v2 / DNS-AID | ✗ FQDN is identity | — | partial (key proof) | — | ✓ | — | — | ✓ | ✗ | ✓ |
| NANDA / NandaIndex | ✗ record is pointed at | ✗ resolver tokens | partial | — | — | — | ✓ | ✓ | ✓ switchboard | ✓ |
| AGNTCY ADS | ✓ CID | — | ✓ signatures | — | ✗ operator-populated | — | — | ✓ | ✓ | ✓ |
| SPKI/SDSI · petnames | ✓ key is principal | — | ✓ | — | ✓ | ✓ intersection | — | — | ✓ | — |
| DANE-DID (IETF draft) | ✓ says so | ✓ says so | ✓ DNSSEC chain | — | — | ✓ says so | — | ✓ TLSA | ✗ DNS root | ✓ |

A ✓ means the standard embodies the principle in its own terms; ✗ means it chose the opposite; — means it does not
speak to it; ? means the public material does not say. The crosswalk carries the sentence behind each cell.
