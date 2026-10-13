# ap-federation — Claude guide

A product repository on published `@agenticprimitives/*` packages (ADR-0063; spec 399). Generated from the
`product-repo` template (2026-09-16.1). This repo owns its apps, runtime, ops scripts, live gates, product
specs and white-label config; Ring 0 owns the packages and the doctrine.

## Hard rules (this repository)

- **Exact pins, one coherent set.** Every `@agenticprimitives/*` dependency is an exact published version from
  `agentic.lock.json#packages`; move them only with `ap upgrade --canary | --pin`. Never a workspace alias, never a fork.
- **Doctrine is projected, never restated.** The managed block below and `.cursor/rules/*.mdc` are generated
  from the pinned source; `ap doctor` (`rules-drift`) fails on any edit.
- **No new app-resident primitive.** Anything a second product would need is a package API in Ring 0 (spec 399 §4).
- **Shadow first.** This repo deploys `<env>-split` during the parallel run; a live env changes hands only in the
  announced cut PR (`DEPLOYER.md`). Worker names, DO bindings and migration tags never change.
- **Web → A2A, never MCP** (ADR-0044); **the vault is the record** (ADR-0055); **no silent fallbacks** (ADR-0013).

## Ask the Developer MCP, don't guess

`.mcp.json` (Claude Code) and `.cursor/mcp.json` register `ap mcp` — the READ-ONLY Developer MCP (spec 398 §10.4):
`package_exports`, `ontology_term`, `contract_deployments`, `recipes`, `doctor`. Query it for an export name or an
ontology IRI rather than guessing. It is not the runtime MCP and not the Home MCP; it holds no key and reads no vault.

## Validate

`pnpm check` (typecheck + tests + `ap doctor`) · `pnpm doctor:rules` · `pnpm live-gates` (needs `HOME_URL`).

## Binding rules (projected)

## This repository in one screen

**Two AP towns interoperate, on standard protocols, over proof.** Spec of record: Ring 0
`specs/439-ap-federation-cross-town-interoperation.md`.

The hard fact everything follows from: **a delegation on chain A is not verifiable on chain B.** We do not
bridge authority, do not re-issue B-side grants for A-side agents, and do not accept an issuer's assertion
that a grant exists. The estate commits to its live set on neutral ground; a counterparty proves one leaf
against the root it reads itself.

