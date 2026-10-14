# nanda-adapter — the NANDA interoperability adapter (spec 439 F4)

**A pure projection, and three refusals.** In: an AP agent's released A2A card, the publisher's verified domain, a
short name. Out: one NANDA index entry of media type `application/a2a-agent-card+json` pointing at the card's own
URL, plus a **loss report** naming everything the index cannot carry. No network in the projection, no key, no state.

```
pnpm nanda project --card https://town.faithnet.io/.well-known/agent-card.json \
  --domain faithnet.io --name town --estate faithnet --chain 34348
```

It prints. **It publishes nothing** — registering an entry is the estate's own act, under a domain the estate
verified at the index. `nanda register` does that act, and only when told to (see below).

## Why it is this small

The sources were read before the design (spec 439 §7.9, digests in Ring 0's `docs/standards-lock.json`):

- the index's identifiers are **ARD URNs** (`urn:air:<publisher-FQDN>:<namespace>:<short-name>`) and its entry shape
  **is** the AI Catalog shape — both already pinned as `ard`, so this adapter adds no vocabulary of its own;
- `application/a2a-agent-card+json` is a first-class media type there, so an AP agent is indexed **as itself**: its
  released card at its own origin, not a translation of it;
- **AgentFacts carries no signature field** and has not moved since 2025-06-17, so we may project into it with a loss
  report and never read one as evidence of anything.

## The three refusals

1. **Never authority.** A grant, a mandate, a standing presentation, a receipt: no field here, ever. The entry says so
   in its own record (`extensions['dev.agenticprimitives'].authority`), so a reader of the index does not have to take
   our word for it elsewhere.
2. **Never an invented vocabulary.** A field we cannot source from the card is absent, not guessed. We write only
   under `dev.agenticprimitives`; `org.projectnanda` is theirs.
3. **Never membership.** Publishing makes an AP agent *listed*. The earned claim is an interoperability adapter
   (spec 439 §5), and "a NANDA Town instance" is not it.

## The loss report

Six codes, each with where to read the thing instead: `signature-not-carried`, `canonical-identity-not-carried`,
`authority-not-carried` (always), `estate-not-carried`, `skill-detail-not-carried`, `capabilities-not-carried`. The
codes are mirrored into the entry, so a reader of the index can see that something was left behind.

## Reading the index back

```
pnpm nanda read [--index https://api.nandaindex.org/api/v1/index] [--limit 29] [--urn urn:air:…]
```

It fetches the listings, fetches what they list, and says per entry what it checked: reachable, signed, served by its
own publisher, the shape it claims. Then a count, and then what none of it is evidence of — starting with authority.

**What the live index looked like on 2026-10-14** (all 29 A2A-card entries): 21 answered, **2 carried a signature**,
17 were served by their own publisher. So for most entries "is this the card its agent published?" is a question
nothing on the wire answers, and an entry's publisher is often not the host you fetch from. Neither is a fault of the
index — it verifies that a publisher owns the domain in its URN, not that the domain serves the artifact — but a
reader that conflates them has trusted a party nobody vouched for. We report it per entry and let it decide nothing.

## Registering, when the estate decides to

```
pnpm nanda register --card https://town.faithnet.io/.well-known/agent-card.json \
  --domain faithnet.io --name town --email <public contact> --estate faithnet --chain 34348
```

Prints the exact `POST /api/v1/orgs` body and **sends nothing**. Three flags send, each one its own decision and
none implying the next: `--publish` creates the record (inactive, because the domain is unproven), `--challenge`
asks for the DNS TXT value, `--verify-domain` activates it once that record resolves. Every one needs `--token`
(or `NANDA_TOKEN`), and before any write it reads `/api/v1/me` so a stale token fails before a record is half-made.

**The account, the e-mail verification and the password are the operator's, never this tool's.** The token comes
from `POST /auth/login` at `https://api.nandaindex.org`; the password stays with the person. The token is never
written to disk here.

It warns, and does not refuse, when the card carries no signature: listing an unsigned card makes the agent one of
the entries no reader can check (spec 439 §7.15), and whether to do it anyway is the estate's call.

**One service that is not this one.** `nanda-registry.com` — a Django/JWT registry some earlier notes used — no
longer resolves at all (NXDOMAIN from the gTLD servers, checked 2026-10-14). An account there reaches nothing. The
live index is `api.nandaindex.org`, which is what Ring 0's `docs/standards-lock.json` pins as `nanda-index`.
