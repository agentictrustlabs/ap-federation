# Runbook — put an estate on neutral ground (spec 439 F1)

What this gets you: the estate publishes a commitment to its live set, and a counterparty in another estate
can prove one leaf against the root it reads itself. It grants nobody anything.

## 0. Prerequisites, and the one that bites

| | |
| --- | --- |
| neutral ground | an `EstateProjectionRegistry` on a chain both parties can read. faithchain's is `0x489E2b147C7F13fCf1c9e7A827a4D9Fd7bE2FEb9` (deployed 2026-10-13, Ring 0 `script/DeployEstateProjectionRegistry.s.sol`). |
| **the estate's own agent** | **the one that bites.** `governance` in the register must be an address that will still mean *this estate* in a year, because the estate id is `keccak256("eip155:<chainId>:<governance>")` and is permanent. That is the estate agent's SA (`<estate>.estate`), not a key — keys rotate. |
| an anchoring key | funded for gas on neutral ground. It is the estate's voice there; `rotateSigner` moves it. |
| a chain endpoint | `FEDERATION_RPC_URL`. The register names the variable, never the URL: it carries an app token. |

**If the estate has no estate agent, stop here and make one** (`ap-home scripts/add-estate-agent.mts` for the
estate's half — it needs the estate's interactions key — and Ring 0 `script/AddEstateName.s.sol` for the
name). faithnet is in exactly this position today: `faithnet.estate` is unregistered and faithnet's people
carry an empty `atl:estate`, so the projector refuses to register it rather than mint a permanent id from a
provisional address.

## 1. Write the register row

In `federation.yaml`, under `estates:`. Governance, its kind and how it was determined; the signer address
(never the key); the `DelegationManager` on the estate's chain, so submissions can be pruned; and
`rpcEnv` when the estate is not on neutral ground's chain. `governance: null` plus a `blocked:` reason is a
valid, deliberate row — it is how an estate says "not yet" without anyone guessing.

## 2. Register, once

```bash
pnpm projector status                     # read it before you write it
```

**There is no `register` step since generation 4 (Ring 0 spec 445 / REG-2).** A row on neutral ground is
`(estateId, signer)`, opened by the signer's first `setRoots` (`pnpm projector project`), so no one can open a victim
estate's row first. What makes a row THE estate's is the estate's own declaration: `atl:projectionSigner` on its agent,
written by the estate (ap-home `scripts/set-projection-signer.mts`). Verifiers read ONLY that signer's row. So
**declare the signer before you project**: an undeclared estate's anchor is not presentable at any door.

## 3. Vouch for something

A submission is the *holder's or issuer's* act, read under their own session — the estate holds no key that
can read a person's records. Today that is the operator running the read as the persona (ap-home
`/a2a/harness/ask` with a supplied plan, `access.grants.audit` — no model call); in the product it is a
press in the person's own Home. Either way what reaches the ledger is one leaf:

```bash
pnpm projector submit --estate <id> --set live-grant \
  --digest 0x<the grant's digest> --subject 0x<the DELEGATE that holds it> \
  --by "<who asked, under what>" --source "<how it was read>"
```

**`--subject` is whom the leaf is ABOUT** — the delegate for a grant, the member for a membership — because
the verifier binds it to the party in front of it. A leaf submitted for the wrong subject proves nothing
about the right one. (Worth knowing for F3: a person's *plane* wires name the estate's service agents as
delegates, so the leaf an acting agent can present about itself is a grant whose delegate IS that agent.)

## 4. Anchor

```bash
pnpm projector project --estate <id> --dry-run     # prints the decision and writes nothing
pnpm projector project --estate <id>
```

It prunes against the chain, builds both trees with Ring 0's `buildProjection`, and anchors only when the
set moved or the anchor is going stale. An unchanged, still-fresh projection is deliberately **not**
re-anchored: the sequence would invalidate every presentation in flight for nothing.

Schedule it on a heartbeat **below the shortest `maxAge` any counterparty uses** (`--refresh-after`, default
3600s), because an anchor that ages out refuses every presentation against it.

### 4a. Re-anchor once after the spec 445 package bump (v2 leaves)

Since Ring 0 spec 445 §3.8 (`@agenticprimitives/estate-projection` after alpha.16) an estate leaf **commits to its
subject**: `keccak256(digest ‖ blind ‖ subject32)`, suite `merkle-membership-v2`. The ledger stores digest, blind and
subject and never a commitment, so nothing is migrated by hand — but the same rows now build **different roots**. The
first `project` after the bump therefore sees "the set moved" and anchors at the next sequence. Do it deliberately:

```bash
pnpm projector project --estate <id> --dry-run     # expect: anchor at sequence N+1 — the roots differ from the anchored ones
pnpm projector project --estate <id>
npx tsx scripts/gate-f1-projection.mts --estate <id>
```

Until an estate has re-anchored, its anchored roots are v1 roots: a v2 presentation built from its ledger does not
verify against them (`projector present` says "the set has moved … re-anchor"), and a v1 presentation is refused by a
door unless that door was deployed with `ACCEPT_BEARER_V1` (off by default — `docs/runbooks/before-real-users.md`).
Order across the federation: **every projector re-anchors first, then every door is deployed on the new package.**
No contract changes: `EstateProjectionRegistry` stores roots only. Issuer rows (`--issuer`) are unaffected — a
`live-credential` leaf names no subject and keeps its construction, so its root does not move.

## 5. Prove it works

```bash
pnpm projector present --estate <id> --digest 0x… --audience https://<the verifier's origin>
# …the SUBJECT signs the file's challenge and attaches `subjectSignature` (below)…
pnpm projector verify  --file .submissions/presentation-….json --chain <the subject's chain id>
npx tsx scripts/gate-f1-projection.mts            # F1's gate, with its refusals
```

**A presentation is proof of possession, not a bearer value** (Ring 0 spec 445 §3.8). `present` writes the
*estate's half* — the leaf, its opening and its proof for one challenge — and that file alone is refused everywhere.
The **subject** (the account the leaf is about) signs the challenge with its own account and attaches the signature:

```ts
import { authorityPresentationTypedData } from '@agenticprimitives/estate-projection';
// chainId = the chain the SUBJECT's account lives on (its estate's `homeChainId`, else `chainId`) — declared, never defaulted
pres.subjectSignature = await subjectAccount.signTypedData(authorityPresentationTypedData(pres, { chainId }));
```

A Smart Agent signs through whatever signs for it (its key-service key, its custodian); the verifier asks the
account itself — `UniversalSignatureValidator.isValidSig` on that chain: ECDSA, ERC-1271 or ERC-6492. The projector
holds no subject's key and never signs as one.

`verify` reads the roots from the chain, not from the presentation, and needs no key; `--chain` names the chain the
subject's signature is read on (the register's `towns[]` row gives the endpoint and the validator). A VERIFIED
result says *this subject holds a live grant in this estate as of sequence N, and signed this challenge* — and
**authorizes nothing**.

## 6. Stop vouching

```bash
pnpm projector retire --estate <id> --digest 0x… --reason "<why>"
pnpm projector project --estate <id>
```

Retiring is not revoking: the grant may still be live on the estate's chain. It withdraws the estate's
*statement* about it. Rows are never deleted — a projection that stopped including something is exactly what
an auditor comes looking for. (To actually revoke, the issuer revokes on chain; the next projection drops it
without anyone telling the projector.)
