// THE DOOR'S VERIFIER (spec 443 W5 / Ring 0 zkID Z4) — the Node half of the door's `predicate` grade.
//
// The door Worker cannot hold the OpenAC verifying keys (the 1k Prepare key is 274 MB), so it POSTs the presentation
// it received and the proof request IT built here, with the issuer facets IT trusts (from the register) and the
// chains it reads. This service:
//   1. resolves the issuer facet THROUGH THE CHAIN (spec 304): the SA's signature over the facet hash answers on the
//      issuer's chain (UniversalSignatureValidator → ERC-1271) and the facet's attestation is live on that chain's
//      AttestationRegistry with the right subject, type and hash;
//   2. verifies the proof bundle against the verifying keys (privacy-credentials `verifyPresentation` over the
//      openac backend) — version bound, challenge bound, claim normalisation bound, expression_result = 1;
//   3. checks the credential's status presentation against the issuer's live-credential row READ FROM NEUTRAL GROUND
//      (estate-projection's issuer row, Ring 0 Z3) when the door's policy asks;
//   4. says whether the nullifier the holder brought is of the grade the policy accepts. It does NOT consume it: the
//      one-per-audience store is the door's ledger DO, which does the atomic insert after this verdict.
// It holds no register, no key of anyone's, and nothing it answers is authority (ADR-0056): the door admits on it as
// evidence and the estate's own mandate still governs every act. One mechanism per read (ADR-0013): an unreachable
// chain is a refusal with its reason, never a guess.
//
//   GET  /health                      keys loaded, SDK + bundle version, memory
//   POST /verify  (Bearer VERIFIER_SECRET)  { presentation, request, issuers, chains, registry, policy } → verdict
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPublicClient, http as rpc, keccak256, toBytes } from 'viem';
import { verifyPresentation, createIssuerKeyResolver } from '@agenticprimitives/privacy-credentials';
import { createOpenAcBackend, OPENAC_SDK_VERSION, OPENAC_SDK_BUNDLE_VERSION } from '@agenticprimitives/privacy-credentials-openac';
import { issuerRootsOf, verifyCredentialStatusPresentation } from '@agenticprimitives/estate-projection';

const PORT = Number(process.env.PORT ?? 8080);
const KEYS = process.env.OPENAC_KEYS_DIR ?? '/keys';
const SECRET = process.env.VERIFIER_SECRET ?? '';
if (!SECRET) { console.error('VERIFIER_SECRET is required: the door is the only caller and it proves it'); process.exit(2); }

