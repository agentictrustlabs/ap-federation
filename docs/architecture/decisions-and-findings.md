# Decisions and findings — the ledger

*Each entry: what was decided or found, when, and where it is written down. Ring 0 documents are named, not linked
(the substrate repository is private).*

## The charter (spec 439, Ring 0)

| # | Decision | Where |
| --- | --- | --- |
| C1 | A delegation on chain A is not verifiable on chain B. No bridge in the authority path, no re-issued grants, no accepted assertions. The estate commits on neutral ground; a counterparty proves one leaf. | spec 439 §0 |
| C2 | A presentation is evidence, never authority. A translated permission must not widen; no mapping ⇒ refuse. | spec 439 §3.1; principles P2, P6 |
| C3 | On the wire, nothing proprietary: A2A 1.0, ARD/ACP, ERC-8004, NANDA as a participation surface. MCP stays inside an estate. | spec 439 §3; principle P8 |
| C4 | The standards lock is Ring 0's; this repository proposes entries and never pins its own target. | spec 439 §10 |

## What F1 found (2026-10-13)

| # | Finding | Where |
| --- | --- | --- |
| F1.1 | The projector is a collector, not a scraper, and the substrate forces it: no estate-held key can read a person's records. Inclusion is a submission; exclusion is the chain; an unreadable chain drops the leaf. | spec 439 §7.1a; `apps/projector/README.md` |
| F1.2 | `register` is first-come-wins. A verifier trusting `signerOf` alone trusts whoever registered first. | spec 439 §7.1b; closed by F2.5 |
| F1.3 | An estate id is permanent, so governance is the estate agent's account, never a key. | spec 439 §7.1c; `federation.yaml` |
| F1.4 | Freshness costs sequences: anchoring invalidates presentations in flight; never re-anchor an unchanged projection; heartbeat below the shortest verifier `maxAge`. | `apps/projector/README.md` §3 |
| F1.5 | `subject` on a leaf is whom it is about (the delegate). The leaf an agent presents about itself is a grant whose delegate is that agent. | spec 439 §7.1 |

## What F2 and F2.5 found (2026-10-14)

| # | Finding | Where |
| --- | --- | --- |
| F2.1 | Admission is not authority, and the origin proved it: the estate's door answered the admitted visitor with its own refusal until the visitor authenticated there too. | spec 439 §7.2 |
| F2.2 | A production door is the estate's edge; the federation's doors are references in front of one estate each, and say so. | `DEPLOYER.md` |
| F2.3 | Receipts belong in vaults; the door's ledger is serving plane. | `DEPLOYER.md`; ADR-0055 |
| F2.4 | Authentication failure codes stay generic (a map of how to forge a proof); `FOREIGN_ESTATE_*` codes stay legible. | `apps/door/src/index.ts`; spec 339 §26.2 |
| F2.5 | `atl:projectionSigner`, written by the estate agent on its own chain, closes first-come-wins. Both verifiers read it. | spec 439 §7.3; Ring 0 `AgentProfilePredicates` |

## What F3 on one chain found (2026-10-14)

| # | Finding | Where |
| --- | --- | --- |
| F3.1 | faithnet's estate agent is persona-custodied (salt 2 over the demo-admin persona), by the owner's choice: one agent per estate typed `.estate`; the `.workspace` context agents stay the Pulse's. Two custody shapes exist and both are legitimate (ADR-0010). | spec 439 §7.4; `federation.yaml` |
| F3.2 | `imb-estate.workspace` is custodied by a faithnet persona and so is a faithnet resident. Proposed, not decided: the Pulse's context agents become the `.estate` agents. | spec 439 §7.4 |
| F3.3 | ap-town's naming app reads `.estate` names as legacy/invalid; it should learn the root. | spec 439 §7.4 |
| F3.4 | The visitor authenticates at the estate's own door with the scheme the runtime already had (an agent asking as itself); no new mechanism. The runtime verifies the door's receipt at the door and records standing on the task as evidence. | spec 439 §7.6; ap-home `agent-runtime` |
| F3.5 | The twin runs both directions on one chain and prints that it is one chain. | `scripts/gate-f3-twin.mts` |
| F3.6 | §6's negative twin: a visitor's act that needs a mandate is refused at the authority stage by the estate's own harness (`messaging.direct.send needs a steward at alice.me`), the task rejected with the missing authority named and the verified standing still on it. A first ask that named "your treasury" parked INPUT_REQUIRED instead: a stranger's read of the agent's relationships is bounded, so the resolver could not find the treasury — correct, and a reminder that the act must name its target. | spec 439 §7.7; `gate-f2-door` |
| F3.8 | §6's positive half: a steward's standing payment wire to a visiting agent (delegate = the visitor's agent, payee = the visitor's treasury, asset = the treasury's rail, cap, 30 days); the visitor derives the child for the parked intent and resumes the same task; the harness verifies the chain and the money moves. Three rules enforced on the way: never the asker as counterparty; money moves only between treasuries (the visitor chartered one); the wire's asset must be the treasury's. | spec 439 §7.8; `gate-f2-door`; ap-home `issue-visitor-standing-wire.mts`, `charter-visitor-treasury.mts` |
| F3.9 | The imbnet mirror of the positive half surfaced two more rules: a treasury born from the Home's birthright carries no `atl:agentType`, and the harness refuses to PAY from an account it cannot tell is a treasury (declared through maya's Home; fixed the same day: a nameless birth now declares its type in the same genesis, in the runtime's bootstrap-agent and the Home's child charter); and a standing wire's default of one redemption a day made the second payment revert on chain — right for a person's wire, said on the command line for the gate's. Both directions green. | spec 439 §7.8; ap-home `declare-agent-type-via-home.mts` |
| F3.10 | §6 step 4 shown: the identical intent repeated derives the same child and is refused at redemption on chain (`PaymentEnforcer.NonceReused`); no second payment. The gate's own repetition had tripped it first — each run is a distinct intent by its memo. | `gate-f2-door`; spec 439 §7.8 |
| F3.7 | ~~The runtime's refusal text is the spoken rendering on the A2A wire.~~ Fixed 2026-10-14: a plan refusal reaching a peer carries its written reason first. | ap-home `standard-a2a.ts` |

