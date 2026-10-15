#!/usr/bin/env tsx
// setup-predicate-issuer — ONE-TIME ceremony behind `gate:predicate-visitor` (spec 443 W5; Ring 0 zkID Z1–Z4). It makes
// the three parties the gate needs and anchors what must be anchored, saying every step out loud:
//
//   THE ISSUER (an SA of the estate, never a person — `credentials.issuers[<id>]` in the register):
//     1. a P-256 issuing key (held in .secrets, never committed) and its spec-304 facet document, signed by the issuer SA
//        through its custodian persona at the estate's Home (persona-sign; EIP-191 over the facet hash, which the
//        account's ERC-1271 answers for), checked through UniversalSignatureValidator before anything is written;
//     2. the facet ANCHORED on the issuer's chain: `AttestationRegistry.assertAssociation` with
//        `credentialType = keccak256("issuer-key-facet")`, subject = issuer = the SA, credentialHash = the facet hash —
//        the issuer SA's signature over the association digest, again through persona-sign; the uid recorded;
//     3. two test credentials issued to the holder's CUSTODIED device key (the SDK's SD-JWT issuer under OUR key): one
//        that stays live, one that is REVOKED here — submitted to the issuer's ledger, the row registered on neutral
//        ground (signer = the issuer SA; the delegate key anchors under its wire) and projected; the revoked one's
//        status presentation is kept from the sequence where it was live, then it is retired and the row re-anchored,
//        so the gate can show the chain refusing a status that was true yesterday.
//   THE HOLDER (a person of the estate, by handle, at her Home):
//     4. her standing `credential.present` wire to the gate's runtime key: ONE door, ONE predicate program (the door's
//        policy, compiled and digested the way the door does it), ONE issuer facet, 180 days — persona-sign at her Home.
//   Everything the gate replays nightly lands in .secrets/predicate-*.json; the public half (facet + attestation uid)
//   is printed as the YAML to paste under the issuer's `facets:` in federation.yaml.
//
//   set -a && . .secrets/ops.env && . .secrets/faithnet-projection-signer.env && set +a
//   npx tsx scripts/setup-predicate-issuer.mts [--issuer faithnet-gate-issuer] [--custodian-persona demo-admin]
//       [--issuer-home https://www.faithnet.me] [--holder alice] [--holder-home https://www.faithnet.me]
//       [--door https://door.ap-federation.faithnet.io] [--receiving-estate impact-agent]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createPublicClient, createWalletClient, hashMessage, http, keccak256, toBytes, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { parse } from 'yaml';
import { computeFacetHash, credentialDigestOfJwt, generateHolderSecret, type IssuerKeyFacetV1, type SignedIssuerKeyFacetV1 } from './lib/predicate-setup-deps.mts';
import { LocalEs256Signer } from '@agenticprimitives/key-custody';
import { associationAttestationDigest, computeAttestationUid } from '@agenticprimitives/attestations';
import { buildStandingWire, signedStandingWire, PRESENTATION_CAPABILITY, type EnforcerAddresses } from '@agenticprimitives/delegation';
import { generateDummyCredential } from 'openac-sdk/testing';
import { predicateDigestOf, type DoorCredentialPolicy } from './lib/predicate-holder.mts';

const args = process.argv.slice(2);
const flag = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const ISSUER = flag('issuer') ?? 'faithnet-gate-issuer';
const CUSTODIAN = flag('custodian-persona') ?? 'demo-admin';
const ISSUER_HOME = (flag('issuer-home') ?? 'https://www.faithnet.me').replace(/\/$/, '');
const HOLDER = flag('holder') ?? 'alice';
const HOLDER_HOME = (flag('holder-home') ?? 'https://www.faithnet.me').replace(/\/$/, '');
const DOOR = (flag('door') ?? 'https://door.ap-federation.faithnet.io').replace(/\/$/, '');
const RECEIVING = flag('receiving-estate') ?? 'impact-agent';

