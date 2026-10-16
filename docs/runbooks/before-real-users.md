# Before real users: settings relaxed for testing

There are no operational users yet (2026-10-16), so some settings are set for fast test cycles rather than for
production. Each row says what it is now, what it should be, and where to change it. Tighten every row, redeploy, and
re-run the named gate before the first real person relies on a door.

| # | Setting | Now (testing) | Before real users | Where | Re-run |
|---|---|---|---|---|---|
| 1 | Nullifier window at the impact-agent door (one visit per device key per audience per window) | 300 s (must exceed one gate run, whose reuse twin knocks minutes after the first) | 3600 s or longer, the door's real "one visit" rule | `federation.yaml` → `doors[impact-agent].credentialProofs.nullifier.windowSeconds`; then `pnpm door:deploy` | `gate:predicate`, `gate:member-payment` |
| 2 | Holder caller tokens for the key service, one per tenant (`ap-federation-holder` in faithnet, `ap-federation-holder-imb` in imb) | 90-day EdDSA tokens from the pilot issuer, in `.secrets/predicate-visitor.env` as `AKCS_HOLDER_TOKEN` and `AKCS_HOLDER_TOKEN_IMB` | A short-lived token from a workload identity, minted per run | faithkms `[auth]`; `akcs dev mint-token` is a pilot tool | `gate:predicate` |
| 3 | Bound-evidence issuer | The ceremony's own ES256 key (`PREDICATE_EVIDENCE_ES256_KEY`), pinned in the key service's `[authority_evidence]` JWKS | The Home runtime's own attestation key, held as a runtime secret, its JWKS pinned in place of the ceremony's | `/etc/akcs/evidence/jwks.json` on the CVM; ap-home runtime | `gate:predicate` |
| 4 | Member-payment ticket and predicate windows | 900 s each | Review against how long a real member takes to pay; shorter is safer | `doors[impact-agent].membershipPayments` | `gate:member-payment` |
| 5 | Receipt full-record window | 30 days | Set from the organization's dispute window, then leave | `doors[].receipts.fullRecordDays` and `RECEIPT_FULL_RECORD_DAYS` | `gate:predicate` |
| 6 | Membership issuer | imbnet's registry agent stands in for a visitor from ANOTHER estate (alice, faithnet); the organization's own agent issues to its own members on hopechain (`imbnet-org`, spec 444, LIVE 2026-10-16) | Cross-estate membership (spec 444 §2.2 option c); then retire the stand-in from the trust set | `credentials.issuers`, `credentialProofs.issuers` | `gate:predicate` |

Not on this list because they are not test relaxations: the asserted nullifier grade, the linkable status proof, and
network privacy. Those are real limits, recorded in `docs/architecture/decisions-and-findings.md` and the essay.
