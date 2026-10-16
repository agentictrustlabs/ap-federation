// THE DEVICE KEY a credential is bound to (`cnf.jwk`) — custodied for the holder, never held by her agent (zkID alignment §8).
// Two custodies, named explicitly by the record (ADR-0013: the record says which; nothing falls back):
//   local    — a P-256 scalar in her vault, signed by `LocalEs256Signer` (the dev/test stand-in; refuses production unless
//              A2A_ALLOW_LOCAL_DEVICE_KEY=true says so).
//   managed  — a P-256 key the estate's key service holds (faithkms ADR-0012 / zkID Z6): it signs `ES256_SHA256` ONLY under
//              BOUND evidence — a token the presentation release's issuer mints naming the digest, the venue and the
//              predicate digest — so a Worker that merely holds the service token cannot make a device signature no wire covers.
// The evidence issuer is the ceremony's own ES256 key (`PREDICATE_EVIDENCE_ES256_KEY`); its public JWKS is pinned in the key
// service's `[authority_evidence]` section. Minting happens inside the signer port, which the release calls only after it allowed.
import { LocalEs256Signer, staticTokenProvider, loadSecret, type JwsSignerPort } from '@agenticprimitives/key-custody';

/** key-custody's `AkcsBoundEvidencePort` (1.0.0-alpha.40+), mirrored structurally so a tree pinned one alpha behind still runs the LOCAL path. */
type AkcsBoundEvidencePort = (input: { digest: Uint8Array; message: Uint8Array }) => Promise<{ evidenceToken: string; audience: string }>;
type AkcsEs256SignerFactory = (cfg: { baseUrl: string; tenantId: string; tokenProvider: () => Promise<string>; acceptedProtectionLevels: string[] }, input: { keyId: string; evidence: AkcsBoundEvidencePort }) => Promise<JwsSignerPort>;
/** The managed signer's factory, resolved when a managed key is actually used: the pinned key-custody either exports it or the record is refused — never a quiet local signature. */
async function akcsEs256SignerFactory(): Promise<AkcsEs256SignerFactory> {
  const mod = (await import('@agenticprimitives/key-custody')) as unknown as { createAkcsEs256Signer?: AkcsEs256SignerFactory };
  if (typeof mod.createAkcsEs256Signer !== 'function') throw new Error('a managed device key needs @agenticprimitives/key-custody ≥ 1.0.0-alpha.40 (createAkcsEs256Signer); the pinned version has no managed ES256 signer');
  return mod.createAkcsEs256Signer;
}
import { parseAudienceBoundChallenge } from '@agenticprimitives/delegation';
import type { Hex } from 'viem';
import { createECDH, createHash, createPrivateKey, randomUUID, sign } from 'node:crypto';

export type DeviceKeyRef =
  | { kind: 'local'; privateKeyHex: string }
  | { kind: 'akcs'; keyId: string; baseUrl: string; tenantId: string };

/** The holder's key-service access (the estate-runtime caller shape, bound by the operator): read from the ceremony's env. */
export function akcsHolderToken(env: (k: string) => string): string { return env('AKCS_HOLDER_TOKEN'); }

export interface BoundEvidenceInput { digest: Uint8Array; venue: string; predicateDigest: Hex; subject: string }

/** Mint the BOUND evidence token (ES256 JWS): `digest` · `venue` · `predicate_digest` beside iss/aud/sub/exp/jti. The issuer key is
 *  the ceremony's own (a script secret, not a device key), so it is signed with Node's crypto here — `kid` is checked against it. */
