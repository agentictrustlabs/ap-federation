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
| F3.2 | `imb-estate.workspace` is custodied by a faithnet persona and so is a faithnet resident. Proposed, not decided: the Pulse's context agents become the `.estate` agents. **Closed 2026-10-14** — see R1 below. | spec 439 §7.4 |
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
| P5 | The alarm that was missing: `gate:freshness` fails RED when any estate is within three hours of a verifier refusing it. An estate that cannot be proved is not a passing estate, so it is a failure and not a warning. | `scripts/gate-projector-freshness.mts` |
| P4 | **§4's shape reached (2026-10-14):** `signerOf` is each estate's `.registry` service agent, custodied by a person of that estate and declaring `atl:estate`. The job holds a delegate key under a wire pinned to `setRoots` and nothing else; without the wire the key reverts, and revoking it on chain stops the job without touching the agent. | `apps/projector`; ap-home `charter-service-agent.mts`, `issue-anchoring-wire.mts`, `rotate-projection-signer.mts` |
| P6 | An agent belongs to an estate, so a person of **that** estate should custody it. imbnet's registry agent was first chartered under the estate's interactions key — a runtime secret, not a person — and was re-chartered under maya through imbnet's own Home, with the custodian address recovered from a probe signature so her key never left it. The same error stood in `imb-estate.workspace` until R1 below. | spec 439 §7.11 |
| P7 | Rotating the signer broke the F2.5 cross-check until each estate agent's `atl:projectionSigner` was updated to match. The chain's signer and the estate's declaration have to move together, and the doors refuse while they disagree — which is the check working. | `set-projection-signer.mts`, `estate-agent-declare.mts` |

## The last misplaced custody (2026-10-14)

imbnet's Pulse context agent, `imb-estate.workspace` (`0xc0d82cdd…`), was custodied by demo-admin — a faithnet
persona. The last instance of P6, and the one named twice above as unfixed.

| # | Finding | Where |
| --- | --- | --- |
| R1 | **Closed.** maya is now its sole custodian and demo-admin is out, in one transaction, and the agent's address never changed: a credential rotated, the identity did not (ADR-0011). It also now declares `atl:estate = imbnet.estate`, which neither faithnet context agent does. The declaration was signed by maya through imbnet's own Home, which is the proof the rotation took: the write would have been refused if she were not a custodian. | `rotate-custodian.mts` tx `0x3ae65cd6…`; `estate-agent-declare.mts` tx `0xf43444b0…` |
| R2 | A `removeCustodian` on its own is the wrong tool: it bumps the custody epoch and leaves every standing grant keyed to the old one. The ceremony is `add → retire → approveDigest×N` in ONE transaction (spec 410 §1), and that is the shape `rotate-custodian.mts` sends — a batch, never a sequence of transactions with a window in between. | ap-home `scripts/rotate-custodian.mts` |
| R3 | **The epoch the doctrine turns on does not exist on this chain yet.** The live `AgentAccount` implementation (`0x8691bFE5…`, every account on faithchain) carries no `custodyEpoch()` and no `approveDigest(bytes32)` — generation 1, exactly as the readiness review records. So this retirement bumped nothing and invalidated nothing, and the ceremony's re-approval half is unrunnable here until the generation lands. The script reads the implementation and says so rather than reporting a clean rotation it did not perform. | `AgentAccount.sol` generation 1 vs spec 410 §1 |
| R4 | None of the three Pulse context agents declares `atl:agentType`, though all three carry a `.workspace` suffix. ADR-0061 §5 makes the on-chain record the authority and the suffix a claim, so a typed resolution of any of them fails closed today; the town agent reaches them by forward record instead, which is why nothing has broken. Backlog, and ap-town's charter path owns it. | `imb-estate.workspace`, `faith-estate.workspace`, `faith-town.workspace` |
| R5 | The imbnet Home's apex redirects to `www`, and a redirected POST drops its `Authorization` header — so `persona-sign` answered `session required` with a valid session in hand. An operator script must address the issuer host (`https://www.impact-agent.me`), not the apex. | `estate-agent-declare.mts --home` |

## The vault becomes the record (2026-10-14)

ADR-0055's test, applied to the three stores this federation runs, separated them sharply and only one needed moving.

