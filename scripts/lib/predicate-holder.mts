// THE HOLDER'S HALF of a predicate visit (Ring 0 zkID Z1–Z3 composed; spec 443 W5) — shared by the one-time setup and
// the nightly gate, so the gate presents exactly what the setup issued.
//
// A visit, in order: the door's policy says WHICH predicates over WHICH credential layout it accepts; the holder asks
// the door for a challenge as a PAIRWISE account (an EOA derived from her holder secret and the door's origin — never
// her person agent, INV-305-3); builds the proof request from the policy and the challenge; derives the child mandate
// for THIS statement from her standing `credential.present` wire; runs Prepare (once per credential) and Show with the
// CUSTODIED device key behind the presentation release, which judges the mandate inside every signature callback; and
// brings, when the door asks, a nullifier for this audience (same key, same release) and the issuer's status
// presentation (from the issuer's projector). Nothing here authorizes anything: the door admits on the verdict as
// evidence and the estate's own mandate still governs every act.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPublicClient, hashMessage, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { compileOpenAcPredicates, deriveNullifier, prepareOpenAcCredential, presentOpenAc, OPENAC_SUITE, type PredicateClaimV1, type PrivatePresentationV1, type ProofRequestV1, type ProvingBackendPort, type OpenAcPreparedCredentialV1 } from '@agenticprimitives/privacy-credentials';
import { createOpenAcBackend, OPENAC_SDK_BUNDLE_VERSION } from '@agenticprimitives/privacy-credentials-openac';
import { deviceSignerFor, boundEvidenceFromEnv, type DeviceKeyRef } from './predicate-device-key.mts';
import { createPresentationRelease, deriveFromStanding, hashDelegation, intentDigest, presentationIntent, PRESENTATION_RAR_TYPE, type Delegation, type StandingWireV1 } from '@agenticprimitives/delegation';

export interface DoorCredentialPolicy {
  predicates: PredicateClaimV1[];
  claimSchema: string[];
  vcSize: '1k' | '2k' | '4k' | '8k';
  acceptedVersions?: string[];
  nullifier?: { require: boolean; grade: 'asserted' | 'in-circuit' };
  status?: 'required' | 'none';
}

export interface IssuedCredential {
  issuerKeyId: string;
  jwt: string;
  disclosures: string[];
  issuerPublicKeyJwk: Record<string, unknown>;
  /** The custodied device key the credential is bound to (`cnf`): a local P-256 scalar, or a key the estate's key service holds (Z6). */
  device: DeviceKeyRef;
}

/** The OpenAC backend from the keys the holder holds (proving + verifying; `scripts/fetch-openac-keys.sh --proving`). */
export async function holderBackend(dir = process.env.OPENAC_KEYS_DIR ?? join(process.env.HOME ?? '', '.cache/openac-5.0.0')): Promise<ProvingBackendPort> {
  const file = async (n: string) => new Uint8Array(await readFile(join(dir, n)));
  return createOpenAcBackend({ keys: { '1k': { prepareProvingKey: await file('1k_prepare_proving.key'), prepareVerifyingKey: await file('1k_prepare_verifying.key'), showProvingKey: await file('1k_show_proving.key'), showVerifyingKey: await file('1k_show_verifying.key') } } });
}

/** The pairwise account for THIS door. privacy-credentials' `pairwiseHandle` is the 20-byte pseudonym a verifier sees;
 *  the KEY behind this door's account is the same construction untruncated — `HMAC-SHA256(holderSecret, "key:" + origin)`,
 *  32 bytes, a secp256k1 scalar with overwhelming probability — so the account exists for this door and no other, and is
 *  underivable without the vault-held secret (INV-305-1 in spirit: what the door learns is an account, never the person). */