## The shared KMS operator, the site, the universal namespace (spec 440)

| # | Decision | Where |
| --- | --- | --- |
| K1 | One AKCS operator at the federation scale; one tenant per estate, always; shared infrastructure with an operator of record, not neutral ground, not required. Four conditions gate a new town's use (#1 shared credential and #4 attestation still open). | spec 440 §A |
| K2 | Cost evidence: one billable Key Vault root, 5.00 USD a month; 433 logical keys under it cost nothing. A tenant or a caller never creates a Key Vault key. `billableKeyBudget: 2` is a gate. | spec 440 §A7; `federation.yaml#kms` |
| S1 | The site reads each town's own surfaces live and holds no copy of anything. | spec 440 §B |
| N1 | Naming is a trust question answered per layer: CAIP-10 identity; a typed handle unique per registry; across towns the pair `{ name, chain }`, never bare; the DNS projection as a rented locator; trust as named signals. | `federated-agent-naming.md` |
| N2 | **One universal namespace rooted on faithchain, ENS v2 style**, other chains joining without a second registry (the owner's decision 2026-10-14; amends N7). `atl:accounts` (accounts by chain) and `FederatedAgentNameV1` are built; the satellite claim path and the naming root wait for a second chain. | spec 440 §C; `federated-agent-naming.md` |

## F4 — the NANDA adapter (2026-10-14)

| # | Decision or finding | Where |
| --- | --- | --- |
| F4.1 | The lock entries came first and were read, not asserted: `nanda-index` and `nanda-agentfacts`, both with real digests. | Ring 0 `docs/standards-lock.json`; spec 439 §7.9 |
| F4.2 | **The index is live and converged on ARD.** `api.nandaindex.org` answers; identifiers are ARD URNs and the entry shape is the AI Catalog shape — already pinned as `ard` — so the adapter adds no vocabulary. `application/a2a-agent-card+json` is first class, so an AP agent is indexed as itself. | spec 439 §7.9 |
| F4.3 | **AgentFacts has no signature, proof or credential field** (verified against the live draft-07 schema) and has not moved since 2025-06-17 while the index moved this week; `spec.projectnanda.org` does not resolve. Project into it with a loss report; never read one as evidence. | spec 439 §7.9 |
| F4.4 | The adapter is a **pure projection with a loss report** and three refusals (never authority, never an invented vocabulary, never membership). It prints; publishing is the estate's own act under its own verified domain. | `apps/nanda-adapter` |
| F4.6 | The reading half (spec 439 §5's discovery row): fetch a listing, fetch what it lists, report per entry — reachable, signed, served by its own publisher, the shape claimed — then a count, then what none of it is evidence of. Over the live index's 29 A2A-card entries on 2026-10-14: **21 reachable, 2 signed, 17 served by their own publisher**. An entry's publisher is often not the host you fetch from, which the index permits and a reader must not conflate. | `apps/nanda-adapter/src/resolve.ts` |
| F4.7 | A six-card sample said "none are signed"; the full 29 said two. The module's comment was corrected before it shipped, and the check is per entry regardless — the adapter never generalises from a count. | `apps/nanda-adapter/src/resolve.ts` |
| F4.5 | Running it against the live town card surfaced that the card carries **no JWS signature** — spec 347 says a released card is signed, and the town agent's is not. The projection says so by omitting the signature loss line rather than inventing one. | `apps/nanda-adapter`; ap-town backlog |

## The projector on a schedule (2026-10-14)

| # | Finding | Where |
| --- | --- | --- |
| P1 | **The predicted failure was arriving.** On the morning of 2026-10-14 imbnet's anchor was 10.5 hours old and faithnet's 9.6, against the doors' 24-hour window: about thirteen hours from refusing every presentation at both doors. Nothing was broken; nobody had run the job. | `DEPLOYER.md` had predicted exactly this |
| P2 | The projector now runs as a Worker on a six-hourly cron, with the submissions in a Durable Object (`pnpm projector push` moved them off the operator's `.submissions/`). It prunes and rebuilds before every anchor and never re-asserts a root it did not just rebuild — a heartbeat that did would extend the life of a revoked grant. | `apps/projector/worker` |
| P3 | A scheduled job is not a submitter. Its ledger is read-only by construction: `add` and `retire` throw, because inclusion is a submission someone made (F1.1) and a cron is not someone. | `worker/index.ts` `readOnlyLedger` |
| P4 | Still not spec 439 §4's shape: the anchoring keys are Worker secrets, not keys the registry agent holds, and the store is serving-plane rather than that agent's vault. Better than a laptop; not the destination. | `DEPLOYER.md` |

## Still owed

| What | Needs |
| --- | --- |
| the two-chain twin | a second chain |
| receipts and submissions into the registry agent's **vault** (both are in Durable Objects now, which is serving plane) | the registry agent as the projector (spec 439 §4) |
| F4, the NANDA adapter | NANDA's normative document digested into the standards lock |
| KMS conditions #1 and #4; the host move | the owner, on the CVM |
