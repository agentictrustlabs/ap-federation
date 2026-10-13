# DEPLOYER — who deploys what (spec 399 §5.5 / §10)

Two deployers must never both believe they own a live environment. This file names, per app and per
environment, which repository is the deployer of record.

## What is live (F1, 2026-10-13)

No Worker and no hosted environment yet. What exists is a contract on neutral ground and a job an operator
runs against it:

| Thing | Where | Deployer / runner of record | Since |
| --- | --- | --- | --- |
| `EstateProjectionRegistry` | faithchain (34348) `0xb4E116F5C6915a4f1e649E0877e4a0A7a1c1147b` | Ring 0 `packages/contracts` (`script/DeployEstateProjectionRegistry.s.sol`); address in `deployments-faithchain.json` | 2026-10-13 |
| `apps/projector` | **an operator's machine**, over `FEDERATION_RPC_URL` | ap-federation | 2026-10-13 |
| `apps/site` — **ap-federation.faithnet.io** (spec 440 §B) | Cloudflare Worker `ap-federation-site`, env `faithnet`, custom domain on `faithnet.io` | ap-federation (`pnpm site:deploy`) | 2026-10-14 |
| the shared KMS operator record (spec 440 §A) | `federation.yaml#kms` — the AKCS CVM in `RG-AKCS-PILOT-WESTUS`; code `agentictrustlabs/faithkms` | **operated**, not deployed, by the AKCS operator (one holder); recorded here | 2026-10-14 |
| `apps/door` — **door.ap-federation.faithnet.io** (spec 439 F2, the receiving door in front of imbnet's A2A door) | Cloudflare Worker `ap-federation-door`, env `imbnet` (envs are keyed by the RECEIVING estate; the Worker name never changed), DO `DoorLedgerDO`; secrets `FEDERATION_RPC_URL`, `DOOR_SECRET` | ap-federation (`pnpm door:deploy`) | 2026-10-14 |
| `apps/door` — **door-faithnet.ap-federation.faithnet.io** (the receiving door in front of faithnet's A2A door, target alice.me) | Cloudflare Worker `ap-federation-door-faithnet`, env `faithnet`, its own DO and `DOOR_SECRET` | ap-federation (`pnpm door:deploy`) | 2026-10-14 |
| `apps/nanda-adapter` (F4) | per town | ap-federation | — |

**The projector is not yet the estate's `.registry` service agent, and spec 439 §4 says it must be.** Today
it is a CLI holding the estate's anchoring key on a workstation, which is honest for F1 and is exactly the
shape to retire: a key that anchors an estate's roots belongs with that estate's other secrets, and the job
belongs on a schedule that keeps the anchor fresh (see `apps/projector/README.md` on why freshness costs
sequences). Until then, if the operator stops running it, every presentation against that estate ages out
and is refused — the failure direction is closed, but it is still a failure.

Submissions and openings live in `.submissions/` (gitignored, 0600) on that same machine. Also the wrong
place and said so in the code: the estate's copy belongs in the registry agent's vault and the holder's in
the holder's (ADR-0055). It is a port, so moving it is a binding change.

## Shared operators (spec 440 §A2)

A shared operator is infrastructure more than one town reaches and no town owns: the KMS today. It is **recorded**
here (`federation.yaml`), it is **declared by reference** in every town's manifest, and it is **operated** by a named
role whose record on the operator's own machine is authoritative. It is not neutral ground (someone can pause it),
not a root, and not required of any town. This repository deploys nothing into it; the operator runbook
(`docs/runbooks/kms-tenant-for-an-estate.md`) is the only path that changes it.

## What this repository must never deploy

- **Any estate's Workers or Home.** Those are the estate's repository's (`ap-home` for faithnet and imbnet;
  its `DEPLOYER.md` is the record). A federation job reaches an estate over its PUBLIC surfaces — the A2A
  door, the registry, the public KB — and never by deploying into it.
- **Any town service.** The registry, naming, public graph, discovery and chain gateway deploy from `ap-town`.

The lesson that rule is written from: on 2026-10-13 three Ring-0-era copies of faithnet's Workers still
carried `[env.faithnet]` in a sibling repository, so a deploy from either tree landed on the same live
Worker — and a stale `EXECUTORS` var went back into production that way. **One deployer per environment. If a
Worker name appears in two repositories, one of them is wrong.**

## The door is a reference, and says so

`apps/door` is the federation's reference receiving door: it stands in FRONT of one estate's A2A door and runs the
admission engine with the foreign-estate evaluator (spec 410 §4.2) the way the estate's own edge should. A
production door is the estate's edge (ap-home `apps/edge`), which already runs ingress admission and would gain
this stage; until it does, this Worker is where a foreign presentation reaches an admission receipt. Two honest
limits: the receipts live in the door's Durable Object (serving plane, hash-chained, returned by reference) and
belong in the receiving estate's registry agent's vault and the presenter's own (ADR-0055); and the door forwards
with evidence in headers that the estate's runtime may read and today ignores — the estate's own mandate, verified
per step, still decides whether anything runs.

## Neutral ground is not an estate

The `EstateProjectionRegistry` lives on a chain every participating town can read — **faithchain today**
(the public L2 of spec 407 D-03 when it lands). It is not any town's deployment and must not be treated as
one: a town that could redeploy the registry it proves itself against has defeated the point of proving.

What makes this instance usable as common ground is the contract, not the chain: **no admin, no pause, no
upgrade**, so the account that deployed it holds nothing over it afterwards and there is nothing to govern.
Its address is published in Ring 0's `deployments-faithchain.json` and in `federation.yaml`.

**The honest limit, which nobody may quietly drop:** it sits beside both estates that currently use it, on
the one chain we run. What F1 proves is CROSS-ESTATE. The id is chain-scoped by construction
(`keccak256("eip155:<chainId>:<governance>")`), so an estate on a second chain registers here unchanged and
not a line of verifier code moves — but until a second chain exists, that is a design property and not a
demonstration.
