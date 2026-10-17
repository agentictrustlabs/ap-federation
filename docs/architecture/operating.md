# Operating the federation

*Commands, secrets, environments, gates. Nothing here grants anything; it is how the evidence is produced and read.*

## The register

`federation.yaml` is the one source: neutral ground, the estates that project (governance, signer, chain,
declaration), the towns and their public surfaces, the shared KMS operator record, the doors and their policies
(`credentialProofs`, `membershipPayments`, `receipts`), the credential issuers (`credentials.issuers[]`), the universal
namespace.
`pnpm check:federation` refuses a register that is not fit to publish (a shared tenant, a billable key without a
payer, a root chain that is not a live town, a `workers.dev` surface a Worker cannot fetch).

## Secrets (never committed; `.secrets/` is gitignored, 0600)

| File | Holds | Used by |
| --- | --- | --- |
| `ops.env` | `FEDERATION_RPC_URL` (the chain gateway with an app token) | everything that reads or writes the chain |
| `<estate>-projection-signer.env` | the key that anchors that estate's roots | `projector project`, `register` |
| `door.env`, `door-faithnet.env` | each door's `DOOR_SECRET` (challenge tickets, grant MAC) | set on the Worker with `wrangler secret put` |
| `f2-test-agent.env`, `f2-test-wire*.json` | the gate's presenter key and its real grants per estate | the gates |
| `predicate-visitor.env` | the gate's runtime and harness keys, the presentation-evidence issuer key (`PREDICATE_EVIDENCE_ES256_KEY`, `PREDICATE_EVIDENCE_KID`), the holder's key-service token per tenant (`AKCS_HOLDER_TOKEN` for faithnet, `AKCS_HOLDER_TOKEN_IMB` for imbnet) | the predicate and member-payment gates, the holder ceremonies |
| `vault-creds-<holder>.json` | the vault credential a holder's custodian minted for the gate's runtime key (her `credential.*` records) | the gates read her records from HER vault |
| `vault-secret-<estate>.json`, `vault-secret-issuer-<id>.json` | an estate's registry agent's, or an issuer's, vault credential with its delegate key | the projector CLI (`ledger: vault`); the same JSON is the Worker secret |
| `anchoring-wire-<estate>.json` | the wire under which a delegate key anchors for the estate's registry agent | `projector project`; the Worker's `ANCHORING_WIRES` / `ISSUER_ANCHORING_WIRES` |
| `member-dues-wire-<holder>.json` | a member's standing dues wire (her treasury → the organization's treasury) | `gate:member-payment` |
| `pap-*-client-key.env` | the personal-agent service's P-256 binding key (`PAP_CLIENT_KEY_P256`) | `apps/pap`, `bind:client-key` |

Load with `set -a && . .secrets/ops.env && . .secrets/<estate>-projection-signer.env && set +a`.

## The projector

```
pnpm projector status                       # every estate: id, signer, roots, declared signer vs neutral ground
pnpm projector status --issuer <id>         # an issuer's row: id, signer (or rowSigner), roots, live credentials, facets
pnpm projector register --estate <id>       # once; binds the id to the signer permanently
pnpm projector submit --estate <id> --digest 0x… --subject 0x… --by <who>   # a holder vouches for a leaf
pnpm projector retire --estate <id> --digest 0x… --reason "…"               # the estate stops vouching
pnpm projector project --estate <id> [--dry-run]                            # prune, build, anchor if changed
pnpm projector present --estate <id> --digest 0x… --audience <door origin> --nonce 0x… --out <file>
pnpm projector verify --file <presentation.json>
```

