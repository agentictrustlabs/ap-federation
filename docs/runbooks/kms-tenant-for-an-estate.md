# A KMS tenant for an estate — in any town (spec 440 §A)

The shared AKCS operator serves every town; an estate gets **its own tenant** (a derivation root, never shared) and
**one least-privilege caller per Worker**. This is the operator's runbook. It needs the CVM; nothing here runs from a
repository. The estate's half (adopting the tokens in its Workers) is ap-home's `new-estate.md` §4.

## 0. Before a tenant for an estate outside the first town

The four conditions in `federation.yaml#kms.conditions` must read `met` for #1 and #4, or the request is refused
and the reason is this line. Both read `met`: faithnet's callers are bound by named profile per Worker, and the CVM is
attested, with the platform root released by Azure Key Vault only to that attested, non-debuggable SEV-SNP machine
(Secure Key Release, faithkms ADR-0013). A restart therefore needs a short egress window to the attestation service
(`faithkms/infra/scripts/nat-for-attestation.sh on`, restart, `off`), and so does an operator command that unseals in
its own process (`create-key`); `bind-caller`, `apply-caller-profile` and token minting do not. `pnpm check:federation`
refuses a *new* estate row that declares `sharedCredential: true`.

## 1. Create the tenant

On the CVM (`az vm run-command invoke -g RG-AKCS-PILOT-WESTUS -n vm-akcs-pilot-0 --command-id RunShellScript`;
`set -a; . /etc/akcs/env; set +a`), as the operator:

```
akcs operator --config /etc/akcs/config.toml create-tenant --tenant-id <t> --name "<Estate> (<town>)"
```

One tenant id per estate, named for the estate. A second deployment or a service **of the same estate** is a new
caller in the same tenant, never a new tenant (faithnet-b, skills-a2a). A different estate is always a new tenant,
even on the same chain (impact-agent).

## 2. Bind one caller per Worker

Allowlists are exact-match or `*`, and `bind-caller` defaults every one to `*` — passing some flags and not others is
the trap. Operations are the Worker's own and nothing more; levels are the two CVM levels only.

```
akcs operator … bind-caller --tenant-id <t> --issuer https://akcs-pilot.faithnet.internal \
  --subject <prefix>-vault   --name "<prefix>-vault" \
  --operations data-key-generate,data-key-unwrap,mac-generate,key-create \
  --purposes "*" --audiences urn:mcp:server:person --protection-levels CVM_WRAPPED,CVM_DERIVED --signing-purposes none
akcs operator … bind-caller --tenant-id <t> --issuer https://akcs-pilot.faithnet.internal \
  --subject <prefix>-runtime --name "<prefix>-runtime" \
  --operations mac-generate \
  --purposes "*" --audiences urn:mcp:server:person --protection-levels CVM_WRAPPED,CVM_DERIVED --signing-purposes none
```

- `--purposes "*"` is correct: each person's KEK is purpose `vault-kek:<owner>`; the vault needs `key-create` to mint one.
- `--audiences` must be the MAC audience the Workers send (`MCP_AUDIENCE`, `urn:mcp:server:person`).
- `AZURE_HSM_DIRECT` is never in `--protection-levels` unless `federation.yaml` names the estate that pays for it
  (`billedTo`). A caller bound without a level cannot make a billable key — that is the point.
- A binding cannot be edited: `disable-caller --tenant-id <t> --caller-id <id>` and bind a `-2` subject.

### If the estate's person custody runs THROUGH the tenant (the faithnet shape)

The two lines above are the **local-aes** shape (impact-agent): the person's vault key is wrapped locally and the tenant is
only asked for envelopes and MACs. An estate whose person custody is OIDC-derived in the CVM needs more, and copying
impact-agent's split into it breaks every read it serves. faithnet's two, 2026-10-14:

```
--operations status,data-key-generate,data-key-unwrap,derived-signer-resolve,derived-signer-sign,\
mac-generate,mac-verify,key-create,key-read,key-public-key,key-sign \
--signing-purposes EIP712,ERC4337_USER_OPERATION,EIP7702_AUTHORIZATION,PERSONAL_SIGN_DIGEST,RAW_32_BYTE_DIGEST
```

- **`--signing-purposes none` allows nothing.** It reads like "this caller does not sign" and is right only for a
  caller that truly never signs; the runbook's template above says it because those two callers do not.
- **`RAW_32_BYTE_DIGEST` must be listed EXPLICITLY.** It is disabled by default and a `*` does not enable it
  (faithkms `crates/akcs-auth/src/binding.rs` `check_signing_purpose`). A caller that signs a raw digest anywhere —
  faithnet's runtime does, on the playbook read — loses that path the moment it is replaced by a caller listing only
  the typed purposes, and **loses it silently**: no Worker log line, no gate failure, only
  `plannerTrace.playbookUnreadable` inside an ask reply, after which the harness asks a plausible domain question
  ("You have no treasury to be paying from"). If a narrowing breaks something, read `playbookUnreadable` FIRST.
- The exact operation set is derived from faithkms's per-route `Operation` mapping (all fourteen in
  `crates/akcs-domain/src/model.rs`) against what that Worker calls — never copied from another estate. The floor is
  per-Worker credentials and the exclusion of `key-rotate`, `key-disable` and `key-schedule-destruction`, which `*`
  wrongly grants a Worker.

## 3. Mint the caller tokens, hand them to the estate

```
akcs dev mint-token --signing-key /etc/akcs/issuer/issuer-signing-key.pem --kid akcs-pilot-1 \
  --issuer https://akcs-pilot.faithnet.internal --audience akcs-pilot --subject <prefix>-vault --ttl-secs 31536000
akcs dev mint-token … --subject <prefix>-runtime --ttl-secs 31536000
```

Hand each token to the estate's deployer out of band. The estate sets them as Worker secrets
(`scripts/adopt-akcs.sh` in ap-home: `A2A_KMS_BACKEND=agentic-kms`, `AKCS_TENANT_ID`,
`AKCS_ACCEPTED_PROTECTION_LEVELS=CVM_WRAPPED,CVM_DERIVED`, the two `AKCS_TOKEN`s). No token is ever written to a
repository, this one included.

## 4. Record it

In `federation.yaml#kms.tenants[]`: the tenant, the estate, the town, each caller with its subject, Worker,
operations and levels, and the date. In the town's `town.yaml`: the estate row's `kms: { tenant: <t>, backend: akcs }`
and the town's `kms` service row referencing the federation record. `pnpm check:federation` must be green.

## 5. The operator may never

Read a key, export a seed, bind a caller with `*` operations, bind a tenant to two estates, or put an estate's token
anywhere but in that estate's hands. The CVM's record is authoritative; `federation.yaml` is the public mirror and
says where it is incomplete (`callers: null`).
