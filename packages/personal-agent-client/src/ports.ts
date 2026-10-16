// THE PORTS — everything this client needs from the estate, as interfaces it never implements (spec 443 §1.1).
//
// The client holds no identity. The binding is a credential the estate's personal-agent service (`pap.svc`) presents
// with; the Account Tokens are the person's vault records; the person's authority is her wire to `pap.svc`, verified
// at her own runtime per step. Nothing below is a key or a secret — a signer signs, a vault seals, an approval door
// answers whether a mandate exists.
import type { JwsSignerPort } from '@agenticprimitives/key-custody';
import type { ClientKeyBindingV1 } from '@agenticprimitives/agent-profile';
import type { ExternalAccountLinkV1 } from '@agenticprimitives/key-custody';
import type { ExternalOperationAuthorityFacts, ExternalOperationRefV1 } from '@agenticprimitives/intent-engagement';

export type { JwsSignerPort, ClientKeyBindingV1, ExternalAccountLinkV1, ExternalOperationAuthorityFacts, ExternalOperationRefV1 };

/** The estate's outward key, bound to pap.svc by a `ClientKeyBindingV1` the Smart Agent signed (spec 442 §3). */
export interface ClientKeyPort {
  binding: ClientKeyBindingV1;
  /** Signs client assertions and session assertions (RFC 7523) — the key `jwks_uri` publishes. */
  signer: JwsSignerPort;
  /** The client metadata document's URL (= `binding.clientId`) and the return URLs it lists. */
  redirectUris: string[];
}

/** One DPoP key per (person, company) — a session-binding key, never published, never the client key (PAP 4.3). */
export interface DpopKeyPort {
  forIssuer(issuer: string): Promise<JwsSignerPort & { keyRef: string }>;
}

/** The person's vault: her pairwise secret, her account links, the sealing of tokens under her vault key. */
export interface VaultPort {
  pairwiseSecret(): Promise<Uint8Array>;
  /** The vault key the subject digest is keyed under (never the pairwise secret). */
  subjectDigestKey(): Promise<Uint8Array>;
  readLink(issuer: string): Promise<ExternalAccountLinkV1 | null>;
  writeLink(link: ExternalAccountLinkV1): Promise<void>;
  /** Seal a token under the vault KEK → an opaque reference the record carries. */
  seal(secret: string): Promise<string>;
  unseal(sealedRef: string): Promise<string>;
}

/** A company's proposed operation, as the person sees it at her approval door. */
export interface ParkedExternalOperation {
  ref: ExternalOperationRefV1;
  companyName: string;
  issuer: string;
  summary: string;
  terms: unknown;
  /** The company says only `user` may approve this revision (PAP Operations 5.1). */
  userApprovalRequired: boolean;
  expiresAt: number;
}

/**
 * The approval door (spec 350 §3.6): shows the person the company's name and the revision's summary, through the
 * HOME's own interface, and answers with the VERIFIED facts — a mandate over this ref's intent digest, or a covering
 * standing wire (spec 397 §11) — or null while the act stays parked. Nothing a company sent is ever read as approval.
 */
export interface ApprovalPort {
  park(act: ParkedExternalOperation): Promise<ExternalOperationAuthorityFacts | null>;
}

/** Spec 442 §5 — the `proof` on confirm. `identity`: an ERC-1271 JWS by the person's SA (public posture only). */
export interface ProofPorts {
  /** Sign `operation_id‖revision‖terms_digest` as the person's Smart Agent → a compact JWS (ERC-1271-validatable). */
  identity?: (ref: ExternalOperationRefV1) => Promise<string>;
  /** A blinded-leaf authority presentation against the estate root on neutral ground (spec 439). */
  standing?: (ref: ExternalOperationRefV1) => Promise<unknown>;
}

export interface OperatorPolicy {
  /** Mediated sign-in (the Home relays a password) is refused unless this names the issuers it is allowed at. */
  allowMediatedSignIn?: { policyRef: string; allowedIssuers: string[] };
}

export interface PersonalAgentClientConfig {
  clientKey: ClientKeyPort;
  dpopKeys: DpopKeyPort;
  vault: VaultPort;
  approval: ApprovalPort;
  proofs?: ProofPorts;
  /** The person's naming posture — decides which proof grade may be used (spec 442 §7.2). */
  posture: { naming: string; listing: string };
  operatorPolicy?: OperatorPolicy;
  fetch?: typeof fetch;
  /** Unix seconds; injected. */
  now?: () => number;
  /** 128-bit random ids for `jti`, `state`, PKCE. */
  random?: (bytes: number) => Uint8Array;
}
