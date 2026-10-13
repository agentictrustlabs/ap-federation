# ap-federation — architecture

Three documents, written 2026-10-13 after F1, for a reader who did not build it. They cite Ring 0 doctrine by
identifier and never restate it (the rules are projected into `CLAUDE.md` by digest), and they never link into a
private repository (`pnpm check:public-links`).

| Read | For |
| --- | --- |
| [`federation-principles.md`](federation-principles.md) | the ten principles this repository protects — what each says, what it rules out, where it is enforced in code or on chain, and where the field has arrived at the same conclusion (or the opposite one), with the sentence that shows it |
| [`federated-agent-naming.md`](federated-agent-naming.md) | **the naming decision**: naming is a trust question answered in layers — CAIP-10 identity (no authority), a town handle unique per town (the ENS v2 principle per town), a town-qualified pair `{ name, chain }` across towns (the ERC-8004 reading: labels may recur, identities do not), the DNS projection as a rented locator that every DNS-anchored resolver can find, and trust as named signals, never a score. No federation root is created; an opt-in one on public ground is recorded. §7 is the backlog it asks of Ring 0 |
| [`naming-landscape-crosswalk.md`](naming-landscape-crosswalk.md) | ERC-8004 · ENS v2 and the ENSIPs · ERC-7930/7828/7785 · CAIP · OWASP ANS v1 · IETF ANS v2 · the Linux Foundation's ANS · GoDaddy's ANS Registry · AID v2 · DNS-AID · DANE-DID · the CSA analysis · HCS-14/10/11 · NANDA and NandaIndex · AGNTCY ADS · SPKI/SDSI, petnames, Zooko — one row each, dated, with what we take, what we refuse, and what to pin |

Where the mechanism lives: Ring 0 spec 410 §4 and spec 439 (the architect-of-record for this repository);
`apps/projector/README.md` for what F1 built and found; [`../runbooks/project-an-estate.md`](../runbooks/project-an-estate.md)
to put an estate on neutral ground.

Status words used throughout: **live** (runs today, gate named) · **designed** (a spec and a gate exist, not built) ·
**proposed** (this repository recommends it; no spec holds it yet) · **open** (framed, not decided).
