# How one crossing works, step by step

*The primer's picture, with the real artifacts. Every step names the code that does it and the gate that proves it.*

The scenario the gates run: an agent holding a grant in **faithnet** visits **imbnet** (and the reverse). The agent
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
| 7 | **Challenge.** The visitor asks the door for a nonce for its subject. The door hands back a nonce, an expiry and an HMAC ticket. Stateless: the door recognises its own ticket later. | `GET /federation/challenge?subject=`, `apps/door/src/challenge.ts` |
| 8 | **Presentation.** The projector builds the leaf's Merkle path at the **anchored** sequence, bound to the nonce and the door's origin. | `pnpm projector present`, `makeAuthorityPresentation` |
| 9 | **Request proof.** The visitor signs the exact request: method, host, path, body digest, audience, replay id, expiry. | `x-ap-request-proof`, `@agenticprimitives/admission` `requestProofDigest` |
| 10 | **The door authenticates.** Replay id spent first, then the signature verified through `UniversalSignatureValidator` on chain (an EOA or a Smart Agent alike). A failure answers a generic 401; the precise code is logged, never returned. | `apps/door/src/index.ts` step 1 |
| 11 | **The door admits.** The admission engine runs the foreign-estate evaluator: it reads `roots(estateId)` from neutral ground **now**, verifies the path against the live-grant root, checks sequence, age, challenge and subject. | `createAdmissionEngine`, `foreignEstateEvaluator`, `verifyAuthorityPresentation` |
| 12 | **The door cross-checks the signer** (F2.5): `signerOf(estateId)` versus the estate agent's declared `atl:projectionSigner`. Equal: `FOREIGN_ESTATE_SIGNER_DECLARED`. Different: refused. Undeclared: admitted, and said. | `apps/door/src/index.ts` step 3b |
| 13 | **A receipt is written**, hash-chained, in the door's Durable Object, and returned by reference. It names the acting account, the boundary and the reason codes, and nothing else about the estate. | `apps/door/src/ledger-do.ts`, `GET /federation/receipts/<id>` |

Gate: `scripts/gate-f2-door.mts`. Proves ADMIT with `FOREIGN_ESTATE_LIVE_GRANT` and the receipt; refuses stale,
another door's challenge, another subject, a replayed proof, no proof; admits a request with no presentation as
nobody-foreign with no standing.

## Part 3 — the estate decides (F3, one chain)

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

## What is not yet shown

Spec 439 §6's second half: the visitor asks for something that needs a mandate and is refused **at the authority
stage with the missing mandate named**. Today the visitor asks a question, which needs none. The refused act needs a
presenter that is a resident with a real mandate at the receiving estate; it is the next piece.
