#!/usr/bin/env tsx
// THE PROJECTOR'S CLI (spec 439 F1) — one estate, one pass, everything said out loud.
//
//   projector status  [--estate <id>]                      what the register claims and what the chain holds
//   projector register --estate <id>                       bind the estate id to its signer (ONCE, forever)
//   projector submit  --estate <id> --set live-grant|membership --digest 0x… --subject 0x… [--expires <iso>]
//   projector retire  --estate <id> --digest 0x… --reason "<why>" [--set live-grant|membership]
//   projector project --estate <id> [--dry-run] [--refresh-after <seconds>]
//   projector present --estate <id> --digest 0x… --audience <origin> [--nonce 0x…] [--out <file>]
//   projector verify  --file <presentation.json> [--max-age <seconds>]
//
//   --issuer <id> (zkID Z4) routes status | register | submit | retire | project at a credential ISSUER's row
//   (`credentials.issuers[]` in the register; set `live-credential`; ledger `.submissions/issuer-<id>.json`), and
//   projector present-status --issuer <id> --digest 0x… --audience <origin> --nonce <nonce> [--out <file>]
//   writes the credential-status presentation a holder shows beside a proof. Revocation is `retire` + `project`.
//
// Every command reads `federation.yaml` (the register) and `FEDERATION_RPC_URL` (neutral ground). The
// anchoring key comes from the environment variable the estate's row names and is never printed.
//
// `verify` runs the same `verifyAuthorityPresentation` the receiving edge will run in F2, against the roots
// READ FROM THE CHAIN here and now. It is the proof that an anchored root is usable, and it is deliberately
// the only command that needs no key at all: a verifier holds nothing.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { makeAuthorityPresentation, verifyAuthorityPresentation, type AuthorityPresentationV1 } from '@agenticprimitives/estate-projection';
import type { Address, Hex } from 'viem';
import { estateById, issuerById, loadFederation, registryRpc, requireProjectable, signerKey } from '../src/config.js';
import { presentCredentialStatus, projectIssuer, liveCredentialRows } from '../src/issuer.js';
import { fileLedger } from '../src/ledger.js';
import { readDeclaredSigner, registryClient, type AnchoringWireV1, type DeclaredSigner } from '../src/anchor.js';
import { buildForSequence, projectEstate } from '../src/project.js';
import { isRevokedReader } from '../src/revocation.js';

const argv = process.argv.slice(2);
const cmd = argv[0] ?? 'status';
const flag = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const has = (k: string) => argv.includes(`--${k}`);

const REGISTER = flag('register-file') ?? 'federation.yaml';
const f = loadFederation(REGISTER);
const rpc = registryRpc(f);
/** `.secrets/anchoring-wire-<estate>.json`, when the operator has one. Absent is not an error here: an estate whose
 *  signer is still a bare key anchors the old way, and `projector status` says which it is. */
const anchoringWire = (estate: string): AnchoringWireV1 | null => {
  const p = `.secrets/anchoring-wire-${estate}.json`;
  try { return JSON.parse(readFileSync(p, 'utf8')) as AnchoringWireV1; } catch { return null; }
};
/** The estate agent's own declaration (spec 439 F2.5), read from the estate's chain — neutral ground's RPC while they share one. */
const declaredSignerFor = (estate: { chainId: number; governance: Address; profileResolver?: Address }): Promise<DeclaredSigner> =>
  readDeclaredSigner({ rpcUrl: rpc, chainId: estate.chainId, governance: estate.governance, profileResolver: estate.profileResolver ?? ('0xB03F7C06ad3274F584AB72794406D639c02A45e1' as Address) });
const registry = registryClient({ rpcUrl: rpc, chainId: f.registry.chainId, address: f.registry.address });
const ledgerFor = (id: string) => fileLedger(flag('ledger') ?? `.submissions/${id}.json`);
const REFRESH_AFTER = Number(flag('refresh-after') ?? process.env.FEDERATION_REFRESH_AFTER_SECONDS ?? 3600);