export async function pairwiseAccountFor(holderSecret: Hex, doorOrigin: string) {
  const raw = Uint8Array.from(holderSecret.slice(2).match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const k = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`key:${doorOrigin}`)));
  return privateKeyToAccount(`0x${[...mac].map((b) => b.toString(16).padStart(2, '0')).join('')}` as Hex);
}

/** The proof request as the DOOR builds it — the holder reproduces it from the door's published policy and the
 *  challenge it was handed, so both sides hash the same predicate program. */
export function proofRequestFor(door: { origin: string }, policy: DoorCredentialPolicy, challenge: { nonce: string; audience: string }): ProofRequestV1 {
  return {
    type: 'ProofRequestV1', suite: OPENAC_SUITE, verifierId: new URL(door.origin).host, requestedClaims: [], predicates: policy.predicates,
    nonce: challenge.nonce, audience: challenge.audience,
    openac: { claimSchema: policy.claimSchema, vcSize: policy.vcSize, acceptedVersions: policy.acceptedVersions ?? [OPENAC_SDK_BUNDLE_VERSION] },
  };
}

/** The digest of the predicate PROGRAM (the compiled DSL, canonical) — what the wire names and the receipt cites. The
 *  door computes the same from its own policy; a holder that disagrees derives no mandate. */
export function predicateDigestOf(predicates: PredicateClaimV1[] | undefined): Hex {
  const compiled = compileOpenAcPredicates(predicates);
  if (!compiled.ok) throw new Error(`the predicate program does not compile: ${compiled.detail}`);
  return intentDigest(compiled.expression);
}

/** The chain-side checks a release judges a mandate with: revocation on the DelegationManager, the signature through
 *  the universal validator (EIP-191 over the EIP-712 digest, the form every wire here is signed in), the digest itself. */
export function mandateChecks(chain: { chainId: number; rpcUrl: string; delegationManager: Address; universalSignatureValidator: Address }) {
  const c = { id: chain.chainId, name: `chain-${chain.chainId}`, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [chain.rpcUrl] } } } as const;
  const pub = createPublicClient({ chain: c, transport: http(chain.rpcUrl) });
  const IS_REVOKED = [{ type: 'function', name: 'isRevoked', stateMutability: 'view', inputs: [{ name: 'delegationHash', type: 'bytes32' }], outputs: [{ type: 'bool' }] }] as const;
  const VALIDATOR = [{ type: 'function', name: 'isValidSig', stateMutability: 'view', inputs: [{ name: 'signer', type: 'address' }, { name: 'hash', type: 'bytes32' }, { name: 'sig', type: 'bytes' }], outputs: [{ type: 'bool' }] }] as const;
  return {
    isRevoked: async (d: Delegation) => (await pub.readContract({ address: chain.delegationManager, abi: IS_REVOKED, functionName: 'isRevoked', args: [hashDelegation(d, chain.chainId, chain.delegationManager)] })) as boolean,
    verifySignature: async ({ signer, digest, signature }: { signer: Address; digest: Hex; signature: Hex }) => (await pub.readContract({ address: chain.universalSignatureValidator, abi: VALIDATOR, functionName: 'isValidSig', args: [signer, hashMessage({ raw: digest }), signature] })) as boolean,
    delegationDigest: (d: Delegation) => hashDelegation(d, chain.chainId, chain.delegationManager),
  };
}

export interface PresentUnderWireInput {
  credential: IssuedCredential;
  request: ProofRequestV1;
  backend: ProvingBackendPort;
  /** Her standing `credential.present` wire (delegator = her person agent, delegate = the runtime key). */
  standing: StandingWireV1;
  /** The runtime key the wire names: it signs the child mandate for THIS statement. */
  runtime: { address: Address; sign: (digest: Hex) => Promise<Hex> };
  /** The harness key the child is issued to: the actor that asks the release to sign. */
  harness: Address;
  checks: ReturnType<typeof mandateChecks>;
  /** Reuse a Prepare from an earlier visit with the same credential and predicate program. */
  prepared?: OpenAcPreparedCredentialV1;
  withNullifier?: boolean;
  status?: unknown;
  /** Present under a statement for ANOTHER audience than the request's — the negative twin: the release must refuse. */
  statementAudience?: string;
  /** The ceremony's env reader (the evidence key, the key-service token) for a managed device key. */
  env?: (k: string) => string;
}

