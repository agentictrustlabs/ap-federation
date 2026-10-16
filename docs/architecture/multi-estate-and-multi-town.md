# Many estates, many towns

*What an estate is, what a town is, the two of each that run today, and what crosses between them. Nothing here
grants anything: every crossing is over proof, and authority stays inside the estate that owns it.*

## An estate

An estate is one deployment an operator runs for its people. It is one shape, stamped as many times as there are
estates (Ring 0 spec 441; `pnpm estate:new` and `check:estate-shape` in ap-home):

| Part | What it holds |
| --- | --- |
| a Home | where a person signs in, signs her mandates, and sees her agents, wires and receipts |
| an agent runtime | the harness every agent of the estate runs: an ask becomes an intent, a mandate, a plan, a receipt |
| a vault | the record: every person's, organization's and service's records, each behind its owner's grant |
| an edge and a Home MCP | the admission boundary, and an MCP entrance for a client acting as the person |
| an interactions service agent and a `.registry` service agent | the estate's two accounts of its own: one executes interactions, one anchors the estate on neutral ground |
| a key-service tenant | the estate's keys — relay, session, vault keys, device keys, issuing keys. A tenant is an estate boundary; two estates never share one |
| a chain | where its people, organizations, treasuries and wires live. A wire is verified on the chain its delegator lives on |

A person is a resident of one estate. Her agent, her treasuries, her credentials and her wires are bound to her
estate's chain.

**Two estates run:**

| Estate | Home | Chain | Notes |
| --- | --- | --- | --- |
| faithnet | www.faithnet.me | faithchain (34348) | the first estate; its registry agent anchors on neutral ground |
| imbnet (impact-agent) | www.impact-agent.me | hopechain (34349) | a generation-3 chain (payload-classes enforcer, treasury spend policy); its organization issues its members' credentials |

## A town

A town is one chain, every estate on it, and the services they share. Nothing in a town grants anything: a name
resolves, a registry lists, the public graph holds only what the chain can prove, and each estate's authority stays in
the estate.

| Service | What it does |
| --- | --- |
| registry | the `.registry` service agent and its listings |
| public graph and discovery | facts any stranger could reproduce from the chain, and the search over them |
| naming | typed names (`.me .org .team .svc .church .circle .treasury .registry .workspace`); a suffix names the agent's type, and the on-chain type record is the authority |
| chain gateway | RPC with app tokens |
| portal and estate pages | what the town holds and who is in it |

**Two towns run:** faithnet.town on faithchain and hopenet.town on hopechain. hopenet roots its names at faithchain
(`chain.namesRootedAt` in ap-town): one universal namespace, with hopenet's local table shown as local. A resolver row's
account is the account on that chain and is never promoted to the canonical identifier. A Home declares its account on
a name once; until then the record says "not declared".

## What crosses a boundary, over proof

| Crossing | How | Proved by |
| --- | --- | --- |
| an estate's standing | the estate anchors the roots of its live grants and memberships on neutral ground (`EstateProjectionRegistry` on faithchain, no admin, no pause, no upgrade); a visitor proves one leaf against the root the door reads itself | `gate:twin` — both directions, across faithchain and hopechain |
| a credential's standing | an issuer anchors the root of the credentials it still vouches for on the same registry | `gate:predicate` |
| a member's fact, nameless | a member proves "over 18 and a member" in zero knowledge at her organization's door, under her own standing wire, with her device key held by the key service | `gate:predicate` (25 checks) |
| a payment, inward | a visitor is paid at another estate under a steward's standing wire there | `gate:twin` |
| a payment, outward | a resident pays out under her own wire; the other estate's permission is never honoured | `gate:pay-outward` |
| dues on a proof | a pay ticket on the predicate admission; she pays from her treasury to her organization's treasury on the organization's chain | `gate:member-payment` (15 checks) |
| a person's agent at a company | the estate's personal-agent service is the client; the person is a pairwise subject; `approved_by` comes only from a mandate signature | `gate:pap-twin` |

The projector keeps every root fresh from each estate's and each issuer's own vault, every six hours.

## What never crosses

**Authority.** A root on neutral ground, a receipt from a door, a name in a town and a credential's proof are evidence.
The receiving estate decides under its own mandate, per step. A translated permission does not widen. Value does not
cross chains: a payment is treasury to treasury on one chain.

## What is still owed

- A person of one estate as a member of an organization in another (an invitation over A2A under an app delegation,
  the organization recording a member from another chain). The estate's registry agent issues for that visitor today,
  and the register says so.
- U3: a name claimed on a town's chain landing on the root through the estate's gate.
- The door's stage on each estate's own edge, in place of the reference door.

See [`primer.md`](primer.md) for the vocabulary, [`how-it-works.md`](how-it-works.md) for each crossing step by step,
and [`operating.md`](operating.md) for the commands.
