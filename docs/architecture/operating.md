# Operating the federation

*Commands, secrets, environments, gates. Nothing here grants anything; it is how the evidence is produced and read.*

## The register

`federation.yaml` is the one source: neutral ground, the estates that project (governance, signer, chain,
declaration), the towns and their public surfaces, the shared KMS operator record, the doors, the universal namespace.
`pnpm check:federation` refuses a register that is not fit to publish (a shared tenant, a billable key without a
payer, a root chain that is not a live town, a `workers.dev` surface a Worker cannot fetch).

## Secrets (never committed; `.secrets/` is gitignored, 0600)

| File | Holds | Used by |
| --- | --- | --- |
| `ops.env` | `FEDERATION_RPC_URL` (the chain gateway with an app token) | everything that reads or writes the chain |
| `<estate>-projection-signer.env` | the key that anchors that estate's roots | `projector project`, `register` |
| `door.env`, `door-faithnet.env` | each door's `DOOR_SECRET` (challenge tickets, grant MAC) | set on the Worker with `wrangler secret put` |
| `f2-test-agent.env`, `f2-test-wire*.json` | the gate's presenter key and its real grants per estate | the gates |

Load with `set -a && . .secrets/ops.env && . .secrets/<estate>-projection-signer.env && set +a`.

## The projector

```
pnpm projector status                       # every estate: id, signer, roots, declared signer vs neutral ground
pnpm projector register --estate <id>       # once; binds the id to the signer permanently
pnpm projector submit --estate <id> --digest 0x… --subject 0x… --by <who>   # a holder vouches for a leaf
pnpm projector retire --estate <id> --digest 0x… --reason "…"               # the estate stops vouching
pnpm projector project --estate <id> [--dry-run]                            # prune, build, anchor if changed
pnpm projector present --estate <id> --digest 0x… --audience <door origin> --nonce 0x… --out <file>
pnpm projector verify --file <presentation.json>
```

Submissions and openings live in `.submissions/` on the operator's machine. Both belong in the estate's registry
agent's vault; the port exists and moving it is a binding change (`DEPLOYER.md`).

## The scheduled projector

```
pnpm projector:deploy                       # apps/projector → projector.ap-federation.faithnet.io
GET  <projector>/status                     # per estate: sequence, anchor age, live leaves, seconds until a verifier refuses it
POST <projector>/ops/project                # run now (ops token)
POST <projector>/ops/submit | /ops/retire   # write to the deployed store (ops token)
pnpm projector push --estate <id> --to <projector>   # move a local ledger into the deployed store
```

A tick every six hours prunes each estate's leaves against the chain, rebuilds the roots, and anchors them when they
changed **or** when the last anchor is older than six hours. It never re-anchors roots it did not just rebuild: a
heartbeat that re-asserted a stale root would extend the life of a grant the chain had already revoked. Secrets:
`FEDERATION_RPC_URL`, `PROJECTION_SIGNER_KEYS` (a JSON map estate → key), `OPS_TOKEN`.

**Why the cadence is two numbers.** Anchoring invalidates every presentation in flight, so a short refresh window
costs sequences and a long one lets anchors age out past a verifier's `maxAge`. Six hours against the doors'
twenty-four keeps the anchor under a quarter of the window. **A deployment that changes either number must check it
against the shortest verifier window it serves.**

## The doors

| Door | Worker | In front of | Target agent |
| --- | --- | --- | --- |
| `door.ap-federation.faithnet.io` | `ap-federation-door` (env `imbnet`) | imbnet | maya-fernandes.me |
| `door-faithnet.ap-federation.faithnet.io` | `ap-federation-door-faithnet` (env `faithnet`) | faithnet | alice.me |

```
pnpm door:deploy                            # both; then wrangler secret put FEDERATION_RPC_URL / DOOR_SECRET per env
GET  <door>/health · /federation/challenge?subject=0x… · /federation/receipts · /federation/receipts/<id>
POST <door>/federation/knock                # decide, do not forward
POST <door>/a2a                             # decide, forward to the estate's A2A door with the evidence
```

Environments are keyed by the **receiving** estate. Worker names and DO classes never change: a rename orphans the
ledger.

## The site

`pnpm site:deploy` → `ap-federation.faithnet.io`. Public, read-only, keyless. `/api/towns`, `/api/kms`,
`/api/names?q=`, `/api/names/<name>`, `/api/doors`, `/api/federation`. It bundles the register at build time and
fetches everything else live, so a register change needs a redeploy and a town change does not.

## §6's positive half (a visitor paid under a steward's standing wire)

1. The visitor needs a **treasury** on the receiving chain: ap-home `scripts/charter-visitor-treasury.mts` (an
   account custodied by the visitor's payee key, typed `treasury` on its profile). Its address goes in
   `.secrets/f3-visitor-payee.env` as `F3_VISITOR_TREASURY`.
2. A steward issues the **standing wire**: ap-home `scripts/issue-visitor-standing-wire.mts --by alice --treasury
   alice2.treasury --delegate <visitor agent> --payee <visitor treasury> --asset <the treasury's rail> --cap 10 --out
   .secrets/f3-standing-wire-<estate>.json`. Delegate ≠ payee, by the harness's rule; the asset is the one the
   treasury pays in.
3. `pnpm gate:door` for that estate runs the positive half when the wire file exists, and its payee twin.

## The gates

| Gate | Command | Proves | Needs |
| --- | --- | --- | --- |
| F1 projection | `npx tsx scripts/gate-f1-projection.mts` | anchor, monotonic sequence, presentation verifies against the chain, four refusals | RPC |
| F2 door | `pnpm gate:door` (`FEDERATION_ESTATE`, `FEDERATION_DOOR_URL`) | admission on evidence, receipt by reference, signer cross-check, five refusals, the estate's own door admits the visitor with verified standing on the task | RPC, the presenter's grant |
| F3 twin | `pnpm gate:twin` | F2 in both directions, on one chain | both estates' grants |
| freshness | `pnpm gate:freshness` | every projecting estate is still provable: the scheduled projector answers, its refresh window is shorter than the shortest verifier window, and no estate is within three hours of being refused | nothing |
| site | `pnpm gate:site` | the site answers from the towns' live surfaces, never a bare name | nothing |

All are in `live-gates.json` for the nightly. On this machine set `NODE_OPTIONS=--dns-result-order=ipv4first`.

## Putting a new estate on neutral ground

1. It needs an **estate agent**: an account that will still mean this estate in a year. Two shapes exist:
   runtime-custodied (ap-home `scripts/add-estate-agent.mts`, needs the estate's interactions key) or
   persona-custodied (`scripts/add-estate-agent-persona.mts`, needs a roster persona's key). Then the deployer
   registers `<estate>.estate` (Ring 0 `script/AddEstateName.s.sol`).
2. A **projection signer**: generate, fund a little gas, keep in `.secrets/`.
3. The agent **declares the signer** on its own chain (`estate-agent-declare.mts --signer …` or
   `set-projection-signer.mts`).
4. A row in `federation.yaml` and in the town's `town.yaml`; `pnpm check:federation`.
5. `pnpm projector register`, a first leaf, `pnpm projector project`.
6. A door in front of it, if it receives visitors: a new env in `apps/door/wrangler.toml`, a row in `doors:`, and
   its boundary id in the estate runtime's `FEDERATION_DOORS` allow-list.

Runbooks: [`../runbooks/project-an-estate.md`](../runbooks/project-an-estate.md),
[`../runbooks/kms-tenant-for-an-estate.md`](../runbooks/kms-tenant-for-an-estate.md).
