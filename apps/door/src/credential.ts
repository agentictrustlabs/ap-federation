// THE DOOR'S `predicate` GRADE (spec 443 W5; Ring 0 zkID Z1–Z3 at the door) — a visitor proves, in zero knowledge, that a
// credential she holds satisfies what THIS door asks ("over 18"), bound to THIS door's challenge, under an issuer this
// door resolves through the chain; with a nullifier (one visit per audience) and the issuer's live-credential status
// when the policy says so. The door builds the proof request from ITS OWN policy (the register's `credentialProofs`
// for this door), never from the presentation; the verifier is the Node service beside the Worker (the keys do not
// fit here), reached as one mechanism per deployment (ADR-0013): the Container binding, or VERIFIER_URL — never both.
// What the door keeps: a reference `credential:<issuerKeyId>:presentation:<digest>` in `entitlementRefs`, the facet,
// the predicate digest, the nullifier grade and the status sequence on the receipt. Never a claim, never the person.
import { CREDENTIAL_PRESENTATION_REF, sha256Of, type CredentialPresentationEvaluatorDeps, type CredentialPresentationVerdict } from '@agenticprimitives/admission';
import { compileOpenAcPredicates, OPENAC_SUITE, type PredicateClaimV1, type PrivatePresentationV1, type ProofRequestV1 } from '@agenticprimitives/privacy-credentials';
import { intentDigest } from '@agenticprimitives/delegation';
import type { Hex } from 'viem';

export interface DoorCredentialPolicy {
  predicates: PredicateClaimV1[];
  claimSchema: string[];
  vcSize: '1k' | '2k' | '4k' | '8k';
  acceptedVersions: string[];
  /** `windowSeconds`: one visit per audience per window (the store forgets the value after it); absent ⇒ a year. */
  nullifier?: { require: boolean; grade: 'asserted' | 'in-circuit'; windowSeconds?: number };
  status?: 'required' | 'none';
  maxAgeSeconds?: number;
}

export interface RegisterIssuer {
  id: string; estate: string; sa: string; chainId: number;
  attestationRegistry?: string; universalSignatureValidator?: string; rpcEnv?: string;
  facets?: Array<{ keyId: string; attestation?: string; document?: { facet: { keyId: string; subjectAgent: string }; facetHash: string; signature: string } }>;
}

/** What the presenter POSTs to `/federation/present` ahead of the knock: `{ presentation: PrivatePresentationV1 }`. An OpenAC
 *  bundle is tens of kilobytes — more than an HTTP header may carry through the edge — so the door holds it under the
 *  reference it derives, and the knock's `x-ap-credential-presentation` header carries that reference alone. */
export interface CredentialPresentV1 { presentation: PrivatePresentationV1 }

export function parsePresentation(o: unknown): { ok: true; presentation: PrivatePresentationV1; issuerKeyId: string } | { ok: false; code: 'malformed' | 'suite' } {
  const p = (o as CredentialPresentV1 | null)?.presentation;
  if (!p || p.type !== 'PrivatePresentationV1' || typeof p.payload !== 'string') return { ok: false, code: 'malformed' };
  if (p.suite !== OPENAC_SUITE) return { ok: false, code: 'suite' };
  let payload: { issuerKeyId?: unknown };
  try { payload = JSON.parse(p.payload) as typeof payload; } catch { return { ok: false, code: 'malformed' }; }
  if (typeof payload.issuerKeyId !== 'string' || !/^[A-Za-z0-9_.:-]+$/.test(payload.issuerKeyId)) return { ok: false, code: 'malformed' };
  return { ok: true, presentation: p, issuerKeyId: payload.issuerKeyId };
}

/** The knock's header: the reference `/federation/present` answered with — nothing else is accepted there. */
export function parsePresentationRef(raw: string | null): { ref: string; issuerKeyId: string } | null | { malformed: true } {
  if (!raw) return null;
  const m = CREDENTIAL_PRESENTATION_REF.exec(raw.trim());
  return m ? { ref: raw.trim(), issuerKeyId: m[1]! } : { malformed: true };
}

/** The reference the door derives for what it received — the evaluator resolves it back to the same bytes. */
export async function presentationRef(issuerKeyId: string, presentation: PrivatePresentationV1): Promise<string> {
  return `credential:${issuerKeyId}:presentation:${(await sha256Of(JSON.stringify(presentation))).slice(7, 39)}`;
}

/** The proof request as THIS door asks it: its policy, its audience, the challenge it issued. */
export function proofRequestFor(policy: DoorCredentialPolicy, origin: string, challenge: { nonce: string; audience: string }): ProofRequestV1 {
  return { type: 'ProofRequestV1', suite: OPENAC_SUITE, verifierId: new URL(origin).host, requestedClaims: [], predicates: policy.predicates, nonce: challenge.nonce, audience: challenge.audience, openac: { claimSchema: policy.claimSchema, vcSize: policy.vcSize, acceptedVersions: policy.acceptedVersions } };
}

/** The digest of the predicate PROGRAM the door asked (the compiled DSL, canonical): what the holder's wire names and
 *  the receipt cites. Computed from the door's own request, never read from the presentation. */
export function predicateDigestOf(request: unknown): Hex {
  const compiled = compileOpenAcPredicates((request as ProofRequestV1).predicates);
  if (!compiled.ok) throw new Error(`the door's own predicate program does not compile: ${compiled.detail}`);
  return intentDigest(compiled.expression);
}

