#!/usr/bin/env tsx
// PUBLISH AN ORGANIZATION'S ISSUER FACET over a key the KEY SERVICE holds (spec 444 W3). The facet is the organization
// agent's own public statement — "this P-256 key signs credentials for me" — signed by the organization (its steward's
// credential answering the org's ERC-1271) and anchored on the organization's OWN chain's attestation registry. The key
// is the key service's issuing key (`issuer-key:` purpose, P-256): its public half comes from the key service's
// key-creation record, never from a scalar here. Nothing is issued; issuing is the organization's act at runtime.
//
//   set -a; . .secrets/ops.env; set +a
//   npx tsx scripts/publish-issuer-facet.mts --issuer imbnet-org --public-key 0x04… --home https://www.impact-agent.me --by maya \
//     --sender-key-file ~/.faithchain-deployer.key
// Prints the YAML to paste under the issuer's `facets:` and writes .secrets/issuer-facet-<id>.json (the document + attestation).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { createPublicClient, createWalletClient, http, keccak256, toBytes, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { parse } from 'yaml';
import { computeFacetHash, type IssuerKeyFacetV1, type SignedIssuerKeyFacetV1 } from './lib/predicate-setup-deps.mts';
import { associationAttestationDigest, computeAttestationUid } from '@agenticprimitives/attestations';

const args = process.argv.slice(2);
const flag = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const die = (m: string): never => { console.error(`✗ ${m}`); process.exit(1); };
const ID = flag('issuer') ?? die('--issuer <register id> is required');
const PUB = (flag('public-key') ?? die('--public-key 0x04… (the key service\'s issuing key, uncompressed SEC1) is required')).toLowerCase();
const HOME = (flag('home') ?? die('--home is required')).replace(/\/$/, '');
const BY = flag('by') ?? die('--by <steward handle> is required');
const SENDER = (readFileSync((flag('sender-key-file') ?? die('--sender-key-file (any funded key on the issuer\'s chain; the issuer\'s signature is what the contract checks)')).replace(/^~/, process.env.HOME ?? ''), 'utf8').trim().replace(/^(?!0x)/, '0x')) as Hex;
if (!/^0x04[0-9a-f]{128}$/.test(PUB)) die('--public-key must be 0x04 + 64 bytes');

const fed = parse(readFileSync('federation.yaml', 'utf8')) as { credentials: { issuers: Array<{ id: string; sa: Address; chainId: number; attestationRegistry: Address; universalSignatureValidator: Address; rpcEnv?: string }> } };
const issuer = fed.credentials.issuers.find((i) => i.id === ID) ?? die(`no credentials.issuers[${ID}] in federation.yaml`);
const rpc = (process.env[issuer.rpcEnv ?? 'FEDERATION_RPC_URL'] ?? '').trim() || die(`${issuer.rpcEnv ?? 'FEDERATION_RPC_URL'} is not set`);
const chain = { id: issuer.chainId, name: `eip155:${issuer.chainId}`, nativeCurrency: { name: 'eth', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } } as const;
const pub = createPublicClient({ chain, transport: http(rpc) });
const j = async (r: Response) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 200) }; } };

const b64u = (h: string) => Buffer.from(h, 'hex').toString('base64url');
const x = b64u(PUB.slice(4, 68)), y = b64u(PUB.slice(68, 132));
const kid = createHash('sha256').update(`{"crv":"P-256","kty":"EC","x":"${x}","y":"${y}"}`).digest().toString('base64url');
const keyId = `issuer-key:sd-jwt:${ID}-1`;
const recordFile = `.secrets/issuer-facet-${ID}.json`;
const prior = existsSync(recordFile) ? JSON.parse(readFileSync(recordFile, 'utf8')) as { document: SignedIssuerKeyFacetV1; attestation: Hex } : null;

const facet: IssuerKeyFacetV1 = prior?.document.facet ?? { type: 'IssuerKeyFacetV1', subjectAgent: issuer.sa.toLowerCase() as Hex, keyId, suite: 'es256-sd-jwt', publicKeyJwk: { kty: 'EC', crv: 'P-256', x, y, kid }, validFrom: new Date().toISOString() } as IssuerKeyFacetV1;
if ((facet.publicKeyJwk as { x?: string }).x !== x) die(`${recordFile} holds a facet for another key — move it aside deliberately`);
const facetHash = await computeFacetHash(facet);
const facetDigest = `0x${facetHash.slice(7)}` as Hex;

