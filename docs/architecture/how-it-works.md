# How one crossing works, step by step

*The primer's picture, with the real artifacts. Every step names the code that does it and the gate that proves it.*

The scenario the gates run: an agent holding a grant in **faithnet** visits **impact-agent** (and the reverse). The agent
is the gate's test account; its grant is a real, narrow `harness.read` wire a resident signed at her Home.

## Part 1 — the estate projects (F1)

| Step | What happens | Where |
| --- | --- | --- |
| 1 | A resident grants something. alice signs a delegation to the test account: `harness.read` only, one year, through her Home's persona-sign. The signature is verified on chain before anything is written. | `scripts/setup-f2-test-grant.mts` |
| 2 | **The holder submits the leaf.** `digest` (the grant hash), a random `blind`, `subject` (whom the grant is about: the delegate). The projector never read anyone's vault; it was handed this. | `pnpm projector submit`, `apps/projector/src/ledger.ts` |
| 3 | **The projector prunes against the chain.** For every leaf, `DelegationManager.isRevoked(digest)` on the estate's chain. Revoked: dropped. Unreadable chain: dropped. | `apps/projector/src/revocation.ts` |
| 4 | **It builds the roots** over the kept leaves (live-grant set, membership set) at `anchored + 1`. | `@agenticprimitives/estate-projection` `buildProjection` |
| 5 | **It anchors**, if the roots changed or the heartbeat is due: `setRoots(estateId, liveGrantRoot, membershipRoot, charterHash, sequence)` signed by the estate's projection signer. The contract refuses a non-increasing sequence. | `apps/projector/src/anchor.ts`, `EstateProjectionRegistry` |
| 6 | **It cross-checks itself.** It reads `atl:projectionSigner` on the estate agent's own profile and compares with `signerOf(estateId)` on neutral ground. Different: it stops. Undeclared: it says so. | `readDeclaredSigner`, `pnpm projector status` |

Gate: `scripts/gate-f1-projection.mts`. Proves anchoring, monotonic sequence, a presentation verifying against the
root read from the chain; refuses a stale presentation, a wrong subject, a wrong challenge, a replayed sequence.

## Part 2 — the visitor knocks (F2)

| Step | What happens | Where |
| --- | --- | --- |
| 7 | **Challenge.** The visitor asks the door for a nonce for its subject — the subject in the POST body, never in a URL (spec 442 §7.6: a query string lands in logs, referers and caches). The door hands back a nonce, an expiry and an HMAC ticket. Stateless: the door recognises its own ticket later. | `POST /federation/challenge { subject }`, `apps/door/src/challenge.ts` |
| 8 | **Presentation.** The projector builds the leaf's Merkle path at the **anchored** sequence, bound to the nonce and the door's origin. | `pnpm projector present`, `makeAuthorityPresentation` |
| 9 | **Request proof.** The visitor signs the exact request: method, host, path, body digest, audience, replay id, expiry. | `x-ap-request-proof`, `@agenticprimitives/admission` `requestProofDigest` |
| 10 | **The door authenticates.** Replay id spent first, then the signature verified through `UniversalSignatureValidator` on chain (an EOA or a Smart Agent alike). A failure answers a generic 401; the precise code is logged, never returned. | `apps/door/src/index.ts` step 1 |
| 11 | **The door admits.** The admission engine runs the foreign-estate evaluator: it reads `roots(estateId)` from neutral ground **now**, verifies the path against the live-grant root, checks sequence, age, challenge and subject. | `createAdmissionEngine`, `foreignEstateEvaluator`, `verifyAuthorityPresentation` |
| 12 | **The door cross-checks the signer** (F2.5): `signerOf(estateId)` versus the estate agent's declared `atl:projectionSigner`. Equal: `FOREIGN_ESTATE_SIGNER_DECLARED`. Different: refused. Undeclared: admitted, and said. | `apps/door/src/index.ts` step 3b |
| 13 | **A receipt is written**, hash-chained, in the door's Durable Object, and returned by reference. It names the acting account, the boundary and the reason codes, and nothing else about the estate. The id is the capability to read it (128 random bits): the presenter has it from the response, the receiving estate from the forwarded header, nobody else. The PUBLIC face of the ledger is counts, decision codes and a per-door subject digest — no ids, no accounts (443 W0). | `apps/door/src/ledger-do.ts`, `GET /federation/receipts/<id>`, `GET /federation/receipts` |

Gate: `scripts/gate-f2-door.mts`. Proves ADMIT with `FOREIGN_ESTATE_LIVE_GRANT` and the receipt; refuses stale,
another door's challenge, another subject, a replayed proof, no proof; admits a request with no presentation as
nobody-foreign with no standing.