// Annotated so TypeScript narrows after it: an unannotated arrow returning `never` does not.
const die: (msg: string) => never = (msg) => { console.error(msg); process.exit(1); };
const estateFlag = () => flag('estate') ?? die('--estate <id> is required');

// ── ISSUER ROWS (Ring 0 zkID Z3/Z4; spec 443 W5): the same verbs, a credential issuer's live-credential row ──
if (has('issuer')) {
  const issuer = issuerById(f, flag('issuer') ?? die('--issuer <id> is required'));
  const ledger = fileLedger(flag('ledger') ?? `.submissions/issuer-${issuer.id}.json`);
  const wire = issuer.anchoringWire ? ((): AnchoringWireV1 | null => { try { return JSON.parse(readFileSync(issuer.anchoringWire!, 'utf8')) as AnchoringWireV1; } catch { return null; } })() : null;
  if (cmd === 'status') {
    const signer = await registry.signerOf(issuer.issuerId);
    const r = await registry.roots(issuer.issuerId);
    const live = liveCredentialRows(ledger.list());
    console.log(`── issuer ${issuer.id} (${issuer.kind ?? 'issuer'} of ${issuer.estate}) ──\n  sa        ${issuer.sa} on eip155:${issuer.chainId}\n  issuerId  ${issuer.issuerId}\n  signer    ${signer ?? 'not registered'}${signer && signer.toLowerCase() !== issuer.sa.toLowerCase() ? '  ⚠ not the issuer SA' : ''}`);
    console.log(r.never ? '  roots     nothing anchored yet (sequence 0)' : `  roots     seq ${r.sequence} · live-credential ${r.liveGrantRoot.slice(0, 18)}… · tag ${r.charterHash.slice(0, 10)}… · anchored ${new Date(r.anchoredAt * 1000).toISOString()}`);
    console.log(`  vouches   ${live.kept.length} live credential(s) in the ledger (${live.dropped.length} retired/expired)\n  facets    ${(issuer.facets ?? []).map((x) => `${x.keyId}${x.attestation ? ' (attested)' : ' (NOT attested)'}`).join(', ') || 'none declared'}`);
  } else if (cmd === 'register') {
    const already = await registry.signerOf(issuer.issuerId);
    if (already) die(already.toLowerCase() === issuer.sa.toLowerCase() ? `issuer ${issuer.id} is already registered to its SA ${already}` : `issuer ${issuer.id}'s row is registered to ${already}, NOT to its SA — first-come-wins; resolve this first`);
    const tx = await registry.register(issuer.issuerId, issuer.sa, signerKey(issuer));
    console.log(`registered issuer ${issuer.id}: row ${issuer.issuerId} → signer ${issuer.sa} (the issuer SA itself; the delegate key anchors under its wire)\n  tx ${tx}`);
  } else if (cmd === 'submit') {
    const digest = (flag('digest') ?? die('--digest 0x… (credentialDigestOf the issued JWT) is required')).toLowerCase() as Hex;
    if (!/^0x[0-9a-f]{64}$/.test(digest)) die('--digest must be 32 bytes');
    // A credential leaf is ABOUT the credential, not a subject: the status presentation names none. The ledger's
    // subject slot takes the zero address unless the issuer chooses to record whom it issued to (its own record).
    const subject = ((flag('subject') ?? `0x${'00'.repeat(20)}`).toLowerCase()) as Address;
    const out = ledger.add({ estate: issuer.estate, set: 'live-credential', digest, subject, submittedBy: flag('by') ?? 'issuer', source: flag('source') ?? 'cli', ...(flag('expires') ? { expiresAt: flag('expires')! } : {}) });
    console.log(out.added ? `vouched for: live-credential ${digest}\n  the opening (digest + blind) is in the issuer's ledger; the holder needs it for a status presentation` : `not added — ${out.why}`);
  } else if (cmd === 'retire') {
    // REVOCATION, for a credential: the issuer stops standing behind it. The next `project` anchors a root without it.
    const digest = (flag('digest') ?? die('--digest 0x… is required')).toLowerCase() as Hex;
    const reason = flag('reason') ?? die('--reason "<why>" is required');
    console.log(ledger.retire('live-credential', digest, reason) ? `revoked: live-credential ${digest}\n  run \`projector project --issuer ${issuer.id}\` to anchor the row without it; every status built before is stale from then on` : `nothing live to retire for ${digest}`);
  } else if (cmd === 'project') {
    const dry = has('dry-run');
    const run = await projectIssuer(issuer, { registry, ledger, refreshAfterSeconds: REFRESH_AFTER, ...(dry ? {} : { signerKey: signerKey(issuer) }), ...(wire ? { anchoringWire: wire } : {}) });
    console.log(`issuer ${issuer.id} · row ${run.issuerId}\n  live-credential ${run.counts.live} leaf/leaves → ${run.projection.liveCredentialRoot} (${run.counts.retired} retired/expired)\n  anchored before: ${run.anchoredBefore.never ? 'never' : `seq ${run.anchoredBefore.sequence}`}\n  decision: ${run.decision.anchor ? `anchor at sequence ${run.decision.sequence}` : 'do not anchor'} — ${run.decision.why}`);
    if (run.txHash) console.log(`  tx ${run.txHash}`); else if (dry && run.decision.anchor) console.log('  (dry run: nothing was written)');
  } else if (cmd === 'present-status') {
    const digest = (flag('digest') ?? die('--digest 0x… is required')).toLowerCase() as Hex;
    const audience = flag('audience') ?? die('--audience <the verifier\'s origin> is required');
    const nonce = flag('nonce') ?? die('--nonce <the verifier\'s challenge nonce> is required: a status answers ONE challenge');
    const r = await presentCredentialStatus(issuer, { registry, ledger, digest, nonce, audience });
    if (!r.ok) die(r.reason);
    const file = flag('out') ?? `.submissions/status-${issuer.id}-${digest.slice(2, 10)}.json`;
    writeFileSync(file, `${JSON.stringify(r.presentation, null, 2)}\n`, { mode: 0o600 });
    console.log(`status presentation for ${digest} at sequence ${r.sequence} → ${file}\n  It says the issuer still stands behind this credential as of that sequence, to this audience, for this nonce. It names no subject and authorizes nothing.`);
  } else die(`unknown issuer command "${cmd}" — status | register | submit | retire | project | present-status`);
  process.exit(0);
}

