// F1's LIVE GATE — the roots are anchored, the sequence is monotonic, and a presentation is checkable
// against what the chain holds. With its authority twin beside it (spec 439 §7, spec 392's shape).
//
// It holds NO ESTATE KEY and writes nothing. Every assertion is a read of a chain or a local computation, and the one
// write it checks — that the registry refuses a replayed sequence — is checked by SIMULATION (`eth_call`), which is
// exactly how you test a refusal without spending a sequence to see it fail.
//
// ONE KEY IT DOES USE, since Ring 0 spec 445 §3.8 (audit H-14): a presentation is proof of possession, so "a
// presentation verifies" now needs the SUBJECT's signature over the challenge. The gate signs as the gate's own test
// account (`.secrets/f2-test-agent.env`, the presenter gate-f2-door already uses — scripts/setup-f2-test-grant.mts),
// about the leaf that account is the subject of, and the signature is checked the way a door checks it: by the
// UniversalSignatureValidator on the subject's chain (the estate's `homeChainId`, else its `chainId` — declared in the
// register, never defaulted), over that town's `rpcEnv`. No test account on this machine, or no leaf about it, is a
// FAIL that says so: a gate that cannot show a presentation verifying has not shown the root is usable.
//
//   FEDERATION_RPC_URL=… [HOPECHAIN_RPC_URL=…] npx tsx scripts/gate-f1-projection.mts [--estate impact-agent]
//
// The twin is the point: anyone can anchor a number. What must also be true is that the SAME verifier
// refuses the same presentation one sequence later, that it refuses one re-aimed at another subject or carrying no
// signature (a bearer value), and that nothing it reads comes from the presenter.
import { authorityPresentationTypedData, verifyAuthorityPresentation, makeAuthorityPresentation, type AuthorityPresentationV1 } from '@agenticprimitives/estate-projection';
import { createPublicClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { ESTATE_PROJECTION_REGISTRY_ABI, readDeclaredSigner, registryClient } from '../apps/projector/src/anchor.js';
import { estateById, loadFederation, registryRpc, requireProjectable } from '../apps/projector/src/config.js';
import { fileLedger } from '../apps/projector/src/ledger.js';
import { isRevokedReader } from '../apps/projector/src/revocation.js';
import { buildForSequence } from '../apps/projector/src/project.js';
import { subjectSignatureCheckFor } from '../apps/projector/src/subject-signature.js';

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

// 2 — THE ESTATE'S ROW (generation 4, spec 445 REG-2). Rows are keyed by (estateId, signer) and the registry no longer says which
//     is the estate's: the estate's own declaration does (`atl:projectionSigner` on its chain). The gate reads the declaration,
//     requires it to be the signer the register claims, and then reads ONLY that signer's row — as a door does.
//     The declaration lives where the estate agent (`governance`) lives — `chainId`, the chain the estate id derives from —
//     NOT on its home chain (`rpcEnv` names the HOME chain's endpoint: impact-agent's governance is on faithchain, its
//     residents on hopechain). Reading it on the wrong chain answers "not a contract", which is no declaration at all.
const declarationRpc = estate.chainId === f.registry.chainId ? rpc : (process.env[estate.rpcEnv ?? ''] ?? '');
if (!declarationRpc) bad(`no endpoint for the estate's chain eip155:${estate.chainId}`);
const declared = await readDeclaredSigner({ rpcUrl: declarationRpc, chainId: estate.chainId, governance: estate.governance, profileResolver: (estate.profileResolver ?? '0xB03F7C06ad3274F584AB72794406D639c02A45e1') as `0x${string}` }).catch((e) => { bad(`the estate's declaration could not be read: ${e instanceof Error ? e.message : String(e)}`); return null; });
let signer: `0x${string}` | null = null;
if (declared && !declared.declared) bad('the estate agent has declared no atl:projectionSigner — a door reads no row for it (ap-home scripts/set-projection-signer.mts)');
else if (declared?.declared) {
  if (row.signer && declared.signer.toLowerCase() !== row.signer.toLowerCase()) bad(`the estate declares ${declared.signer}, the register claims ${row.signer}`);
  else { signer = declared.signer; ok(`the estate declares ${signer} as its projection signer`); }
}
if (signer && await registry.isRetired(estate.estateId, signer)) { bad(`the declared signer ${signer} is retired on neutral ground`); signer = null; }

// 3 — something is anchored under that row, and the sequence is above zero (the registry's own "never").
const anchored = await registry.roots(estate.estateId, signer ?? (`0x${'00'.repeat(20)}` as `0x${string}`));
anchored.never ? bad('nothing is anchored under the declared signer (sequence 0)') : ok(`anchored at sequence ${anchored.sequence}, ${Math.floor(Date.now() / 1000) - anchored.anchoredAt}s ago`);

// 4 — the estate's own record agrees with neutral ground: the roots rebuilt from the ledger, at the
//     anchored sequence, are the roots on chain. A projector that anchored something it cannot rebuild has
//     published a number nobody can prove anything against.
const ledger = fileLedger(arg('ledger', `.submissions/${ESTATE}.json`)!);
const built = await buildForSequence(estate, { ledger, liveness: { isRevoked: await isRevokedReader(row) }, sequence: anchored.sequence });
built.projection.liveGrantRoot.toLowerCase() === anchored.liveGrantRoot.toLowerCase()
  ? ok(`the live-grant root rebuilds from the estate's own record (${built.kept.liveGrant.length} leaf/leaves)`)
  : bad(`the live-grant root does not rebuild: on chain ${anchored.liveGrantRoot}, rebuilt ${built.projection.liveGrantRoot}${built.kept.liveGrant.length ? ' — if this anchor predates Ring 0 spec 445 §3.8 (subject-committing leaves), the estate must re-anchor: `pnpm projector project --estate ' + ESTATE + '`' : ''}`);
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
    ok(`sequence ${anchored.sequence + 1} would be accepted from the declared signer`);
  } catch (e) { bad(`the next sequence is not acceptable from the declared signer: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`); }
}

