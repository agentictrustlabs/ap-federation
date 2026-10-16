# ap-federation

**Two AP towns interoperate — on protocols the field already speaks, over proof rather than trust.**

Spec of record: Ring 0 `specs/439-ap-federation-cross-town-interoperation.md` (the substrate repository is private, so it is
named here and not linked; the architecture notes in `docs/architecture/` carry what a reader needs from it). Generated from the Developer Kit's `product-repo` template (spec 399 §3.6, revision 2026-09-16.1)
by `@agenticprimitives/create-app` 0.0.0-alpha.22. Ring 0 (`agenticprimitives`) keeps the packages, the
contracts and the kit; this repository owns its runtime, its ops scripts, its live gates and its adapters
(ADR-0063 §2).

## The one hard thing

Two towns are two chains. An agent IS its ERC-4337 Smart Agent address on its own chain (ADR-0010), and
authority is an ERC-7710 delegation on that chain. So the wire is the easy half — A2A is already the
normative external profile (ADR-0057). The hard half is one sentence:

> **A delegation on chain A is not verifiable on chain B.**

This repository exists because of the three easy answers we refuse:

| Tempting | Why not |
| --- | --- |
| bridge the authority | a bridge in the authority path makes the bridge the custodian |
| re-issue B-side grants for A-side agents | that is B minting authority over A's people |
| accept a signed assertion that a grant exists | an issuer's word is not a verifier's check |

Instead the estate publishes a **commitment to its live set on neutral ground**, and a counterparty **proves
one leaf against the root it reads itself** — `EstateProjectionRegistry` + `authority-presentation-v1`,
already in Ring 0 source (spec 410 §4). `estateId = H(chainId, governance)` is chain-scoped by construction,
so one registry serves many estates on many chains. That is the Ethereum multi-chain story here, and it is
proof-based, not bridge-based.

## The invariant this repository protects

> **A presentation is evidence. It is never authority.** (ADR-0056, ADR-0057)

It says *this subject holds a live grant in estate A as of sequence N*. Whether anything happens in B is B's
decision, by B's gates, under a mandate B's own principal signed. Admission's stage order (spec 339) is
unchanged, and no stage is skipped because a foreign estate vouched for someone.

The corollary, and the first thing to write tests against: **a translated permission must not widen.**
Permission to deliver a message cannot become permission to transfer funds. Where a foreign protocol's grant
has no mapping in our authority model, the adapter **refuses and says so** rather than choosing the nearest
available scope.

## What this repository owns

1. **The projector** — per estate, the live-grant and membership roots; per ISSUER, the live-credential root. It
   reads each estate's and issuer's submissions from THEIR OWN vault, prunes against the chain, anchors with a
   monotonic sequence, and runs as a Worker on a six-hour cron with one delegate key per estate and per issuer.
2. **The receiving doors** — a challenge, a principal-signed request proof, admission with `foreignEstateEvaluator`
   against roots read from neutral ground, a hash-chained receipt by reference, the admitted bytes forwarded. The
   **predicate grade**: a zero-knowledge presentation (OpenAC) verified in a Node container beside the Worker, a
   **trust set** of accepted issuers, a nullifier window, receipts whose parties collapse after a retention window.
3. **Member payment** — a pay ticket issued only on a predicate admission, bound to the admission receipt and to the
   issuer's own terms (payee, asset, chain); the member pays treasury to treasury under her standing dues wire; the
   door reads the transfer on the organization's chain and settles the ticket once.
4. **The register** — `federation.yaml`: neutral ground, estates (two chains each: projection and home), towns, the
   shared KMS operator, the universal namespace, the doors and their policies, and `credentials.issuers[]` — an
   organization's own agent among them, with `ledger: vault` and a `rowSigner` for an issuer on another chain.
5. **Personal agents at a company's door** — `packages/personal-agent-client` (PAP discovery, RFC 7523 + DPoP
   sessions, Direct and Device sign-in as Home ceremonies; mediated sign-in refused by default), `apps/pap`
   (the estate's personal-agent SERVICE, the client at every company), `apps/pap-door` (a company door in front of a
   service, where `approved_by` comes only from a mandate signature).