export async function mintBoundEvidence(i: BoundEvidenceInput & { signerKeyHex: string; kid: string; issuer: string; audience: string; ttlSeconds?: number }): Promise<string> {
  const d = Buffer.from(i.signerKeyHex.replace(/^0x/, ''), 'hex');
  const ecdh = createECDH('prime256v1'); ecdh.setPrivateKey(d);
  const pub = ecdh.getPublicKey(undefined, 'uncompressed');
  const x = Buffer.from(pub.subarray(1, 33)).toString('base64url'), y = Buffer.from(pub.subarray(33, 65)).toString('base64url');
  const kid = createHash('sha256').update(`{"crv":"P-256","kty":"EC","x":"${x}","y":"${y}"}`).digest().toString('base64url');
  if (kid !== i.kid) throw new Error(`the evidence key's thumbprint is ${kid}, not the configured ${i.kid}`);
  const key = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: d.toString('base64url'), x, y }, format: 'jwk' });
  const b64 = (s: string | Uint8Array) => Buffer.from(s).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: i.kid }));
  const claims = b64(JSON.stringify({ iss: i.issuer, aud: i.audience, sub: i.subject, iat: now - 120, nbf: now - 120, exp: now + (i.ttlSeconds ?? 120), jti: randomUUID(), digest: `0x${Buffer.from(i.digest).toString('hex')}`, venue: i.venue, predicate_digest: i.predicateDigest.toLowerCase() }));
  const sig = sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${claims}.${b64(sig)}`;
}

export interface EvidenceIssuer { signerKeyHex: string; kid: string; issuer: string; audience: string }

/** The evidence issuer from the ceremony's env (`PREDICATE_EVIDENCE_ES256_KEY`, `PREDICATE_EVIDENCE_KID`); issuer/audience are the key service's pins. */
export function evidenceIssuerFromEnv(env: (k: string) => string): EvidenceIssuer {
  return { signerKeyHex: env('PREDICATE_EVIDENCE_ES256_KEY'), kid: env('PREDICATE_EVIDENCE_KID'), issuer: process.env.AKCS_EVIDENCE_ISSUER ?? 'https://presentation-release.faithnet.internal', audience: process.env.AKCS_EVIDENCE_AUDIENCE ?? 'akcs-pilot-evidence' };
}

/**
 * The signer for a credential's device key. For a managed key the evidence port mints the bound token for THIS signature:
 * the venue is read out of the audience-bound challenge the release already judged, the predicate digest is the step's.
 */
export async function deviceSignerFor(ref: DeviceKeyRef, i: { predicateDigest: Hex; subject: string; env: (k: string) => string }): Promise<JwsSignerPort> {
  if (ref.kind === 'local') return new LocalEs256Signer({ privateKeyHex: ref.privateKeyHex });
  const issuer = evidenceIssuerFromEnv(i.env);
  const evidence: AkcsBoundEvidencePort = async ({ digest, message }) => {
    const bound = parseAudienceBoundChallenge(message);
    if (!bound) throw new Error('the managed device key signs only an audience-bound challenge; the message is not one');
    return { evidenceToken: await mintBoundEvidence({ ...issuer, digest, venue: bound.audience, predicateDigest: i.predicateDigest, subject: i.subject }), audience: bound.audience };
  };
  return (await akcsEs256SignerFactory())({ baseUrl: ref.baseUrl, tenantId: ref.tenantId, tokenProvider: staticTokenProvider(loadSecret<'akcs-token'>(akcsHolderToken(i.env))), acceptedProtectionLevels: ['CVM_WRAPPED', 'CVM_DERIVED'] }, { keyId: ref.keyId, evidence });
}

/** `--device local` or `--device akcs:<keyId>` on a ceremony's command line → the record the credential is issued against. */
export function parseDeviceArg(arg: string | undefined, env: (k: string) => string): DeviceKeyRef {
  const a = arg ?? 'local';
  if (a === 'local') return { kind: 'local', privateKeyHex: env('PREDICATE_DEVICE_P256_KEY') };
  const m = /^akcs:(.+)$/.exec(a);
  if (!m) throw new Error(`--device must be "local" or "akcs:<keyId>", got ${a}`);
  return { kind: 'akcs', keyId: m[1]!, baseUrl: process.env.AKCS_HOLDER_BASE_URL ?? 'https://kms.faithnet.io', tenantId: process.env.AKCS_HOLDER_TENANT ?? 'faithnet' };
}

/** The public JWK the credential binds to, for either custody (the managed one is READ from the service, never asserted). */
export async function devicePublicJwk(ref: DeviceKeyRef, env: (k: string) => string): Promise<{ kty: 'EC'; crv: 'P-256'; x: string; y: string; kid: string }> {
  if (ref.kind === 'local') return new LocalEs256Signer({ privateKeyHex: ref.privateKeyHex }).publicJwk();
  const s = await (await akcsEs256SignerFactory())({ baseUrl: ref.baseUrl, tenantId: ref.tenantId, tokenProvider: staticTokenProvider(loadSecret<'akcs-token'>(akcsHolderToken(env))), acceptedProtectionLevels: ['CVM_WRAPPED', 'CVM_DERIVED'] }, { keyId: ref.keyId, evidence: async () => { throw new Error('read-only'); } });
  return s.publicJwk();
}