// 6 — a presentation against the anchored root verifies, read from the chain and not from the presenter — and it is
//     PROOF OF POSSESSION (spec 445 §3.8): the leaf commits to its subject, and the subject signed this challenge.
const testKeyFile = arg('subject-key-file', '.secrets/f2-test-agent.env')!;
const testKey = existsSync(testKeyFile) ? (/F2_TEST_AGENT_KEY=(0x[0-9a-fA-F]{64})/.exec(readFileSync(testKeyFile, 'utf8'))?.[1] as Hex | undefined) : undefined;
const me = testKey ? privateKeyToAccount(testKey) : null;
const live = [...built.kept.liveGrant, ...built.kept.membership];
// The leaf the gate can SIGN for is the one about its own test account; any other leaf still serves the refusals.
const mine = me ? live.find((r) => r.subject.toLowerCase() === me.address.toLowerCase()) : undefined;
const leaf = mine ?? live[0];
if (!leaf) bad('the estate vouches for nothing, so no presentation can be checked');
else {
  const set = leaf.set as 'live-grant' | 'membership';
  const challenge = { nonce: `0x${randomBytes(32).toString('hex')}` as Hex, audience: 'https://gate.ap-federation.invalid' };
  const pres = makeAuthorityPresentation(built.projection, set, leaf.digest, challenge);
  if (!pres) bad(`no proof could be made for a leaf that is in the ${set} set`);
  else {
    const anchoredRoots = { estateId: estate.estateId, signer: anchored.signer, sequence: anchored.sequence, liveGrantRoot: anchored.liveGrantRoot, membershipRoot: anchored.membershipRoot, anchoredAt: anchored.anchoredAt };
    const expect = { subject: pres.subject, nonce: challenge.nonce, audience: challenge.audience, now: Math.floor(Date.now() / 1000), maxAgeSeconds: 24 * 3600 };
    pres.suite === 'merkle-membership-v2' ? ok('the estate\'s half is a merkle-membership-v2 presentation (the leaf commits to its subject)') : bad(`the projector made a ${pres.suite} presentation — a bearer value; this tree is on a pre-445 estate-projection`);
    // THE SUBJECT'S CHAIN, DECLARED: where the estate's people live. The signature is asked there, as a door asks it.
    const subjectChain = estate.homeChainId ?? estate.chainId;
    let verifySubjectSignature: ReturnType<typeof subjectSignatureCheckFor> | null = null;
    try { verifySubjectSignature = subjectSignatureCheckFor(f.towns, subjectChain); }
    catch (e) { bad(`the subject's signature cannot be read on eip155:${subjectChain}: ${e instanceof Error ? e.message : String(e)}`); }
    const opts = { chainId: subjectChain, ...(verifySubjectSignature ? { verifySubjectSignature } : {}) };

    // The positive: signed by the leaf's own subject, for this challenge, on its chain.
    let signed: AuthorityPresentationV1 | null = null;
    if (!me) bad(`no test account at ${testKeyFile} — a presentation cannot be shown to verify without its subject's signature (scripts/setup-f2-test-grant.mts --estate ${ESTATE})`);
    else if (!mine) bad(`the estate vouches for no leaf about the gate's test account ${me.address} — nothing here can sign as the subject of a live leaf (scripts/setup-f2-test-grant.mts --estate ${ESTATE}, then \`projector project\`)`);
    else {
      signed = { ...pres, subjectSignature: await me.signTypedData(authorityPresentationTypedData(pres, { chainId: subjectChain })) };
      const v = await verifyAuthorityPresentation(signed, anchoredRoots, expect, opts);
      v.ok && v.grade === 'standing'
        ? ok(`a ${set} presentation verifies against the root read from the chain, signed by its subject on eip155:${subjectChain} (grade standing)`)
        : bad(`a signed presentation against the anchored root was refused: ${v.ok ? `grade ${v.grade}` : `${v.code} — ${v.reason}`}`);
    }

    // THE AUTHORITY TWIN. The same verifier, the same leaf, the ways it must say no.
    const base = signed ?? pres;
    const stale = await verifyAuthorityPresentation({ ...base, sequence: base.sequence - 1 } as AuthorityPresentationV1, anchoredRoots, expect, opts);
    (!stale.ok && stale.code === 'stale') ? ok('the same presentation one sequence behind is refused as stale') : bad(`a superseded sequence was not refused as stale: ${JSON.stringify(stale)}`);
    const other = `0x${'11'.repeat(20)}` as const;
    const wrongSubject = await verifyAuthorityPresentation(base, anchoredRoots, { ...expect, subject: other }, opts);
    (!wrongSubject.ok && wrongSubject.code === 'subject_mismatch') ? ok('a presentation about someone else is refused') : bad(`a presentation about another subject was not refused: ${JSON.stringify(wrongSubject)}`);
    const replayed = await verifyAuthorityPresentation(base, anchoredRoots, { ...expect, nonce: `0x${'22'.repeat(32)}` }, opts);
    (!replayed.ok && replayed.code === 'challenge_mismatch') ? ok('a presentation answering another challenge is refused') : bad(`a replayed challenge was not refused: ${JSON.stringify(replayed)}`);

    // Spec 445 §3.8 — the two a BEARER value would have passed.
    // (a) RE-AIMED: someone who saw the presentation rewrites the subject to their own account and presents as
    //     themselves (the verifier's `expect.subject` is THEIR account, as a door binds it to the proof signer). The
    //     leaf commits to the real subject, so the opening no longer opens it — refused before any signature is read.
    const reaimed = await verifyAuthorityPresentation({ ...base, subject: other } as AuthorityPresentationV1, anchoredRoots, { ...expect, subject: other }, opts);
    (!reaimed.ok && reaimed.code === 'opening_mismatch') ? ok('a presentation re-aimed at another subject is refused — the leaf commits to its subject') : bad(`a presentation re-aimed at another subject was not refused as opening_mismatch: ${JSON.stringify(reaimed)}`);
    // (b) UNSIGNED: the estate's half alone, with no subject signature, is not presentable.
    const { subjectSignature: _dropped, ...unsigned } = base;
    const missing = await verifyAuthorityPresentation(unsigned as AuthorityPresentationV1, anchoredRoots, expect, opts);
    (!missing.ok && missing.code === 'subject_signature_missing') ? ok('a presentation with no subject signature is refused — it is not a bearer value') : bad(`an unsigned presentation was not refused as subject_signature_missing: ${JSON.stringify(missing)}`);
  }
}

console.log(problems.length ? `\nF1 GATE RED · ${problems.length} problem(s)` : '\nF1 GATE GREEN · roots anchored, sequence monotonic, presentation verifies signed by its subject, refusals refused (incl. re-aimed and unsigned)');
process.exit(problems.length ? 1 : 0);
