# Runbook — put an estate on neutral ground (spec 439 F1)

What this gets you: the estate publishes a commitment to its live set, and a counterparty in another estate
can prove one leaf against the root it reads itself. It grants nobody anything.

## 0. Prerequisites, and the one that bites

| | |
| --- | --- |
| neutral ground | an `EstateProjectionRegistry` on a chain both parties can read. faithchain's is `0xb4E116F5C6915a4f1e649E0877e4a0A7a1c1147b` (deployed 2026-10-13, Ring 0 `script/DeployEstateProjectionRegistry.s.sol`). |
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
pnpm projector register --estate <id>
```

`register` is **first-come-wins** by construction. Register early; and until F2's `atl:projectionSigner`
exists, make sure the signer is declared somewhere public and reviewed (this file's register row and the
ap-town estate row), because a verifier that trusts `signerOf` alone trusts whoever registered first.

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

## 5. Prove it works

```bash
pnpm projector present --estate <id> --digest 0x… --audience https://<the verifier's origin>
pnpm projector verify  --file .submissions/presentation-….json
npx tsx scripts/gate-f1-projection.mts            # F1's gate, with its refusals
```

`verify` reads the roots from the chain, not from the presentation, and needs no key. A VERIFIED result says
*this subject holds a live grant in this estate as of sequence N* — and **authorizes nothing**.

## 6. Stop vouching

```bash
pnpm projector retire --estate <id> --digest 0x… --reason "<why>"
pnpm projector project --estate <id>
```

Retiring is not revoking: the grant may still be live on the estate's chain. It withdraws the estate's
*statement* about it. Rows are never deleted — a projection that stopped including something is exactly what
an auditor comes looking for. (To actually revoke, the issuer revokes on chain; the next projection drops it
without anyone telling the projector.)
