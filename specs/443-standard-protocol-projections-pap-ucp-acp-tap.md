# Spec 443 — Standard-protocol projections: Personal Agent Protocol, UCP, ACP, Visa TAP

**Status:** DRAFT 2026-10-15. Spec only; waves named, none built. The primitives it renders are Ring 0
[spec 442](../../agenticprimitives/specs/442-personal-agents-at-the-companys-door.md); nothing here exists until
442 W1–W3 do.
**Owner's brief (2026-10-15):** *"Understand the impact of the Personal Agent Protocol from Meta/Sierra and
standards like UCP, ACP and Visa's Trusted Agent Protocol. Retain the crispness of the Agentic Primitives
substrate, fill the holes, and add into ap-federation any projections we need to integrate with these protocols —
and make sure nameless agents keep their privacy."*
**Builds on:** spec 439 (this repository's charter — *"standard protocols on top"*; the NANDA adapter in §5 is
the precedent for everything here), spec 440 (the site, the KMS operator), Ring 0 spec 338 (private resolution,
invitations), spec 346 §9 (invitation flows), spec 347 (projections with loss reports), spec 350/397 (mandate,
standing wires), ADR-0013, ADR-0037, ADR-0041, ADR-0056, ADR-0057.
**Does not change:** any contract, any Ring 0 package (442 does that), any verifier. Nothing here is authority.

---

## 0. Decisions in one screen

1. **This repository renders; Ring 0 defines.** Every document served here — a client metadata document, a
   `poppy.json`, a UCP business profile, an ACP capability response, a TAP key directory — is a pure projection of
   `CanonicalAgentProfileV1` + `AgentDiscoveryPolicyV1` + a `ClientKeyBindingV1`, produced by 442 §9's projectors
   with a loss report. No field is authored here.
2. **Adapters refuse when no mapping exists** (439 §3.1). A PAP scope, an ACP session, a TAP `tag` that cannot be
   expressed as a scoped, intent-digest-bound mandate is refused with the reason, never approximated.
3. **The person is never the client.** The PAP/TAP/ACP client at every company is the estate's personal-agent
   service `pap.svc`; the person is a pairwise `sub` (442 §4, §7.1).
4. **Our company doors park acts.** A foreign personal agent's `approved_by` is recorded as its claim; the act
   waits for the owner's mandate at the owner's approval door, exactly as any outsider's does (spec 379).
5. **Every door writes an `AdmissionReceipt`** whose public face carries no subject (442 §7.6).
6. **Versions are pinned in Ring 0's lock.** This repository proposes entries; it never pins its own (439 §10).
7. **A door verifies ZK credential proofs; it never proves them** (added 2026-10-15, Ring 0
   `docs/architecture/zkid-and-verifiable-credentials-alignment.md` §2a, §6). The prover (`openac-sdk`, Rust/Circom→WASM, ~126 MB of proving keys, raw device key in `present()`)
   runs in the holder's Home; a door here carries only the verifying keys and the `Show` verifier, behind Ring 0's
   `ProvingBackendPort`, and adds the layer the SDK leaves out: issuer key through spec 304 facets **read from the
   chain**, audience = door origin + operation id, replay cache, and `expressionResult` as evidence, never
   acceptance. A valid proof is a third proof grade, `predicate`, beside `identity` and `standing`.

---

## 1. What is built, and where

```
ap-federation/
  packages/personal-agent-client/     the outbound half: our person's agent at THEIR door
  apps/pap-door/                      the inbound half: THEIR personal agent at OUR company's door
  apps/site/                          the Protocols card (§3)
  federation.yaml                     protocols: per estate (§2)
```

### 1.1 `@ap-federation/personal-agent-client` — our agent at their door

Runs inside the estate's runtime as step invokers (the ap-home runtime consumes it the way it consumes
`estate-projection`); signs with the estate's `pap.svc` binding through 442's `JwsSignerPort`.