if (cmd === 'status') {
  const only = flag('estate');
  console.log(`register: ${REGISTER} · neutral ground: ${f.registry.address} on chain ${f.registry.chainId} (${f.registry.chain})`);
  for (const row of f.estates) {
    if (only && row.id !== only) continue;
    console.log(`\n── ${row.id} ──`);
    if (!row.governance) { console.log(`  NOT PROJECTABLE — ${row.blocked ?? 'the register gives no reason'}`); continue; }
    const estate = requireProjectable(row);
    console.log(`  governance ${estate.governance} (${row.governanceKind}${row.governanceName ? ` · ${row.governanceName}` : ''})`);
    console.log(`  estateId   ${estate.estateId}`);
    const onChain = await registry.estateIdOf(estate.chainId, estate.governance);
    console.log(`  derivation ${onChain.toLowerCase() === estate.estateId.toLowerCase() ? 'agrees with the contract' : `DISAGREES with the contract (${onChain})`}`);
    const signer = await registry.signerOf(estate.estateId);
    console.log(`  signer     ${signer ?? 'not registered'}${signer && row.signer && signer.toLowerCase() !== row.signer.toLowerCase() ? `  ⚠ the register claims ${row.signer}` : ''}`);
    const r = await registry.roots(estate.estateId);
    if (r.never) console.log('  roots      nothing anchored yet (sequence 0)');
    else console.log(`  roots      seq ${r.sequence} · live-grant ${r.liveGrantRoot.slice(0, 18)}… · membership ${r.membershipRoot.slice(0, 18)}… · anchored ${new Date(r.anchoredAt * 1000).toISOString()} (${Math.floor(Date.now() / 1000) - r.anchoredAt}s ago)`);
    const rows = ledgerFor(row.id).list();
    console.log(`  vouches    ${rows.filter((x) => !x.retired).length} live submission(s) in the ledger (${rows.length} ever)`);
    const declared = await declaredSignerFor(estate).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    if ('error' in declared) console.log(`  declared   could not read the estate's chain: ${declared.error}`);
    else if (!declared.declared) console.log('  declared   ⚠ the estate agent has not declared atl:projectionSigner on its own chain — reviewable here and in ap-town, not yet chain-verifiable (spec 439 F2.5; ap-home scripts/set-projection-signer.mts)');
    else console.log(`  declared   ${declared.signer}${signer && declared.signer.toLowerCase() === signer.toLowerCase() ? ' — agrees with neutral ground: chain-verifiable both ways' : signer ? `  ✗ DISAGREES with neutral ground (${signer}) — this registration is not the estate's` : ''}`);
  }
} else if (cmd === 'register') {
  const estate = requireProjectable(estateById(f, estateFlag()));
  if (!estate.signer) die(`estate ${estate.id} has no signer address in the register`);
  const already = await registry.signerOf(estate.estateId);
  if (already) die(already.toLowerCase() === estate.signer.toLowerCase()
    ? `estate ${estate.id} is already registered to ${already} — registration happens once`
    : `estate ${estate.id} is registered to ${already}, NOT to the ${estate.signer} in the register. \`register\` is first-come-wins; resolve this before anything anchors.`);
  const key = signerKey(estate);
  console.log(`registering ${estate.id}\n  estateId ${estate.estateId}\n  signer   ${estate.signer}\nThis binds the id to that signer permanently (only the signer can rotate it).`);
  const tx = await registry.register(estate.estateId, estate.signer as Address, key);
  const after = await registry.signerOf(estate.estateId);
  console.log(`  tx ${tx}\n  signerOf now ${after}`);
} else if (cmd === 'submit') {
  const row = estateById(f, estateFlag());
  const set = (flag('set') ?? 'live-grant') as 'live-grant' | 'membership';
  if (set !== 'live-grant' && set !== 'membership') die('--set is live-grant or membership');
  const digest = (flag('digest') ?? die('--digest 0x… is required')).toLowerCase() as Hex;
  const subject = (flag('subject') ?? die('--subject 0x… (whom the leaf is about) is required')).toLowerCase() as Address;
  if (!/^0x[0-9a-f]{64}$/.test(digest)) die('--digest must be 32 bytes');
  if (!/^0x[0-9a-f]{40}$/.test(subject)) die('--subject must be an address');
  const out = ledgerFor(row.id).add({
    estate: row.id, set, digest, subject,
    submittedBy: flag('by') ?? 'operator',
    source: flag('source') ?? 'cli',
    ...(flag('expires') ? { expiresAt: flag('expires')! } : {}),
  });
  console.log(out.added
    ? `vouched for: ${set} ${digest} about ${subject}\n  the opening (digest + blind) is in the ledger; the holder needs it to present, and nobody else should have it`
    : `not added — ${out.why}`);
} else if (cmd === 'retire') {
  // THE ESTATE STOPS VOUCHING. Not a revocation — the grant may well still be live on the chain — but a
  // withdrawal of the estate's statement about it: the holder asked for it back, or an operator found a row
  // that should never have been submitted. The row stays, with the reason, because a projection that
  // stopped including something is exactly what an auditor comes looking for.
  const row = estateById(f, estateFlag());
  const digest = (flag('digest') ?? die('--digest 0x… is required')).toLowerCase() as Hex;
  const set = (flag('set') ?? 'live-grant') as 'live-grant' | 'membership';
  const reason = flag('reason') ?? die('--reason "<why>" is required: a withdrawal without a reason is indistinguishable from a bug');
  console.log(ledgerFor(row.id).retire(set, digest, reason)
    ? `retired: ${set} ${digest}\n  the next \`projector project\` will anchor a root without it (the chain still says whatever it says about the grant itself)`
    : `nothing live to retire for ${set} ${digest}`);
} else if (cmd === 'project') {
  const estate = requireProjectable(estateById(f, estateFlag()));
  const dry = has('dry-run');
  const run = await projectEstate(estate, {
    registry, ledger: ledgerFor(estate.id),
    declaredSigner: await declaredSignerFor(estate),
    liveness: { isRevoked: await isRevokedReader(estate) },
    refreshAfterSeconds: REFRESH_AFTER,
    ...(dry ? {} : { signerKey: signerKey(estate) }),
    // The wire the estate's registry agent lent this key (spec 439 §4), when this operator holds one. Without it the
    // key anchors as itself, which only works while it is still the registered signer.
    ...(anchoringWire(estate.id) ? { anchoringWire: anchoringWire(estate.id)! } : {}),
  });
  for (const w of run.warnings) console.log(`⚠ ${w}`);
  console.log(`${estate.id} · estateId ${run.estateId}`);
  console.log(`  live-grant ${run.counts.liveGrant} leaf/leaves → ${run.projection.liveGrantRoot}`);
  console.log(`  membership ${run.counts.membership} leaf/leaves → ${run.projection.membershipRoot}`);
  for (const d of run.dropped) console.log(`  dropped ${d.set} ${d.digest.slice(0, 18)}… — ${d.reason}`);
  console.log(`  anchored before: ${run.anchoredBefore.never ? 'never' : `seq ${run.anchoredBefore.sequence}`}`);
  console.log(`  decision: ${run.decision.anchor ? `anchor at sequence ${run.decision.sequence}` : 'do not anchor'} — ${run.decision.why}`);
  if (run.txHash) console.log(`  tx ${run.txHash}`);
  else if (dry && run.decision.anchor) console.log('  (dry run: nothing was written)');
} else if (cmd === 'present') {
  const estate = requireProjectable(estateById(f, estateFlag()));
  const digest = (flag('digest') ?? die('--digest 0x… is required')).toLowerCase() as Hex;
  const audience = flag('audience') ?? die('--audience <the verifier\'s origin> is required: a presentation answers ONE challenge');
  const nonce = (flag('nonce') ?? `0x${randomBytes(32).toString('hex')}`) as Hex;
  const anchored = await registry.roots(estate.estateId);
  if (anchored.never) die(`${estate.id} has nothing anchored — there is no root to prove against`);
  // Built at the ANCHORED sequence, then checked against the anchored roots: if the set has moved since,
  // the proof would be against a tree nobody can verify, and saying so beats handing over a dead proof.
  const built = await buildForSequence(estate, { ledger: ledgerFor(estate.id), liveness: { isRevoked: await isRevokedReader(estate) }, sequence: anchored.sequence });
  const set: 'live-grant' | 'membership' = built.kept.liveGrant.some((r) => r.digest === digest) ? 'live-grant'
    : built.kept.membership.some((r) => r.digest === digest) ? 'membership'
    : die(`${digest} is not in ${estate.id}'s live sets right now — nothing to present`);
  const expect = set === 'live-grant' ? anchored.liveGrantRoot : anchored.membershipRoot;
  const rebuilt = set === 'live-grant' ? built.projection.liveGrantRoot : built.projection.membershipRoot;
  if (rebuilt.toLowerCase() !== expect.toLowerCase()) {
    die(`the ${set} set has moved since sequence ${anchored.sequence} (rebuilt ${rebuilt}, anchored ${expect}). Re-anchor (\`projector project\`) and present again.`);
  }
  const pres = makeAuthorityPresentation(built.projection, set, digest, { nonce, audience });
  if (!pres) die('the leaf is in the set but no proof could be made for it — that is a bug, not a refusal');
  const file = flag('out') ?? `.submissions/presentation-${estate.id}-${digest.slice(2, 10)}.json`;
  writeFileSync(file, `${JSON.stringify(pres, null, 2)}\n`, { mode: 0o600 });
  console.log(`presentation for ${set} ${digest}\n  subject  ${pres!.subject}\n  sequence ${pres!.sequence}\n  audience ${audience}\n  written  ${file}`);
  console.log('  It is EVIDENCE, not authority: it says this subject holds a live grant in this estate as of that sequence, and nothing more.');
} else if (cmd === 'verify') {
  const file = flag('file') ?? die('--file <presentation.json> is required');
  const pres = JSON.parse(readFileSync(file, 'utf8')) as AuthorityPresentationV1;
  const maxAgeSeconds = Number(flag('max-age') ?? 3600);
  const anchored = await registry.roots(pres.estateId);
  const verdict = verifyAuthorityPresentation(pres, {
    estateId: pres.estateId, sequence: anchored.sequence,
    liveGrantRoot: anchored.liveGrantRoot, membershipRoot: anchored.membershipRoot, anchoredAt: anchored.anchoredAt,
  }, { subject: pres.subject, nonce: pres.nonce, audience: pres.audience, now: Math.floor(Date.now() / 1000), maxAgeSeconds });
  console.log(`roots read from ${f.registry.address} (chain ${f.registry.chainId}) — not from the presentation`);
  console.log(verdict.ok
    ? `VERIFIED: ${verdict.subject} holds a live ${verdict.set} leaf in estate ${verdict.estateId} as of sequence ${verdict.sequence}.\n  This authorizes nothing. The receiving estate still decides, under its own mandate, per step.`
    : `REFUSED (${verdict.code}): ${verdict.reason}`);
  if (!verdict.ok) process.exit(2);
} else if (cmd === 'push') {
  // PUSH THE LOCAL LEDGER TO THE DEPLOYED STORE — the one-time migration off `.submissions/`, and the way an operator
  // vouches for a leaf once the scheduled projector is the one anchoring. The rows are the same rows; the opening
  // (digest + blind) travels because the deployed job needs it to rebuild the tree, and it goes over TLS to one
  // Worker, authenticated by the ops token. It is still not a vault (ADR-0055) — see DEPLOYER.md.
  const row = estateById(f, estateFlag());
  const to = (flag('to') ?? process.env.FEDERATION_PROJECTOR_URL ?? die('--to <https://projector…> (or FEDERATION_PROJECTOR_URL) is required')).replace(/\/$/, '');
  const token = process.env.FEDERATION_OPS_TOKEN ?? die('FEDERATION_OPS_TOKEN is required — the deployed store takes writes only from the operator');
  const rows = ledgerFor(row.id).list();
  if (!rows.length) die(`nothing in the local ledger for ${row.id}`);
  let added = 0, already = 0, retired = 0;
  for (const r of rows) {
    const res = await fetch(`${to}/ops/submit`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(r) });
    const b = (await res.json().catch(() => ({}))) as { added?: boolean };
    if (!res.ok) die(`${to} refused ${r.digest.slice(0, 12)}…: HTTP ${res.status}`);
    b.added ? added++ : already++;
    if (r.retired) {
      await fetch(`${to}/ops/retire`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ estate: r.estate, set: r.set, digest: r.digest, reason: r.retired.reason }) });
      retired++;
    }
  }
  console.log(`${row.id} → ${to}: ${added} added, ${already} already there, ${retired} retirement(s) carried over (${rows.length} row(s) local)`);
} else {
  die(`unknown command "${cmd}" — status | register | submit | retire | project | present | verify | push`);
}
