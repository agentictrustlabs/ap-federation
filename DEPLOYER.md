# DEPLOYER — who deploys what (spec 399 §5.5 / §10)

Two deployers must never both believe they own a live environment. This file names, per app and per
environment, which repository is the deployer of record.

## What is live (2026-10-16)

Six Workers, one container, one contract on neutral ground, and the ceremonies that put records where they belong:

| Thing | Where | Deployer / runner of record | Since |
| --- | --- | --- | --- |
| `EstateProjectionRegistry` | faithchain (34348) `0xb4E116F5C6915a4f1e649E0877e4a0A7a1c1147b` | Ring 0 `packages/contracts` (`script/DeployEstateProjectionRegistry.s.sol`); address in `deployments-faithchain.json` | 2026-10-13 |
| `apps/projector` — **projector.ap-federation.faithnet.io** | Cloudflare Worker `ap-federation-projector`, env `faithnet`, cron every 6h, DO `SubmissionStoreDO` (the serving projection; the record is each estate's and issuer's vault). Secrets: `FEDERATION_RPC_URL`, `HOPECHAIN_RPC_URL`, `OPS_TOKEN`, `AKCS_TOKEN_FAITHNET` + `AKCS_TOKEN_IMB` (key-service callers `projector-faithnet` / `projector-imb`, bound to `projector:<tenant>` keys, `key-public-key,key-sign`, `EIP155_TRANSACTION,PERSONAL_SIGN_DIGEST,RAW_32_BYTE_DIGEST`), `ANCHORING_WIRES` (per ESTATE) + `ISSUER_ANCHORING_WIRES` (per ISSUER — never the estate's wire under the estate's name), `VAULT_CREDENTIALS_<ESTATE>` and `VAULT_CREDENTIALS_ISSUER_<ID>` (the vault credential each row is read with; its `signer` is a key-service reference). **No key**: each row's anchoring key is the register's `anchorKey` (2026-10-17 — the held keys `0x9d0c…`/`0xadcd…` were retired and every wire and leaf naming them revoked on chain) | ap-federation (`pnpm projector:deploy`) | 2026-10-14; issuer rows 2026-10-16 |
| `apps/projector` CLI | an operator's machine, for submitting and presenting | ap-federation | 2026-10-13 |
| `apps/site` — **ap-federation.faithnet.io** (spec 440 §B) | Cloudflare Worker `ap-federation-site`, env `faithnet`, custom domain on `faithnet.io` | ap-federation (`pnpm site:deploy`) | 2026-10-14 |
| the shared KMS operator record (spec 440 §A) | `federation.yaml#kms` — the AKCS CVM in `RG-AKCS-PILOT-WESTUS`; code `agentictrustlabs/faithkms` | **operated**, not deployed, by the AKCS operator (one holder); recorded here | 2026-10-14 |
| `apps/door` — **door.ap-federation.faithnet.io** (spec 439 F2, the receiving door in front of impact-agent's A2A door) | Cloudflare Worker `ap-federation-door`, env `impact-agent` (envs are keyed by the RECEIVING estate; the Worker name never changed), DO `DoorLedgerDO`; secrets `FEDERATION_RPC_URL`, `DOOR_SECRET` | ap-federation (`pnpm door:deploy`) | 2026-10-14 |
| `apps/door` — **door-faithnet.ap-federation.faithnet.io** (the receiving door in front of faithnet's A2A door, target alice.me) | Cloudflare Worker `ap-federation-door-faithnet`, env `faithnet`, its own DO and `DOOR_SECRET` | ap-federation (`pnpm door:deploy`) | 2026-10-14 |
| `apps/door` — the predicate grade, the trust set and pay tickets (env `impact-agent`): `/federation/credentials` publishes the policy (`credentialProofs`: claim schema, predicates, nullifier window, `issuers` — the trust set, by id from `credentials.issuers`), `/federation/present` holds a presentation under a reference, the knock verifies it, `/federation/pay-ticket` + `/settled` sell and settle a member's dues on a predicate admission with terms per issuer (`membershipPayments.byIssuer`); receipts keep their parties `RECEIPT_FULL_RECORD_DAYS` (var, 30) then collapse | the same Worker; the policy is the register's | 2026-10-16 |
| `apps/door/verifier` — the OpenAC verifier (spec 443 W5 / Ring 0 zkID Z4), the door's `predicate` grade | a Cloudflare **Container** beside `ap-federation-door` (env `impact-agent` only): DO binding `VERIFIER`, class `VerifierContainer`, image built by wrangler from `apps/door/verifier/Dockerfile` (Node 22 + the 1k VERIFYING keys ≈280 MB from `pnpm keys:openac`, gitignored), `instance_type = standard` (RSS ≈1 GB after one verification — `basic`'s 1 GiB is not enough); secrets `VERIFIER_SECRET` (the Worker's bearer to it; the `*_RPC_URL` secrets pass through). The faithnet door has no verifier: a credential knock there is refused `CREDENTIAL_VERIFIER_UNAVAILABLE`. | ap-federation (`pnpm door:deploy`; needs Docker) | 2026-10-15 (live; `gate:predicate` green the same evening) |
| `apps/pap` — **pap.faithnet.io** (spec 443 W1, Ring 0 spec 442 §3/§9): faithnet's personal-agent SERVICE `faithnet-pap.svc` — `client.json` (OAuth client metadata), `jwks.json`, the RFC 9421 key directory, `/oauth/return` → the Home; every byte a projection of the signed `ClientKeyBindingV1` in `apps/pap/binding.json` (public; written by `scripts/bind-client-key.mts`) | Cloudflare Worker `ap-federation-pap-faithnet`, env `faithnet`; secret `PAP_CLIENT_KEY_P256` (the binding key, a local P-256 scalar; the key service holds P-256 keys, and moving this one into it is open) | ap-federation (`pnpm --filter @ap-federation/pap deploy:faithnet`) | 2026-10-16 |
| `apps/pap-door` — **ligonier-door.ap-federation.faithnet.io** (spec 443 W2): a PAP Company door in front of ligonier.svc — `poppy.json` from the company-door projection, RFC 8414 metadata, a token endpoint that admits foreign client_ids on their own documents (RFC 7523 + DPoP + jti replay), device sign-in approved by the person's agent signing the code (ERC-1271), the Operations extension where every confirm records `approved_by` as the presenter's claim and parks the act at ligonier.svc's A2A door as the door's own service agent `0xa8faCe68…` | Cloudflare Worker `ap-federation-pap-door-ligonier`, env `ligonier`, DO `PapDoorDO`; secrets `DOOR_SECRET`, `AKCS_TOKEN` (caller `pap-door-ligonier`, faithnet tenant, `pap-door:ligonier` keys only), `DOOR_SESSION_WIRE` (alice's wire: door agent → key-service key `0x2eee98d9…`, `harness.ask` at ligonier.svc, 90 days), `FEDERATION_RPC_URL`. The door agent is custodied by alice (ligonier's steward) since 2026-10-17 (tx 0xf99bf3c9…); the Worker holds no key and is not its custodian. (`ligonier.faithnet.ai` is the runtime's wildcard zone — the door lives on the ap-federation zone.) | ap-federation (`pnpm pap-door:deploy`) | 2026-10-16 |
| the predicate gate's holder records (`scripts/setup-predicate-holder-vault.mts`, once) | ALICE'S VAULT at mcp.faithnet.io, as her agent: `credential.anonymous:<digest>` ×2 · `credential.device-key:<thumbprint>` · `credential.holder-secret:predicate-visitor` · `credential.presentation-mandate:<ref>` (Ring 0 `vault-records.ts` bindings → `appc:`); written under `.secrets/vault-creds-alice.json` — her custodian's grant to the interactions service scoped to those four families + a DEL-001 leaf for the gate's runtime key (ap-home `issue-self-host-vault-credentials.mts <her agent> --by alice --delegate <runtime key>`); the gate reads them from the vault and nothing else | ap-federation | 2026-10-15 |
| the predicate gate's issuer + holder ceremony (`scripts/setup-predicate-issuer.mts`, once) | faithchain: facet attestation `0x4aee783d…` on `AttestationRegistry` (tx `0xe506b393…`); issuer row `0x07c51491…` on neutral ground (signer = faithnet's registry agent, anchored under its wire); `.secrets/predicate-*.json` (keys, two credentials, the holder's standing wire) | ap-federation | 2026-10-15 |
| **the organization as issuer** (spec 444): `credentials.issuers[imbnet-org]` | imbnet's own organization agent `0x2Ce39743…` on hopechain; its issuing key is a P-256 key in the key service's `imb` tenant (purpose `issuer-key:imbnet-org-1`); its facet `issuer-key:sd-jwt:imbnet-org-1` attested on hopechain (`scripts/publish-issuer-facet.mts`); its row on neutral ground is signed by the estate's faithchain registry agent (`rowSigner 0x432FE71e…`, anchoring under that agent's wire, because an account on hopechain cannot sign on faithchain); `ledger: vault` — the organization's `credential.issue` act writes each issuance's submission into the organization's OWN vault, and the projector reads it there (`VAULT_CREDENTIALS_ISSUER_IMBNET_ORG`; the CLI's `.secrets/vault-secret-issuer-imbnet-org.json`). Issuing itself runs in ap-home. | ap-federation (the register, the facet ceremony, the row); ap-home (the act) | 2026-10-16 |
| a member's records (`scripts/setup-member-holder.mts`, per member) | HER VAULT at her estate's Home (hannah: mcp.impact-agent.io, as her agent under `.secrets/vault-creds-hannah.json`): the credentials her organization DELIVERED there, the revoked one with its kept status, her device key — `--device akcs:<keyId>`, a P-256 key in her estate's key-service tenant (`01a14642…`, purpose `device-key:hannah-1`), the record a reference, never the scalar — her holder secret, her standing presentation wire for one door. The key-service token is per tenant: `AKCS_HOLDER_TOKEN` (faithnet), `AKCS_HOLDER_TOKEN_IMB`. | ap-federation | 2026-10-16 |
| `apps/nanda-adapter` (F4) | per town | ap-federation | — |

**The projector anchors as each estate's registry agent, on a schedule** (spec 439 §4). Since 2026-10-14
`signerOf(estateId)` on neutral ground is the estate's own `.registry` service agent — a Smart Agent custodied by a
person **of that estate** (faithnet's by demo-admin, impact-agent's by maya through its own Home), each declaring
`atl:estate`. The job holds a **delegate key** under a wire that agent signed: `setRoots` on the registry, nothing
else, time-bounded. Without the wire the key reverts; revoking it on chain stops the job without touching the agent,
its name, or anything else it may later hold. A Worker ticks every six hours: read the submissions, prune every leaf
against the chain, rebuild, anchor on change or on age.

The schedule keeps every anchor well inside the doors' twenty-four-hour window, and the keys it holds are delegates
under each registry agent's wire, never the estates' own voices.

Submissions are vault records (ADR-0055). Each estate's live-grant and membership submissions live in ITS registry
agent's vault as `federation.projection-submission:<set>:<digest>`; a vault-ledger issuer's live-credential
submissions live in the ISSUER's own vault, written by its issuing act. The Worker's Durable Object is the serving
projection, mirrored from the vault on every rebuild and never the record. The operator's `.submissions/` stays only
for a file-ledger issuer and for building a presentation.

**The key service's platform root is released only to the attested machine** (faithkms ADR-0013, Secure Key Release):
Key Vault hands the key that seals the root only to a genuine, Azure-compliant, non-debuggable SEV-SNP CVM with the
pilot VM's id. A copy of the sealed root anywhere else releases nothing. Every restart is a short boot ceremony that
opens egress to the attestation service for a minute; an operator command that unseals (`create-key`) needs that
window too.

## Shared operators (spec 440 §A2)

A shared operator is infrastructure more than one town reaches and no town owns: the KMS today. It is **recorded**
here (`federation.yaml`), it is **declared by reference** in every town's manifest, and it is **operated** by a named
role whose record on the operator's own machine is authoritative. It is not neutral ground (someone can pause it),
not a root, and not required of any town. This repository deploys nothing into it; the operator runbook
(`docs/runbooks/kms-tenant-for-an-estate.md`) is the only path that changes it.

## What this repository must never deploy

- **Any estate's Workers or Home.** Those are the estate's repository's (`ap-home` for faithnet and impact-agent;
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
