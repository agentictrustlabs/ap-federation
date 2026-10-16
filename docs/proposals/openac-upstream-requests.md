# Two requests to OpenAC (privacy-scaling-explorations/zkID), from the agenticprimitives deployment

Drafted 2026-10-16 for the owner to file. Both are things our gate runs on today and the essay records as owed; neither
can close on our side alone.

## 1. `deviceSign`: a signer callback on `present()` (pull request, patch attached)

**What we run.** `openac-sdk@5.0.0` with a 43-line patch (`patches/openac-sdk@5.0.0.patch`, applied by pnpm on every
install). `PresentRequest` gains an optional `deviceSign(challengeBytes) → Promise<Uint8Array>`; `devicePrivateKey` becomes
optional; exactly one must be given. The callback returns the ES256 signature over the UTF-8 challenge bytes (SHA-256
inside), raw 64-byte `r || s`, and the prover REFUSES a high-S result (the SD-JWT-P256 profile requires low-S) or a
wrong length — so a callback cannot quietly produce a presentation the verifier would reject.

**Why.** The device key a credential is bound to (`cnf.jwk`) should be custodied — in a KMS, a secure element, a
confidential VM — and never present as a scalar in the prover's process. Today our device key lives in a key service
that signs only under a per-signature authorization (the release's attestation of what it judged); the prover sees a
signature, never the key. With `devicePrivateKey` as the only input, every holder must hold the scalar in memory.

**Shape.**
```ts
interface PresentRequest {
  precomputed: PrecomputedCredential;
  verifierNonce: string;
  devicePrivateKey?: EcdsaPrivateKey;                       // in process
  deviceSign?: (challengeBytes: Uint8Array) => Promise<Uint8Array>; // in custody
  keys: KeySet;
  predicates: PredicateExpression;
}
```
`present()` throws `INVALID_KEY` with neither, `INVALID_SIGNATURE` on a non-64-byte or high-S result. No change to the
circuit, the credential format or the verifier. The patch is against `dist/` because we consume the published package;
the source change is the same ten lines in `Prover.present`.

**Evidence it works.** Our live gate (`gate:predicate-visitor`, 21 checks) presents with a key held by a key service on
a confidential VM; the verifier is unmodified `openac-sdk@5.0.0`.

## 2. An in-circuit nullifier (feature request)

**What we run.** The `asserted` nullifier grade: the holder derives `H(device key, audience)` outside the circuit and
asserts it; the verifier records the grade. An honest holder is exact; a dishonest one is not bound — the proof does not
tie the asserted value to the credential's device key.

**What we ask.** A circuit variant that emits the nullifier as a public output computed from the credential-bound key
and the verifier's audience, so a verifier can refuse a second visit per audience without trusting the holder's
arithmetic. Our door already keys its one-visit-per-audience store by `(audience, window)` and records the grade on every
receipt (`nullifier.grade: asserted | in-circuit`), so the switch on our side is a policy flag.

**Related, same reason.** A zero-knowledge form of the status proof: the Merkle status presentation today links to the
credential; the status row we anchor on neutral ground is already shaped for a membership proof that does not.

## What we are not asking for
Changes to the SD-JWT format, to key sizes, or to the four-pattern limit of the 1k circuit — we moved to a two-claim
layout and will take the 2k keys when the prover's time budget allows.
