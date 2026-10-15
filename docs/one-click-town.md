# A town in one click — what it would take, from having done it by hand

Written 2026-10-14, immediately after standing up the second town (hopechain, 34349) beside the first on the
operator's existing VM. This is not a design sketch: every step below was performed, and the hard parts are the
ones that went wrong.

**The goal:** `one command` → a new Azure VM, a chain, its town services and one estate, all working. Today that
is about forty steps across five repositories, two dashboards and three credentials.

---

## 1. What a town actually is, in dependency order

The order is not a preference — each step needs the one before it:

| # | step | needs | today |
| --- | --- | --- | --- |
| 1 | a chain (Besu/QBFT) | a VM with a data disk | `~/faithchain` compose project, now parameterised |
| 2 | a public RPC hostname | a tunnel + a DNS record | `cloudflared` ingress + a proxied CNAME |
| 3 | contracts | a funded key, an RPC | `pnpm deploy:<town>` → `deployments-<town>.json` |
| 4 | an RPC gateway | the Worker, a KV, app tokens | `[env.<town>]` in `apps/chain-gateway` |
| 5 | a public graph | GraphDB credentials | a repository cloned from a sibling's config |
| 6 | **an estate** | 3, 4, and the estate's own keys | `bootstrap-estate --agents-only`, `retarget-estate` |
| 7 | the town manifest | **an estate** (the schema requires one) | `towns/<town>/town.yaml`, then `gen:town` |
| 8 | the discovery tier | the manifest (its vars are GENERATED from it) | three Worker envs |

**Steps 6–8 are one wave, not three.** `validateTown` requires `estates: a town has at least one estate`, and the
indexer's `TLDS` and `LANE_ROUTES` are generated from the manifest. A plan that puts "town services" before "the
estate moves in" cannot execute in that order.

---

## 2. What is already one command, and what is not

**Already parameterised (done this session):**
- the chain: `PROJECT_PREFIX`, `SUBNET`, `RPC_PORT`, `DATA_ROOT`, `COMPOSE_PROFILES` — defaults are the live town's
- the genesis: `VALIDATOR_COUNT` derived from the compose profile, so the two cannot disagree
- an estate's chain addresses: `townVarsFromDeployment(deployment)` — 22 vars from one file
- moving an estate between towns: `retarget-estate.mts`, 28 edits
- an estate's ten build steps, nine of them self-verifying: `estate-new.mts`

**Still hand-work, and why:**

| hand-work | why it resists automation | what would fix it |
| --- | --- | --- |
| the VM | the one genuinely new resource | a bicep module (the AKCS one is the model) |
| the DNS record | a tunnel hostname needs a proxied CNAME, and our tunnels are managed two different ways | a Cloudflare token with `Tunnel:Edit` + `DNS:Edit`, then it is an API call |
| GraphDB repository | admin credentials live only as Worker secrets | the credential in the deploy's own secret store |
| the estate's charters | **they spend authority and sign as a custodian** | nothing. A tool that charters unattended can create an agent nobody decided to create |
| the personas | a demo roster is seeded per chain | a `seed-demo-estate` that takes the roster and the chain |

---

## 3. The traps, each with the failure it causes

A one-click deployer is mostly a list of these, encoded. Every one cost real time:

1. **`DEPLOYER_ADDRESS` unset became Anvil's account** and was baked into the naming registry as its immutable
   initializer. ~18 contracts deployed; the failure arrived later as `NotInitializer(<real key>, 0xf39F…)`.
   *Now fails closed off anvil.*
2. **`foundry.toml fs_permissions` is exhaustive** — a new chain adds three paths or the deploy completes and only
   the write is refused.
3. **One subdomain level.** `rpc.<town>.<zone>` resolves and then fails the TLS handshake, because Universal SSL
   does not cover a second level. ACM is ~$10/month to serve a hostname. Use `<town>-<service>.<zone>`.
4. **Compose profiles exclude by default**, so moving the extra validators behind one means an unset
   `COMPOSE_PROFILES` starts the FIRST town with half its validators — visible nowhere except block production.
5. **The data-disk guard tested for a mountpoint**, not a disk, so a second town could not share the disk it should.
6. **A locally managed tunnel shows "No routes" in the dashboard.** Ours are one of each. Check before editing.
7. **`az vm run-command` truncates its reply FROM THE FRONT** and is SERIAL — reduce on the VM, and never probe
   while something else is running.
8. **Several contract addresses are IDENTICAL across chains** (same deployer, same nonces, fresh chain), so an
   address no longer tells you which chain you are on. Pass the chain explicitly.
9. **An estate's secrets are chain-agnostic and its service agents are not.** Re-minting the former orphans the
   estate's own vault records.

---

## 4. What belongs in ap-federation

ap-federation already holds the register, the door, the projector and the gates — the things that are true across
towns. Four additions would make a one-click town a thin script over it:

**4.1 A `towns[].bootstrap` block in `federation.yaml`.** The register already names each town's chain, RPC and
contracts. It does not say how the town is *stood up*: the VM, the data disk, the validator count, the subnet, the
tunnel. Put those there and the deployer reads one file instead of four. The register is already the thing both
estates and gates read; this makes it the thing the installer reads too.

**4.2 `scripts/new-town.mts` — a plan runner, not a script.** The estate builder's shape has earned it: ten
ordered, idempotent, **self-verifying** steps, where a step that cannot be done unattended prints the exact
command and stops. The two kinds that must stop are already known — an **operator** step (the KMS, the GraphDB
admin) and a **signer** step (anything that charters). Everything else can run.

**4.3 The derivations, in one place.** `townVarsFromDeployment` lives in ap-home today and is the reason retargeting
an estate took 28 edits. It belongs beside the register, because it is the same question the door asks: *what does
this chain call its contracts?* With it, the gateway env, the indexer env and the estate env are all one function
of `deployments-<town>.json`.

**4.4 One credential contract.** A town needs exactly five: an Azure principal, a Cloudflare token with
`Tunnel:Edit` + `DNS:Edit`, a funded deployer key, GraphDB admin, and the KMS operator. Today they live in four
`.env` files and two Worker secret stores, and two of them are **unreadable from where they are needed** (the
GraphDB admin password and the AKCS caller token are Worker secrets, which cannot be read back). Name the five in
`federation.yaml` — *where each lives, not its value* — and the deployer can check it has them before it starts
rather than failing at step six.

---

## 5. The docker-compose shape

A town's VM runs exactly two things: Besu and `cloudflared`. Everything else is Workers, Vercel and a managed
graph. So the "docker deployment" is small, and the install is mostly *elsewhere*:

```
/opt/<town>/
  .env                  PROJECT_PREFIX, SUBNET, RPC_PORT, DATA_ROOT, COMPOSE_PROFILES, FAITHNET_CHAIN_ID,
                        FAITHNET_FUNDED_ADDRESSES
  compose.yml           validators (profiled) + rpc + optional monitoring
  config/               besu toml per role
  scripts/bootstrap.sh  genesis, ownership, up
/etc/cloudflared/config.yml   one ingress rule per town, named hostnames FIRST
```

**The honest scope:** one click gets you steps 1–4 (chain, tunnel, contracts, gateway) and the *preparation* of
5–8. The estate's charters stay a human act, and should. What a one-click deployer removes is not the signing —
it is the forty undocumented steps around it, and the nine traps above.