export interface PresentedUnderWire {
  presentation: PrivatePresentationV1;
  mandate: Delegation;
  mandateDigest: Hex;
  predicateDigest: Hex;
  prepared: OpenAcPreparedCredentialV1;
  decisions: string[];
}

export async function presentUnderWire(i: PresentUnderWireInput): Promise<PresentedUnderWire> {
  const predicateDigest = predicateDigestOf(i.request.predicates);
  const statement = { audience: i.statementAudience ?? i.request.audience, predicateDigest, issuerKeyId: i.credential.issuerKeyId };
  const now = Math.floor(Date.now() / 1000);
  // The child for THIS statement, derived from the standing wire by the runtime and signed by its key (a subset:
  // one audience, one predicate program, one issuer facet, one presentation, ten minutes).
  const derived = await deriveFromStanding(i.standing, {
    delegator: i.standing.wire.delegator as Address, delegate: i.harness,
    requirement: { type: PRESENTATION_RAR_TYPE, actions: ['present'], limits: { audience: statement.audience, predicateDigest, issuerKeyId: statement.issuerKeyId, maxPresentations: 1 }, intentDigest: intentDigest(presentationIntent(statement)), validUntil: now + 600 },
  } as never, i.runtime.sign);
  if (!derived.ok) throw new Error(`the standing wire does not cover this statement: ${derived.reason}`);
  const child = derived.presented[0] as unknown as Delegation & { salt: string | bigint };
  const mandate: Delegation = { ...child, salt: BigInt(child.salt) };
  const decisions: string[] = [];
  // The device signer: local, or the key service's P-256 key signing only under the bound evidence minted for each challenge.
  const env = i.env ?? ((k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set`); return v; });
  const device = await deviceSignerFor(i.credential.device, { env });
  // A managed key signs only under the release's own attestation of what it judged (digest · venue · predicate digest ·
  // actor), minted after `allow` and handed to the key with the signature; a local key needs none.
  const evidence = i.credential.device.kind === 'akcs' ? await boundEvidenceFromEnv(env) : undefined;
  const release = createPresentationRelease({ mandate, actor: i.harness, enforcers: i.standing.enforcers, checks: i.checks, now: () => Math.floor(Date.now() / 1000), signer: device, ...(evidence ? { evidence } : {}), onDecision: (d) => decisions.push(d.decision.decision) });
  let prepared = i.prepared;
  if (!prepared) {
    const prep = await prepareOpenAcCredential({ jwt: i.credential.jwt, disclosures: i.credential.disclosures, issuerPublicKeyJwk: i.credential.issuerPublicKeyJwk, request: i.request, backend: i.backend });
    if (!prep.ok) throw new Error(`Prepare refused: ${prep.reason} ${prep.detail ?? ''}`);
    prepared = prep.prepared;
  }
  const sign = (bytes: Uint8Array) => release.sign(statement, bytes);
  const nullifier = i.withNullifier ? await deriveNullifier(sign, i.request.audience) : undefined;
  const pres = await presentOpenAc({ prepared, issuerKeyId: i.credential.issuerKeyId, request: i.request, device: { kind: 'signer', sign }, backend: i.backend, ...(nullifier ? { nullifier } : {}), ...(i.status ? { status: i.status } : {}) });
  if (!pres.ok) throw new Error(`Show refused: ${pres.reason} ${pres.detail ?? ''}`);
  return { presentation: pres.presentation, mandate, mandateDigest: hashDelegation(mandate, i.standing.chainId, i.standing.delegationManager as Address), predicateDigest, prepared, decisions };
}
