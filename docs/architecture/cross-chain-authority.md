# Cross-chain authority — how a grant in one estate is proved in another

**Status:** 2026-10-14. This is the walk. It decides nothing: a conflict is settled by Ring 0 spec 410 §4 and spec 439,
and by [`federation-principles.md`](federation-principles.md) P2–P6. What is built is F1 (the projector) and F2 (the
receiving door).

**The one sentence.** A delegation on chain A is not verifiable on chain B. The estate commits to its live set on
neutral ground; the other side proves one leaf against the root it reads itself; then it decides, under a mandate its
own principal signed, whether anything happens.

---

## What crosses, and what stays home

| | Stays on the estate's chain | Crosses, as evidence |
| --- | --- | --- |
| The grant | signed into that chain; revoked by one read on that chain | a leaf: subject, digest, which set |
| The commitment | the estate's own record of submissions | a Merkle root, a sequence, an anchor time |
| The act | runs in the receiving estate, under that estate's mandate | a presentation bound to one challenge and one audience |
| The name | a facet of the account (see the [naming service](naming-service.md)) | never a permission |

A presentation says: *this subject holds a live grant in estate E as of sequence N*. It does not say the subject may
do anything in the receiving estate.

---

## The walk

```
  holder or issuer                         estate's chain              neutral ground                 receiving door
  (their own session)
        │                                        │                            │                              │
        │  1. submit the leaf                    │                            │                              │
        ├───────────────────────────────────────▶│                            │                              │
        │                                        │  2. isRevoked?             │                              │
        │                                        │     drop if revoked        │                              │
        │                                        │     or unreadable          │                              │
        │                                        │                            │                              │
        │                                        │  3. anchor the root        │                              │
        │                                        ├───────────────────────────▶│  EstateProjectionRegistry    │
        │                                        │     sequence N+1           │  no admin, no pause,         │
        │                                        │                            │  no upgrade                  │
        │                                        │                            │                              │
        │  4. present one leaf + path,           │                            │  5. read the root NOW        │
        │     bound to this door's challenge     │                            │◀─────────────────────────────┤
        │────────────────────────────────────────────────────────────────────────────────────────────────────▶│
        │                                        │                            │                              │
        │                                        │                            │     6. receipt by reference  │
        │                                        │                            │     7. forward the bytes     │
        │                                        │                            │        the estate still      │
        │                                        │                            │        decides the act       │
```

1. **Inclusion is a submission.** A person's grants live in their own object. The estate holds no key that can list
   them, so a leaf enters only when its holder or issuer submits it (`apps/projector`, spec 341 §1).
2. **Exclusion is the chain.** `DelegationManager.isRevoked` is world-readable. A revoked leaf leaves the set whether
   or not anyone tells the projector. An unreadable chain drops the leaf.
3. **The anchor is a new sequence.** `setRoots` cannot refresh the timestamp without raising the sequence, so a
   verifier cannot be handed yesterday's root. The price is in `apps/projector/README.md` §3: every anchor
   invalidates presentations in flight. Anchor when the set changes, and on a heartbeat shorter than the strictest
   verifier `maxAge`.
4. **The presentation is one leaf.** Path, sequence, audience, and the nonce from the door's challenge. The audience
   is that door.
5. **The door reads the root itself.** `foreignEstateEvaluator` calls `roots(estateId)` on
   `EstateProjectionRegistry` at request time. A cached root is a refusal. A lower sequence is a refusal. A leaf
   about another subject, or answering another challenge, is a refusal.
6. **The receipt names the account and the boundary.** Hash-chained, returned by reference
   (`GET /federation/receipts/<id>` on the door).
7. **The bytes go on, the decision stays.** Admitted requests are forwarded to the estate's A2A door with
   `x-ap-foreign-standing` and `x-ap-admission-receipt`. The estate's runtime authorizes each step under its own
   mandate. The door granted nothing.

Before step 5 the door checks that the presenter signed *this* request (method, authority, path, body digest,
audience, replay id, expiry). The signature is checked through `UniversalSignatureValidator` on the presenter's
chain. The replay id is spent before that check. The acting agent is the signer, written `eip155:<chainId>:<address>`.

After a presentation is admitted, the door reads `signerOf` on neutral ground and `atl:projectionSigner` on the
estate's own chain. A declared signer that disagrees with the registered one is a refusal: public ground cannot tell
who governs an estate on another chain, so first to call `register` would otherwise own the roots. An undeclared
signer is admitted with the gap named (`FOREIGN_ESTATE_SIGNER_UNDECLARED`). impact-agent's row in `federation.yaml` still
says `declaredOnChain: false`.

---

## What is live

| Piece | Where | What a reader can check |
| --- | --- | --- |
| Neutral ground | faithchain (34348) `0xb4E116F5C6915a4f1e649E0877e4a0A7a1c1147b` | no admin, no pause, no upgrade |
| impact-agent's roots | estate id derived from `imbnet.estate` (`0x4457aadf…`) | `scripts/gate-f1-projection.mts` — a presentation verifies; one sequence later it is refused |
| The receiving door | https://door.ap-federation.faithnet.io in front of impact-agent's A2A door | `scripts/gate-f2-door.mts` — a real `harness.read` grant maya signed, anchored, admitted; stale, wrong audience, wrong subject, replay, and no proof are refused |
| The public view of the register | https://ap-federation.faithnet.io | the registry address, each projecting estate, `declaredOnChain` |

faithnet is not on neutral ground. It has no estate agent, and an estate id is permanent, so the projector refuses
to mint one. The reason is the faithnet row in `federation.yaml`.

---

## The honest limit

Both estates sit on faithchain. What F1 and F2 prove is **cross-estate on one chain**. The estate id is
`keccak256("eip155:<chainId>:<governance>")`, so an estate on a second chain registers with one config line and the
verifier's code does not move. Until that chain exists, that is a design property. It is not a demonstration.

Three further limits, each already named in `DEPLOYER.md`:

- The projector is a CLI on an operator's machine, holding the anchoring key. Spec 439 §4 says it is the estate's
  `.registry` service agent. Until that move, a stopped operator means every presentation ages out and is refused.
- The door is a reference standing in front of one estate. A production door is that estate's own edge. The estate's
  runtime may read the standing headers and today ignores them.
- Receipts live in the door's Durable Object. That is a serving copy. The record belongs in the receiving estate's
  registry-agent vault and in the presenter's own vault.

---

## Where to read next

| Question | Document |
| --- | --- |
| Why a bridge, a re-issued grant, or an issuer's assertion is refused | [`federation-principles.md`](federation-principles.md) P2, P3, P5, P6 |
| How to put an estate on neutral ground | [`../runbooks/project-an-estate.md`](../runbooks/project-an-estate.md) |
| Which cross-town outcomes this unlocks, and which are still ahead | [`cross-town-capabilities.md`](cross-town-capabilities.md) |