/** Spec 304 §binding: the facet is anchored as `credentialType = keccak256("issuer-key-facet")`. */
const ISSUER_KEY_FACET_TYPE = keccak256(toBytes('issuer-key-facet'));
const VALIDATOR_ABI = [{ type: 'function', name: 'isValidSig', stateMutability: 'view', inputs: [{ name: 'signer', type: 'address' }, { name: 'hash', type: 'bytes32' }, { name: 'sig', type: 'bytes' }], outputs: [{ type: 'bool' }] }];
const ATTESTATION_ABI = [
  { type: 'function', name: 'isValid', stateMutability: 'view', inputs: [{ name: 'uid', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'getAttestation', stateMutability: 'view', inputs: [{ name: 'uid', type: 'bytes32' }], outputs: [{ type: 'tuple', components: [
    { name: 'uid', type: 'bytes32' }, { name: 'schemaId', type: 'bytes32' }, { name: 'credentialType', type: 'bytes32' }, { name: 'credentialHash', type: 'bytes32' }, { name: 'refUID', type: 'bytes32' },
    { name: 'bilateralConsentRef', type: 'bytes32' }, { name: 'offchainCredentialStatusList', type: 'bytes32' }, { name: 'epochBucket', type: 'uint64' }, { name: 'revocationEpochBucket', type: 'uint64' },
    { name: 'subject', type: 'address' }, { name: 'party2', type: 'address' }, { name: 'issuer', type: 'address' }] }] },
];
const REGISTRY_ABI = [{ type: 'function', name: 'roots', stateMutability: 'view', inputs: [{ name: 'estateId', type: 'bytes32' }], outputs: [
  { name: 'liveGrantRoot', type: 'bytes32' }, { name: 'membershipRoot', type: 'bytes32' }, { name: 'charterHash', type: 'bytes32' }, { name: 'sequence', type: 'uint64' }, { name: 'anchoredAt', type: 'uint64' }] }];

/** `sha256:<hex>` → the 32-byte digest the SA signed (EIP-191 by a persona custodian or raw; the account's ERC-1271 answers either). */
const facetDigestOf = (facetHash) => `0x${String(facetHash).replace(/^sha256:/, '')}`;

/** An endpoint is named by the env var the register gives the chain (`towns[].rpcEnv`); the URL carries an app token and
 *  reaches this process as a Container secret, never in a request. */
function clientFor(chain) {
  const url = (process.env[chain.rpcEnv] ?? '').trim();
  if (!url) throw new Error(`no endpoint for eip155:${chain.chainId}: ${chain.rpcEnv} is not set on the verifier`);
  const c = { id: chain.chainId, name: `chain-${chain.chainId}`, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [url] } } };
  return createPublicClient({ chain: c, transport: rpc(url) });
}

const t0 = Date.now();
const file = (n) => readFile(join(KEYS, n)).then((b) => new Uint8Array(b));
const backend = await createOpenAcBackend({ keys: { '1k': { prepareVerifyingKey: await file('1k_prepare_verifying.key'), showVerifyingKey: await file('1k_show_verifying.key') } } });
console.log(`verifier: 1k verifying keys loaded in ${Date.now() - t0} ms · openac-sdk ${OPENAC_SDK_VERSION} · bundle version ${OPENAC_SDK_BUNDLE_VERSION} · rss ${Math.round(process.memoryUsage().rss / 1048576)} MB`);

