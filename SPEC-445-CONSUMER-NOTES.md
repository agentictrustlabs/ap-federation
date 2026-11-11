# Spec 445 consumer notes — ap-federation

Branch `spec-445-ring0-hardening` (worktree `/home/barb/ap-federation-spec445`, from `master` b11da3c). Nothing is
committed, pushed or deployed. Source of the changes: the primitives monorepo, branch `spec-445-w0-hardening`,
spec 445 §3.2 (audit H-8) and §3.8 (audit H-14).

**This tree does not typecheck against the pins it still carries.** The source here is written for the package
versions that are not published yet. Bump the pins (list below) and it does.

**Verified against a snapshot.** The local packages were linked from their `dist/` as built at 13:26 on 2026-11-10.
The primitives tree was being edited while this work ran; three later changes are not in that build and are
listed under "Arrived during this work" — they are reported, not verified.

## 1. What changed, per area

### Projector — the leaf commits to its subject (§3.8)

| Call site | Change |
| --- | --- |
| `apps/projector/src/ledger.ts:81` (`leafOf`) | An estate leaf (`live-grant`, `membership`) is `commitmentOf(digest, blind, subject)`. An issuer's `live-credential` leaf is `commitmentOfV1(digest, blind)` — Ring 0 deliberately keeps the issuer leaf subject-free. |
| `apps/projector/src/project.ts:68` (`buildProjection`) | No edit. Ring 0's builder now produces v2 leaves and `suite: 'merkle-membership-v2'`. |
| `apps/projector/src/issuer.ts:50` (`buildIssuerProjection`) | No edit. Issuer roots do not move. |
| `apps/projector/bin/projector.mts:236` (`present`) | Writes the estate's half and says it is not yet presentable: the subject signs. Warns if the result is still v1. |
| `apps/projector/bin/projector.mts:254-264` (`verify`) | Async. New required `--chain <id>` for a v2 file (the subject's chain; refused if absent). New `--accept-bearer-v1` flag, off by default; prints the grade. |
| `apps/projector/src/subject-signature.ts` (new) | The signature read: `UniversalSignatureValidator.isValidSig(subject, digest, sig)` on the declared chain, endpoint and validator from the register's `towns[]` row. Throws by name when the chain has no row, no validator or no endpoint. |
| `apps/projector/src/config.ts` | `Federation.towns?: TownRow[]` (already in `federation.yaml`; the type did not carry it). |
| `apps/projector/src/anchor.ts`, `worker/index.ts` | No edit. They call `projectEstate`; the registry stores roots only. |

**Stored commitments: none.** The ledger (file, vault and the deployed store) keeps digest, blind and subject; the
commitment is derived on every build. So no data migration — but the same rows build different roots, and the
first `project` after the bump anchors them at the next sequence. The scheduled projector Worker does this by
itself on its first run after it is deployed on the new package.

### Door — proof of possession, on the presenting estate's home chain (§3.8)

| Call site | Change |
| --- | --- |
| `apps/door/src/presentation.ts` (new) | `presentationVerifier({ homeChainOf, clientFor, acceptBearerV1 })` — binds the chain and the signature read into Ring 0's `verifyAuthorityPresentation`. |
| `apps/door/src/index.ts:280` | `foreignEstateEvaluator({ verify: presentationVerifier(…) })`, replacing the synchronous two-line call. |
| `apps/door/src/index.ts:119` | `registerEstateOf(estateId)` — one lookup, used by the verifier and by the existing F2.5 signer cross-check (`:311`). |
| `apps/door/src/index.ts:348`, `:523` | `standing.grade` is `standing` or `bearer`; the `x-ap-foreign-standing` header is forwarded only for `standing`. |
| `apps/door/src/index.ts:389` (`/health`) | Reports `presentations: { suite, subjectSignature: 'required', acceptsBearerV1 }`. |
| `apps/door/src/challenge.ts` | No behaviour change. The nonce is 32 random bytes as 0x-hex, which is what the typed data's `bytes nonce` takes; the audience is the door's origin string. Comment added. |
| `apps/door/wrangler.toml:34-38` | `ACCEPT_BEARER_V1` documented and left unset (commented out) on every env. |

**Which chain the door reads the signature on.** The presenting estate's declared home chain: `homeChainId`, else
`chainId`, from the register row whose governance derives the presentation's estate id. The door already bundles the
register and already has a client per chain (`clientFor`, the port the request proof uses). Reason for the home
chain rather than the chain the request proof names: an account address can exist counterfactually on another chain
under credentials its owner has since rotated out, and the leaf commits to a 20-byte address with no chain.
Two refusals follow, both by name and neither a fallback:

- the estate is not in the register → `FOREIGN_ESTATE_SUBJECT_CHAIN_UNDECLARED`
- the door has no endpoint or validator for that chain → `FOREIGN_ESTATE_SUBJECT_CHAIN_UNREACHABLE`

The first is a behaviour change: before, a presentation from an estate the register did not know was admitted
with `FOREIGN_ESTATE_SIGNER_UNKNOWN_ESTATE`. It is now refused. See open question 1.

### Gates

| Script | Change |
| --- | --- |
| `scripts/gate-f1-projection.mts` | Async. Signs one presentation as the gate's test account (`.secrets/f2-test-agent.env`, the presenter gate-f2 already uses) about that account's own leaf, and reads the signature through the real validator on the estate's home chain. Two new negatives: re-aimed at another subject → `opening_mismatch` (`:149`); no signature → `subject_signature_missing` (`:153`). A machine with no test key, or an estate with no leaf about it, fails with the reason. |
| `scripts/gate-f2-door.mts` | `present()` signs the projector's output as the subject (`signPresentation`, `:70`). Three new twins: a stranger re-aims a seen presentation at itself (`:251`), unsigned (`:255`), signed by someone else (`:259`). The ADMIT check also requires `standing.grade === 'standing'` and no `FOREIGN_ESTATE_BEARER_GRADE`. `knock()` takes `as:` so the stranger can sign its own request proof. |
| `live-gates.json` | `f1-projection` and `f2-door` entries: `proves`, `twin`, and a `needs` line for F1 (it now needs the test key and the estate's home-chain endpoint, e.g. `HOPECHAIN_RPC_URL` for impact-agent). |
| `scripts/gate-f3-twin.mts` | No edit — it runs gate-f2-door twice. |

F1 was documented as "holds no key". It still holds no estate key and writes nothing, but it cannot show a
presentation verifying without the subject's signature, so it now uses the gate's own test account.

### Presenter

The only code that presents an authority presentation is `scripts/gate-f2-door.mts`: its subject is the gate's
test EOA and it signs with that key. `packages/personal-agent-client`, `apps/pap` and `apps/pap-door` make no
authority presentation today (spec 443 W3's `standing` proof at a company door is not built). When it is, the
signer is the agent's own Smart Agent through its key-service key (`@ap-federation/key-service-account` exposes
`signTypedData` via the viem `LocalAccount` it returns) — nothing to change now, nothing blocked.

### Presentation release — holder and chain required (§3.2)

`scripts/lib/predicate-holder.mts:143-146`: `createPresentationRelease({ mandate, holder, chain, … })`.
`holder` is `i.standing.wire.delegator` (her person agent: `setup-member-holder.mts:92` builds the wire with
`delegator: holderAgent`). `chain` is `[mandate, standing]`, the standing link exactly as `deriveFromStanding`
returned it. Nothing fabricated; no new parameter on `presentUnderWire`. `scripts/lib/predicate-device-key.mts`
needed no change.

### Payments

No x402 rail, no payment-mandate builder and no `@agenticprimitives/payments` import anywhere in this repo. The
member-gated payment is: the door issues a pay-ticket (`apps/door/src/index.ts`, HMAC over terms it reads from its
own receipt), the payer's agent pays treasury to treasury through its own Home, and the door reads the transfer on
chain at `/federation/pay-ticket/settled`. Cross-estate payment (`gate-f3-pay-outward`, gate-f2 §6) asks the
receiving estate's harness and presents `[child, standing]` from `deriveFromStanding`, whose signature is
unchanged. The stricter chain verification lands in the Home's harness (ap-home), not here. Nothing to change;
the gates must be re-run once ap-home is on the new packages.

### Other changed APIs, grepped

Not used in this repo: `delegationMandateVerifier`, `verifyAuthorityChain` / `assembleAuthorityChain`,
`createX402Rail`, `withStandardCardFields`, `pushNotifications`, fabric exchange stores, `AcpHost`,
`runtime-member`, `resolveParty`.

## 2. Verification

Under a temporary root `pnpm.overrides` linking `estate-projection`, `admission`, `delegation` and `a2a` to the
local packages (plus `@agenticprimitives/audit@1.0.0-alpha.34` as a temporary devDependency — linking dropped
key-custody's optional peer; an override artefact, not an API error):

- `pnpm -r typecheck`: all 8 workspaces pass.
- `pnpm -r test`: all pass — projector 42 (was 32), door 22 (was 11), others unchanged.
- The three changed scripts typecheck clean (ad hoc tsconfig; the other scripts have pre-existing errors and are
  not typechecked by any workspace).
- `presentUnderWire` exercised offline with test keys and a stub backend: a good chain signs; a revoked standing
  wire is refused (`chain-link-dead … delegation is revoked`); a standing wire not signed by the holder is refused
  (`delegation signature did not verify`).
- `check:public-links` and `check:federation` pass after the overrides were removed.

Overrides removed; `package.json` and `pnpm-lock.yaml` restored with `git checkout`; `node_modules` reinstalled
frozen at the pinned versions.

Not verifiable offline — re-run after publish, in this order:
`gate:freshness`, `scripts/gate-f1-projection.mts` (both estates), `gate:door`, `gate:twin`, `gate:predicate`,
`gate:member-payment`, `gate:pay-outward`, `gate:pap-twin`, `gate:site`.

## 3. Pins to bump

The new version numbers do not exist yet. On the branch the packages stand at estate-projection `0.0.0-alpha.20`,
admission `0.0.0-alpha.21`, delegation `1.0.0-alpha.45`, a2a `0.0.0-alpha.47`; the release will be above those.

| Package | Current pin | Where |
| --- | --- | --- |
| `@agenticprimitives/estate-projection` | `0.0.0-alpha.16` | root, `apps/door`, `apps/projector` |
| `@agenticprimitives/estate-projection` | `0.0.0-alpha.12` | `apps/door/verifier` (issuer status only; compatible either way, bump with the rest) |
| `@agenticprimitives/admission` | `0.0.0-alpha.18` | root, `apps/door`, `apps/pap-door` |
| `@agenticprimitives/delegation` | `1.0.0-alpha.41` | root, `apps/door`, `apps/projector` |
| `@agenticprimitives/a2a` | `0.0.0-alpha.42` | root, `apps/pap-door` |
| `@agenticprimitives/privacy-credentials` | `0.0.0-alpha.18` / `.14` | root + `apps/door` / `apps/door/verifier` — see "Arrived during this work" before bumping |
| `agentic.lock.json` | estate-projection `.14`, admission `.16`, delegation `.39`, a2a `.40` | regenerate with `pnpm upgrade:pin` |

estate-projection, admission and delegation must move together: the door passes an async `verify` and reads
`grade`, the projector needs `commitmentOfV1`, the holder script needs the release's `holder` and `chain`.

## 4. Migration order for the live estates

1. Publish the packages; bump the pins here; `pnpm check`.
2. **Projector first.** Deploy the projector (`pnpm projector:deploy`) and run `pnpm projector project --estate
   impact-agent` and `--estate faithnet` (dry-run first: expect "anchor at sequence N+1"). Each estate's roots
   become v2. From this moment a door still on the old package refuses every presentation from that estate
   (`suite_unsupported`), and the F2 gates are red until step 3.
3. **Doors next**, both envs (`pnpm door:deploy`). They accept v2 only.
4. Re-run the gates listed above.

There is no order with zero refusals: an old door cannot verify a v2 leaf, and a new door refuses v1 by default.
Doing steps 2 and 3 back to back keeps the gap to minutes. No contract change — `EstateProjectionRegistry` stores
roots. Issuer rows do not move.

**`ACCEPT_BEARER_V1`** is the alternative, and it is the owner's decision: deploy the doors first with
`ACCEPT_BEARER_V1 = "true"`, re-anchor each estate, then redeploy without it. It is implemented as an explicit
setting, off unless the value is exactly `"true"`, unset on every env in this tree. While on, a v1 admission is
graded bearer on the receipt (`FOREIGN_ESTATE_BEARER_GRADE`), `/health` reports `acceptsBearerV1: true`, and no
standing header is forwarded — so the F2/F3 forwarding checks fail while it is on. Listed as item 7 in
`docs/runbooks/before-real-users.md`. With two estates and one operator, the back-to-back order above needs no
allowance.

## 5. Arrived during this work — reported, not verified

These landed in the primitives working tree after the packages were built, and were not in the brief. Each
changes something this repo does.

1. **admission ING-2 — `ABSTAIN`, `NO_AFFIRMATIVE_OPINION`.** `foreignEstateEvaluator` and
   `credentialPresentationEvaluator` abstain when nothing is cited, and the engine denies a decision nobody
   affirmed. This door's evaluators are only those two, so **a knock with no presentation and no credential
   becomes a DENY**. Today it is admitted "as nobody-foreign" and forwarded; `scripts/gate-f2-door.mts:271-272`
   asserts that ADMIT. Not changed here — see open question 2. `NO_AFFIRMATIVE_OPINION` is also not in the door's
   public-reason filter (`apps/door/src/index.ts`, `publicReasons` and `PUBLIC_CODE`).
2. **privacy-credentials DATA-7 — the verifier states what it trusts.** `ProofRequestV1` gains `credentialTypes`
   and `acceptedIssuers` (or an injected `isTrustedIssuer`); verification refuses with `credential_type_unstated`
   / `issuer_trust_unstated` otherwise, and openac refuses with `status_check_unstated` unless a status check is
   injected or declared unnecessary. Call sites: `apps/door/src/credential.ts:72` (`proofRequestFor`),
   `apps/door/verifier/server.mjs:132` (`verifyPresentation`), and the holder's mirror
   `scripts/lib/predicate-holder.mts:58`. The door already filters issuers itself (`acceptedIssuers`), so the data
   is at hand; the request shape and the verifier call need it passed. `holderSecret` is now strictly 32 bytes of
   hex (`pairwiseAccountFor` in `predicate-holder.mts` does its own HMAC and is unaffected).
3. **a2a RUN-9 — a session wire names its target.** `checkSessionWireShape` requires
   `enforcers.allowedTargets` and `opts.target`. `scripts/issue-door-session-wire.mts:55` is updated for it (the
   wire it mints already carries the `allowedTargets` caveat). This one edit was not typechecked against a built
   a2a. `apps/pap-door` only signs with the wire (`sessionWireSigner`) and is unaffected.

## 6. Open questions for the owner

1. **The chain a foreign subject's signature is read on.** Implemented as the presenting estate's declared home
   chain from the register (`homeChainId ?? chainId`). Confirm that, and confirm the consequence: an estate absent
   from this door's bundled register can no longer be admitted on a presentation at all (`SUBJECT_CHAIN_UNDECLARED`).
   If estates outside the register must be admissible, the chain has to be declared somewhere the door can read
   without trusting the presenter — for example on the registry row. The door does not additionally require the
   request proof's chain to equal the estate's home chain; say if it should.
2. **A visitor with no evidence** (item 1 above): should this door refuse it (then flip the gate's last check to
   expect 403 with `FOREIGN_ESTATE_NOT_PRESENTED`), or should the door carry an evaluator of its own that affirms
   a request-proof-authenticated visitor as "nobody-foreign"?
3. **Bearer and the standing header.** A bearer-grade admission forwards no `x-ap-foreign-standing`. The
   alternative is to forward it with the grade, which needs the Home's runtime to read a grade. Only matters if
   `ACCEPT_BEARER_V1` is ever turned on.
4. **F1 now needs the gate's test key and the estate's home-chain endpoint.** Confirm the nightly job has
   `.secrets/f2-test-agent.env` and `HOPECHAIN_RPC_URL` where F1 runs.
5. **An RPC failure during the signature read** surfaces as `FOREIGN_ESTATE_SUBJECT_SIGNATURE_INVALID` (Ring 0
   catches the throw inside `verifyAuthorityPresentation`), not as an unreadable-anchor INDETERMINATE. Fail-closed
   either way; the receipt cannot tell an outage from a forgery.

---

# Second pass — 2026-11-10 (afternoon)

Built on the first pass above; nothing in it was reverted. Still nothing committed, pushed, deployed or anchored,
no live gate run, no `.env` secret read. This pass closes the three items the first pass listed under "Arrived
during this work" (admission ING-2/ING-3, credentials DATA-7/17/18, session wires RUN-9) and applies the
`.impact` and `npx ap` decisions.

## A. `.impact` name root — nothing to change here

Grep of the worktree: two hits. `specs/440-…:131` and `federation.yaml:508-509` name **tenant `impact`**, a
key-service tenant id of the retired base-sepolia estate — not a name root; kept. `.cursor/rules/
service-agent-signing.mdc:32` (`<name>.impact`) is a projection of the pinned devkit's rule: editing it by hand
makes `ap doctor --rules` report drift, so it is left and changes with the devkit pin
(`pnpm upgrade:pin <version> && pnpm exec ap doctor --rules --write`).

**Possible live `.impact` names: none found in this repository.** No config change.

## B. `npx ap` → the pinned local install

`.mcp.json` and `.cursor/mcp.json` are now the template's, byte for byte:
`node node_modules/@agenticprimitives/devkit/bin/ap.mjs mcp --root .` (the pinned devkit `0.0.0-alpha.29` has
`bin/ap.mjs`; checked). No doc or script in this repository said `npx ap`. `agentic.lock.json` has no
`definitions` pins, so nothing to re-pin; if one is ever added, the pin is the digest of the committed snapshot
under `.agentic/definitions/`, made by the owner with `pnpm exec ap upgrade --pin-definitions <registry> <key>`.

## C. Admission (ING-2, ING-3)

| Where | Change |
| --- | --- |
| `apps/door/src/index.ts:278` | `acceptedAudiences: [env.PUBLIC_ORIGIN]`. Request proofs at this door are signed for its origin (`verifyRequestProof({ expectedAudience: env.PUBLIC_ORIGIN })`), and the engine's default is `[boundaryId]`. Without this line every knock is `REQUEST_AUDIENCE_MISMATCH`. |
| `apps/door/src/index.ts:347`, `:376`, `:529` | `NO_AFFIRMATIVE_OPINION` is a public reason code (the knock's summary, the public ledger face) and the refusal says what was missing. |
| `apps/door/src/index.ts:17-21` | Header: no evidence, no admission. |
| `scripts/gate-f2-door.mts:272-277` | The last check is flipped: a knock with no presentation is **403 DENY** with `FOREIGN_ESTATE_NOT_PRESENTED` + `NO_AFFIRMATIVE_OPINION`; a second check knocks `/a2a` and asserts the estate's door is never asked. 10 refusals. |
| `scripts/gate-predicate-visitor.mts:232-235` | Same flip for "no credential at all". |
| `docs/architecture/how-it-works.md`, `live-gates.json` (f2-door, predicate-visitor `twin`) | Say the refusal. |
| `apps/door/test/admission-policy.test.ts` (new, 6 tests) | The engine composed as the door composes it: origin audience admits; the default audience refuses (the twin for `:278`); a proof for another door refuses before any evaluator; no evidence refuses with every contribution `ABSTAIN`; a credential alone admits (`ALLOW` + `ABSTAIN`); an abstention never outvotes a refusal. |

**The choice made (the owner has not decided): fail closed.** A visitor who authenticates and cites neither a
foreign presentation nor a credential is refused. **The alternative, not built:** an explicit, named evaluator of
this door's own — for example `door-public-surface` — that votes `ALLOW` for a request-proof-authenticated visitor
on a *declared* public surface only (`doors[].publicSurface: { operations: [SendMessage], capabilities:
[harness.read] }` in the register), writes its own reason code (`DOOR_PUBLIC_SURFACE`) so the receipt says the
visitor was admitted as nobody-foreign, and abstains for anything outside that surface. It would restore the old
behaviour for reads while keeping "nothing cited" visible on every receipt.

**ING-3 (`IDEMPOTENCY_IN_PROGRESS`, `retryable: true`).** Nothing in this repository runs an execution point or
an idempotency store (`createExecutionPoint`, `IdempotencyStore`, `ExecutionDecision`: no hits). The door issues
admission decisions and forwards; `apps/pap-door` forwards to the company agent and reads an A2A task state.
Neither can receive a retryable deny, so there is nothing to handle. If the estate's runtime (ap-home) returns
one to a forwarded request, the door passes the origin's response through unchanged.

## D. Credential presentations (DATA-7, DATA-17, DATA-18)

| Where | Change |
| --- | --- |
| `apps/door/src/credential.ts:82` (`proofRequestFor`) | Takes the register's issuers. `acceptedIssuers` = the `sa` of the issuers the door's policy names by id (`credentialProofs.issuers` → `credentials.issuers[].sa`, lower-cased, deduplicated). `credentialTypes` = `credentialProofs.credentialTypes`. Neither is defaulted: absent ⇒ absent from the request ⇒ the suite refuses (`credential_type_unstated` / `issuer_trust_unstated`). |
| `apps/door/src/credential.ts:29`, `:47` | `DoorCredentialPolicy.credentialTypes`; `RegisterIssuer.facets[].document.facet.credentialTypes`. |
| `apps/door/src/index.ts:258`, `apps/door/src/credential.ts:153-168` | **Verify, then consume.** The pre-verification consume at the old `:244` is gone. `credentialVerify` spends the challenge in the ledger DO only after the verifier's verdict is valid, then stores the nullifier. The DO's insert-if-absent is the atomic step: of two valid answers to one challenge, one is admitted and the other is `CREDENTIAL_NONCE_REPLAYED`. A junk bundle no longer burns a visitor's nonce. |
| `apps/door/src/credential.ts:164` | `status` is sent to the verifier as the register states it; it used to default to `none`. |
| `apps/door/verifier/server.mjs:107`, `:133-139` | `required` → the existing real check (the issuer's live-credential row read on neutral ground through `issuerRootsOf` + `verifyCredentialStatusPresentation`). `none` → `acceptUncheckedStatus: true`, because the register said so in words. Unstated → neither, and the suite refuses `status_check_unstated`. The verifier's clock is passed (`now`) for the facet's validity window. |
| `apps/door/src/index.ts:428` | `GET /federation/credentials` reports `credentialTypes` (or `null`). |
| `scripts/setup-predicate-issuer.mts:55`, `:130`; `scripts/publish-issuer-facet.mts:32`, `:51` | **`--credential-types <a,b>` is required.** The facet is signed with `credentialTypes`. A facet on file with other types — or none, as every existing one — is re-published: same key and key id, new facet hash, new SA signature, new attestation. `setup-predicate-issuer` also refuses a type the receiving door does not ask for. |
| `scripts/lib/predicate-holder.mts:29`, `:67`; `apps/site/src/federation.ts:106` | The type carries `credentialTypes`; the holder states it in its mirror of the request. |
| `docs/runbooks/before-real-users.md` row 8 | `status: none` / `acceptUncheckedStatus`: used by no door; listed so it stays that way. |
| `apps/door/test/credential.test.ts` | +5 tests: types and issuer accounts from the register; the "no any" twin; challenge spent after verification and before the nullifier, junk does not burn it, a second valid answer is a replay; status reaches the verifier unstated when unstated. |
| `scripts/gate-predicate-visitor.mts:218-231` | The replay twin expects `CREDENTIAL_NONCE_REPLAYED` (or `…_MISSING` if the ten-minute hold lapsed); new twin: a junk bundle under a fresh challenge is refused and does not burn it. |

**`acceptUncheckedStatus` is used unconditionally nowhere.** The door has a status source and uses it.

**Not done, and why: `credentialProofs.credentialTypes` is not set in `federation.yaml`.** The register names
which issuers the door trusts (`issuers: [imbnet-membership-issuer, imbnet-org]`) but nothing in this repository,
in the issued credentials or in Ring 0 names a credential *type* — the SD-JWTs the ceremonies issue carry no
`vct`. The name is written once in the register and once into each facet the organization signs and attests on
chain, so it was not invented here. `federation.yaml:160-168` has the commented line and the reason. **Until it
is set the door refuses every credential presentation** (`CREDENTIAL_CREDENTIAL_TYPE_UNSTATED`) once it runs on
the new packages — fail closed, visible at `/federation/credentials` as `credentialTypes: null`.

**Issuers that must re-publish their facet** (every facet in the register was signed before 2026-11-10 and
declares no type; until re-signed it is refused `credential_type_unbound`, and both predicate gates are red):

| Issuer | Key id | Chain | Signed by | Script |
| --- | --- | --- | --- | --- |
| `imbnet-org` | `issuer-key:sd-jwt:imbnet-org-1` | 34349 | maya, via www.impact-agent.me | `publish-issuer-facet.mts` |
| `imbnet-membership-issuer` | `issuer-key:sd-jwt:imbnet-membership-issuer-1` | 34348 | maya | `setup-predicate-issuer.mts` |
| `lbsb` | `issuer-key:sd-jwt:lbsb-1` | 34348 | ruth, via www.faithnet.me | `publish-issuer-facet.mts` |
| `faithnet-gate-issuer` | `issuer-key:sd-jwt:faithnet-gate-issuer-1` | 34348 | demo-admin | `setup-predicate-issuer.mts` |

After each: paste the printed facet under the issuer's `facets:` in `federation.yaml`, and for `imbnet-org` and
`lbsb` update the facet record in the organization's vault (ap-home `scripts/put-issuer-facet.mts`). The old
attestations stay on chain and name facets no verifier accepts.

## E. Session wires (RUN-9) and the key-service fixtures

- `scripts/issue-door-session-wire.mts:55` (the first pass's untested edit) matches the current a2a source:
  `checkSessionWireShape(wire, { timestamp, allowedMethods, allowedTargets }, now, { target, skill })`, and the
  wire it mints already carries the `allowedTargets` caveat for the one company agent. It typechecks against the
  linked a2a. The PAP door calls one company agent, so one wire per target is what it already is.
  **The existing door session wire needs no re-mint if it was minted by this script** (it has the caveat); a wire
  minted any other way without it does.
- `apps/pap-door/test/door.test.ts` and `packages/key-service-account/test/key-service-account.test.ts`: **no
  change needed.** Both stand-in key services already sign each digest with a real test key
  (`privateKeyToAccount(…).sign({ hash })`) and return that key's address, so key-custody's new recovery of the
  signer passes. Run against the linked key-custody: 5/5 and 3/3. (The pap-door fixture's *session wire* carries a
  placeholder signature; nothing in that test verifies it — the company agent's edge does.)

## G. Other changed APIs, grepped

No use of `verifyAgentSession`, `verifyCredential`, `verifyVerificationReceipt`, `verifyAuditChain`, `recordOf`,
`createX402Rail`, payment-mandate signing, `fetchProfile`, `withStandardCardFields`, `createServiceHost` /
`runTurn`, `AcpHost`, `ap runtime serve`, `hashA2aMessage`, or registry-kit admission (`registry-kit` is imported
for `clientMetadataDocument`, `jwkThumbprintSync`, `companyDoorProfile` only).

## Config changes (before → after)

| File | Before | After |
| --- | --- | --- |
| `.mcp.json`, `.cursor/mcp.json` | `npx ap mcp --root .` | `node node_modules/@agenticprimitives/devkit/bin/ap.mjs mcp --root .` |
| `federation.yaml` → `doors[impact-agent].credentialProofs` | no `credentialTypes` | **owner to add** `credentialTypes: [<name>]` (commented placeholder at `:168`) |
| `federation.yaml` → `credentials.issuers[].facets[].document` | four facets without `credentialTypes` | **owner to replace** with the re-published facets |

No deploy var changes. The door's `PUBLIC_ORIGIN` and `BOUNDARY_ID` are unchanged.

## Verification (offline)

Under a temporary root override linking a2a, admission, agent-profile, attestations, delegation,
estate-projection, intent-engagement, key-custody, privacy-credentials, privacy-credentials-openac, registry-kit,
verification-receipts (+ audit) to the local packages — `dist/` of a2a, admission, intent-engagement and
registry-kit rebuilt at 14:07–14:15, the rest already current:

- `pnpm -r typecheck`: all 8 workspaces pass.
- `pnpm -r test`: all pass — door **32** (was 22), projector 42, pap-door 5, key-service-account 3,
  personal-agent-client 11, pap 3, site 16, nanda-adapter 20.
- The six changed scripts typecheck clean in the lines changed (ad hoc tsconfig; the five remaining errors are
  pre-existing, in lines this pass did not touch). `node --check apps/door/verifier/server.mjs` passes.
- Overrides removed; `package.json` and `pnpm-lock.yaml` restored byte-identical (`git status` clean for both);
  `node_modules` reinstalled frozen. At the pins: `check:federation`, `check:public-links`, `ap doctor` pass; the
  tree does not typecheck until the pins move (as the first pass said).

**Not verifiable offline:** the door Worker's `admit()` end to end (chain reads, the ledger DO, the verifier
Container); `apps/door/verifier/server.mjs` against a real proof; both ceremony scripts (they sign through a Home
and send a transaction); the new junk-bundle twin in the predicate gate.

**Live gates to re-run after publish, in order:** `gate:freshness`, `f1-projection` (both estates), `gate:door`
(`f2-door`), `gate:twin` (`f3-twin`), `gate:predicate` (`predicate-visitor`) and `gate:member-payment` — both
only after the credential type is named and the four facets are re-published — then `gate:pay-outward`,
`gate:pap-twin`, `gate:vault-record`, `gate:site`.

## Pins to bump (versions are the branch's; the release will be at or above them)

| Package | Pin now | Branch | Where |
| --- | --- | --- | --- |
| `admission` | `0.0.0-alpha.18` | `.21` | root, `apps/door`, `apps/pap-door` |
| `privacy-credentials` | `.18` / `.14` | `.21` | root + `apps/door` / `apps/door/verifier` |
| `privacy-credentials-openac` | `.6` / `.2` | `.10` | root / `apps/door/verifier` |
| `a2a` | `.42` | `.47` | root, `apps/pap-door` |
| `key-custody` | `1.0.0-alpha.41` | `1.0.0-alpha.45` | `packages/key-service-account` |
| `estate-projection`, `delegation` | first-pass table | | |
| `registry-kit`, `agent-profile`, `attestations`, `intent-engagement`, `verification-receipts`, `devkit` | move with the set | | |

admission, privacy-credentials and privacy-credentials-openac must move together with the door and its verifier.

## Open questions (added to the first pass's five)

1. **A visitor with no evidence** — refused (built), or affirmed by a named public-surface evaluator (described
   in C)? This replaces first-pass question 2.
2. **The credential type's name** for the membership credential, and whether `lbsb`'s licence credential is a
   second type. Blocks both predicate gates.
3. **`status` unstated now refuses.** A door with `credentialProofs` and no `status` line used to mean `none`.
   Only one door has a policy and it says `required`, so nothing changes today; confirm the stricter reading.
4. **Old attestations.** Re-publishing leaves each issuer's earlier facet attestation live on chain. Revoke them,
   or leave them as history?

# Third pass — 2026-11-10 (generation 4 B2: estate registry, attestations, engagement)

Done against the final package APIs (read from `git diff master` and the 2026-11-10 AUDIT notes of estate-projection,
attestations, admission, intent-engagement).

## Done

| Item | Change |
| --- | --- |
| Estate registry rows `(estateId, signer)` — projector | `apps/projector/src/anchor.ts`: `register`/`signerOf` gone; ABI is the package's `estateProjectionRegistryAbi`; `roots(estateId, signer)`, `isRetired`; `setRoots` refuses a wire whose delegator is not the row signer. `project.ts`: `rowSignerOf` (declared signer wins; register claim must agree; undeclared warns), retired refused. `issuer.ts`: row = `rowSigner ?? sa`. `bin/projector.mts`: `status`/`present`/`verify` read the declared signer's row; `register` is now an explanatory refusal. `worker/index.ts` `/status` reads the register signer's row. |
| Door | `apps/door/src/index.ts`: `declaredSigner` (the estate's `atl:projectionSigner` on its chain; none ⇒ refused `FOREIGN_ESTATE_SIGNER_UNDECLARED`) and `readRoots(estateId, signer)` through `readAnchoredRoots` (retired ⇒ refused; an issuer-tagged row ⇒ read as unanchored + `FOREIGN_ESTATE_ROW_IS_AN_ISSUER_ROW`). The hand-written F2.5 `signerOf` cross-check is removed (closed by construction); the receipt still carries `FOREIGN_ESTATE_SIGNER_DECLARED` on an admission. |
| Verifier | `apps/door/verifier/server.mjs` reads `isRetired` + `roots(issuerId, rowSigner)`; the door now sends `rowSigner` (`credential.ts`, `RegisterIssuer.rowSigner`, default the issuer SA) per facet. |
| Gates | `gate-f1-projection.mts` reads the declaration first (fails if undeclared or different from the register), then only that row; `gate-f2-door.mts` reads the register signer's row. |
| Attestations | `setup-predicate-issuer.mts`, `publish-issuer-facet.mts`: the digest carries `offchainCredentialStatusList` (zero: none declared); `assertAssociation` is sent BY the issuer SA through its Home (`scripts/lib/send-as-account.mts`, the `build-call-userop`/`submit-call-userop` path `bind-client-key.mts` uses). `publish-issuer-facet` no longer takes `--sender-key-file`. |
| Engagement | `personal-agent-client` `refOf`: authority is the issuer as a canonical https origin (`authorityOfIssuer`; userinfo refused). |
| Tests | door fixtures take the signer; projector `rowSignerOf` tests; client authority tests. |
| Docs | runbooks/README/operating/how-it-works: no `register` step. |

## Blocked / left deliberately

- **Credential type NAME** — still the placeholder in `federation.yaml` (~168); not invented. Blocks both predicate gates and every facet re-publish.
- **openac local patch entry** — `patches/openac-sdk@5.0.0.patch` stays until the openac pin moves; drop `pnpm.patchedDependencies` and `scripts/lib/predicate-holder.mts`'s local handling only after the bump is verified.
- `scripts/` import `@agenticprimitives/agent-account` (new `send-as-account.mts`, and existing `bind-client-key.mts`), which is not a root devDependency — add it at the bumped pin.
- Pre-existing, untouched: ad hoc typecheck of `scripts/` still shows errors in `bind-client-key`, `gate-pap-twin`, `gate-f3-pay-outward`, `setup-predicate-issuer.mts` lines ~117/185.

## Owner actions

1. Each estate must **declare** `atl:projectionSigner` (ap-home `set-projection-signer.mts`) — verifiers now read no row without it. Both estates were declared before; confirm the declared address equals the registry agent that is the anchoring wire's delegator.
2. **Re-anchor every estate** under the new registry generation: the first `projector project` writes the signer's row at sequence 1 (the contract's generation-4 rows are fresh) — and v2 leaves (first pass). Issuers likewise: `projector project --issuer <id>` for every issuer that has a row.
3. **Issuers that must re-publish facets** (new digest incl. status list, SA-sent attestation, credential types): `faithnet-gate-issuer`, `imbnet-org`, and every issuer with a `facets[]` in `federation.yaml` (four facets today). Run `setup-predicate-issuer.mts` / `publish-issuer-facet.mts` after the credential type is named; paste the new documents.
4. Old facet attestations stay live on chain; with generation 4 an issuer re-attesting the same content under a new salt after revocation reverts — a new `credentialHash` is a new facet.
5. Live gates to re-run after publish, in order: `gate:freshness`, `f1-projection`, `gate:door` (`f2-door`), `gate:twin`, then `gate:predicate` and `gate:member-payment` (need the type name), then `gate:pay-outward`, `gate:pap-twin`.
6. Pins to bump (with the earlier table): `estate-projection`, `attestations` (to the branch's generation-4 release), `admission`, `agent-account` (add as root devDependency).

## Verification (offline, third pass)

Temporary root `pnpm.overrides` linking 23 local packages; typecheck of all 8 workspaces clean; tests: door 32, projector 45, personal-agent-client 13, others unchanged, all pass. `node --check` on the verifier. Overrides removed and `package.json` / `pnpm-lock.yaml` restored byte-identical.

## 2026-11-10 — owner answers

- `.impact` agents: confirmed retired by the owner. No migration; the retired on-chain addresses stay recorded as history.
- Door credential type: `https://agenticprimitives.dev/vct/organization-membership/v1` (the organization's membership credential, spec 444; it also carries the age attribute the over-18 predicate reads). Set in `federation.yaml` `credentialProofs.credentialTypes`. Owner action after the pin bump: re-publish each accepted issuer's facet with `--credential-types https://agenticprimitives.dev/vct/organization-membership/v1` (`scripts/publish-issuer-facet.mts` / `setup-predicate-issuer.mts`) for `imbnet-membership-issuer` and `imbnet-org`; any SD-JWT issuance of this credential must set `vct` to the same string.
