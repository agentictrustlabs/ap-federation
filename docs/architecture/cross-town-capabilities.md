# Cross-town capabilities — what one town can do with another

**Status:** 2026-10-14. This is the working set. It decides nothing: the charter is Ring 0 spec 439, the naming
waves are [spec 440 §C9](../../specs/440-shared-kms-federation-site-and-universal-naming.md), and the two walks are
[`cross-chain-authority.md`](cross-chain-authority.md) and [`naming-service.md`](naming-service.md).

**The one sentence.** A town can see another town, resolve a name in it, and prove that an account holds a live
grant there. Whether that account may act is always the receiving town's own decision.

These are federation outcomes. They grant nothing (ADR-0056). An advertised capability — the thing an agent puts on
its card — still comes from that agent's own capability model. This list is what the federation is building so those
capabilities can be *used* across a town boundary.

Status words are the ones in [`README.md`](README.md): **live** · **designed** · **proposed** · **open**, plus
**blocked** when a named precondition is missing.

---

## The set

### See

| Outcome | What it is | Status |
| --- | --- | --- |
| List the towns | chain, estates, services, live probes, on https://ap-federation.faithnet.io | **live** — `gate-federation-site` |
| See neutral ground | registry address, which estates project, whether each signer is declared on its own chain | **live** — same gate |
| See the shared KMS operator | host, tenants, callers, the four conditions, the billable-key budget | **live** as a record; attestation **open** (spec 440 A5) |

The site is public, read-only, and keyless. It fetches each town's own surfaces. It holds no copy of a town
manifest and no record of a person.

### Name

| Outcome | What it is | Status |
| --- | --- | --- |
| Resolve a label across every live town | one API, each row `{ name, chain }` plus the CAIP-10 account, never shown bare | **live** (U1) — over https://names.faithnet.io |
| Carry the pair in the naming package | `FederatedAgentNameV1` and `atl:accounts` (one account id per chain) | **live** (U2, 2026-10-14); per-chain reverse claim **blocked** on a second chain |
| Issue a name from an estate on another chain | that estate's gate named on the root; the resident owns the name on the root chain | **designed** (U3) |
| Resolve that name where the root chain cannot be read | a naming root on neutral ground; proof or empty | **proposed** (U4) |
| Admit a new estate's gate by quorum | town clerks, a receipt, not one persona's key | **open** (U5) |
| Be found by an ANS, AID, or HCS-14 resolver | `_agent` TXT and the well-known paths, each a projection of the signed profile | **proposed** — naming doc §7 item c |

### Prove standing

| Outcome | What it is | Status |
| --- | --- | --- |
| Anchor an estate's live-grant and membership roots | Merkle roots on `EstateProjectionRegistry`, monotonic sequence | **live** for impact-agent (F1) — `gate-f1-projection` |
| Prove one leaf to a counterparty | the counterparty reads the root itself; a stale sequence is a refusal | **live** (F1 verify, F2 admit) |
| Cross-check who registered the estate | `signerOf` on neutral ground against `atl:projectionSigner` on the estate's chain | **live** as a check; impact-agent's declaration is still **open** (`declaredOnChain: false`) |
| Project faithnet | the same anchor, once faithnet has an estate agent | **blocked** — `federation.yaml` faithnet row |

### Be admitted, then act

| Outcome | What it is | Status |
| --- | --- | --- |
| Knock | a challenge, a principal-signed request proof, a presentation | **live** (F2) — https://door.ap-federation.faithnet.io |
| Receive an admission receipt | hash-chained, by reference, naming the account and the boundary | **live**; the durable copy in the two vaults is **designed** (ADR-0055) |
| Have the admitted call forwarded | headers carry the standing; the estate's A2A door receives the bytes | **live** as a forward; the estate runtime **ignores the headers today** |
| Run the act | under a mandate the receiving estate's own principal signed, checked per step | the estate's runtime, unchanged by this repository |
| Take the same stage on the estate's own edge | the reference door retires into ap-home's edge | **designed** — `DEPLOYER.md` |
| Run the two-chain twin, with its negative twin | the same proofs on a second chain, and the same refusals | **designed** — spec 439; no second chain |

### Speak a protocol the field already speaks

| Outcome | What it is | Status |
| --- | --- | --- |
| A2A over HTTPS | the normative external profile; the door forwards A2A | **live** as the door's forward |
| NANDA adapter | participation, earned by conformance, with a foreign grant that has no mapping refused in words | **proposed** (spec 439 F4) |
| ERC-8004 and ARD/ACP projections | a chain-side registry target and a discovery record, each with a back-link to the account | **proposed** — reuse of what Ring 0 already pins |

MCP stays inside an estate. It is not a cross-town surface.

### Shared infrastructure these depend on

The KMS operator (spec 440 §A) is how an estate's naming gate and its session keys are held when the estate opts
in: one tenant per estate, CVM wrapping, a named operator. It is not neutral ground — someone can pause it — and a
town may bring its own. Joining it does not join faithnet's trust domain. For residents who sign in with Google,
email, or phone, the operator custodies the seed; the record says so. faithnet's shared caller credential is still
**open** (spec 407 D10) and closes before a third estate binds.

---

## The order

```
  live today
    see the towns · resolve a name · anchor impact-agent · knock and be admitted

  owner, not code
    faithnet's estate agent          →  faithnet can project
    declare atl:projectionSigner     →  the first-come-wins gap closes
    per-Worker KMS callers           →  a third estate may bind
    move the projector onto the      →  presentations stay fresh without a workstation
      estate's .registry agent

  when a second chain exists
    U3  claim a root-chain name through a satellite     (after custody propagation)
    U4  prove that name against a naming root
    the two-chain twin, refusals included
    the estate's own edge takes the door's stage

  when the field's spec is pinnable
    NANDA, then ERC-8004 / ARD — adapters that refuse a grant they cannot map
    U5  the root's governor becomes a council of town clerks
```

A translated permission does not widen along this list. Permission to deliver a message stays permission to deliver
a message. Where a foreign grant has no mapping, the adapter refuses and names the gap.

---

## Where to read next

| Question | Document |
| --- | --- |
| How the proof actually moves | [`cross-chain-authority.md`](cross-chain-authority.md) |
| How the name actually resolves | [`naming-service.md`](naming-service.md) |
| The ten principles, and where the field agrees | [`federation-principles.md`](federation-principles.md) |
| Who deploys the site, the door, and the KMS record | [`../../DEPLOYER.md`](../../DEPLOYER.md) |