const fed = parse(readFileSync('federation.yaml', 'utf8')) as {
  registry: { chainId: number; address: Address };
  doors: Array<{ estate: string; url: string; credentialProofs?: DoorCredentialPolicy }>;
  credentials: { issuers: Array<{ id: string; estate: string; sa: Address; chainId: number; attestationRegistry: Address; universalSignatureValidator: Address; rpcEnv?: string; anchorDelegateKeyEnv?: string }> };
  estates: Array<{ id: string; chainId: number; homeChainId?: number; delegationManager?: Address }>;
};
const issuer = fed.credentials?.issuers?.find((i) => i.id === ISSUER) ?? (() => { throw new Error(`no issuer ${ISSUER} under credentials.issuers in federation.yaml`); })();
const door = fed.doors.find((d) => d.estate === RECEIVING && d.credentialProofs) ?? (() => { throw new Error(`no door for ${RECEIVING} with credentialProofs in federation.yaml`); })();
const policy = door.credentialProofs!;
const rpc = (process.env[issuer.rpcEnv ?? 'FEDERATION_RPC_URL'] ?? '').trim() || (() => { throw new Error(`${issuer.rpcEnv ?? 'FEDERATION_RPC_URL'} is not set (set -a && . .secrets/ops.env)`); })();
const chain = { id: issuer.chainId, name: `chain-${issuer.chainId}`, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } } as const;
const pub = createPublicClient({ chain, transport: http(rpc) });
const VALIDATOR_ABI = [{ type: 'function', name: 'isValidSig', stateMutability: 'view', inputs: [{ name: 'signer', type: 'address' }, { name: 'hash', type: 'bytes32' }, { name: 'sig', type: 'bytes' }], outputs: [{ type: 'bool' }] }] as const;
const ATTESTATION_ABI = [
  { type: 'function', name: 'assertAssociation', stateMutability: 'nonpayable', inputs: [{ name: 'req', type: 'tuple', components: [
    { name: 'schemaId', type: 'bytes32' }, { name: 'credentialType', type: 'bytes32' }, { name: 'credentialHash', type: 'bytes32' }, { name: 'offchainCredentialStatusList', type: 'bytes32' },
    { name: 'subject', type: 'address' }, { name: 'issuer', type: 'address' }, { name: 'issuerSignature', type: 'bytes' }, { name: 'salt', type: 'uint256' }] }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'isValid', stateMutability: 'view', inputs: [{ name: 'uid', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
] as const;
// Ring 0 deployments-faithchain.json — the enforcers a standing wire names (the pinned contracts release carries them).
const ENFORCERS: EnforcerAddresses = { delegationManager: '0x710cb1bF08C234Df397e0910331e0A29710EF4F7', timestamp: '0x73A7B878168b7DE48677617179A8bE894f0Dfe96', value: '0x8759c1a6cEBF1D5069e9434EF46327Bf2ef69975', allowedTargets: '0x2156311097A936de1916a878bF53Bfd43c7b5715', allowedMethods: '0xdBb2E47793393C499efB0f3fcbf6Ca8669791a41', digestBinding: '0xA3bb9BCC9b2F6F2419E1aBe5ED6Fd5399b9E68e1', payment: '0x07fA0aE59FdE4B7ce8962d6fE7a1d648ec3DD5CE' };
const j = async (r: Response) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 200) }; } };
const isValidSig = (signer: Address, hash: Hex, sig: Hex) => pub.readContract({ address: issuer.universalSignatureValidator, abi: VALIDATOR_ABI, functionName: 'isValidSig', args: [signer, hash, sig] }).catch(() => false);
/** persona-sign: EIP-191 over a 32-byte digest by the persona's custodian key; the SA's ERC-1271 answers for it. */
async function personaSign(home: string, handle: string, digest: Hex): Promise<{ signature: Hex; agent: Address }> {
  const signin = await j(await fetch(`${home}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle, client_id: 'demo-jp' }) }));
  const token: string = signin.homeSession; const agent = String(signin.agent ?? '').toLowerCase() as Address;
  if (!token || !/^0x[0-9a-f]{40}$/.test(agent)) throw new Error(`no session for ${handle} at ${home}: ${JSON.stringify(signin).slice(0, 200)}`);
  const signed = await j(await fetch(`${home}/connect/persona-sign`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ digest }) }));
  if (!signed.signature) throw new Error(`persona-sign refused for ${handle}: ${JSON.stringify(signed).slice(0, 200)}`);
  return { signature: signed.signature as Hex, agent };
}

mkdirSync('.secrets', { recursive: true });
const envFile = '.secrets/predicate-visitor.env';
const envText = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
const envGet = (k: string) => new RegExp(`^${k}=(\\S+)`, 'm').exec(envText)?.[1];
const fresh = {
  PREDICATE_ISSUER_P256_KEY: envGet('PREDICATE_ISSUER_P256_KEY') ?? `0x${randomBytes(32).toString('hex')}`,
  PREDICATE_DEVICE_P256_KEY: envGet('PREDICATE_DEVICE_P256_KEY') ?? `0x${randomBytes(32).toString('hex')}`,
  PREDICATE_HOLDER_SECRET: envGet('PREDICATE_HOLDER_SECRET') ?? generateHolderSecret(),
  PREDICATE_RUNTIME_KEY: envGet('PREDICATE_RUNTIME_KEY') ?? `0x${randomBytes(32).toString('hex')}`,
  PREDICATE_HARNESS_KEY: envGet('PREDICATE_HARNESS_KEY') ?? `0x${randomBytes(32).toString('hex')}`,
};
writeFileSync(envFile, Object.entries(fresh).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
const issuerKey = new LocalEs256Signer({ privateKeyHex: fresh.PREDICATE_ISSUER_P256_KEY });
const device = new LocalEs256Signer({ privateKeyHex: fresh.PREDICATE_DEVICE_P256_KEY });
const runtime = privateKeyToAccount(fresh.PREDICATE_RUNTIME_KEY as Hex);
const harness = privateKeyToAccount(fresh.PREDICATE_HARNESS_KEY as Hex);
console.log(`issuer ${issuer.id}: SA ${issuer.sa} on eip155:${issuer.chainId} · custodian persona ${CUSTODIAN} at ${ISSUER_HOME}\nholder ${HOLDER} at ${HOLDER_HOME} · runtime key ${runtime.address} · harness key ${harness.address}\ndoor ${DOOR} (in front of ${RECEIVING}) asks ${JSON.stringify(policy.predicates)} over [${policy.claimSchema.join(', ')}]`);

// ── 1. the facet ──
const recordFile = `.secrets/predicate-issuer-${issuer.id}.json`;
const record = existsSync(recordFile) ? JSON.parse(readFileSync(recordFile, 'utf8')) as { keyId: string; document: SignedIssuerKeyFacetV1; attestation: Hex; salt: string; schemaId: Hex } : null;
const keyId = record?.keyId ?? `issuer-key:sd-jwt:${issuer.id}-1`;
const jwk = issuerKey.publicJwk();
const facet: IssuerKeyFacetV1 = record?.document.facet ?? { type: 'IssuerKeyFacetV1', subjectAgent: issuer.sa.toLowerCase() as Hex, keyId, suite: 'es256-sd-jwt', publicKeyJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, kid: jwk.kid }, validFrom: new Date().toISOString() };
if (facet.publicKeyJwk?.x !== jwk.x || facet.publicKeyJwk?.y !== jwk.y) throw new Error(`${recordFile} holds a facet for another key than ${envFile}'s — remove one of them, deliberately`);
const facetHash = await computeFacetHash(facet);
const facetDigest = `0x${facetHash.slice(7)}` as Hex;
let document = record?.document ?? null;
if (!document) {
  const { signature, agent } = await personaSign(ISSUER_HOME, CUSTODIAN, facetDigest);
  const ok = await isValidSig(issuer.sa, facetDigest, signature);
  if (!ok) throw new Error(`the facet signature by ${CUSTODIAN} (${agent}) does not validate for the issuer SA ${issuer.sa} on eip155:${issuer.chainId} — is ${CUSTODIAN}'s key a custodian of that agent?`);
  document = { facet, facetHash, signature };
  console.log(`facet ${keyId}: thumbprint ${jwk.kid} · hash ${facetHash} · signed by the issuer SA (custodian ${CUSTODIAN}, verified through the validator)`);
} else console.log(`facet ${keyId}: kept (hash ${facetHash})`);

// ── 2. the attestation ──
const ISSUER_KEY_FACET_TYPE = keccak256(toBytes('issuer-key-facet'));
const SCHEMA_ID = keccak256(toBytes('ap.issuer-key-facet.v1'));
let attestation = record?.attestation ?? null;
let salt = record?.salt ?? null;
if (!attestation) {
  const saltN = BigInt(`0x${randomBytes(16).toString('hex')}`);
  const digest = associationAttestationDigest({ subject: issuer.sa, issuer: issuer.sa, schemaId: SCHEMA_ID, credentialType: ISSUER_KEY_FACET_TYPE, credentialHash: facetDigest, chainId: BigInt(issuer.chainId), verifyingContract: issuer.attestationRegistry });
  const { signature } = await personaSign(ISSUER_HOME, CUSTODIAN, digest);
  const keyEnv = issuer.anchorDelegateKeyEnv ?? 'FAITHNET_PROJECTION_SIGNER';
  const senderKey = (process.env[keyEnv] ?? '').trim() as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(senderKey)) throw new Error(`${keyEnv} is not set — the funded delegate key that sends the attestation transaction (anyone may send one; the issuer's signature is what the contract checks)`);
  const wallet = createWalletClient({ account: privateKeyToAccount(senderKey), chain, transport: http(rpc) });
  const req = { schemaId: SCHEMA_ID, credentialType: ISSUER_KEY_FACET_TYPE, credentialHash: facetDigest, offchainCredentialStatusList: `0x${'00'.repeat(32)}` as Hex, subject: issuer.sa, issuer: issuer.sa, issuerSignature: signature, salt: saltN };
  await pub.simulateContract({ address: issuer.attestationRegistry, abi: ATTESTATION_ABI, functionName: 'assertAssociation', args: [req], account: wallet.account });
  const tx = await wallet.writeContract({ address: issuer.attestationRegistry, abi: ATTESTATION_ABI, functionName: 'assertAssociation', args: [req] });
  await pub.waitForTransactionReceipt({ hash: tx });
  attestation = computeAttestationUid({ subject: issuer.sa, party2: `0x${'00'.repeat(20)}`, issuer: issuer.sa, credentialType: ISSUER_KEY_FACET_TYPE, credentialHash: facetDigest, refUID: `0x${'00'.repeat(32)}`, salt: saltN });
  salt = saltN.toString();
  const live = await pub.readContract({ address: issuer.attestationRegistry, abi: ATTESTATION_ABI, functionName: 'isValid', args: [attestation] });
  if (!live) throw new Error(`the attestation ${attestation} is not valid after tx ${tx} — the uid recomputation disagrees with the contract`);
  console.log(`attestation ${attestation} anchored on ${issuer.attestationRegistry} (tx ${tx}): subject = issuer = ${issuer.sa}, type issuer-key-facet, hash ${facetDigest}`);
} else console.log(`attestation ${attestation}: kept (isValid ${await pub.readContract({ address: issuer.attestationRegistry, abi: ATTESTATION_ABI, functionName: 'isValid', args: [attestation] })})`);
writeFileSync(recordFile, JSON.stringify({ keyId, document, attestation, salt, schemaId: SCHEMA_ID, issuer: issuer.id, sa: issuer.sa, chainId: issuer.chainId }, null, 2) + '\n', { mode: 0o600 });

// ── 3. two credentials: one to keep, one to revoke ──
const credFile = '.secrets/predicate-credential.json';
const revokedFile = '.secrets/predicate-credential-revoked.json';
const dev = device.publicJwk();
const issue = (age: string) => {
  const c = generateDummyCredential({ size: '1k', claims: [{ key: 'age', value: age }, { key: 'roc_birthday', value: '0900101' }], deviceKey: { kty: 'EC', crv: 'P-256', x: dev.x, y: dev.y }, issuerPrivateKey: fresh.PREDICATE_ISSUER_P256_KEY.slice(2) });
  if (c.issuerPublicKey.x !== jwk.x || c.issuerPublicKey.y !== jwk.y) throw new Error('the SDK issued under another key than the facet names');
  return { issuerKeyId: keyId, jwt: c.jwt, disclosures: c.disclosures, issuerPublicKeyJwk: c.issuerPublicKey, devicePrivateKeyHex: fresh.PREDICATE_DEVICE_P256_KEY, digest: credentialDigestOfJwt(c.jwt), claims: { age, roc_birthday: '0900101' } };
};
const projector = (...a: string[]) => execFileSync('pnpm', ['-s', 'projector', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const haveBoth = existsSync(credFile) && existsSync(revokedFile);
if (!haveBoth) {
  const live = issue('0000021'); const revoked = issue('0000030');
  writeFileSync(credFile, JSON.stringify(live, null, 2) + '\n', { mode: 0o600 });
  console.log(`credential (kept): ${live.digest} — age 21, bound to device ${dev.kid}`);
  console.log(projector('submit', '--issuer', issuer.id, '--digest', live.digest, '--by', 'setup-predicate-issuer', '--source', 'gate-setup'));
  console.log(projector('submit', '--issuer', issuer.id, '--digest', revoked.digest, '--by', 'setup-predicate-issuer', '--source', 'gate-setup (to be revoked)'));
  const status = projector('status', '--issuer', issuer.id);
  if (/signer\s+not registered/.test(status)) console.log(projector('register', '--issuer', issuer.id));
  console.log(projector('project', '--issuer', issuer.id));
  // The revoked credential's status, from the sequence where it was live — what a holder would keep and replay.
  const out = `.submissions/status-revoked-${Date.now()}.json`;
  projector('present-status', '--issuer', issuer.id, '--digest', revoked.digest, '--audience', DOOR, '--nonce', 'setup-placeholder', '--out', out);
  const staleStatus = JSON.parse(readFileSync(out, 'utf8')) as { sequence: number };
  console.log(projector('retire', '--issuer', issuer.id, '--digest', revoked.digest, '--reason', 'gate setup: the credential the gate shows refused as revoked'));
  console.log(projector('project', '--issuer', issuer.id));
  writeFileSync(revokedFile, JSON.stringify({ ...revoked, staleStatus, revokedAtSequence: staleStatus.sequence + 1 }, null, 2) + '\n', { mode: 0o600 });
  console.log(`credential (revoked): ${revoked.digest} — live at sequence ${staleStatus.sequence}, absent from ${staleStatus.sequence + 1}; its old status is kept for the gate's twin`);
} else console.log(`credentials: kept (${credFile}, ${revokedFile})`);

// ── 4. the holder's standing wire ──
const wireFile = '.secrets/predicate-standing-wire.json';
if (!existsSync(wireFile)) {
  const estate = fed.estates.find((e) => e.id === issuer.estate)!;
  const chainId = estate.homeChainId ?? estate.chainId;
  if (chainId !== issuer.chainId) throw new Error(`the holder's home chain (${chainId}) is not the issuer's (${issuer.chainId}) — this setup assumes one chain for the wire's enforcers`);
  const predicateDigest = predicateDigestOf(policy.predicates);
  const signin = await j(await fetch(`${HOLDER_HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: HOLDER, client_id: 'demo-jp' }) }));
  const holderAgent = String(signin.agent ?? '').toLowerCase() as Address;
  if (!/^0x[0-9a-f]{40}$/.test(holderAgent)) throw new Error(`demo-signin did not name ${HOLDER}'s agent at ${HOLDER_HOME}`);
  const { standing } = buildStandingWire({ template: 'present-as-me', delegator: holderAgent, delegate: runtime.address, capability: PRESENTATION_CAPABILITY, presentation: { audiences: [DOOR], predicateDigests: [predicateDigest], issuerKeyIds: [keyId] }, validForSeconds: 180 * 86_400, enforcers: ENFORCERS, chainId, delegationManager: (estate.delegationManager ?? ENFORCERS.delegationManager) as Address });
  const { signature } = await personaSign(HOLDER_HOME, HOLDER, standing.ref);
  const ok = await isValidSig(holderAgent, hashMessage({ raw: standing.ref }), signature);
  if (!ok) throw new Error(`the standing wire's signature does not validate for ${HOLDER} (${holderAgent}) — nothing written`);
  writeFileSync(wireFile, JSON.stringify({ ...signedStandingWire(standing, signature), holder: HOLDER, holderHome: HOLDER_HOME, door: DOOR, predicateDigest, issuerKeyId: keyId, issuedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
  console.log(`standing wire ${standing.ref}: ${HOLDER} (${holderAgent}) → runtime ${runtime.address} · credential.present · audience ${DOOR} · predicate ${predicateDigest} · issuer ${keyId} · 180 days`);
} else console.log(`standing wire: kept (${wireFile})`);

// ── 5. the public half, for the register ──
console.log(`\npaste under credentials.issuers[${issuer.id}].facets in federation.yaml:\n` + [
  `        - keyId: ${keyId}`,
  `          thumbprint: ${jwk.kid}`,
  `          attestation: "${attestation}"`,
  `          revocationRoot: projection`,
  `          document:`,
  `            facet: ${JSON.stringify(document!.facet)}`,
  `            facetHash: ${document!.facetHash}`,
  `            signature: "${document!.signature}"`,
].join('\n'));
console.log(`\nnext: paste the facet, \`pnpm check:federation\`, deploy the door (pnpm door:deploy) with VERIFIER_SECRET set, then \`pnpm gate:predicate\``);
