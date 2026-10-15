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
| F3.9 | The impact-agent mirror of the positive half surfaced two more rules: a treasury born from the Home's birthright carries no `atl:agentType`, and the harness refuses to PAY from an account it cannot tell is a treasury (declared through maya's Home; fixed the same day: a nameless birth now declares its type in the same genesis, in the runtime's bootstrap-agent and the Home's child charter); and a standing wire's default of one redemption a day made the second payment revert on chain — right for a person's wire, said on the command line for the gate's. Both directions green. | spec 439 §7.8; ap-home `declare-agent-type-via-home.mts` |
| F3.10 | §6 step 4 shown: the identical intent repeated derives the same child and is refused at redemption on chain (`PaymentEnforcer.NonceReused`); no second payment. The gate's own repetition had tripped it first — each run is a distinct intent by its memo. | `gate-f2-door`; spec 439 §7.8 |
| F3.7 | ~~The runtime's refusal text is the spoken rendering on the A2A wire.~~ Fixed 2026-10-14: a plan refusal reaching a peer carries its written reason first. | ap-home `standard-a2a.ts` |

## The shared KMS operator, the site, the universal namespace (spec 440)

| # | Decision | Where |
| --- | --- | --- |
| K1 | One AKCS operator at the federation scale; one tenant per estate, always; shared infrastructure with an operator of record, not neutral ground, not required. Four conditions gate a new town's use (#1 shared credential and #4 attestation still open). | spec 440 §A |
| K2 | Cost evidence: one billable Key Vault root, 5.00 USD a month; 433 logical keys under it cost nothing. A tenant or a caller never creates a Key Vault key. `billableKeyBudget: 2` is a gate. | spec 440 §A7; `federation.yaml#kms` |
| S1 | The site reads each town's own surfaces live and holds no copy of anything. | spec 440 §B |
| N1 | Naming is a trust question answered per layer: CAIP-10 identity; a typed handle unique per registry; across towns the pair `{ name, chain }`, never bare; the DNS projection as a rented locator; trust as named signals. | `federated-agent-naming.md` |
| N2 | **One universal namespace rooted on faithchain, ENS v2 style**, other chains joining without a second registry (the owner's decision 2026-10-14; amends N7). `atl:accounts` (accounts by chain) and `FederatedAgentNameV1` are built; the satellite claim path and the naming root are not. | spec 440 §C; `federated-agent-naming.md` |
| N3 | **The second chain names nothing of its own (2026-10-15).** hopechain's `AgentNameRegistry` is a local table for hopenet's discovery index. `maya-fernandes.me` is on both chains, each record pointing at that chain's account (one custodian key). Both reverse lookups round-trip, both carry the same `atl:accounts`, and the first local label `maya.me` is expired. That is U2's record half across two chains. It is not U3: no gate claim from hopechain, no satellite at the home address, no custody propagation. | spec 440 §C10; `naming-primer.md` |

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
| P1 | **The predicted failure was arriving.** On the morning of 2026-10-14 impact-agent's anchor was 10.5 hours old and faithnet's 9.6, against the doors' 24-hour window: about thirteen hours from refusing every presentation at both doors. Nothing was broken; nobody had run the job. | `DEPLOYER.md` had predicted exactly this |
| P2 | The projector now runs as a Worker on a six-hourly cron, with the submissions in a Durable Object (`pnpm projector push` moved them off the operator's `.submissions/`). It prunes and rebuilds before every anchor and never re-asserts a root it did not just rebuild — a heartbeat that did would extend the life of a revoked grant. | `apps/projector/worker` |
| P3 | A scheduled job is not a submitter. Its ledger is read-only by construction: `add` and `retire` throw, because inclusion is a submission someone made (F1.1) and a cron is not someone. | `worker/index.ts` `readOnlyLedger` |
| P5 | The alarm that was missing: `gate:freshness` fails RED when any estate is within three hours of a verifier refusing it. An estate that cannot be proved is not a passing estate, so it is a failure and not a warning. | `scripts/gate-projector-freshness.mts` |
| P4 | **§4's shape reached (2026-10-14):** `signerOf` is each estate's `.registry` service agent, custodied by a person of that estate and declaring `atl:estate`. The job holds a delegate key under a wire pinned to `setRoots` and nothing else; without the wire the key reverts, and revoking it on chain stops the job without touching the agent. | `apps/projector`; ap-home `charter-service-agent.mts`, `issue-anchoring-wire.mts`, `rotate-projection-signer.mts` |
| P6 | An agent belongs to an estate, so a person of **that** estate should custody it. impact-agent's registry agent was first chartered under the estate's interactions key — a runtime secret, not a person — and was re-chartered under maya through impact-agent's own Home, with the custodian address recovered from a probe signature so her key never left it. The same error stood in `imb-estate.workspace` until R1 below. | spec 439 §7.11 |
| P7 | Rotating the signer broke the F2.5 cross-check until each estate agent's `atl:projectionSigner` was updated to match. The chain's signer and the estate's declaration have to move together, and the doors refuse while they disagree — which is the check working. | `set-projection-signer.mts`, `estate-agent-declare.mts` |

## The last misplaced custody (2026-10-14)

impact-agent's Pulse context agent, `imb-estate.workspace` (`0xc0d82cdd…`), was custodied by demo-admin — a faithnet
persona. The last instance of P6, and the one named twice above as unfixed.

| # | Finding | Where |
| --- | --- | --- |
| R1 | **Closed.** maya is now its sole custodian and demo-admin is out, in one transaction, and the agent's address never changed: a credential rotated, the identity did not (ADR-0011). It also now declares `atl:estate = imbnet.estate`, which neither faithnet context agent does. The declaration was signed by maya through impact-agent's own Home, which is the proof the rotation took: the write would have been refused if she were not a custodian. | `rotate-custodian.mts` tx `0x3ae65cd6…`; `estate-agent-declare.mts` tx `0xf43444b0…` |
| R2 | A `removeCustodian` on its own is the wrong tool: it bumps the custody epoch and leaves every standing grant keyed to the old one. The ceremony is `add → retire → approveDigest×N` in ONE transaction (spec 410 §1), and that is the shape `rotate-custodian.mts` sends — a batch, never a sequence of transactions with a window in between. | ap-home `scripts/rotate-custodian.mts` |
| R3 | **The epoch the doctrine turns on does not exist on this chain yet.** The live `AgentAccount` implementation (`0x8691bFE5…`, every account on faithchain) carries no `custodyEpoch()` and no `approveDigest(bytes32)` — generation 1, exactly as the readiness review records. So this retirement bumped nothing and invalidated nothing, and the ceremony's re-approval half is unrunnable here until the generation lands. The script reads the implementation and says so rather than reporting a clean rotation it did not perform. | `AgentAccount.sol` generation 1 vs spec 410 §1 |
| R4 | None of the three Pulse context agents declares `atl:agentType`, though all three carry a `.workspace` suffix. ADR-0061 §5 makes the on-chain record the authority and the suffix a claim, so a typed resolution of any of them fails closed today; the town agent reaches them by forward record instead, which is why nothing has broken. Backlog, and ap-town's charter path owns it. | `imb-estate.workspace`, `faith-estate.workspace`, `faith-town.workspace` |
| R5 | The impact-agent Home's apex redirects to `www`, and a redirected POST drops its `Authorization` header — so `persona-sign` answered `session required` with a valid session in hand. An operator script must address the issuer host (`https://www.impact-agent.me`), not the apex. | `estate-agent-declare.mts --home` |

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

## Paying outward (2026-10-14) — the other direction, and the rule it makes legible

§6's positive half had a visitor PAID from a resident's treasury: the money was the resident's, so her wire
authorized it. This is the reverse, and the asymmetry is the whole point.

| # | Finding | Where |
| --- | --- | --- |
| O1 | **A resident of one estate paid a treasury in the other, under her own permission, and 3 USDC moved** (alice's faithnet treasury → maya's impact-agent treasury, 75 → 78). No door, no presentation, no foreign standing: none of that machinery is involved, because nothing foreign is trusted. The permission was issued at her own home, for her own treasury, by her own custodian, and redeemed by her own harness. | `gate:pay-outward`, 8 checks |
| O2 | **THE RULE, proven rather than asserted:** the other estate's own valid, signed standing wire derives NOTHING against this payer's requirement — "the run needs an act of 0x5ef5…; this wire is 0xdd16…". Neither estate honours a spending permission issued by the other, and the refusal is a subset check on the delegator, not a policy anyone had to write. | the gate's third check |
| O3 | **Receiving needs no authority at all**, which is why this direction works today with a payee that has none of the setup a payer needs. The receiving estate checks one thing: that the money arrived. | the doctrine |
| O4 | The wire's own bounds hold in this direction too: another payee and an over-cap amount derive nothing, and the identical intent repeated is refused on chain as a reused nonce (`0x435fd071`). One intent, one payment. | the gate's last three checks |
| O5 | **CLOSED the same day — a treasury can exist, hold a balance, be registered at its owner's Home, and still not be hers.** maya's was: listed as her `person-treasury`, holding real USDC, and carrying no `ap:charteredUnder` edge. That edge on `AgentRelationship` is the ONLY basis on which "whose treasury is this?" is answered — countersigned, public, chain-reproducible — which is why "send alice 20 USDC" is routable for anyone rather than only for Alice. With none, the birthright effect reused the orphan instead of making one and her agent answered *"You have no treasury to be paying from."* She could receive forever and never spend. The edge is a COUNTERSIGNATURE, not an assertion: the subject proposes, the object confirms, either activates, and PROPOSED and CONFIRMED are not yet an answer. Now ACTIVE, and **maya paid 3 USDC from her impact-agent treasury into faithnet** (10066.09 → 10069.09) with the same eight checks green. | ap-home `charter-treasury-edge.mts` |
| O5b | So the gate now runs in **both estates and both directions**, and the rule holds each way: faithnet's wire refuses impact-agent's requirement and impact-agent's refuses faithnet's, each as a subset check on the delegator. | `gate:pay-outward` |
| O6 | Still one chain. Both treasuries are on faithchain, so the money never crosses chains. Paying from a treasury on chain A to one on chain B needs a way to move value between them, which stays open (spec 243 reserves it). | the honest limit |

## W4 — the two-chain twin (2026-10-15)

impact-agent moved to hopechain on 2026-10-14; the federation's proofs still ran on one chain. Closing that took one
real design change and seven traps, each of which failed where nothing named it.

| # | Finding | Where |
| --- | --- | --- |
| W1 | **An estate has two chains, and they are two facts.** `chainId` is where its projection anchors and its permanent id derives from (never changes); `homeChainId` is where its people, Home, custody and grants live. The register says both, with `rpcEnv` for the home chain; each town declares how the federation's Workers reach its chain and which `universalSignatureValidator` answers there. A reader that infers one from the other is wrong. | `federation.yaml`, `apps/site/src/federation.ts` |
| W2 | **The door verifies a signature on the signer's chain** — the one its CAIP-10 names — reads roots on the registry's chain, and the estate agent's declaration on the projection chain. A chain it cannot reach is refused and logged `SIGNER_CHAIN_UNREACHABLE`, never verified elsewhere. This is the one place "no verifier code" was optimistic. | `apps/door/src/index.ts` |
| W3 | **The projector reads revocation on the HOME chain.** Before this it read hopechain leaves against faithchain's DelegationManager — the same hex, a different contract — and could only ever answer "not revoked". | `apps/projector/src/revocation.ts` |
| W4 | **The twin is green in both directions across the chains**: standing admitted each way, acts refused at the authority stage, the host-side payment lands on hopechain under a wire issued there (5 USDC, visitor's payee treasury on hopechain), the duplicate refused on chain. The summary line names the chains. | `pnpm gate:twin` |
| W5 | **The estate's runtime could never send a transaction on any chain**: its KMS caller (`imb-runtime-3`) refused signing purpose `EIP155_TRANSACTION`, surfacing as viem's "unknown error" on `handleOps`. `imb-runtime-4` names the purpose explicitly beside the `estate-runtime` profile; the old caller is disabled. The estate's gateway token was also read-only (`writeRps: 0`) — two independent "cannot write" causes, found in that order. | ap-home `estates/impact-agent.estate.json`; hopenet gateway KV |
| W6 | **The twin crosses GENERATIONS as well as chains.** hopechain was deployed from the current scripts (contract generation 3), so its DigestBindingEnforcer takes `(digest, stepNonce)`; the runtime said generation 1 and every redemption died with `BadArgsLength`. `CONTRACTS_GENERATION = "3"` on that env, and the manifest and gateway now say 3. A second chain stood up later than the first runs newer contracts; nothing checked that the estate's declared generation matched the chain's deployment record. | ap-home `apps/agent-runtime/wrangler.toml`; ap-town `towns/hopenet/town.yaml` |
| W7 | **Wires are chain-bound and do not move.** Every standing wire from before the move named faithchain enforcers and treasuries; on hopechain they derived children that could not redeem. Re-issued on hopechain by their owners with that chain's enforcers (`issue-visitor-standing-wire --deployment-file`), after a treasury for maya and one for the visitor's payee were chartered there (`charter-service-agent` now takes the chain's factory). | `.secrets/*-impact-agent.json` |
| W8 | **Outward across chains is refused, but not yet for the right reason.** The gate reads the payer's chain from the register and expects a refusal that names the counterparty when the payee's chain differs; today maya's harness stops earlier — "you have no treasury to be paying from". The `ap:charteredUnder` edge was written on hopechain (`charter-treasury-edge.mts`, ACTIVE) and the answer did not change: the harness resolves "my treasury" from the person's OWN vault record (ADR-0025 — a related agent is a private credential, never a public edge), which only the Home's birthright ceremony writes. That ceremony cannot run at impact-agent today: its playbook step calls the skills commons (`skills-a2a-production`), which accepts the faithnet.me issuer and origins only (`SESSION_ISS_DOMAIN`, `ALLOWED_ORIGINS` in `~/skills/apps/skills-a2a/wrangler.toml`) — the commons is single-estate. Nothing moved, which is correct, and the gate stays RED until the refusal is about the payee. | `pnpm gate:pay-outward` |
| W9 | **The estate's registry agent and its vault credential moved on 2026-10-15; its anchoring did not.** `gate:vault-record` had refused `invalid_invocation_proof` for impact-agent: the projector's credential was a leaf under the faithchain registry agent while the vault validated on hopechain. A registry agent was chartered on the home chain (`0x4eB7D9e5…`, by maya), its vault key bound, the credential re-issued (`.secrets/vault-secret-impact-agent.json`; the faithchain-era file kept beside it), and the store re-anchored at sequence 7 with 3 live leaves. `gate:vault-record` is GREEN for both estates. The neutral-ground signer is unchanged (the faithchain agent, under the anchoring wire): an estate id derives from its projection chain, and rotating the signer is the owner's ceremony, not a consequence of the move. | `gate:vault-record`, `gate:freshness` |
| W10 | **A Home claims where its agent lives, and the root called the name free.** The owner signed in at impact-agent.me (social login, per-chain record — ap-home `27e61fee`) and claimed `rich-impact.me`: born on hopechain (`0x5bBd…B957`, reverse round-trips), absent on faithchain, and names.faithnet.io said "available". Spec 440 C10 had written "hopechain issues no names" — true of sales, false of claims: an estate's Home writes into its own chain's registry, and nothing carries that claim to the root (U3). Three answers, none of them U3: hopenet gets a read-only naming service over its local table (ap-town `6f61aea`, deploys after the contracts release that carries `deployments-hopechain.json`), the register lists it so the resolver asks it, and the root's name page asks the resolver before calling a name free and refuses to register one claimed elsewhere (ap-town `9f39932`). The root record is still unwritten; that is U3's. | names.faithnet.io `/name/rich-impact.me` after names.hopenet.town is live |

## The company's door — PAP, ACP, UCP, TAP (spec 443, 2026-10-15; designed, nothing built)

| # | Decision / finding | Where |
| --- | --- | --- |
| P1 | **The person is never the client.** PAP's `client_id` names the agent software, so at every company the client is the estate's `pap.svc` (one service-scoped `ClientKeyBindingV1`, one JWKS, one key directory) and the person is only a pairwise `sub` derived from a vault secret. A per-person client metadata document would publish the label and estate to every company and is refused by gate. | spec 442 §7.1; spec 443 §0 |
| P2 | **Approval is the mandate signature; `approved_by` is a claim.** Outbound, `user` comes only from the parked act's signature and `standing_permission` only from a covering 397 §11 wire. Inbound, a foreign agent's `approved_by` is recorded and the act parks for the owner's mandate. We propose a `proof` on confirm (`identity`: ERC-1271 JWS; `standing`: a blinded presentation against the estate root) to close PAP Operations §8. | spec 442 §5, §7.2 |
| P3 | **A `listing: none` company serves no `poppy.json`.** Its door profile travels inside the connect invitation's publication; PAP "registration" is an accepted invitation; the door admits only a presented resolution grant and answers everyone else with a uniform `invalid_client`. | spec 442 §7.3; spec 443 §1.2 |
| P4 | **Finding: the federation door leaks the visitor.** `GET /federation/challenge?subject=0x…` carries the Smart Agent in a query string, and `GET /federation/receipts` serves full `AdmissionReceipt`s to the world (the site shows 25). Fix in 443 W0: subject in the POST body; the public list becomes counts + decision codes + an HMAC `subjectDigest`; the full receipt only to the presenter and the receiving estate's registry agent's vault. | `apps/door/src/index.ts`, `challenge.ts`, `ledger-do.ts`; `apps/site` |
| P5 | Mediated Sign-In (password relay) is refused by default; Direct and Device Sign-In are Home ceremonies. | spec 442 §8 |

## zkID / OpenAC at the door and on neutral ground — BUILT (2026-10-15, wave Z4 of the Ring 0 program)

**What runs.** `credentials:` + `doors[impact-agent].credentialProofs` in `federation.yaml` (validated by `check:federation`;
on the site as a Credentials tab + `/api/credentials`); the projector's **issuer mode** (`--issuer <id>`: status · register ·
submit · retire · project · `present-status`; set `live-credential`; revocation = retire + re-anchor); the door's **`predicate`
grade** (`x-ap-credential-presentation` → the door's OWN proof request from its policy + its challenge → Ring 0's
`binding-credential-presentation` evaluator → a verdict from the **Node verifier Container** beside the Worker → the
nullifier consumed in the door's ledger DO → receipt + `x-ap-credential-predicate` on the forward); the verifier
(`apps/door/verifier`: facet resolved by keyId among the register's documents and RE-VERIFIED on the issuer's chain — SA
signature through the validator, live attestation of type `issuer-key-facet` — then the proof, then the issuer row read from
neutral ground); the ceremony (`setup-predicate-issuer.mts`) and the gate (`gate-predicate-visitor.mts`, nightly row
`predicate-visitor`). Measured locally against the real chain: Prepare+Show 25 s on the holder's side, verify 7 s, verifier RSS
993 MB after one verification; a revoked credential's old status → `status_not_live`; another audience → `nonce_or_audience_mismatch`.

**Found on the way.**
- *The visitor is nameless, not actor-less.* Ring 0's admission invariants want a CAIP-10 actor and a principal-signed proof
  behind any cited entitlement (ADR-0010/0041). A credential reference is an entitlement ref, so the knock IS signed — by a
  **pairwise EOA** derived from the holder secret and the door's origin (`pairwiseHandle`). What the door and its receipt
  hold is that handle, the facet, the predicate digest, the nullifier grade and the status sequence; her person agent
  appears nowhere, and the gate asserts it.
- *An issuer row can masquerade as an estate.* Same registry, same id function, and `liveGrantRoot` holds the credential
  root: a credential leaf submitted with a `--subject` would verify as that subject's "live grant" in a row that is no
  estate, and F2.5 only says `SIGNER_UNKNOWN_ESTATE`. The door now reads `charterHash`, treats `ISSUER_ROW_TAG` as never
  anchored and refuses by name (`FOREIGN_ESTATE_ROW_IS_AN_ISSUER_ROW`). Ring 0's `verifyAuthorityPresentation` already refused a
  `live-credential` SET; the row-level confusion was the door's to close.
- *The nullifier store is the door's, never the verifier's.* The verifier holds no state (it is one Container per door and
  must stay replaceable), so it answers the verdict and the ledger DO does the atomic insert — a reused one flips a valid
  verdict to `nullifier_reused` after the fact, and a verdict that was not valid consumes nothing (unit-tested).
- *The device key must be in `cnf`.* openac-sdk's test issuer takes `deviceKey` as a full `EcdsaPublicKey` (`kty`, `crv`, `x`, `y`);
  `{x, y}` alone silently issues a credential with no holder binding, and Prepare refuses it later with `INVALID_JWT`. The first
  issued pair had to be retired and re-issued (sequences 1–2 of the issuer row are that mistake, kept, with the reason).
- *A Container's `basic` instance is too small.* 350 MB at idle, 993 MB after one verification: `standard` (4 GiB).
- *Ring 0 type drift, one line:* Z3 widened `ProjectionSet` and `verifyAuthorityPresentation`'s ok-verdict type leaked it, which
  admission's `foreignEstateEvaluator` refuses at the type level — narrowed in Ring 0 (changeset) rather than cast here.
- *The reference issuer is the estate's registry agent*, not a `.svc`: the one non-person SA with a headless custodian and an
  anchoring wire that already covers `setRoots` for any row it signs for. A production issuer is a dedicated service agent.

**Blocked on.** The Ring 0 release that carries Z1–Z3 (`privacy-credentials` with the OpenAC suite, `estate-projection`'s issuer
row, `admission`'s evaluator) and the brand-new leaf `@agenticprimitives/privacy-credentials-openac`, which **trusted publishing
cannot create** (E404 on first publish — the known bootstrap step: `npm login`, `scripts/publish-manual.sh --publish`, then
`03-configure-trusted-publishing.sh privacy-credentials-openac`). Until it lands this repo's pins stay at the published
versions and the door is not redeployed; the typecheck and the unit tests here ran against the Ring 0 builds.

### The analysis that preceded it (kept as written)

Ring 0 doc of record: `agenticprimitives/docs/architecture/zkid-and-verifiable-credentials-alignment.md`
(Coin Center's seven principles scored; OpenAC's `Deployment policy` layer = our authority plane; **delegated
presentation** — the credential's device key signs only under a person→runtime wire). What it asks of this repo,
none built (wave Z4):

| # | Addition | Shape |
| --- | --- | --- |
| K1 | **Issuer-key facets as published surfaces.** An issuing estate lists its spec-304 facets under `issuers:` in `federation.yaml` and on the site, read from the chain; a verifier in another town resolves `kid` → facet → SA → attestation without asking the issuer (no phone-home). A `listing: none` issuer publishes none. | `federation.yaml`, `apps/site` |
| K2 | **Revocation roots on neutral ground** beside the authority roots — same `EstateProjectionRegistry`, same projector cadence, same freshness rule (stale = refuse). The holder proves non-membership; the verifier reads the root. | `apps/projector` |
| K3 | **The door accepts an OpenAC bundle as evidence**: `admission` sibling `binding-credential-presentation` contributes `{issuerFacet, predicateDigest, nullifier, fresh}`, never authority; `pap-door` is an OpenAC verifier (challenge audience = door origin + operation id) and offers the `predicate` proof grade beside `identity`/`standing`. | `apps/door`, spec 443 `pap-door` |
| K4 | `gate:predicate-visitor` — a nameless person proves "over 21" at another estate's door; no address anywhere on the wire; the receipt names the mandate digest. | gates |
| K5 | **Verifier only, never prover** (spec 443 decision 7, W5). `openac-sdk` is TypeScript over a Rust/Circom→WASM core (~126 MB proving keys; `present()` takes a raw device key). A door here bundles verifying keys + the `Show` verifier behind Ring 0's `ProvingBackendPort`, adds issuer trust from the chain / audience binding / replay, and records `expressionResult` as evidence. `federation.yaml` gains `credentialProofs:` + `issuers:`; a company door lists its `proofGrades`. | spec 443 §0.7, §1.2, §2, §5 W5 |

## Still owed

| What | Needs |
| the two door fixes in P4 (subject out of the query string; minimized public receipts) | 443 W0 — no Ring 0 dependency |
| `pap.svc` per estate, `personal-agent-client`, `pap-door`, the Protocols card, `gate:pap-twin` / `gate:nameless-visitor` / `gate:private-company` | Ring 0 spec 442 W1–W3 |
| --- | --- |
| the outward refusal for the right reason (W8) | maya's hopechain treasury recorded as hers in her vault — the Home's birthright ceremony run at impact-agent, which first needs the skills commons (`skills-a2a`) to admit a second estate's issuer and origin (a change in `~/skills`, the other developer's tree today); then the harness's own counterparty check does the refusing |
| a check that an estate's declared contract generation matches its chain's deployment record (W6) | ap-town `check:town` compares `chain.generation` with the pinned contracts release's `deployments-<chain>.json` since 2026-10-15 (hopechain's record ships in the release after 1.0.0-alpha.35 — Ring 0 `847bfad21`); still owed in `ap doctor` / `check:estate-shape` for the ESTATE's declared `CONTRACTS_GENERATION` |
| the DOOR's receipt copy into the registry agent's vault (the submissions landed 2026-10-14 — V1; the door's receipts are the weaker case of V3, since the presenter holds a copy) | the door writing as the receiving estate's registry agent, which is now only plumbing |
| the HOLDER's own copy of a vouch (they hold their blind and no record that the estate vouched for it) | a Home surface for it |
| U3 — a claim made on a town's chain lands on the root (W10): the resident's root-chain account owns the record, the estate's gate signs the ticket, `atl:accounts` links the two accounts | impact-agent's gate named on the root; the Home claiming on the root chain through its gate rather than on its own chain |
| F4, the NANDA adapter | NANDA's normative document digested into the standards lock |
| KMS conditions #1 and #4; the host move | the owner, on the CVM |