| protocol | what the client does | 442 primitive it stands on |
| --- | --- | --- |
| **PAP sessions** | fetch + cache `/.well-known/poppy.json`; start a session with an RFC 7523 assertion (`iss` = `pap.svc`'s `client_id`, `sub` = the pairwise subject); DPoP on every call; renew; Account Token exchange; sign out | `ClientKeyBindingV1` (service scope), `derivePairwiseSubject`, `ExternalAccountLink` |
| **PAP sign-in** | Direct and Device Sign-In as Home ceremonies (the Home is the registered `redirect_uri`); **Mediated Sign-In refused** unless an operator policy names the company, and then audited fail-hard | 442 §8 |
| **PAP operations** | `proposed` → park the act with the company's summary + terms; `approved_by: user` only from the mandate signature, `standing_permission` only from a covering 397 §11 wire; confirm with `ExternalOperationRefV1`'s digest as the nonce; track `in_progress` as `effect-uncertain`; cancel = decline / revoke; attach `proof` at the grade the posture allows | 442 §5, §7.2 |
| **PAP web + APIs + conversations** | the browser-session endpoint and OpenAPI/MCP entries become tools of the run under the session token; a company conversation is an outside agent that may answer and never act (spec 379) | spec 350 tool model |
| **ACP checkout** | create/update/complete/cancel with `Idempotency-Key = f(intentDigest)`, `Signature` over canonical JSON under the binding key; `complete` only with a mandate; Shared Payment Token handled as an `ExecutionCredential` | 442 §5, §10 |
| **UCP** | read the business profile; checkout capability as ACP above; carry an AP2 mandate JWT (VC-JWS by the person's SA via ERC-1271) where the extension is declared | 442 §10 |
| **TAP / Web Bot Auth** | RFC 9421 signatures (`@authority`, `@path`, `created`, `nonce`, `keyid`, `tag`) on web requests under the service binding; `tag: payment` only when a mandate covers the act; consented identifiers only from the mandate's field-class consents | 442 §6, §7.5 |

The client holds no identity: the binding is a credential; the Account Tokens are the person's vault records;
the person's authority is their wire to `pap.svc`, verified at their own runtime per step.

### 1.2 `apps/pap-door` — their personal agent at our company's door

A Worker in front of a `.svc` / `.org` agent that chooses to be a PAP Company. One deployment per estate, routed
per agent (`<agent>.<estate-zone>/.well-known/poppy.json`), the way the federation door fronts an A2A surface.

| PAP surface | what the door does | rule |
| --- | --- | --- |
| `/.well-known/poppy.json` | serves 442 §9's `companyDoorProfile` rendered as PAP; **404 for `listing: none`** — the profile travels inside the invitation instead (442 §7.3) | the projector refuses; the door never fills in |
| OAuth server metadata, `token_endpoint`, `revocation_endpoint` | backed by the Home's OIDC provider (spec 230) and `mcp-oauth`; sessions issued to a foreign `client_id` after fetching and verifying its metadata document; `jti` replay store (the door's one Durable Object, as in `apps/door`) | OAuth is the ingress envelope, never the authority (ADR-0041) |
| registration (`invalid_client`) | a company with `requiresInvitation` admits a session only when the client presents a resolution grant (`admitGrantPresentation`, 338 §4); everyone else gets a uniform `invalid_client` with no timing oracle | registration = an accepted connect invitation (346 §9.1) |
| Direct / Device Sign-In | the person signs in at the Home (their own browser); the door issues Account Tokens as spec 230 `/authorize` mints an `id_token` + a caveated delegation today | mediated sign-in **not offered** |
| `apis` (OpenAPI / MCP entries) | point at the estate's existing surfaces; the session token is the ingress envelope, Web3 decides every call (spec 277) | no new surface |
| conversations | the agent's A2A door, with the PAP conversation shape as a projection (spec 372 outsiders) | answers; acts park |
| operations endpoint | every proposal is a parked act at the owner's approval door; confirm with the presenter's `approved_by` recorded as its claim; the act proceeds only on the owner's mandate; `in_progress` while `effect-uncertain`; at-most-once by the intent nonce | 442 §5 and decision 4 |
| receipts | `AdmissionReceipt` per decision; the public list is counts + decision codes + `subjectDigest` | 442 §7.6 |
| `predicate` proof on confirm (zkID, decision 7) | the door issues the challenge (≥128 bits, single-use, TTL; audience = door origin + operation id) in the operation's `approval_required` response; on confirm it verifies the OpenAC bundle through `ProvingBackendPort` (verifying keys only), resolves `issuerKey` → spec 304 facet → issuer SA → attestation **from the chain** (an unresolved key is `untrusted_issuer`, never a lookup at the issuer), checks `claimNormalization` against the policy it compiled, and records `{issuerFacet, predicateDigest, nullifier, fresh}` as evidence; the act still parks for the owner's mandate | proof validity ≠ acceptance ≠ authority; a `listing: none` issuer's facet is read only from an invitation's publication |
| verifier placement | the `Show` verifier (WASM + verifying keys) bundled in the door Worker if it fits the bundle limit; otherwise a per-estate Node verifier over the same port, and the receipt names which verified | the door never holds proving keys or a device key |

### 1.3 Projections for UCP and TAP (served, not authored)

- UCP business profile: `companyDoorProfile` rendered to UCP's profile schema, served by `pap-door` at the path
  UCP names, with the loss report logged; checkout via the ACP-shaped capability.
- TAP key directory: `clientMetadataDocument` rendered as the RFC 9421 key directory for `pap.svc`; one per
  estate service, never per person.

---

## 2. `federation.yaml` — the `protocols:` stanza

Declared per estate, pinned to Ring 0 lock targets; `check-federation` refuses an unpinned version or a
per-person `clientId`.

```yaml
protocols:
  - estate: faithnet
    personalAgent:
      service: pap.svc@faithnet              # the estate's personal-agent service; NEVER a person
      clientId: https://pap.faithnet.io/client.json
      jwks: https://pap.faithnet.io/jwks.json
      keyDirectory: https://pap.faithnet.io/.well-known/http-message-signatures-directory
      binding: atl:clientKeys                # read from the chain; thumbprints only
      speaks: { pap: "0.1", acp: "2026-04-17", ucp: "latest", tap: "sample-2026" }
      mediatedSignIn: refused                # or: { allowedIssuers: [...], audit: fail-hard }
    companyDoors:
      - agent: ligonier.svc
        poppy: https://ligonier.faithnet.ai/.well-known/poppy.json
        requiresInvitation: false
      - agent: <a private .svc>
        poppy: null                           # listing: none — the profile travels inside the invitation
        requiresInvitation: true
        proofGrades: [standing, predicate]    # what this door accepts on confirm; `identity` only if listed
    credentialProofs:                         # zkID (decision 7) — verifier side only
      suite: openac-sd-jwt-p256
      backend: { package: openac-sdk, version: "<pinned in Ring 0 lock>", role: verifier }
      verifierPlacement: worker | node        # where `Show` is verified; the receipt names it
      issuerTrust: chain                      # spec 304 facets via the chain; never a fetch to the issuer
    issuers:                                  # facets THIS estate publishes, read from the chain (K1)
      - sa: 0x…                               # issuing agent (an org or .svc; never a person)
        facets:
          - thumbprint: <JWK thumbprint>
            attestation: <AttestationRegistry uid>
            revocationRoot: projection        # K2: anchored beside the authority roots, or `statusList` for public flows
```

Nothing in the stanza grants anything. It says what an estate presents and accepts, so a reader of the site can
tell, and so the gate can check the live documents against the declaration.

---

## 3. The site — a Protocols card

Per estate: what its personal-agent service presents (`client_id` reachable, JWKS fresh, binding on chain and
current under the custody epoch), which company doors it runs and whether each serves a public `poppy.json` or
requires an invitation, the last `gate:pap-twin` / `gate:nameless-visitor` result. It reads live surfaces and
holds no copy (440 §B3). It never lists a `sub`, an Account Token, a subject, or a receipt body.

---

## 4. Gates

| gate | what it proves | its negative half |
| --- | --- | --- |
| **`gate:pap-twin`** | faithnet's person agent, as `pap.svc@faithnet`, starts a PAP session at imbnet's `pap-door` for a public-posture person; signs in (Device Sign-In through the Home); an operation is proposed, parks at the person's approval door, is signed, confirmed with `approved_by: user` and an `identity` proof; receipts land on both sides and the act's receipt cites the intent nonce | `standing_permission` with no covering wire is refused and parks instead; a second confirm of the same revision is refused on chain; a changed revision under the old mandate is refused; Mediated Sign-In returns the refusal; a TAP-signed web request is admitted as evidence and still refused at the authority stage |
| **`gate:nameless-visitor`** | a nameless imbnet person (`naming: none`, `listing: none`) completes the same operation at faithnet's door with a `standing` proof (a blinded-leaf presentation against imbnet's root on neutral ground) | no Smart Agent address, name or `sub` appears in `/federation/receipts`, the site, the door's logs or the company's records; the `identity` grade is refused for this person; the same person at a second company carries a different `sub` |
| **`gate:private-company`** | a `listing: none` `.svc` serves no `poppy.json`; an invited personal agent reaches it from the invitation's publication and is admitted with its grant | an uninvited client receives a uniform `invalid_client` with no timing difference from an unknown `client_id` |
| **stub foreign client** | a fixed-behaviour PAP personal agent (the shape Meta or OpenAI would run) exercises our door end to end | its `approved_by: user` without a mandate parks the act and performs nothing |
| **`gate:predicate-visitor`** (zkID) | a nameless imbnet person holds an SD-JWT credential issued by an imbnet org (facet on chain); their agent, under a `credential.present` wire, answers faithnet's door challenge with an OpenAC proof of "over 21"; the door verifies with verifying keys only, resolves the issuer facet from imbnet's chain / projection, records the evidence, parks the act; the receipt carries `proofDigest`, `challengeDigest`, `mandateDigest` | no address, issuer signature, claim value or `sub` on the wire or in any receipt; a replayed challenge is refused; a proof for a different predicate digest than the wire covers is never produced (KMS refuses the device signature); an issuer facet revoked on chain fails the whole presentation; a `claimNormalization` mismatch is refused; the same person at a second door yields a different nullifier |
| **`gate:member-payment`** (zkID, the user's ask 2026-10-16) | a member over 18, nameless, PAYS the organization treasury to treasury on one chain: she proves `age ≥ 18 ∧ member ≥ 1` at impact-agent's door (the credential the organization's own issuer gave her, Z5); the door issues a payment TICKET only on that ADMIT (an HMAC over reference · payee · asset · amount · admission receipt · expiry — never the person); her OWN agent pays from HER treasury under a child mandate derived from her standing dues wire (issued once at her Home, revocable on chain) for THIS intent, signed by her agent; `POST /federation/pay-ticket/settled` lets the door read the ERC-20 transfer on the chain and record `door.payment` beside the predicate admission. The organization learns that a member over 18 paid, and not which member | no ticket without a predicate ADMIT inside the window; a ticket settles once (the replay store consumes the reference); a forged ticket is refused; the identical intent repeated moves nothing (one intent, one payment); the public ledger face names nobody |

Nightly rows on the site, like the existing twin.

---

## 5. Waves

| wave | builds | needs |
| --- | --- | --- |
| **W0** | this spec; the `protocols:` stanza (declared); the findings in 442 §7.6 fixed in `apps/door` (challenge subject to the POST body; public receipts minimized) | nothing from 442 |
| **W1** ✅ 2026-10-16 (Ring 0 442 W1–W4 landed 2026-10-15) | `packages/personal-agent-client` (discovery checked as PAP 3.1–3.2 says; RFC 7523 session + client assertions signed by the service's binding key; DPoP on every call with the nonce dance; Direct/Device sign-in as Home ceremonies → a SEALED account token + `ExternalAccountLinkV1`; mediated refused unless an operator policy names the issuer; operations as parked acts — `approved_by` only from a verified mandate or a covering wire, one confirm per revision, a new revision a new intent; the `identity` proof grade only for a public posture) + a stub PAP company and 11 twin checks at unit scale. **`faithnet-pap.svc`** `0xf2903860…` chartered under demo-admin (the gate's domain rule refused `pap`), vault bound, steward wire recorded, named (10 SHQ); its service-scoped `ClientKeyBindingV1` signed by its custodian and `atl:clientKeys` on chain (tx 0xc6bdb815…; the predicate registered by the governor, tx 0x6f9089d4…), verified through ERC-1271 (`scripts/verify-client-key.mts`); `apps/pap` at **pap.faithnet.io** serves `client.json` · `jwks.json` · the RFC 9421 key directory · the Direct Sign-In return — all projections of the binding (Ring 0 `clientMetadataDocument`). The client key is a Worker secret until faithkms has P-256 (zkID Z6). Owed: the Home's `/oauth/return` handler and the approval-door port wired into the faithnet runtime (W2 exercises both). | 442 W1 + W2 |
| **W2** ✅ 2026-10-16 | `apps/pap-door` at **ligonier-door.ap-federation.faithnet.io** in front of ligonier.svc: `poppy.json` from Ring 0's `companyDoorProfile` (404 for `listing: none`; mediated sign-in dropped unless an operator policy names it), RFC 8414 metadata, a token endpoint that admits a FOREIGN `client_id` on its own metadata document and JWKS (RFC 7523 client + session assertions, DPoP with `ath`, jti replay in the door's DO; a per-person `client_id` refused), device sign-in approved by the person's OWN agent signing the user code (validated through ERC-1271 on faithchain — no password, no Home session relayed), the Operations extension (`/api/orders/exchange` proposes with HTTP 202; confirm records `approved_by` as **the presenter's claim** and forwards the act to ligonier.svc's edge-addressed A2A door as the door's own service agent `0xa8faCe68…` — chartered with its birthrights, the key a Worker secret — where it parks for the owner's mandate; `in_progress` with `Retry-After` until the task finishes; a repeated confirm is safe), receipts whose public face is counts and subject digests. The stub foreign client lives in `apps/pap-door/test` (5 checks). **`gate:pap-twin`**: our own client, as `faithnet-pap.svc`, end to end — 20 checks incl. 3 refusals. (`ligonier.faithnet.ai` is the runtime's wildcard zone, so the door lives on the ap-federation zone.) | 442 W2 + W3 |
| **W3** | invitation-only company doors; `gate:private-company`; `gate:nameless-visitor` with the `standing` proof | 442 W3; estate-projection presentations |
| **W4** | ACP checkout client; UCP profile + AP2 mandate JWT; TAP signer + key directory; the Protocols card | 442 W4 |
| **W5** (zkID) — **LIVE 2026-10-15** (`docs/architecture/decisions-and-findings.md` §zkID; `gate:predicate-visitor` green at door.ap-federation.faithnet.io) | `credentials:` + `credentialProofs:` in `federation.yaml`; facets on the site (Credentials tab, `/api/credentials`); the door's `predicate` grade over `ProvingBackendPort` (verifier only) — the Worker-size decision: a Node **Container** beside the door (`verifierPlacement: node`, RSS ≈1 GB); revocation roots in `apps/projector` beside the authority roots (`--issuer`, set `live-credential`); `gate:predicate-visitor` | Ring 0 Z1–Z3 (`openac-sd-jwt-p256` suite, the `sign(digest)` SDK patch, `binding-credential-presentation`) |

