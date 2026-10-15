// F1's LIVE GATE — the roots are anchored, the sequence is monotonic, and a presentation is checkable
// against what the chain holds. With its authority twin beside it (spec 439 §7, spec 392's shape).
//
// It holds NO KEY. Every assertion is a read of neutral ground or a local computation, and the one write it
// checks — that the registry refuses a replayed sequence — is checked by SIMULATION (`eth_call`), which is
// exactly how you test a refusal without spending a sequence to see it fail.
//
//   FEDERATION_RPC_URL=… npx tsx scripts/gate-f1-projection.mts [--estate impact-agent]
//
// The twin is the point: anyone can anchor a number. What must also be true is that the SAME verifier
// refuses the same presentation one sequence later, and that nothing it reads comes from the presenter.
import { verifyAuthorityPresentation, makeAuthorityPresentation, type AuthorityPresentationV1 } from '@agenticprimitives/estate-projection';
import { createPublicClient, http, type Hex } from 'viem';
import { randomBytes } from 'node:crypto';
import { ESTATE_PROJECTION_REGISTRY_ABI, registryClient } from '../apps/projector/src/anchor.js';
import { estateById, loadFederation, registryRpc, requireProjectable } from '../apps/projector/src/config.js';
import { fileLedger } from '../apps/projector/src/ledger.js';
import { isRevokedReader } from '../apps/projector/src/revocation.js';
import { buildForSequence } from '../apps/projector/src/project.js';

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1]! : d; };
const ESTATE = arg('estate', 'impact-agent')!;
const problems: string[] = [];
const ok = (what: string) => console.log(`  ok   ${what}`);
const bad = (what: string) => { problems.push(what); console.log(`  FAIL ${what}`); };

const f = loadFederation(arg('register-file', 'federation.yaml')!);
const rpc = registryRpc(f);
const registry = registryClient({ rpcUrl: rpc, chainId: f.registry.chainId, address: f.registry.address });
const row = estateById(f, ESTATE);
const estate = requireProjectable(row);
console.log(`F1 gate · estate ${ESTATE} · neutral ground ${f.registry.address} on chain ${f.registry.chainId}`);

// 1 — the id the register derives is the id the DEPLOYED contract derives. A verifier computes it itself.
const contractId = await registry.estateIdOf(estate.chainId, estate.governance);
contractId.toLowerCase() === estate.estateId.toLowerCase()
  ? ok(`the estate id agrees with the contract (${estate.estateId.slice(0, 18)}…)`)
  : bad(`the estate id disagrees with the contract: register ${estate.estateId}, contract ${contractId}`);

// 2 — registered, and to the signer the register claims. `register` is first-come-wins, so this is the
//     cross-check that the id was not bound by somebody else first.
const signer = await registry.signerOf(estate.estateId);
if (!signer) bad('the estate is not registered on neutral ground');
else if (row.signer && signer.toLowerCase() !== row.signer.toLowerCase()) bad(`the registry's signer is ${signer}, the register claims ${row.signer}`);
else ok(`registered to ${signer}`);

// 3 — something is anchored, and the sequence is above zero (the registry's own "never").
const anchored = await registry.roots(estate.estateId);
anchored.never ? bad('nothing is anchored (sequence 0)') : ok(`anchored at sequence ${anchored.sequence}, ${Math.floor(Date.now() / 1000) - anchored.anchoredAt}s ago`);

// 4 — the estate's own record agrees with neutral ground: the roots rebuilt from the ledger, at the
//     anchored sequence, are the roots on chain. A projector that anchored something it cannot rebuild has
//     published a number nobody can prove anything against.
const ledger = fileLedger(arg('ledger', `.submissions/${ESTATE}.json`)!);
const built = await buildForSequence(estate, { ledger, liveness: { isRevoked: await isRevokedReader(row) }, sequence: anchored.sequence });
built.projection.liveGrantRoot.toLowerCase() === anchored.liveGrantRoot.toLowerCase()
  ? ok(`the live-grant root rebuilds from the estate's own record (${built.kept.liveGrant.length} leaf/leaves)`)
  : bad(`the live-grant root does not rebuild: on chain ${anchored.liveGrantRoot}, rebuilt ${built.projection.liveGrantRoot}`);
built.projection.membershipRoot.toLowerCase() === anchored.membershipRoot.toLowerCase()
  ? ok(`the membership root rebuilds (${built.kept.membership.length} leaf/leaves)`)
  : bad(`the membership root does not rebuild: on chain ${anchored.membershipRoot}, rebuilt ${built.projection.membershipRoot}`);