## Part 3 — the estate decides (F3, across two chains)

| Step | What happens | Where |
| --- | --- | --- |
| 14 | **The door forwards the admitted bytes** to the estate's A2A door with `x-ap-foreign-standing`, `x-ap-admission-receipt`, `x-ap-admission-boundary`. It strips its own headers and passes the visitor's `Authorization` through. | `apps/door/src/index.ts` step 4 |
| 15 | **The estate's own door asks who is calling**, separately. The visitor carries an `A2A-Session` caller assertion bound to the method, body, the estate's host and the moment, signed directly. This is the scheme the runtime already had for an agent asking as itself. | ap-home `standard-a2a.ts`, `sessionWirePrincipal` |
| 16 | **The runtime checks the door's word at the door.** Allow-listed boundary → fetch the receipt → it must name this caller as admitted → write `ForeignStandingEvidenceV1` on the task: estate id, set, sequence, `verified: true`. | ap-home `index.ts` `verifyDoorReceipt`, `FEDERATION_DOORS` |
| 17 | **The run is the ordinary run** any agent asking as itself gets: no mandate presented, reads bounded to what this agent's records say to that asker, an act parking as `AUTH_REQUIRED` until a steward signs. | ap-home `askAsAgent` |
| 18 | The task completes with the answer, and its metadata carries the standing **as evidence a reader weighs**, never as a grant. | the task's `metadata.foreignStanding` |

Gate: `scripts/gate-f3-twin.mts`. Runs Part 2 and Part 3 in both directions and prints its own limit: one chain.

## The refusals, which are the point

| Refused | Code | Why it matters |
| --- | --- | --- |
| presentation one sequence behind | `FOREIGN_ESTATE_STALE` | a cached acceptance is how revocation stops working |
| presentation for another door | `FOREIGN_ESTATE_CHALLENGE_MISMATCH` | a presentation cannot be lifted and replayed elsewhere |
| presentation about someone else | `FOREIGN_ESTATE_SUBJECT_MISMATCH` | standing is not transferable |
| registration not the estate's | `FOREIGN_ESTATE_SIGNER_MISMATCH` | first-come-wins is closed |
| replayed request proof | generic 401 | a captured request is spent once |
| no proof at all | generic 401 | a TLS connection authenticates no principal |
| an act with no mandate at the estate | `AUTH_REQUIRED` at the runtime | admission is not authority |

## The refused act, shown (spec 439 §6's negative twin)

The same visitor, admitted on the same standing, asks the receiving agent to **send a message** on its behalf. The
estate's own harness refuses at plan admission: *"the authority does not cover this: messaging.direct.send needs a
steward at alice.me"*. The task is `TASK_STATE_REJECTED` with the missing authority named, and its metadata still
carries the verified standing, so a steward reading it knows exactly who asked and from where. Admission said "has
standing in faithnet at sequence 1"; authority said "no mandate here". The gap between those two sentences is the
whole architecture, and `gate-f3-twin` now asserts it in both directions.