| # | Finding | Where |
| --- | --- | --- |
| V1 | **The projector's submissions were the real violation, and are now vault records.** Each row carries a blind, random, derived from nothing public, held by the holder and the estate and nobody else. Wipe it and the roots on chain survive while no leaf in them can ever be proved again and the next rebuild yields a different tree: a bereavement, not a rebuild. Each estate's submissions now live in ITS OWN registry agent's vault as `federation.projection-submission:<set>:<digest>`, and both estates vouch `from: vault`, with the roots and counts unchanged — which is what a faithful migration looks like. | `apps/projector/src/vault-ledger.ts`; ontology `tbox/estate.ttl` |
| V2 | **The Durable Object stays, as what ADR-0055 says a DO is for.** A rebuild reads the vault, because anchoring a root from a cache anchors whatever the cache last held; `/status` reads the projection, because a status page that goes dark when a Home does is a worse status page and it vouches for nothing. `/mirror` replaces an estate's rows wholesale rather than merging: a row the vault does not have is stale, not a second opinion. | `worker/store-do.ts`, `worker/index.ts` |
| V3 | **The door's two tables are not the same kind of thing and only one was ever a candidate.** `replay` must stay a DO — it spends single-use ids atomically, and one-event-at-a-time is the entire reason it is one. `receipts` is the weaker case the door's own header already admitted: every decision also went back to the presenter in the response, so wiping it loses the door's copy only. Still owed, no longer urgent. | `apps/door/src/ledger-do.ts` |
| V4 | **The public vault door was write-only, which silently made the vault unable to BE the record.** A self-hosted agent could write its own records through `/mcp/native` and never read them back, so any service that rebuilds from its own records had to keep a second authoritative copy somewhere its owner does not control — exactly what ADR-0055 forbids. `get_vault_record` and `list_vault_record` now serve there too, through the same pipeline as the write: DEL-001 binding enforced, per-call invocation proof, and the grant's record scope deciding what may be read. It widens no existing credential, because a write-only grant still reads nothing and lists nothing. | ap-home `apps/vault/src/index.ts` |
| V5 | **An operator script signed four wires for a chain the estate left behind.** `CHAIN_ID` in the Home's client library falls back to Base Sepolia when `NEXT_PUBLIC_CHAIN_ID` is unset, and a delegation digest is signed over the chain id and THAT chain's DelegationManager. The wires looked right — 65 bytes, correct delegator, correct scope — and the vault refused them as `invalid_invocation_proof`, which on that door is the catch-all for any failure in the whole authority chain. The account itself was the oracle that settled it: `isValidSignature` returned `0xffffffff` and the recovered address was nobody. The script now refuses an unset chain, and the native door now logs the message and the reason the MAC door always logged. | ap-home `scripts/issue-self-host-vault-credentials.mts`, `apps/vault/src/index.ts` |
| V6 | Two estates mean two vaults at two Homes with two different interactions services, and the compiled-in one is faithnet's. A grant naming the wrong estate's service is refused at the door with nothing useful to say, so the script now refuses to default it when the Home is not this deployment's. The federation premise showing up in the plumbing. | `--interactions` |
| V7 | `wrangler secret put --name X --env Y` writes to `X-Y`, not to `X` — so two secrets landed on a worker that did not exist until they created it, and the projector went on reporting no credentials. Put secrets with `--env` alone when the env block keeps the base name. The phantom worker was deleted. | ops |
| V8 | The gate owns exactly ONE record and rewrites it, because it cannot tidy up after itself: the grant has no `delete` scope on purpose, since submissions are retired and never deleted. Earlier runs left three stray retired leaves, which the rebuild correctly drops and which stay as untidiness rather than risk. | `scripts/gate-vault-record.mts` |

## Before listing anywhere: our own card was not signed (2026-10-14)

| # | Finding | Where |
| --- | --- | --- |
| S1 | **F4's own numbers decided the order of work.** Of 29 A2A-card entries in the live index, 2 carried a signature. Ours carried none, so registering would have made us the 28th entry nobody can check, while publishing an adapter whose report says exactly that about everyone else. Spec 347 says a released card is signed; this was our gap, not the index's. | `nanda read`; spec 439 §7.15 |
| S2 | **A signature alone would not have closed it.** A JWS proves whoever holds a key signed these bytes; with a self-published key that answers "did someone sign this?" and not "whose card is this?" So three documents are served and a reader needs all three: the signed card, the public key set (a thumbprint in a `kid` is not key material), and the agent's own EIP-712 `SmartAgentCardBindingV1` over both digests and that thumbprint, validated through ERC-1271. The binding is what makes the key the agent's. | ap-town `town.faithnet.io/.well-known/*` |
| S3 | The private key never reaches the Worker: the ceremony runs offline and verifies the binding on chain before writing, and the Worker serves the release verbatim. Serving a card rebuilt per request would put a signature made for one set of bytes over whatever the manifest said that minute. Drift is reported in a header and never resolved. | `card:release` |
| S4 | **A green gate lied twice before it was right.** Its foreign-key refusal was skipped because the malformed key made the import throw, and its wrong-agent refusal was answered by a shape check before any read. Both now run: a real generated second key, and the binding restated for the other agent so the shape agrees and the CHAIN is the thing that refuses. | `gate:card-signature`, 12 checks, 4 refusals |

## The registry that is not there any more (2026-10-14)

| # | Finding | Where |
| --- | --- | --- |
| N1 | **`nanda-registry.com` does not resolve.** NXDOMAIN, confirmed against a public resolver with authority from the gTLD servers — no A record, no NS. An account created there (a Django/DRF service with JWT auth and a `servers` collection) reaches nothing today. It is not the index this adapter targets and never was. | checked 2026-10-14 |
| N2 | The live index is `api.nandaindex.org`, which is what Ring 0's `docs/standards-lock.json` pins as `nanda-index`, and its identifiers are ARD URNs over a **verified domain**, not a JWT account. Two NANDA-adjacent services with similar names, one alive; the lock is what keeps the distinction. | spec 439 §7.9 |
| N3 | Its own OpenAPI declares **no security scheme at all**, while `POST /auth/login` returns `{token}` and the write routes plainly need it. So the auth is a bearer that the document does not describe — read the routes, not the schema's `security` field. | `api.nandaindex.org/docs/json` |
| N4 | `nanda register` does the act in three steps that do not imply one another, needs a token for any of them, and reads `/api/v1/me` before any write so a stale token fails before a record is half-made. The account, the mailbox and the password stay with the operator. | `apps/nanda-adapter/src/register.ts` |

## Still owed

| What | Needs |
| --- | --- |
| the two-chain twin | a second chain |
| the DOOR's receipt copy into the registry agent's vault (the submissions landed 2026-10-14 — V1; the door's receipts are the weaker case of V3, since the presenter holds a copy) | the door writing as the receiving estate's registry agent, which is now only plumbing |
| the HOLDER's own copy of a vouch (they hold their blind and no record that the estate vouched for it) | a Home surface for it |
| F4, the NANDA adapter | NANDA's normative document digested into the standards lock |
| KMS conditions #1 and #4; the host move | the owner, on the CVM |