/** The verdict for one presentation, under the door's request, trust and policy. */
async function verify(body) {
  const { presentation, request, issuers = [], chains = {}, registry, policy = {} } = body;
  if (!presentation || !request) return { valid: false, reason: 'malformed', detail: 'presentation and request are required' };
  const now = Math.floor(Date.now() / 1000);
  const clients = new Map();
  const client = (chainId) => {
    const key = String(chainId);
    if (!clients.has(key)) {
      const chain = chains[key];
      if (!chain) throw new Error(`the door named no chain eip155:${key}`);
      clients.set(key, { pub: clientFor({ chainId: Number(key), rpcEnv: chain.rpcEnv }), chain });
    }
    return clients.get(key);
  };
  // Spec 304: the facet by keyId among the documents the DOOR trusts — then its binding re-verified on the chain.
  const resolveIssuerKey = createIssuerKeyResolver(
    async (keyId) => issuers.find((i) => i?.document?.facet?.keyId === keyId)?.document ?? null,
    {
      async verifySaSignature({ signer, facetHash, signature }) {
        const issuer = issuers.find((i) => i.document.facetHash === facetHash);
        if (!issuer) return false;
        const { pub, chain } = client(issuer.chainId);
        return pub.readContract({ address: chain.universalSignatureValidator, abi: VALIDATOR_ABI, functionName: 'isValidSig', args: [signer, facetDigestOf(facetHash), signature] });
      },
      async checkAttestation({ subjectAgent, facetHash }) {
        const issuer = issuers.find((i) => i.document.facetHash === facetHash);
        if (!issuer?.attestation) return false;
        const { pub, chain } = client(issuer.chainId);
        const [live, a] = await Promise.all([
          pub.readContract({ address: chain.attestationRegistry, abi: ATTESTATION_ABI, functionName: 'isValid', args: [issuer.attestation] }),
          pub.readContract({ address: chain.attestationRegistry, abi: ATTESTATION_ABI, functionName: 'getAttestation', args: [issuer.attestation] }),
        ]);
        return live === true
          && String(a.subject).toLowerCase() === String(subjectAgent).toLowerCase()
          && String(a.credentialType).toLowerCase() === ISSUER_KEY_FACET_TYPE.toLowerCase()
          && String(a.credentialHash).toLowerCase() === facetDigestOf(facetHash).toLowerCase();
      },
    },
  );
  const opts = { resolveIssuerKey, openacBackend: backend };
  if (policy.nullifier?.require) {
    // Required ⇒ privacy-credentials refuses a presentation without one and below the grade; the STORE is the door's.
    opts.consumeNullifier = async () => true;
    opts.nullifierGrade = policy.nullifier.grade ?? 'asserted';
  }
  if (policy.status === 'required') {
    if (!registry?.address || !registry?.rpcEnv) throw new Error('status is required but the door named no registry to read the issuer row from');
    opts.checkCredentialStatus = async (status, challenge) => {
      const pub = clientFor({ chainId: registry.chainId, rpcEnv: registry.rpcEnv });
      const issuerId = status?.issuerId;
      if (typeof issuerId !== 'string') return { ok: false, code: 'malformed', reason: 'the status names no issuer row' };
      const r = await pub.readContract({ address: registry.address, abi: REGISTRY_ABI, functionName: 'roots', args: [issuerId] });
      const anchored = issuerRootsOf({ estateId: issuerId, liveGrantRoot: r[0], membershipRoot: r[1], charterHash: r[2], sequence: Number(r[3]), anchoredAt: Number(r[4]) });
      if (!anchored) return { ok: false, code: 'not_an_issuer_row', reason: 'neutral ground holds no issuer row under that id' };
      const v = verifyCredentialStatusPresentation(status, anchored, { ...challenge, now, maxAgeSeconds: Number(policy.maxAgeSeconds ?? 86400) });
      return v.ok ? { ok: true, sequence: v.sequence ?? anchored.sequence } : { ok: false, code: v.code, reason: v.reason };
    };
  }
  const result = await verifyPresentation(presentation, request, opts);
  // Never the claims: this suite reveals none, and a verdict that carried any would be a disclosure by the verifier.
  const { claims: _dropped, ...verdict } = result;
  return verdict;
}

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://verifier');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
    return json(res, 200, { ok: true, service: 'ap-federation-door-verifier', placement: 'node', sdk: OPENAC_SDK_VERSION, bundleVersion: OPENAC_SDK_BUNDLE_VERSION, keys: ['1k'], rssMb: Math.round(process.memoryUsage().rss / 1048576), upSeconds: Math.round((Date.now() - t0) / 1000) });
  }
  if (req.method === 'POST' && url.pathname === '/verify') {
    if (req.headers.authorization !== `Bearer ${SECRET}`) return json(res, 401, { error: 'unauthorized' });
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 4_000_000) { return json(res, 413, { error: 'too_large' }); } }
    let parsed; try { parsed = JSON.parse(body); } catch { return json(res, 400, { error: 'not_json' }); }
    const t = Date.now();
    try {
      const verdict = await verify(parsed);
      return json(res, 200, { ...verdict, verifier: { placement: 'node', sdk: OPENAC_SDK_VERSION, bundleVersion: OPENAC_SDK_BUNDLE_VERSION, ms: Date.now() - t } });
    } catch (e) {
      // A chain the verifier could not read, a key set it lacks: said as unavailable, so the door answers INDETERMINATE → DENY, never ALLOW.
      return json(res, 503, { error: 'verifier_unavailable', detail: e instanceof Error ? e.message : String(e) });
    }
  }
  return json(res, 404, { error: 'not_found' });
}).listen(PORT, () => console.log(`verifier: listening on :${PORT}`));