Two shapes of that refusal are accepted by the gate, because the harness has two honest answers: **parked**
(`TASK_STATE_AUTH_REQUIRED`, when a mandate could later cover the act and the requirement rides on the task) or
**rejected** (when the capability needs a steward's mandate the caller cannot derive). Either is the authority stage
speaking; neither is the door.

## The covered act, shown (spec 439 §6's positive half)

A steward of the receiving estate decided **once**: this visitor may be paid from her treasury, up to a cap, for
thirty days. That decision is a **standing wire**, the same act-as-me wire a connected client gets (spec 397 §11),
with the visitor's agent as the delegate and the visitor's own treasury as the payee, signed at her Home as the
treasury's custodian and revocable on chain like any delegation.

| Step | What happens | Where |
| --- | --- | --- |
| 19 | The visitor, admitted on its foreign standing, asks alice's agent to pay 5 USDC from `alice2.treasury` to the visitor's treasury. | `gate-f2-door` positive half |
| 20 | The harness parks the act `TASK_STATE_AUTH_REQUIRED` and says exactly what it would need: a `treasury.payment.execute` mandate of that treasury, for the runtime's executing key, bound to this intent. | ap-home `harness-run.ts` |
| 21 | **The visitor derives the child for that intent** from the standing wire (`deriveFromStanding`): a subset check on payee, asset, amount, window; a digest binding to the intent and the plan; signed with the visitor's key. | `@agenticprimitives/delegation` |
| 22 | The visitor continues **the same task**, presenting `[child, standing]` in the message's metadata. | A2A `SendMessage` with `taskId` |
| 23 | The estate's harness re-enters the run, verifies every link of the chain and the intent binding, and the step runs: *"Done — make payments: done, on chain."* 5 USDC lands in the visitor's treasury. | ap-home `resumeAsAgent`, `mandate-verifier` |
| 24 | **The duplicate (spec 439 §6 step 4):** the identical ask again. Same words, same reference, so the same intent digest and the same nonce; the run parks and the child derives as before; **the chain refuses the redemption as a reused nonce** and no second payment moves. One intent, one payment. | `PaymentEnforcer` `NonceReused` |
| 25 | **The twin:** the same wire, a payment to any other payee — not a subset, nothing derives, the run stays parked for the steward. | `gate-f2-door` |

Three rules the building enforced on the way, all correct and all recorded:

- **Never the asker.** A visitor may not name itself as the counterparty of its own act ("That would be you. Who is
  being paid?"). The payee is a separate account.
- **Money moves only between treasuries.** A bare account "has no agent type recorded on chain, so this agent cannot
  tell it is a treasury — nothing was paid". The visitor chartered a treasury on faithchain, typed on its own
  profile, and the wire names it.
- **The asset is the treasury's rail.** The ask said "SHQ"; the treasury pays USDC; the wire had to name USDC or
  derivation refused the subset. A standing wire names the asset the treasury actually pays in.
- **One intent is one payment.** The gate first repeated its own ask word for word every run and the chain refused the
  second redemption with `NonceReused`. Each run now carries a distinct memo, and the identical ask is asserted as a
  duplicate on purpose.

## Part 4 — a member proves, nameless, and pays (the predicate grade)

The second scenario the gates run: **hannah**, a member of imbnet's organization, proves at impact-agent's door that she
is over 18 and a member, without saying who she is, and pays her dues.

| Step | What happens | Where |
| --- | --- | --- |
| 1 | She asks for a credential through her own agent. Her agent checks the organization's roster, reads the PUBLIC half of her device key from her vault, and leaves `credential.request:<her>` in the organization's vault. | ap-home `credential.request` |
| 2 | The organization issues, as itself, under its steward's mandate: a credential in its facet's claim layout `[age, member]`, bound to her device key, signed by the key service's issuing key under issuance evidence. It records `credential.issued:<digest>` (no claim values), vouches by writing `federation.projection-submission:live-credential:<digest>` into its own vault, and delivers `credential.anonymous:<digest>` into hers. | ap-home `credential.issue` |
| 3 | The scheduled projector reads the organization's vault and anchors its live-credential root on neutral ground, as the estate's registry agent (`rowSigner`) under its wire. | `apps/projector/worker` |
| 4 | The door publishes what it asks: the predicate program `age ≥ 18 ∧ member ≥ 1`, the claim layout, the nullifier window, the trust set of issuers. Her agent asks for a challenge as a pairwise account derived from her holder secret and the door's origin. | `GET /federation/credentials`, `POST /federation/challenge` |
| 5 | Her agent proves. The release judges her standing `credential.present` wire against this audience, predicate and issuer facet, mints the bound evidence, and the key service's device key signs the one challenge. The issuer's status proof comes from the root anchored in step 3. | `scripts/lib/predicate-holder.mts` |
| 6 | The presentation is posted ahead (tens of kilobytes; a header holds sixteen) and held under a reference; the knock cites it. The door verifies in the container beside it, resolves the facet through the chain, checks the status against the root it reads from the registry, consumes the nullifier, admits with `CREDENTIAL_PREDICATE_HELD`. | `POST /federation/present`, `/federation/knock` |
| 7 | On that admission the door issues a pay ticket for the issuer's own terms (`membershipPayments.byIssuer`: the organization's treasury, the asset, hopechain). Her agent pays from her treasury under her standing dues wire; each payment is a child mandate her own harness verifies. | `POST /federation/pay-ticket` |
| 8 | The door reads the transfer on hopechain, settles the ticket once, and records the acceptance beside the admission. The organization learns a member over 18 paid, not which member. | `POST /federation/pay-ticket/settled` |

`pnpm gate:predicate` (25 checks, 5 refusals: a reused nullifier, a foreign venue, a revoked credential, a replayed
challenge, an issuer outside the trust set) and `pnpm gate:member-payment` (15 checks, 4 refusals: no ticket without an
admission, one settlement per ticket, a forged reference, a repeated intent) prove it, on the key service's device key.

## The two-chain twin

The scenario above and the F2/F3 crossings run across two chains: impact-agent's people, grants, treasuries and
organization live on hopechain (34349); faithnet's on faithchain (34348); neutral ground is on faithchain. A presenter
is verified on the chain its account lives on; a root is read from the registry's chain. `pnpm gate:twin` is green in
both directions.