---

## 6. Not built, and said

- A prover anywhere in this repository: no proving keys, no `precompute`/`present`, no device key. Proving is the
  holder's Home; a door verifies.

**The presentation reference is the design, not a workaround (2026-10-16).** A zero-knowledge proof bundle is tens of
kilobytes and the public internet's edge caps a request header at sixteen; so a knock has two steps by design: `POST
/federation/present { presentation }` — refused at once under a facet outside the door's trust set, otherwise HELD under the
reference the door derives (`credential:<issuerKeyId>:presentation:<digest>`) for ten minutes, unverified — then the knock
cites the reference in `x-ap-credential-presentation`. Nothing is verified until the knock, the receipt keeps the digest and
never the bundle, and a presentation nobody knocks with expires unread. A door that asks a credential serves both steps.
- Trusting `issuerKey` as returned by `openac-sdk`, or fetching an issuer's key or status list from the issuer.
- Payment rails: card tokens, PSP exchange, PAR — Ring 1, another repository. (The member-dues payment is the SUBSTRATE's rail — treasury to treasury under her own mandate — not a PSP; the invoice the doctrine describes is still the ticket's successor, spec 337.)
- Mediated Sign-In as a default anywhere.
- A PAP "personal agent" per person; a per-person `client_id`; a per-person key directory.
- Any reading of a foreign `approved_by` as approval at our doors.
- A `sub`, token, subject or receipt body on the site or in `federation.yaml`.
- NANDA stays in 439 §5; this spec adds no second discovery index.

---

## 7. Reference: smart-agent patterns to port

See Ring 0 spec 442's reference section: `pairwiseHandle` (intent kept, construction replaced), the
pairwise-handle-bound presentation (the `standing` grade). This repository adds none of its own; the adapter
posture — refuse where no mapping exists, record what was presented, decide under our own mandate — is 439 §5's
NANDA adapter, applied again.
