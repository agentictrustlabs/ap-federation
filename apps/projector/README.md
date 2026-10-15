# apps/projector — an estate's authority, projected onto neutral ground

**Spec 439 F1** (Ring 0). The projector maintains an estate's **live-grant** and **membership** sets and
anchors their Merkle roots in `EstateProjectionRegistry` under a **monotonic sequence**. A counterparty in
another estate then proves one leaf against the root **it reads itself**.

```
                    submissions (consent)            prune (truth)
  holder / issuer ───────────────────────▶ ledger ──────────────────▶ buildProjection ──▶ setRoots
  under their own session                           isRevoked() on              (Ring 0)      │
                                                    the estate's chain                        ▼
                                                                              EstateProjectionRegistry
                                                                                 (no admin, no upgrade)
```

## The three things that shaped the design

**1. The projector is a collector, not a scraper — and that is forced, not chosen.** A person's grants live
in their own object and are read under *their own session* or a grant they issued; ap-home deleted its HMAC
bridge precisely so no estate-held secret could read a person's records (spec 341 §1). So the estate holds no
key with which to enumerate what its people have granted. **Inclusion is a submission; exclusion is the
chain** — `DelegationManager.isRevoked(digest)` is world-readable, so a revoked leaf leaves the set whether or
not anyone tells the projector. Adding requires consent; dropping requires only the truth.

**2. `register` is first-come-wins, and that is a real exposure.** Public ground cannot verify who governs an
estate on another chain, so it cannot refuse a squatter: whoever registers an estate id first controls what
that estate appears to publish. A verifier that trusts `signerOf` alone trusts whoever was first. The
mitigation is a cross-check against the estate's **own** declaration — F2 registers an `atl:projectionSigner`
predicate in Ring 0 and the estate agent writes it (reading another public chain needs an endpoint, not
trust). Until then the declaration is `federation.yaml` plus the ap-town row, both public and reviewed, and
every run prints the gap.

**3. Freshness costs sequences.** A verifier accepts a presentation only while its sequence **is** the
anchored one and the anchor is younger than that verifier's `maxAge`, and `setRoots` demands a strictly
higher sequence — so there is no way to refresh `anchoredAt` without invalidating every presentation in
flight. Hence: anchor when the set moves, re-anchor on a heartbeat below the shortest `maxAge` in use, and
never spend a sequence on an unchanged, still-fresh projection. Presentations are deliberately short-lived.

## Use

```bash
export FEDERATION_RPC_URL=…            # neutral ground (carries an app token; never in federation.yaml)
export IMPACT_AGENT_PROJECTION_SIGNER=0x…    # the estate's anchoring key, per its register row

pnpm projector status                                        # register vs chain, for every estate
pnpm projector register --estate impact-agent                      # binds the estate id to its signer — ONCE
pnpm projector submit  --estate impact-agent --set live-grant \
  --digest 0x… --subject 0x… --by "maya, under her own session" --source "…"
pnpm projector retire  --estate impact-agent --digest 0x… --reason "the holder asked for it back"
pnpm projector project --estate impact-agent [--dry-run]           # prune, build, anchor (or say why not)
pnpm projector present --estate impact-agent --digest 0x… --audience https://edge.faithnet.io
pnpm projector verify  --file .submissions/presentation-….json
```

`verify` runs the same `verifyAuthorityPresentation` the receiving edge runs in F2, against the roots read
from the chain. It is the only command that needs no key at all — **a verifier holds nothing.**

## What it will not do

- Read a person's records to find something to vouch for.
- Anchor a live-grant root it did not prune against the chain (an unreadable chain **drops** the leaf: one
  mechanism, no fallback — ADR-0013).
- Register an estate with no durable governance identity. The estate id is `keccak256("eip155:<chainId>:
  <governance>")` and is permanent; minting one from an address that can rotate is not undoable.
- Hand out authority. A presentation says *this subject holds a live grant in estate E as of sequence N*.
  Whether anything may happen is the receiving estate's own mandate, verified per step (ADR-0056/ADR-0057).

## Live state (2026-10-13)

| | |
| --- | --- |
| neutral ground | `0xb4E116F5C6915a4f1e649E0877e4a0A7a1c1147b` on faithchain (34348) |
| impact-agent | estateId `0xe96d2c36…`, governance `imbnet.estate` `0x4457aadf…`, anchored, sequence monotonic |
| faithnet | **not projectable** — it has no estate agent (`faithnet.estate` is unregistered and its people declare no `atl:estate`). See `federation.yaml`. |

`npx tsx scripts/gate-f1-projection.mts` is F1's gate, and it is green.