export interface VerifierClient {
  placement: 'container' | 'url';
  /** POST /verify on the Node verifier. Throws when it cannot be reached — the evaluator turns that into INDETERMINATE. */
  verify(body: unknown): Promise<CredentialPresentationVerdict & { verifier?: { placement: string; sdk: string; bundleVersion: string; ms: number } }>;
  health(): Promise<{ ok: boolean; status: number; body: unknown }>;
}

/** ONE mechanism per deployment: the Container binding, or a URL — a door configured with both is misconfigured and
 *  says so rather than picking. */
export function verifierClient(env: { VERIFIER?: DurableObjectNamespace; VERIFIER_URL?: string; VERIFIER_SECRET?: string; BOUNDARY_ID: string }): VerifierClient | { error: string } {
  const url = (env.VERIFIER_URL ?? '').trim();
  if (url && env.VERIFIER) return { error: 'both VERIFIER (the Container binding) and VERIFIER_URL are set — one mechanism per deployment' };
  if (!url && !env.VERIFIER) return { error: 'no verifier: neither the VERIFIER Container binding nor VERIFIER_URL is configured' };
  if (!env.VERIFIER_SECRET) return { error: 'VERIFIER_SECRET is not set' };
  const secret = env.VERIFIER_SECRET;
  const send = async (path: string, init?: RequestInit) => {
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${secret}` };
    if (url) return fetch(`${url.replace(/\/$/, '')}${path}`, { ...init, headers, signal: AbortSignal.timeout(60_000) });
    const stub = env.VERIFIER!.get(env.VERIFIER!.idFromName(env.BOUNDARY_ID));
    return stub.fetch(new Request(`http://verifier${path}`, { ...init, headers }));
  };
  return {
    placement: url ? 'url' : 'container',
    async verify(body) {
      const r = await send('/verify', { method: 'POST', body: JSON.stringify(body) });
      if (r.status !== 200) throw new Error(`verifier answered ${r.status}`);
      return (await r.json()) as ReturnType<VerifierClient['verify']> extends Promise<infer T> ? T : never;
    },
    async health() { try { const r = await send('/health'); return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) }; } catch (e) { return { ok: false, status: 0, body: { error: e instanceof Error ? e.message : String(e) } }; } },
  };
}

/** The chain table the verifier reads with: every town's endpoint NAME (the URL is a secret the Container holds), its
 *  validator and attestation registry; plus neutral ground for the issuer rows. */
export function verifierChains(fed: { registry: { chainId: number; address: string; rpcEnv?: string }; towns?: Array<{ chainId: number; rpcEnv?: string; universalSignatureValidator?: string; attestationRegistry?: string }> }, issuers: RegisterIssuer[]) {
  const chains: Record<string, { rpcEnv: string; universalSignatureValidator?: string; attestationRegistry?: string }> = {};
  for (const t of fed.towns ?? []) chains[String(t.chainId)] = { rpcEnv: t.rpcEnv ?? 'FEDERATION_RPC_URL', universalSignatureValidator: t.universalSignatureValidator, attestationRegistry: t.attestationRegistry };
  for (const i of issuers) {
    const c = chains[String(i.chainId)] ?? { rpcEnv: i.rpcEnv ?? 'FEDERATION_RPC_URL' };
    chains[String(i.chainId)] = { ...c, ...(i.universalSignatureValidator ? { universalSignatureValidator: i.universalSignatureValidator } : {}), ...(i.attestationRegistry ? { attestationRegistry: i.attestationRegistry } : {}) };
  }
  return { chains, registry: { chainId: fed.registry.chainId, address: fed.registry.address, rpcEnv: fed.registry.rpcEnv ?? 'FEDERATION_RPC_URL' } };
}

/** The evaluator's `verify`: the Node verifier's verdict, then the door's own one-per-audience store — the nullifier's
 *  atomic insert happens HERE, in the ledger DO, because the verifier holds no state and must not. */
export function credentialVerify(deps: { client: VerifierClient; issuers: RegisterIssuer[]; chains: ReturnType<typeof verifierChains>; policy: DoorCredentialPolicy; consume: (namespace: string, id: string, digest: string) => Promise<'CONSUMED' | 'REPLAY' | 'CONFLICT'> }): CredentialPresentationEvaluatorDeps['verify'] {
  return async (presentation, request) => {
    const v = await deps.client.verify({
      presentation, request,
      issuers: deps.issuers.flatMap((i) => (i.facets ?? []).filter((f) => f.document).map((f) => ({ id: i.id, chainId: i.chainId, attestation: f.attestation, document: f.document }))),
      chains: deps.chains.chains, registry: deps.chains.registry,
      policy: { nullifier: deps.policy.nullifier, status: deps.policy.status ?? 'none', maxAgeSeconds: deps.policy.maxAgeSeconds ?? 86400 },
    });
    if (!v.valid || !v.nullifier) return v;
    const audience = (request as ProofRequestV1).audience;
    // The store is keyed by the window too: a door that changes its rule starts a fresh count under the new rule.
    const window = deps.policy.nullifier?.windowSeconds ?? 365 * 86400;
    const r = await deps.consume(`nullifier:${audience}:w${window}`, String(v.nullifier.value).toLowerCase(), 'presented');
    return r === 'CONSUMED' ? v : { ...v, valid: false, reason: 'nullifier_reused' };
  };
}