6. **The holder tooling and the live gates** — ceremonies that put an issuer on neutral ground and a member's
   credentials in her own vault (`scripts/setup-*.mts`), and ten gates (`live-gates.json`) the nightly runs.
7. **Protocol adapters**, one per target family, each depending inward: NANDA (projection only).

It does **not** own a new authority model, a bridge in the authority path, a trust score, private data on
neutral ground, or any conformance claim it has not earned. See spec 439 §8.

## Status (2026-10-16)

| What | Where | Proof |
| --- | --- | --- |
| Neutral ground | `EstateProjectionRegistry` on faithchain `0xb4E116F5…` — no admin, no pause, no upgrade | `gate:freshness` |
| Two estates on two chains | impact-agent (Home on hopechain 34349, projection on faithchain) and faithnet (faithchain), both anchored, both signers declared on chain | `gate:vault-record`, `gate:freshness` |
| The two-chain twin | a visitor from each estate admitted at the other's door on a leaf proved against the root read from the chain; an act refused at the authority stage; a payment under a steward's standing wire; the duplicate refused on chain — both directions, across faithchain and hopechain | `gate:twin`, `gate:door`, `gate:pay-outward` |
| The predicate grade | a nameless visitor proves "over 18 and a member of your organization" in zero knowledge at impact-agent's door, under the key service's device key, with no local-key allowance; 25 checks, 5 refusals | `gate:predicate` |
| The organization issues (spec 444) | imbnet's own organization agent issues membership credentials to its members under its steward's mandate, vouches on its own live-credential row from its own vault, delivers into the member's vault; the member asks through her own agent | `gate:predicate` on an org-issued credential |
| Member payment | a pay ticket on the predicate admission; dues paid treasury to treasury on the organization's chain; the organization learns a member paid, not which | `gate:member-payment` (15 checks, 4 refusals) |
| The company's door | faithnet-pap.svc at pap.faithnet.io; a PAP company door in front of ligonier.svc | `gate:pap-twin` |
| The site | ap-federation.faithnet.io: towns, KMS, names, doors, neutral ground | `gate:site` |
| The key service | kms.faithnet.io, one tenant per estate, P-256 keys for devices and issuers; its platform root is released only to the attested SEV-SNP CVM (Secure Key Release) | `federation.yaml#kms` |

Settings relaxed for testing are listed, with their production values, in
[`docs/runbooks/before-real-users.md`](docs/runbooks/before-real-users.md). Every finding since F1 is in
[`docs/architecture/decisions-and-findings.md`](docs/architecture/decisions-and-findings.md).

## Layout

| Path | What lives there |
| --- | --- |
| `federation.yaml` | the register: neutral ground; the estates (projection chain and home chain); the towns; the shared KMS operator (tenants, callers, the four conditions); the universal namespace; the doors and their policies (`credentialProofs`, `membershipPayments`, `receipts`); `credentials.issuers[]` |
| `apps/projector` | the projection job: a CLI (`--estate` and `--issuer` modes) and **projector.ap-federation.faithnet.io**, a Worker that rebuilds and anchors every estate's and every vault-ledger issuer's roots every six hours |
| `apps/door` | **door.ap-federation.faithnet.io** (impact-agent) and **door-faithnet.ap-federation.faithnet.io**: proof → admission → receipt → forward; the predicate grade (`/federation/present`, `/federation/credentials`), pay tickets (`/federation/pay-ticket`, `/settled`) |
| `apps/door/verifier` | the OpenAC verifier, a Node container beside the impact-agent door (the 274 MB verifying key does not fit a Worker) |
| `apps/pap` | **pap.faithnet.io** — faithnet's personal-agent service: client metadata, JWKS, the RFC 9421 key directory, the sign-in return |
| `apps/pap-door` | **ligonier-door.ap-federation.faithnet.io** — a PAP company door in front of ligonier.svc |
| `apps/site` | **ap-federation.faithnet.io** — the federation drawn; towns · KMS · names · neutral ground; public, read-only, keyless |
| `apps/nanda-adapter` | a pure projection from a released card into a NANDA index entry, with a loss report |
| `packages/personal-agent-client` | our person's agent at THEIR door: PAP discovery, sessions, sign-in ceremonies, operations as parked acts |
| `specs/` | this repository's own specs: `440` (the shared KMS operator, the site, universal naming), `443` (PAP / ACP / UCP / TAP projections) |
| `scripts/` | the live gates (`gate-*.mts`), the ceremonies (`setup-predicate-issuer.mts`, `setup-predicate-holder-vault.mts`, `setup-member-holder.mts`, `publish-issuer-facet.mts`, `bind-client-key.mts`), `check-federation.mts`, `fetch-openac-keys.sh` |
| `docs/architecture/` | start at its `README.md`: the primer, one crossing step by step, multi-estate and multi-town, operating, the ledger of decisions and findings, the naming documents |
| `docs/runbooks/` | `project-an-estate.md`, `kms-tenant-for-an-estate.md`, `before-real-users.md` |
| `live-gates.json` | the ten live gates the nightly runs through `ap test --live-gates` |
| `agentic.lock.json` | the coherent `@agenticprimitives/*` set, the rules-source digests, the doctor config |
| `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/` | projected from the pinned rules source — regenerate with `ap doctor --rules --write`, never edit the managed block |
| `DEPLOYER.md` | which repository deploys which Worker, and in which environment — one line per app |