| Reading for | Start at |
| --- | --- |
| the mechanism | Ring 0 spec 410 §4 — `EstateProjectionRegistry`, `estate-projection`, `foreignEstateEvaluator`. **Already in source; do not re-invent it.** |
| the wire | ADR-0057 (A2A over HTTPS is the normative external profile) · ADR-0044 (MCP stays INSIDE an estate, never a peer surface) |
| what a presentation is | ADR-0056 — resolution/evidence is never authority |
| the town's shape | `ap-town` `towns/<chain>/town.yaml`: estates, `agentZone`, lanes, naming gate |
| the principles, with the field's own sentences beside each | `docs/architecture/federation-principles.md` (P1–P10) |
| **naming across towns and chains** | `docs/architecture/federated-agent-naming.md` — N1–N8: CAIP-10 is the identity; a handle is unique per town and never re-registered elsewhere; across towns a name is the pair `{ name, chain }` and is never shown bare; the DNS projection is a rented locator; trust is named signals; **no federation root** (an opt-in one on public ground is recorded, not built). §7 is the Ring 0 backlog |
| what ERC-8004, ENS v2, the ANS family, AID, HCS-14, NANDA, AGNTCY actually say, dated | `docs/architecture/naming-landscape-crosswalk.md` |
| the shared KMS operator, the site, the universal naming service | `specs/440-shared-kms-federation-site-and-universal-naming.md` — A1–A4 (one operator, one tenant per estate, four conditions), B1–B2 (the site reads the towns' own surfaces), C1–C4 (**one namespace rooted on faithchain, ENS v2 style**; other chains join by gate + satellite + chain-keyed records + proof) |
| the receiving door (F2) | `apps/door/src/index.ts` — the four steps in order: proof → resolution → admission (foreign-estate evaluator, roots read live) → forward with evidence. The challenge is a stateless HMAC ticket (`challenge.ts`); the ledger DO is serving plane (`ledger-do.ts`). The gate's presenter is a real delegate (`scripts/setup-f2-test-grant.mts`) |
| standards versions | Ring 0 `docs/standards-lock.json`. **This repo proposes entries; it never pins its own target** — the point of the lock is that an upgrade is reviewable by someone other than the adapter's author. |

### Drift triggers — STOP

- *"Just bridge the delegation to the other chain."* **HARD STOP.** A bridge in the authority path is a
  custodian. The presentation mechanism exists precisely to avoid this.
- *"Map the foreign run grant onto our nearest scope so the demo works."* **STOP.** A translated permission
  must not widen; permission to deliver a message is not permission to transfer funds. No mapping ⇒ refuse
  and say so.
- *"Cache the estate root so the edge is fast."* **STOP.** The edge decides from the root it reads, and a
  stale sequence is a refusal, never a cached acceptance (spec 410 §4.2).
- *"Combine the federation signals into a trust score."* **STOP.** Separate signals, never an aggregate
  (spec 346).
- *"Call it a NANDA Town instance."* **STOP.** No general town certification or federation contract exists to
  claim conformance against. The earned claim is an interoperability *adapter*.
- *"Let the projector read the person's grants and build the set itself."* **STOP.** The estate holds no key
  that can read its people's records — ap-home deleted its HMAC bridge for exactly that reason (spec 341 §1).
  Inclusion is a SUBMISSION made under the holder's own session; exclusion is the chain (`isRevoked`).
- *"Use the naming gate (or any key) as `governance` so this estate can register."* **STOP.** The estate id is
  `keccak256("eip155:<chainId>:<governance>")` and is permanent; keys rotate, Smart Agent addresses do not
  (ADR-0010). An estate with no estate agent is refused, with the reason, in `federation.yaml`.
- *"Re-anchor every run so the roots are always fresh."* **STOP.** A sequence spent on an unchanged
  projection invalidates every presentation in flight. Anchor on change, plus a heartbeat below the shortest
  verifier `maxAge` — and know that the two pull against each other (`apps/projector/README.md` §3).
- *"Say the cross-chain story is demonstrated."* **STOP.** F1 is CROSS-ESTATE on one chain. The id is
  chain-scoped by construction, which is a design property, not a demonstration.
- *"Let this town run its own `.me` / create a second root."* **STOP.** There is ONE universal namespace, rooted on the
  root chain (faithchain today; spec 440 C1, the owner's decision 2026-10-14). A town joins it — its estate's gate is
  named on the root's priced roots, its residents own names there by their own root-chain account — and never runs a
  parallel typed root. Across towns a name is still `{ name, chain }` and is still never shown bare.
- *"Have the registry agent / the operator hold the name for a resident on the other chain."* **STOP.** The owner of a
  root-chain name is the resident's own root-chain account (home or satellite, spec 440 C3). No satellite ⇒ no name,
  not operator custody.
- *"Share the KMS tenant — same operator anyway."* **STOP.** A tenant is a derivation root and an estate boundary. One
  tenant per estate in every town; a second estate on one tenant changes every address the day custody moves.
- *"Bind the new town's Workers with the pilot credential for now."* **STOP.** Condition 1 (spec 440 A3): one
  least-privilege caller per Worker, never a shared credential; `check:federation` refuses the row.
- *"Write `alice.me@faithchain` for the cross-town form."* **STOP.** `@` means context (spec 346 §3); the chain is a
  record beside the name, never a name component (Ring 0 refused ERC-7828 for this reason).
- *"Put the capability / version / certification in the name so resolvers can filter."* **STOP.** The one derived fact
  in a name is the type, checked on chain (ADR-0061). Everything else changes without the agent changing.
- *"Make the DNS host the identity — every ANS/AID resolver already speaks DNS."* **STOP.** The host is a projection
  the agent publishes and could lose without losing anything but reach; the DANE-DID draft itself says a name binding
  "MUST NOT be read as providing continuity of holding".
- *"Let an OAuth bearer through the door when it cites a presentation."* **STOP.** A request that claims authority
  needs a PRINCIPAL-signed proof (admission's binding position; ADR-0041). The door accepts only the request proof.
- *"Return the request-proof failure code to the caller so they can debug."* **STOP.** Those codes are a map of how
  to forge a proof (spec 339 §26.2). Log precisely, answer `authentication_failed`. The FOREIGN_ESTATE_* codes are
  the federation's own vocabulary and are the ones that stay legible.
- *"Use `faith-estate.workspace` / `imb-estate.workspace` as the estate agent — it's already there."* **STOP.** Those are
  the Pulse's context agents, typed `.workspace`. An estate's identity on neutral ground is its `.estate` agent (owner,
  2026-10-14: one per estate typed `.estate`). Two custody shapes exist (runtime key; a demo persona); the type does not change.
- *"Add a primitive here."* **STOP.** Anything a second product would need is a Ring-0 package API
  (spec 399 §4). This repo holds adapters, deployed jobs and gates.

### Validate

```
pnpm typecheck && pnpm test && pnpm run doctor     # `pnpm doctor` is pnpm's own builtin — use `run`
```

<!-- ap:rules -->
<!-- Generated by `ap doctor --rules --write` from the pinned rules source; edit the source, never this block (ADR-0063 §8). -->

| Rule | Source | Digest |
| --- | --- | --- |
| Coordination (between agents, discovery, capability level) vs orchestration (within agent, SKILL.md + tools) | `@agenticprimitives/devkit/rules/coordination-vs-orchestration.md` · `.cursor/rules/coordination-vs-orchestration.mdc` | `sha256:f27549392401…` |
| A demo person SA is never also their organization SA (ADR-0046) | `@agenticprimitives/devkit/rules/demo-person-org-distinct.md` · `.cursor/rules/demo-person-org-distinct.mdc` | `sha256:533f89b8c8e5…` |
| Keep external registry integrations out of primitive packages | `@agenticprimitives/devkit/rules/external-registry-integrations.md` · `.cursor/rules/external-registry-integrations.mdc` | `sha256:1e23b29977d0…` |
| The root CLAUDE.md hard rules (canonical identifier, no silent fallbacks, generic packages, web → A2A, vault is the record) | `@agenticprimitives/devkit/rules/hard-rules.md` | `sha256:443a34a33287…` |
| Define the capability model once; UX behaviour and agent surfaces are generated from it (specs 354/355/359) | `@agenticprimitives/devkit/rules/one-capability-model-generates-both.md` | `sha256:50d46f01e41c…` |
| Domain relationships live in the ontology T-box, not in prompts or app tables (spec 355) | `@agenticprimitives/devkit/rules/ontology-drives-behavior.md` · `.cursor/rules/ontology-drives-behavior.mdc` | `sha256:1324bb1aec2d…` |
| service-agent-birthrights | `@agenticprimitives/devkit/rules/service-agent-birthrights.md` | `sha256:0a1601d625aa…` |
| Service agents sign with a DELEGATE key under a ceremony-minted wire — never custody the identity they act as (ADR-0019) | `@agenticprimitives/devkit/rules/service-agent-signing.md` · `.cursor/rules/service-agent-signing.mdc` | `sha256:3f41d62dc56a…` |
| Capability as canonical noun; qualify every standards-specific "skill" (ADR-0050, ADR-0051) | `@agenticprimitives/devkit/rules/skill-terminology.md` · `.cursor/rules/skill-terminology.mdc` | `sha256:c28873bc0594…` |
| Prefer vault-backed authority and standards-based ontology patterns | `@agenticprimitives/devkit/rules/vault-and-ontology.md` · `.cursor/rules/vault-and-ontology.mdc` | `sha256:825116963a48…` |
| vault-is-the-record-apps-hold-references | `@agenticprimitives/devkit/rules/vault-is-the-record-apps-hold-references.md` | `sha256:e6a6e859a160…` |
| Vault records are ontology-shaped: record keys bind to T-box classes by IRI | `@agenticprimitives/devkit/rules/vault-records-are-ontology-shaped.md` | `sha256:6a739d1a10d5…` |

<!-- /ap:rules -->