// 5 — MONOTONIC. The registry refuses the sequence it already holds, checked by simulation so the gate
//     spends nothing. A refusal that is only documented is not a refusal.
if (signer) {
  const pub = createPublicClient({ chain: { id: f.registry.chainId, name: 'neutral', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } }, transport: http(rpc) });
  let refused = false; let detail = '';
  try {
    await pub.simulateContract({
      address: f.registry.address, abi: ESTATE_PROJECTION_REGISTRY_ABI, functionName: 'setRoots', account: signer,
      args: [estate.estateId, anchored.liveGrantRoot, anchored.membershipRoot, anchored.charterHash, BigInt(anchored.sequence)],
    });
  } catch (e) { refused = true; detail = e instanceof Error ? (e.message.split('\n')[0] ?? '') : String(e); }
  refused ? ok(`a replayed sequence ${anchored.sequence} is refused by the contract (${detail.slice(0, 60)})`) : bad(`the contract ACCEPTED a replay of sequence ${anchored.sequence}`);
  // And the next one is accepted — so the refusal above is about ordering, not about the call being broken.
  try {
    await pub.simulateContract({
      address: f.registry.address, abi: ESTATE_PROJECTION_REGISTRY_ABI, functionName: 'setRoots', account: signer,
      args: [estate.estateId, anchored.liveGrantRoot, anchored.membershipRoot, anchored.charterHash, BigInt(anchored.sequence + 1)],
    });
    ok(`sequence ${anchored.sequence + 1} would be accepted from the registered signer`);
  } catch (e) { bad(`the next sequence is not acceptable from the registered signer: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`); }
}

// 6 — a presentation against the anchored root verifies, read from the chain and not from the presenter.
const leaf = built.kept.liveGrant[0] ?? built.kept.membership[0];
if (!leaf) bad('the estate vouches for nothing, so no presentation can be checked');
else {
  const set = leaf.set;
  const challenge = { nonce: `0x${randomBytes(32).toString('hex')}` as Hex, audience: 'https://gate.ap-federation.invalid' };
  const pres = makeAuthorityPresentation(built.projection, set, leaf.digest, challenge);
  if (!pres) bad(`no proof could be made for a leaf that is in the ${set} set`);
  else {
    const live = { estateId: estate.estateId, sequence: anchored.sequence, liveGrantRoot: anchored.liveGrantRoot, membershipRoot: anchored.membershipRoot, anchoredAt: anchored.anchoredAt };
    const expect = { subject: pres.subject, nonce: challenge.nonce, audience: challenge.audience, now: Math.floor(Date.now() / 1000), maxAgeSeconds: 24 * 3600 };
    const v = verifyAuthorityPresentation(pres, live, expect);
    v.ok ? ok(`a ${set} presentation verifies against the root read from the chain`) : bad(`a presentation against the anchored root was refused: ${v.code} — ${v.reason}`);

    // THE AUTHORITY TWIN. The same verifier, the same leaf, three ways it must say no.
    const stale = verifyAuthorityPresentation({ ...pres, sequence: pres.sequence - 1 } as AuthorityPresentationV1, live, expect);
    (!stale.ok && stale.code === 'stale') ? ok('the same presentation one sequence behind is refused as stale') : bad(`a superseded sequence was not refused as stale: ${JSON.stringify(stale)}`);
    const other = `0x${'11'.repeat(20)}` as const;
    const wrongSubject = verifyAuthorityPresentation(pres, live, { ...expect, subject: other });
    (!wrongSubject.ok && wrongSubject.code === 'subject_mismatch') ? ok('a presentation about someone else is refused') : bad(`a presentation about another subject was not refused: ${JSON.stringify(wrongSubject)}`);
    const replayed = verifyAuthorityPresentation(pres, live, { ...expect, nonce: `0x${'22'.repeat(32)}` });
    (!replayed.ok && replayed.code === 'challenge_mismatch') ? ok('a presentation answering another challenge is refused') : bad(`a replayed challenge was not refused: ${JSON.stringify(replayed)}`);
  }
}

console.log(problems.length ? `\nF1 GATE RED · ${problems.length} problem(s)` : '\nF1 GATE GREEN · roots anchored, sequence monotonic, presentation checkable, refusals refused');
process.exit(problems.length ? 1 : 0);