## Commands

```
pnpm install
pnpm doctor                     # ap doctor — the doctrine rules over this tree
pnpm check:public-links         # no link into a private repository (this repo is public)
pnpm check:federation           # the register is fit to publish (towns, one tenant per estate, the root chain, trust sets)
pnpm projector …                # the projection CLI: --estate <id> | --issuer <id> (apps/projector/README.md)

pnpm site:deploy                # apps/site → ap-federation.faithnet.io
pnpm projector:deploy           # apps/projector → projector.ap-federation.faithnet.io
pnpm door:deploy                # apps/door → both doors (the impact-agent door builds its verifier container; needs Docker)
pnpm pap:deploy                 # apps/pap → pap.faithnet.io
pnpm pap-door:deploy            # apps/pap-door → ligonier-door.ap-federation.faithnet.io
pnpm nanda                      # the NANDA projection, printed

pnpm gate:door                  # F2: the door admits on evidence and refuses what it must (FEDERATION_ESTATE, FEDERATION_DOOR_URL)
pnpm gate:twin                  # the two-chain twin: both estates' standing at the other's door, both directions
pnpm gate:freshness             # every projecting estate is still provable; the scheduled projector answers
pnpm gate:vault-record          # each estate's submissions are read from its registry agent's vault
pnpm gate:pay-outward           # paying outward across the boundary
pnpm gate:predicate             # a nameless visitor proves over 18 AND a member, in zero knowledge
pnpm gate:member-payment        # the member pays her dues on that proof, treasury to treasury
pnpm gate:pap-twin              # the company's door: a personal agent signs in and parks an act
pnpm gate:site                  # the site answers from the towns' live surfaces
pnpm live-gates                 # the whole ledger (nightly in CI)

pnpm setup:predicate            # the issuer ceremony (facet, attestation, row) for a registry-agent issuer
pnpm setup:predicate-vault      # the holder's records into her vault
pnpm keys:openac                # fetch the OpenAC keys (verifying ≈280 MB; --proving for a prover)
pnpm bind:client-key            # the estate's personal-agent service key binding
pnpm doctor:rules · pnpm upgrade:canary · pnpm upgrade:pin <v> · pnpm conform:a2a <url> · pnpm conform:mcp <url>
```

## Rules that bind every change

- Every `@agenticprimitives/*` dependency is an exact published version; the set is coherent (`lock-coherent`).
- Doctrine is projected, never restated: `AGENTS.md` / `CLAUDE.md` managed blocks and `.cursor/rules/*.mdc` come
  from the pinned source by digest (`rules-drift`). A product repo may not paraphrase a rule.
- A shadow environment (`<env>-split`) is where this repo deploys during a parallel run; the live environment
  changes hands only at the announced cut (spec 399 §5.3). Worker names, DO bindings and migration tags never change.
