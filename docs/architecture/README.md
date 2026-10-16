# ap-federation — architecture

Read top to bottom. The first six are written for a reader who did not build this; the deep dives beneath
them are where the detail and the industry context live. Ring 0 doctrine is cited by identifier and never restated
(the rules are projected into `CLAUDE.md` by digest), and nothing here links into a private repository
(`pnpm check:public-links`).

## Start here

| Read | For |
| --- | --- |
| [`primer.md`](primer.md) | **the federation in plain words**: the one problem, the answer, the picture, the vocabulary, the four rules, what is live |
| [`how-it-works.md`](how-it-works.md) | **one crossing, step by step**, with the real artifacts, the code that does each step, the gate that proves it, and the refusals; then a member proving, nameless, and paying her dues |
| [`multi-estate-and-multi-town.md`](multi-estate-and-multi-town.md) | **many estates, many towns**: what an estate and a town hold, the two of each that are live, what crosses a boundary over proof, and what never crosses |
| [`operating.md`](operating.md) | **running it**: the register, the secrets, the projector, the doors, the site, the gates, putting a new estate on neutral ground |
| [`decisions-and-findings.md`](decisions-and-findings.md) | **the ledger**: every decision and finding since F1, dated, with its spec pointer, and what is still owed |
| [`naming-primer.md`](naming-primer.md) | **names in plain words**: two towns, two chains, one name, with maya drawn across faithchain and hopechain |

## Deep dives

| Read | For |
| --- | --- |
| [`federation-principles.md`](federation-principles.md) | the ten principles this repository protects: what each says, rules out, where it is enforced, and where the field agrees or disagrees, with the sentence that shows it |
| [`naming-service.md`](naming-service.md) | how the naming service works: the resolver, the four layers, issuance, how another chain joins, what hopechain does today, the waves |
| [`federated-agent-naming.md`](federated-agent-naming.md) | the naming decision across towns and chains, layer by layer; amended 2026-10-14 when the owner chose one universal namespace rooted on faithchain (spec 440 §C is the decision of record) |
| [`naming-landscape-crosswalk.md`](naming-landscape-crosswalk.md) | ERC-8004 · ENS v2 · the ANS family (OWASP, IETF, Linux Foundation, GoDaddy) · AID · HCS-14 · NANDA · AGNTCY · SPKI/SDSI, one dated row each: what we take, refuse, and propose to pin |

Where the mechanism lives: Ring 0 spec 410 §4 and spec 439 (the architect-of-record), spec 440 in this repository
(`specs/`); spec 443 (`specs/443-standard-protocol-projections-pap-ucp-acp-tap.md`) for the Personal Agent
Protocol / ACP / UCP / Visa TAP projections (PAP live: W0–W2; Ring 0 spec 442 defines what they render); Ring 0
`docs/architecture/zkid-and-verifiable-credentials-alignment.md` for zero-knowledge credential proofs at the door and
revocation roots on neutral ground (Z1–Z6 live), and Ring 0 spec 444 for the organization as issuer;
`apps/projector/README.md` for the projector's estate and issuer modes; `../runbooks/` to do things, and
[`../runbooks/before-real-users.md`](../runbooks/before-real-users.md) for the settings relaxed for testing.

Status words used throughout: **live** (runs today, gate named) · **designed** (a spec and a gate exist, not built) ·
**proposed** (this repository recommends it; no spec holds it yet) · **open** (framed, not decided).
