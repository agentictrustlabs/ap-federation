# Proposal to the Personal Agent Protocol: an optional `proof` on confirm

**To:** the Personal Agent Protocol working group (personalagentprotocol.org, draft 0.1, via its feedback path)
**From:** Agentic Trust Labs (agenticprimitives.dev) — the authors of an estate-run personal-agent service that presents under PAP
**Status:** draft for submission, 2026-10-16. Nothing in this proposal changes a required field or breaks an implementation of 0.1.

## The sentence this closes

Operations §8 says what a confirmation proves and what it does not: *"It doesn't prove that the User saw the terms or approved them. The Company can't see the Personal Agent's interface, so `approved_by` works on trust, like the sign-in types. … A Company that needs proof of the User's approval for an action can ask the User to approve on its own website."*

That last clause is the cost of the hole: every company that needs proof builds its own approval page, and the Personal Agent is cut out of the one moment the protocol exists for. We run personal agents whose approval is already a cryptographic act — the user's own account signs the exact terms before the agent may confirm — and today we have nowhere to put that signature. This proposal adds one optional field so a company that wants proof can accept it from the agent instead of sending the user to a website, and a company that does not want it ignores the field.

## The change

In the confirm request (Operations §5.2), an optional `proof`:

```
POST …/poppy/operations/exc_5Rt2/confirm
{ "revision": 1, "approved_by": "user",
  "proof": { "grade": "identity", "jws": "eyJhbGciOiJFUzI1NiIs…" } }
```

| `proof.grade` | what it is | what a company learns |
| --- | --- | --- |
| `identity` | a compact JWS over `operation_id ‖ "." ‖ revision ‖ "." ‖ terms_digest`, signed by **the user's own account key** (not the Personal Agent's), where `terms_digest` is SHA-256 over the RFC 8785 canonical JSON of the revision's `terms`. The JWS header carries `kid` and, for a smart-contract account, `x-caip10` (the account's chain id and address) so the company can validate the signature through the chain's standard account-signature check (ERC-1271) instead of a bare key. | *this specific user's account approved exactly these terms* — the thing §8 says is missing. |
| `standing` | a blinded-membership presentation: a Merkle inclusion proof that *some* live grant in a named estate covers this `terms_digest`, against a root the estate anchored in public (we publish ours on a neutral registry contract), bound to a challenge the company issued. The company learns that an estate stands behind the approval; it does not learn which user. | *an accountable estate vouches for this confirmation* — for users who must stay nameless at the company, the §4.2 User ID is already opaque; this keeps the proof as opaque as the ID. |

Rules:

- `proof` is optional. A company that does not list `proof_grades` in its `poppy.json` operations extension ignores it. A company that lists them may return `proof_required` (HTTP 403, with `proof_grades`) when a confirm arrives without one it accepts.
- A `proof` never widens `approved_by`: a `standing` proof with `approved_by: user` still means the user approved; the proof is evidence about that claim, not a second approval channel.
- The company's challenge, when it wants one, rides on the proposed operation as `proof_challenge` (≥128 random bits, single use, bound to the operation id and revision). `identity` proofs include it in the signed string when present; `standing` proofs require it.
- A proof is over the *revision*. A new revision needs a new proof, exactly as it needs a new approval (§5.1).

Discovery addition (an excerpt from `poppy.json`):

```
"extensions": { "operations": { "version": "1", "endpoint": "…", "proof_grades": ["identity", "standing"] } }
```

Client metadata addition: a Personal Agent that can produce proofs lists the grades it can make under `extensions.operations.proof_grades`.

## Why this shape

- **It costs a company nothing it does not already do.** UCP checkouts carry AP2 mandate JWTs in the body; the `identity` grade is the same discipline, one signature over a digest, validated with libraries every company already has. The `standing` grade is a Merkle proof against a public root — a few hundred bytes, verified offline.
- **It keeps §4.2's privacy.** The User ID is opaque; `standing` keeps the proof opaque too. A company that wants a named signature asks for `identity` and gets it only from users whose agents are willing to name them.
- **It does not touch the trust rules for sign-in.** Sign-in types still work on trust (spec 4.4). This is only about the approval of an operation's terms, where there is a precise thing to sign.
- **It is what we run.** Our personal-agent service confirms only after the user's account has signed a mandate bound to the revision's terms digest; `approved_by: user` is produced by that signature and by nothing else. The `proof` field is the same object, shown to the company.

## What we are not proposing

- No change to `approved_by`'s meaning, to `standing_permission`, or to §8's honesty about what a plain confirmation proves.
- No requirement that companies verify proofs, publish roots, or know about any particular chain. `identity` works with any key the company can resolve from the proof; the CAIP-10 header is only for accounts that are contracts.
- No new sign-in type.

## Reference implementation

- The client side: `@ap-federation/personal-agent-client` (`confirmOperation` attaches `proof` at the grade the user's posture allows).
- The digest and the approval rule: Ring 0 `@agenticprimitives/intent-engagement` (`externalOperationIntentDigest`, `externalApprovedBy`).
- The `standing` presentation: `@agenticprimitives/estate-projection` (`makeAuthorityPresentation` / `verifyAuthorityPresentation`), roots on `EstateProjectionRegistry`.

We would be glad to contribute test vectors and a stub company that accepts both grades.
