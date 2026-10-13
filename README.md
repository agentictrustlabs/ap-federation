# ap-federation

**Two AP towns interoperate — on protocols the field already speaks, over proof rather than trust.**

Spec of record: [`specs/439-ap-federation-cross-town-interoperation.md`](https://github.com/agentictrustlabs/agentic-primitives/blob/main/specs/439-ap-federation-cross-town-interoperation.md)
in Ring 0. Generated from the Developer Kit's `product-repo` template (spec 399 §3.6, revision 2026-09-16.1)
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

1. **The projector** — per estate, maintain the live-grant and membership roots and anchor them with a
   monotonic sequence; runs as the estate's `.registry` service agent (spec 346), never a Home.
2. **The receiving edge** — the runtime path consuming a foreign presentation through
   `foreignEstateEvaluator`, and the receipt that records it.
3. **The cross-town runner** — the two-chain live twin, *with its negative twin beside it*.
4. **Protocol adapters**, one per target family, each depending inward: NANDA first, then ERC-8004 and
   ARD/ACP reuse of what Ring 0 already pins.

It does **not** own a new authority model, a bridge in the authority path, a trust score, private data on
neutral ground, or any conformance claim it has not earned. See spec 439 §8.

## Status

**F1 — the projector, live (2026-10-13).** `EstateProjectionRegistry` is deployed on faithchain
(`0xb4E116F5C6915a4f1e649E0877e4a0A7a1c1147b` — no admin, no pause, no upgrade), the **imbnet** estate is
registered under `estateId 0xe96d2c36…` derived from its own agent `imbnet.estate`, and its live-grant root
is anchored over real grants read under their holder's own session and pruned against the chain. A
presentation verifies against the root read from the chain; one sequence later the same presentation is
refused as stale. `scripts/gate-f1-projection.mts` is the gate and it is green.

Three things F1 found, and none of them are footnotes:

- **The projector is a collector, not a scraper** — the estate holds no key that can read its people's
  records (ap-home deleted its HMAC bridge for that reason), so *inclusion is a submission and exclusion is
  the chain*. `apps/projector/README.md` §1.
- **`register` is first-come-wins**, so a verifier that trusts `signerOf` alone trusts whoever registered
  first. F2 adds the estate-side declaration a verifier cross-checks (`atl:projectionSigner`); until then
  every run prints the gap.
- **faithnet cannot be federated yet.** It has no estate agent: `faithnet.estate` is unregistered and its
  people declare no `atl:estate`, so it has no address that will still mean "faithnet" in a year, and an
  estate id is permanent. `federation.yaml` carries the refusal and the fix.

**And what F1 did NOT prove:** this is cross-*estate*, on one chain. The estate id is chain-scoped by
construction, so a second chain changes one line of config and no verifier code — but a design property is
not a demonstration. Next: F2, the receiving edge through `foreignEstateEvaluator`.

## Layout

| Path | What lives there |
| --- | --- |
| `apps/*` | the product's deployables — each with its own `wrangler.toml` (see `wrangler.example.toml` for the env layout) |
| `examples/*` | relying-app demonstrations of the product's ceremonies; each builds against published packages or is retired |
| `federation.yaml` | the register: neutral ground, and the estates that project onto it (governance, signer, how each was determined, and why an estate is refused) |
| `scripts/` | ops scripts and the live gates (`gate-f1-projection.mts`) |
| `docs/runbooks/` | `project-an-estate.md` — putting an estate on neutral ground, end to end |
| `live-gates.json` | the live-gates ledger (spec 392 shape) the nightly runs through `ap test --live-gates` |
| `agentic.lock.json` | the coherent `@agenticprimitives/*` set, the rules-source digests, the doctor config |
| `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/` | projected from the pinned rules source — regenerate with `ap doctor --rules --write`, never edit the managed block |
| `DEPLOYER.md` | which repository deploys which Worker, and in which environment — one line per app |

## Commands

```
pnpm install
pnpm doctor                     # ap doctor — the doctrine rules over this tree
pnpm doctor:rules               # drift between the projected rules and the pinned source
pnpm upgrade:canary             # newest canary of every pin, one coherent set, then doctor
pnpm upgrade:pin 1.0.0-alpha.24 # or one named version / dist-tag
pnpm live-gates                 # the ledger against HOME_URL (nightly in CI)
pnpm conform:a2a https://…      # A2A 1.0 conformance of a deployment
pnpm conform:mcp https://…      # MCP conformance of a deployment
```

## Rules that bind every change

- Every `@agenticprimitives/*` dependency is an exact published version; the set is coherent (`lock-coherent`).
- Doctrine is projected, never restated: `AGENTS.md` / `CLAUDE.md` managed blocks and `.cursor/rules/*.mdc` come
  from the pinned source by digest (`rules-drift`). A product repo may not paraphrase a rule.
- A shadow environment (`<env>-split`) is where this repo deploys during a parallel run; the live environment
  changes hands only at the announced cut (spec 399 §5.3). Worker names, DO bindings and migration tags never change.
