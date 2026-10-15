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
      estate A (impact-agent)                  neutral ground                    estate B (faithnet)
   ┌──────────────────────┐        ┌───────────────────────┐        ┌──────────────────────┐
   │ people's grants      │        │ EstateProjectionReg.  │        │ people's grants      │
   │ (in their own vaults)│ anchor │  impact-agent   root @ seq 3│ anchor │ (in their own vaults)│
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
| **estate** | one deployment an operator runs for its residents: a Home, a runtime, a vault, an edge. impact-agent and faithnet are estates |
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
| impact-agent | `imbnet.estate`, anchored at sequence 3, signer declared |
| faithnet | `faithnet.estate`, anchored at sequence 1, signer declared |
| a door in front of each | `door.ap-federation.faithnet.io` (impact-agent), `door-faithnet.ap-federation.faithnet.io` (faithnet) |
| the site | `ap-federation.faithnet.io`: towns, KMS, names, doors, neutral ground |
| kept fresh by | a projector on a six-hourly cron at `projector.ap-federation.faithnet.io` — a verifier accepts only a fresh anchored sequence, so an estate whose projector stops running stops being provable |
| the proof | `pnpm gate:twin`: in both directions, the visitor's standing admitted at the other estate's door, a question answered, an act refused at the authority stage with the missing mandate named, a payment **run under a steward's standing wire** derived by the visitor with the money landing in the visitor's treasury, and the five door refusals |

**What is not live:** a second chain. The estate id is chain-scoped by construction, so a second chain is one row
in the register and one door, and no verifier code. Until one exists, that is a design property, not a
demonstration, and every document here says so.

## A worked use case: a visiting agent is paid at faithnet

This is the scenario the gates run every night, with real accounts on faithchain. It is small on purpose: one visitor,
one resident, one payment, and the two refusals that sit beside it.

**The parties**

| Who | What they are | Where they live |
| --- | --- | --- |
| **the visitor** | an agent of the impact-agent estate (it holds a live grant there, from maya) | impact-agent, with its own treasury on faithchain |
| **alice** | a resident of faithnet; a steward of her treasury `alice2.treasury` | faithnet |
| **alice's agent** | the agent that acts for alice, behind faithnet's A2A door | faithnet's runtime |
| **the door** | the federation's receiving door in front of faithnet | `door-faithnet.ap-federation.faithnet.io` |
| **neutral ground** | the registry both estates anchor to | `EstateProjectionRegistry` on faithchain |

**Before anything crosses** (done once, by each side)

1. impact-agent's projector collects the leaf for maya's grant to the visitor, prunes it against the chain, and anchors
   impact-agent's roots on neutral ground at sequence 3.
2. alice decides, at her Home, that this visitor may be paid from her treasury: up to 10 USDC per payment, for thirty
   days, into the visitor's treasury. She signs that **standing wire** once. It is revocable on chain at any moment.

**The crossing** (every time)

| # | Interaction | What is checked | What it proves |
| --- | --- | --- | --- |
| 1 | The visitor asks the door for a **challenge** for its own account. | — | the presentation it builds next cannot be replayed elsewhere |
| 2 | The visitor builds a **presentation**: its leaf and Merkle path at impact-agent's anchored sequence, bound to the nonce and the door's origin. | — | "I hold a live grant in impact-agent as of sequence 3" |
| 3 | The visitor sends the request with a **signed request proof** and the presentation. | the door spends the replay id, verifies the signature on chain, reads impact-agent's root **from neutral ground now**, verifies the path, the sequence, the age, the challenge, the subject; cross-checks impact-agent's declared signer | **standing in impact-agent** — evidence, written to a receipt |
| 4 | The door **forwards** the request to alice's door with the receipt reference and the standing in headers. | — | the estate can see what the door saw |
| 5 | alice's door asks **who is calling**, separately: the visitor's caller assertion, signed by its own key. | verified through the universal validator; spent once | the visitor is an authenticated agent asking as itself |
| 6 | The runtime fetches the door's receipt **from the door** and records the standing on the task as evidence. | the receipt names this caller, admitted | a steward later reading the task knows who asked and from where |
| 7 | The visitor asks: *"Pay 5 USDC from alice2.treasury to my treasury."* | the harness plans the payment and finds no mandate | the task **parks**, saying exactly what it would need |
| 8 | The visitor **derives the child mandate** for that intent from alice's standing wire and continues the same task presenting the chain. | payee, asset, amount and window are a subset of the wire; the child is bound to this intent and plan | the resident's one decision covers this act and nothing wider |
| 9 | The harness verifies every link and runs the step. 5 USDC moves from alice's treasury to the visitor's. | the chain enforces the caveats at redemption | **authority stayed at faithnet**, with alice, the whole time |

**The three refusals beside it** (also run every time)

- The visitor repeats **the identical ask**. Same intent, same nonce: the chain refuses the second redemption as a
  reuse. One intent is one payment, whatever the visitor sends twice.

- The visitor asks alice's agent to **send a message** on its behalf. No wire covers that. The harness refuses at
  the authority stage: *"messaging.direct.send needs a steward at alice.me."* Standing is not a mandate.
- The visitor asks for a payment to **a different payee**. The wire names one payee; the child is not a subset;
  nothing derives; the run stays parked for alice.

**What each party learned, and what none of them had to trust**

- The door learned that the visitor has a live grant in impact-agent. It never saw the grant, or anyone else in impact-agent.
- alice's agent learned that the door admitted this caller, and that alice's own wire covers this payment. It
  trusted neither the door nor the visitor for that: it read the receipt itself and verified the chain itself.
- impact-agent learned nothing about faithnet, and faithnet nothing about impact-agent, beyond one root each on neutral ground.
- No bridge carried authority. No grant was re-issued. No assertion was accepted on its issuer's word.

## Where to go next

- [How one crossing works, step by step](how-it-works.md): the same picture with the real artifacts.
- [Operating the federation](operating.md): the commands, the secrets, the gates.
- [Decisions and findings](decisions-and-findings.md): the ledger, with spec pointers.
- Deep dives: [principles](federation-principles.md) · [naming across towns](federated-agent-naming.md) ·
  [the standards landscape](naming-landscape-crosswalk.md).