const VALIDATOR_ABI = [{ type: 'function', name: 'isValidSig', stateMutability: 'view', inputs: [{ name: 'signer', type: 'address' }, { name: 'hash', type: 'bytes32' }, { name: 'sig', type: 'bytes' }], outputs: [{ type: 'bool' }] }] as const;
const ATTESTATION_ABI = [
  { type: 'function', name: 'assertAssociation', stateMutability: 'nonpayable', inputs: [{ name: 'req', type: 'tuple', components: [
    { name: 'schemaId', type: 'bytes32' }, { name: 'credentialType', type: 'bytes32' }, { name: 'credentialHash', type: 'bytes32' }, { name: 'offchainCredentialStatusList', type: 'bytes32' },
    { name: 'subject', type: 'address' }, { name: 'issuer', type: 'address' }, { name: 'issuerSignature', type: 'bytes' }, { name: 'salt', type: 'uint256' }] }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'isValid', stateMutability: 'view', inputs: [{ name: 'uid', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
] as const;

const si = await j(await fetch(`${HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: BY, client_id: 'demo-jp' }) }));
const session = String(si.homeSession ?? '') || die(`no session for ${BY} at ${HOME}`);
const personaSign = async (digest: Hex): Promise<Hex> => { const b = await j(await fetch(`${HOME}/connect/persona-sign`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` }, body: JSON.stringify({ digest }) })); return (b.signature ?? die(`persona-sign: ${JSON.stringify(b).slice(0, 160)}`)) as Hex; };

let document = prior?.document ?? null;
if (!document) {
  const signature = await personaSign(facetDigest);
  const ok = await pub.readContract({ address: issuer.universalSignatureValidator, abi: VALIDATOR_ABI, functionName: 'isValidSig', args: [issuer.sa, facetDigest, signature] }).catch(() => false);
  if (!ok) die(`the facet signature by ${BY} does not validate for ${issuer.sa} on eip155:${issuer.chainId} — is ${BY}'s credential a custodian of that agent?`);
  document = { facet, facetHash, signature };
  console.log(`facet ${keyId}: kid ${kid} · signed by the organization (custodian ${BY}), verified through the validator on eip155:${issuer.chainId}`);
}
let attestation = prior?.attestation ?? null;
if (!attestation) {
  const TYPE = keccak256(toBytes('issuer-key-facet')), SCHEMA = keccak256(toBytes('ap.issuer-key-facet.v1'));
  const salt = BigInt(`0x${randomBytes(16).toString('hex')}`);
  const digest = associationAttestationDigest({ subject: issuer.sa, issuer: issuer.sa, schemaId: SCHEMA, credentialType: TYPE, credentialHash: facetDigest, chainId: BigInt(issuer.chainId), verifyingContract: issuer.attestationRegistry });
  const issuerSignature = await personaSign(digest as Hex);
  const wallet = createWalletClient({ account: privateKeyToAccount(SENDER), chain, transport: http(rpc) });
  const req = { schemaId: SCHEMA, credentialType: TYPE, credentialHash: facetDigest, offchainCredentialStatusList: `0x${'00'.repeat(32)}` as Hex, subject: issuer.sa, issuer: issuer.sa, issuerSignature, salt };
  await pub.simulateContract({ address: issuer.attestationRegistry, abi: ATTESTATION_ABI, functionName: 'assertAssociation', args: [req], account: wallet.account });
  const tx = await wallet.writeContract({ address: issuer.attestationRegistry, abi: ATTESTATION_ABI, functionName: 'assertAssociation', args: [req] });
  await pub.waitForTransactionReceipt({ hash: tx });
  attestation = computeAttestationUid({ subject: issuer.sa, party2: `0x${'00'.repeat(20)}`, issuer: issuer.sa, credentialType: TYPE, credentialHash: facetDigest, refUID: `0x${'00'.repeat(32)}`, salt } as never) as Hex;
  const live = await pub.readContract({ address: issuer.attestationRegistry, abi: ATTESTATION_ABI, functionName: 'isValid', args: [attestation] });
  if (!live) die(`attestation ${attestation} is not valid after tx ${tx}`);
  console.log(`attestation ${attestation} on ${issuer.attestationRegistry} (tx ${tx})`);
}
writeFileSync(recordFile, JSON.stringify({ keyId, document, attestation }, null, 2) + '\n', { mode: 0o600 });
console.log(`\npaste under credentials.issuers[${ID}].facets:\n        - keyId: ${keyId}\n          thumbprint: ${kid}\n          attestation: "${attestation}"\n          revocationRoot: projection\n          document:\n            facet: ${JSON.stringify(document.facet)}\n            facetHash: ${document.facetHash}\n            signature: "${document.signature}"`);
