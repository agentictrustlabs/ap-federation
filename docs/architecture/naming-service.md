# The naming service — one namespace, many chains

**Status:** 2026-10-14. This is how the service works. It decides nothing: the decision of record for the root is
[spec 440 §C](../../specs/440-shared-kms-federation-site-and-universal-naming.md); the layers under the root are
[`federated-agent-naming.md`](federated-agent-naming.md) N1–N6 and N8. N7 was amended the day this service was
chosen: one universal namespace, rooted on faithchain, the way ENS v2 is rooted on Ethereum L1.

**The one sentence.** Every name in the federation is a record on one chain. Other chains join that registry. They
do not start a second one.

---

## What a reader can ask today

The universal resolver is the Names view on https://ap-federation.faithnet.io.

```
GET /api/names?q=<label or name>
GET /api/names/<name>
```

Each row is `{ name, town, chain, identity, kind, status, display }`. `identity` is the account,
`eip155:<chainId>:<address>`. `display` always carries the town: the site is in no town, so no name is shown bare.
Wave 1 asks every **live** town's naming read API (today https://names.faithnet.io), which reads its chain at
request time. A retired town is not queried. A chain written into the name (`alice.me@faithchain`) is refused: `@`
means a context (an org, a team, a workspace), and the chain is a field beside the name.

An answer is a resolution. It is not a permission, a membership, or a reputation.

---

## Four layers, one job each

| Layer | Example | Job | Unique where |
| --- | --- | --- | --- |
| L0 identity | `eip155:34348:0xc35c…` | the only thing a verifier binds to | everywhere, by construction |
| L1 handle | `alice.me` | the name a person claims | the root chain's `AgentNameRegistry` |
| L2 federated reference | `{ name: alice.me, chain: eip155:34348 }` | how a name travels between towns | the pair, not the label |
| L3 DNS projection | `alice.faithnet.ai` | where the agent is reached | the DNS zone the estate rents |

L0 never changes when a credential rotates. L1 is bought once, typed, and checked against the on-chain agent type:
`.me` is a person, `.org` an organization, `.svc` a service, and a mismatch fails closed. L2 is how two towns can
each have issued `alice.me` during the years before the root, and how a reader still tells them apart. L3 can be
sold, dropped, or hijacked without the account changing; it publishes a card and, later, the DNS records other
resolvers already read. Deleting the host costs reach. It does not cost the name.

The typed roots on the root chain are `.me .org .team .svc .workspace .treasury .registry .church .circle
.household` and `.estate`. They are listed in `federation.yaml#naming`.

---

## How a name is issued today

faithchain is both the root and the only live town, so issuance is the town's existing ceremony (ap-town specs 430
and 431):

1. The resident asks their estate's Home.
2. That estate's **naming gate** — a key the Home holds — signs a claim ticket. The chain records which estate
   signed, so "issued by impact-agent" is a fact, not a label.
3. The resident's account on the root chain owns the name. The governor of the priced roots (`naming.svc`, under
   the town clerk) has already named that estate's gate with `setGate`. A ticket from a gate that was not named is
   refused.
4. The forward record points at the account. The reverse record is honoured only when the forward agrees.

A town's naming service **reads** this registry. It does not run a root of its own, and it does not re-register a
name another town issued.

---

## How another chain joins

Three parts, all described in spec 440 §C3. None of them is a second registry.

1. **The gate.** The estate on chain X has its naming gate named on the root chain's priced roots, the same
   `setGate` faithnet and impact-agent use. A ticket it signs is accepted, and the chain records which estate issued the
   name.
2. **The owner.** The name is owned by the resident's account **on the root chain**. When their home account is on
   chain X, that owner is their satellite: an account at the same CREATE2 address when the factory matches, signing
   by ERC-6492 until its first transaction. The resident signs the claim at their Home on chain X. The operator
   does not hold the name for them. Where the same factory does not exist, the answer is no name until it does.
3. **The records.** `atl:accounts` holds one CAIP-10 id per chain (registered on faithchain 2026-10-14). The home
   account's reverse claim on chain X counts only when the forward on the root chain names that account.

Custody has to travel with the person before a global name may point at a satellite in production: a rotation or
recovery at the home account has to reach the satellite by its own custody ceremony. That is a Ring 0 spec, and it
is the precondition of wave U3. Until it exists, a global name would keep pointing at a satellite whose credential
had already been retired.

Resolution from the other chain is one mechanism, chosen in configuration:

- **Direct read**, when that town can read the root chain. Its naming service reads the root registry the way it
  reads its own chain today.
- **By proof**, when it cannot. A naming root is anchored on neutral ground beside the live-grant and membership
  roots. A resolver on chain X checks `{ name, eip155:<root> }` against that root. A stale naming sequence is a
  refusal.

One deployment uses one of those. It does not try the other when the first returns empty.

---

## Waves

| Wave | What a reader gets | Status |
| --- | --- | --- |
| **U1** | the register, the resolver over live towns' naming services, the never-bare rule, the site | **live** — `scripts/gate-federation-site.mts` |
| **U2** | the pair `{ name, chain }` in `agent-naming`; `atl:accounts` on the root chain; a reverse claim per chain | pair and `atl:accounts` **live** (2026-10-14); the reverse claim waits for a second chain |
| **U3** | an estate on another chain named as a gate; its resident claims a root-chain name through their satellite | **designed** — needs a second chain, and custody propagation before production |
| **U4** | the naming root on neutral ground; a proof-backed resolver on the second chain | **proposed** — a Ring 0 change to spec 410 §4 (a third root, or a second registry instance) |
| **U5** | `setGate` for a new estate becomes a quorum of town clerks, with a receipt | **open** — the governor today is one persona; spec 440 §C7 names the council and does not design it |

---

## What a name is for, stated as the inferences a reader may act on

| A reader may conclude | Because |
| --- | --- |
| this name points at this account | the forward record on the root chain |
| this account presents this name | the reverse record round-trips |
| this is a person, an org, or a service | the suffix matches the on-chain type |
| town A's estate issued it | the gate recorded on the claim |
| it is the same account as last month | the account does not change; the label is not the evidence |

A reader may not conclude, from the name alone, that the subject is reputable, or that they may act in the reader's
town. Standing is a presentation ([cross-chain authority](cross-chain-authority.md)). Permission is the reader's own
mandate. Signals stay separate; nothing on this service adds them up.

---

## Where to read next

| Question | Document |
| --- | --- |
| Why the root was chosen, and what the field does instead | [`federated-agent-naming.md`](federated-agent-naming.md), spec 440 §C |
| ERC-8004, ENS v2, the ANS family, AID, HCS-14, NANDA — dated | [`naming-landscape-crosswalk.md`](naming-landscape-crosswalk.md) |
| Which of these waves are cross-town capabilities, and in what order | [`cross-town-capabilities.md`](cross-town-capabilities.md) |