Submissions are vault records: an estate's live in its registry agent's vault, a vault-ledger issuer's in its own
(written there by the organization's `credential.issue` act). `--issuer <id>` runs the same verbs on an issuer's
live-credential row, plus `backfill-vault` for moving a file ledger in (`apps/projector/README.md`). The operator's
`.submissions/` holds only file-ledger issuers' rows and presentations being built.

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
heartbeat that re-asserted a stale root would extend the life of a grant the chain had already revoked. The same tick
rebuilds and anchors every issuer whose register entry says `ledger: vault`. Secrets: `FEDERATION_RPC_URL`,
`HOPECHAIN_RPC_URL`, `OPS_TOKEN`, one key-service caller token per tenant (`AKCS_TOKEN_FAITHNET`, `AKCS_TOKEN_IMB`); per
estate `ANCHORING_WIRES` (a JSON map by estate id) and `VAULT_CREDENTIALS_<ESTATE>`; per issuer `ISSUER_ANCHORING_WIRES`
(by issuer id) and `VAULT_CREDENTIALS_ISSUER_<ID>`. **The Worker holds no key.** Each row's anchoring key is the key
service's, named publicly in the register (`anchorKey: {tenant, keyId}`); each vault credential names its signer the same
way. Wires are held per issuer, never under an estate's name, so an issuer's wire cannot re-anchor an estate.

**Why the cadence is two numbers.** Anchoring invalidates every presentation in flight, so a short refresh window
costs sequences and a long one lets anchors age out past a verifier's `maxAge`. Six hours against the doors'
twenty-four keeps the anchor under a quarter of the window. **A deployment that changes either number must check it
against the shortest verifier window it serves.**

## The doors

| Door | Worker | In front of | Target agent |
| --- | --- | --- | --- |
| `door.ap-federation.faithnet.io` | `ap-federation-door` (env `impact-agent`) | impact-agent | maya-fernandes.me |
| `door-faithnet.ap-federation.faithnet.io` | `ap-federation-door-faithnet` (env `faithnet`) | faithnet | alice.me |
| `ligonier-door.ap-federation.faithnet.io` | `apps/pap-door` | ligonier.svc | a PAP company door (spec 443) |

```
pnpm door:deploy                            # both; then wrangler secret put FEDERATION_RPC_URL / DOOR_SECRET per env
GET  <door>/health · /federation/receipts (counts · codes · subject digests) · /federation/receipts/<id> (full; the id is the capability)
POST <door>/federation/challenge { "subject": "0x…" }   # the subject never rides in a URL (spec 442 §7.6)
POST <door>/federation/knock                # decide, do not forward
POST <door>/a2a                             # decide, forward to the estate's A2A door with the evidence
GET  <door>/federation/credentials          # the predicate policy: claim schema, predicates, nullifier window, the trust set of issuers, their facets
POST <door>/federation/present              # hold a zero-knowledge presentation under a reference (10 min); the knock cites it in x-ap-credential-presentation
POST <door>/federation/pay-ticket           # x-ap-admission-receipt of a predicate ADMIT → a ticket for the issuer's terms (payee, asset, chain)
POST <door>/federation/pay-ticket/settled   # { reference, ticket, txHash, admissionReceipt, expiresAt } → the transfer read on that chain, once
```

**The predicate grade** (impact-agent's door): the OpenAC verifier runs in a Node container beside the Worker (the
274 MB verifying key does not fit a Worker), reached with `VERIFIER_SECRET`. The **trust set**
(`credentialProofs.issuers`) names the issuers whose facets the door accepts; a presentation under any other facet is
refused before a byte of proof is read. Receipts keep their parties for `RECEIPT_FULL_RECORD_DAYS` (30), then collapse
to kind · effect · codes · decision; the hash chain never changes. **Member payment** (`membershipPayments`, with
`byIssuer` for an organization's own terms on its own chain): a ticket only on a predicate ADMIT, bound to the
admission receipt; the terms are read from the door's own receipt at ticket time and again at settlement.

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
| F3 twin | `pnpm gate:twin` | F2 in both directions, across faithchain and hopechain | both estates' grants |
| vault record | `pnpm gate:vault-record` | each estate's submissions are read from its registry agent's vault | the vault secrets |
| pay outward | `pnpm gate:pay-outward` | paying across the boundary outward, under the payer's own wire | the payer's wire |
| predicate | `pnpm gate:predicate` | a nameless visitor proves over 18 AND a member in zero knowledge; 25 checks, 5 refusals | OpenAC proving keys, the holder's vault credential, `predicate-visitor.env` |
| member payment | `pnpm gate:member-payment` | dues paid treasury to treasury on the predicate admission; 15 checks, 4 refusals | the above + the member's dues wire |
| PAP twin | `pnpm gate:pap-twin` | a personal agent signs in at a company's door and parks an act | the pap key |
| freshness | `pnpm gate:freshness` | every projecting estate is still provable: the scheduled projector answers, its refresh window is shorter than the shortest verifier window, and no estate is within three hours of being refused | nothing |
| site | `pnpm gate:site` | the site answers from the towns' live surfaces, never a bare name | nothing |

All ten are in `live-gates.json` for the nightly. On this machine set `NODE_OPTIONS=--dns-result-order=ipv4first`. A
holder's gate runs as another member with `PREDICATE_HOLDER_VAULT_CREDS`, `PREDICATE_HOLDER_VAULT_URL`,
`PREDICATE_HOLDER`, `PREDICATE_HOLDER_CHAIN_ID` (and `PAP_HOLDER_HOME`, `PAP_HOLDER`, `MEMBER_DUES_WIRE` for the
payment). The door's nullifier window is five minutes for testing: two runs as one holder need that much apart.

## Credentials: an issuer and a member

1. **An organization issues** (spec 444): its own agent in ap-home runs `credential.issue` under its steward's mandate.
   Before that: a P-256 issuing key in the estate's key-service tenant (purpose `issuer-key:<org>-<n>`), its facet
   signed by the organization and attested on its chain (`scripts/publish-issuer-facet.mts`), the facet record in the
   organization's vault (ap-home `scripts/put-issuer-facet.mts`), a row in `credentials.issuers[]` with `ledger: vault`
   (and a `rowSigner` when the organization's chain is not the registry's), `projector register --issuer`, the
   Worker's per-issuer secrets, and the issuer added to the door's trust set.
2. **A member holds** (`scripts/setup-member-holder.mts`): her device key — the key service's P-256 key in her estate's
   tenant (`--device akcs:<keyId>`) or a local stand-in; the credentials her organization delivered into her vault;
   her holder secret; her standing `credential.present` wire for one door, one predicate program, one issuer facet.
   Everything is written as her agent and read back.
3. Settings relaxed for testing, with their production values: [`../runbooks/before-real-users.md`](../runbooks/before-real-users.md).

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
