# The federation, in plain words

*Start here. Ten minutes. Everything below links to a deeper document.*

## The one problem

An agent in this system **is** an account on a blockchain. A permission is a signed grant **on that same chain**,
checked on that chain every time it is used, and revoked on that chain in one transaction. That is what makes
"may this agent do this?" an answer you can prove rather than a promise.

It also means a grant on chain A means nothing on chain B. Two towns are two chains. So how does an agent that
belongs to one town act in another?

Three tempting answers, each refused:

| Tempting | Why not |
| --- | --- |
| Bridge the grant across | whoever runs the bridge now holds everyone's authority |
| Have town B issue its own grants to town A's people | town B is now minting authority over people it does not govern |
| Accept town A's signed note saying "this grant exists" | an issuer's word is not a verifier's check |

## The answer

**Prove standing; keep authority local.**

1. Each estate publishes a **commitment** to the grants it vouches for: one hash (a Merkle root) on a piece of
   **neutral ground** nobody can administer. The grants themselves stay home.
2. A visiting agent carries **one leaf and its proof**: "I hold a live grant in estate A, as of version N."
3. The receiving side reads the root **itself**, from neutral ground, and checks the proof. That is **evidence**
   that the visitor has standing somewhere.
4. Whether the visitor may **do** anything here is still this estate's own decision, under a grant this
   estate's own person signed. The evidence changes nothing about that.

> **A presentation is evidence. It is never authority.**

Everything in this repository is a consequence of that sentence.

## The picture

```
      estate A (imbnet)                  neutral ground                    estate B (faithnet)
   ┌──────────────────────┐        ┌───────────────────────┐        ┌──────────────────────┐
   │ people's grants      │        │ EstateProjectionReg.  │        │ people's grants      │
   │ (in their own vaults)│ anchor │  imbnet   root @ seq 3│ anchor │ (in their own vaults)│
   │ projector ───────────┼───────▶│  faithnet root @ seq 1│◀───────┼─────────── projector │
   └──────────┬───────────┘        └──────────▲────────────┘        └──────────┬───────────┘
              │ "here is my leaf"              │ read the root, now              │
              ▼                                │                                 ▼
   a visiting agent ──challenge/proof──▶ the DOOR in front of B ──admitted bytes + receipt──▶ B's own door
                                        (admission = evidence)                        (authority = B's mandate)
```

## The words

| Word | Means |
| --- | --- |
| **estate** | one deployment an operator runs for its residents: a Home, a runtime, a vault, an edge. imbnet and faithnet are estates |
| **town** | the estates on one chain and what they share: naming, registry, KMS tenants, gateways. faithchain is the only town today |
| **federation** | towns on different chains, joined on public ground. Today: two estates, one chain |
| **estate agent** | the one account that *is* the estate on neutral ground: `imbnet.estate`, `faithnet.estate`. Its address is permanent, so it must be an account, never a key |
| **neutral ground** | `EstateProjectionRegistry`: a contract with no admin, no pause, no upgrade. Neutral is a property of the contract, not of the chain it sits on |
| **projection** | an estate's commitment to its live-grant set (and membership set): two Merkle roots and a sequence number |
| **leaf** | one grant in that set: the grant's hash, a random blind, and whom it is about |
| **presentation** | one leaf plus its Merkle path, bound to a challenge (nonce + audience) and a subject |
| **sequence** | the version of the projection. A verifier accepts only the anchored sequence; anything else is a refusal |
| **projector** | the job that collects leaves, prunes revoked ones against the chain, and anchors the roots |
| **door** | the receiving boundary: it verifies a presentation against the root it reads and writes a receipt. It admits; it never decides what the agent may do |
| **receipt** | the door's hash-chained record of a decision, by reference |
| **standing** | what the receipt says: "live grant in estate X at sequence N". Evidence |
| **mandate** | the receiving estate's own signed grant for the act. Authority. Only this ever lets anything run |

## Four rules the building taught us

1. **Inclusion is a submission; exclusion is the chain.** The estate holds no key that can read its people's
   grants, so a leaf enters the set only when its holder submits it. A revoked grant leaves the set whether or
   not anyone says so, because revocation is world-readable on chain. An unreadable chain drops the leaf.
2. **An estate id is permanent, so it derives from an account, never a key.** Keys rotate. Accounts do not.
3. **Freshness costs sequences.** Anchoring invalidates every presentation in flight, so an unchanged
   projection is not re-anchored, and a heartbeat runs below the shortest verifier's maximum age.
4. **Registration on neutral ground is first-come-wins, so the estate declares its signer on its own chain**
   and a verifier cross-checks both. A mismatch is a refusal.

## What is live today (2026-10-14)

| Thing | Where |
| --- | --- |
| neutral ground | `0xb4E116F5…` on faithchain |
| imbnet | `imbnet.estate`, anchored at sequence 3, signer declared |
| faithnet | `faithnet.estate`, anchored at sequence 1, signer declared |
| a door in front of each | `door.ap-federation.faithnet.io` (imbnet), `door-faithnet.ap-federation.faithnet.io` (faithnet) |
| the site | `ap-federation.faithnet.io`: towns, KMS, names, doors, neutral ground |
| the proof | `pnpm gate:twin`: each estate's standing admitted at the other's door, with the five refusals |

**What is not live:** a second chain. The estate id is chain-scoped by construction, so a second chain is one row
in the register and one door, and no verifier code. Until one exists, that is a design property, not a
demonstration, and every document here says so.

## Where to go next

- [How one crossing works, step by step](how-it-works.md): the same picture with the real artifacts.
- [Operating the federation](operating.md): the commands, the secrets, the gates.
- [Decisions and findings](decisions-and-findings.md): the ledger, with spec pointers.
- Deep dives: [principles](federation-principles.md) · [naming across towns](federated-agent-naming.md) ·
  [the standards landscape](naming-landscape-crosswalk.md).
