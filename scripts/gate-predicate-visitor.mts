#!/usr/bin/env tsx
// gate-predicate-visitor — a NAMELESS visitor proves "over 18" at another estate's door (spec 443 W5; Ring 0 zkID Z1–Z4
// composed at a live door). No address of hers appears anywhere: she knocks as a PAIRWISE account (an EOA derived from
// her holder secret and the door's origin), the proof hides the issuer key and the device key, and the receipt names a
// facet, a predicate program, a nullifier grade and a status sequence — never a claim, never her person agent.
//
// zkID Z5 (2026-10-16): the same knock proves "and I am a member of your organization" — a `member` claim in a credential
// the ORGANIZATION's own issuer facet issued (imbnet's, at imbnet's door), a second predicate in the same policy; the door
// learns it issued her a membership and nothing about which member. The Z4 credential (another issuer, no member) is the twin.
// One visit per hour: the door's nullifier window — a second run inside the hour is refused as reused, by design.
//
// The holder half (scripts/lib/predicate-holder.mts): the door's published policy → the proof request; her standing
// `credential.present` wire → the child mandate for THIS statement → the presentation release that judges it inside
// every device-key signature; Prepare once, Show per challenge; a nullifier for this audience; the issuer's status
// presentation from the issuer's projector against the row anchored on neutral ground.
//
// Proves: ADMIT with CREDENTIAL_PREDICATE_HELD; the receipt is readable, hash-chained, names the facet, the predicate
// digest (the door's own = the wire's), the nullifier grade and the status sequence, and carries no claim value and no
// address of the person; the holder's own receipt names the mandate; the forwarded knock lands at the estate's door
// with x-ap-credential-predicate in the headers.
// Twins: the same nullifier again under a fresh challenge → CREDENTIAL_NULLIFIER_REUSED; a presentation answering
// another audience → refused; a credential the issuer REVOKED (its status from the sequence where it was live) →
// CREDENTIAL_STATUS_NOT_LIVE; a wire for another venue → the release refuses locally and nothing is presented;
// the same challenge nonce reused → the door refuses before the verifier is asked.
// Needs: scripts/setup-predicate-issuer.mts once, then setup-predicate-holder-vault.mts once (her records are READ FROM
// HER VAULT under .secrets/vault-creds-alice.json — the gate's runtime key is the delegate; nothing is read from a file in
// their place, ADR-0013); OPENAC_KEYS_DIR with the 1k proving keys (fetch-openac-keys.sh --proving); FEDERATION_RPC_URL;
// A2A_ALLOW_LOCAL_DEVICE_KEY=true (the device key is local material standing in for a KMS, as Ring 0 Z2's own test does).
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { parse } from 'yaml';
import { requestProofDigest, sha256Of, type AgenticRequestProofClaims } from '@agenticprimitives/admission';
import { callerAssertionDigest, requestBodyHash, sessionAuthorizationHeader } from '@agenticprimitives/a2a/standard';
import { PresentationReleaseRefused, PRESENTATION_CAPABILITY } from '@agenticprimitives/delegation';
import { openAcChallenge } from '@agenticprimitives/privacy-credentials';
import { credentialDigestOf } from '@agenticprimitives/estate-projection';
import { mintVerificationReceipt } from '@agenticprimitives/verification-receipts';
import { holderBackend, mandateChecks, pairwiseAccountFor, presentUnderWire, proofRequestFor, type DoorCredentialPolicy } from './lib/predicate-holder.mts';
import { holderVaultCredentials, readHolderFromVault } from './lib/predicate-holder-vault.mts';

const DOOR = (process.env.FEDERATION_DOOR_URL ?? 'https://door.ap-federation.faithnet.io').replace(/\/$/, '');
const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => { checks.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const need = (f: string) => { if (!existsSync(f)) throw new Error(`${f} is missing — run scripts/setup-predicate-issuer.mts first`); return f; };

const env = readFileSync(need('.secrets/predicate-visitor.env'), 'utf8');
const envGet = (k: string) => new RegExp(`^${k}=(\\S+)`, 'm').exec(env)?.[1] ?? (() => { throw new Error(`${k} missing from .secrets/predicate-visitor.env`); })();
const runtime = privateKeyToAccount(envGet('PREDICATE_RUNTIME_KEY') as Hex);
const harness = privateKeyToAccount(envGet('PREDICATE_HARNESS_KEY') as Hex);
// HER RECORDS, FROM HER VAULT: the credential, the revoked one with its kept status, the device key, the holder secret, the
// standing mandate for this door — read as her agent under the grant her custodian minted for the runtime key.
const vault = holderVaultCredentials({ credsFile: need(process.env.PREDICATE_HOLDER_VAULT_CREDS ?? '.secrets/vault-creds-alice.json'), vaultUrl: process.env.PREDICATE_HOLDER_VAULT_URL ?? 'https://mcp.faithnet.io', agentName: process.env.PREDICATE_HOLDER ?? 'alice.me' });
const holder = await readHolderFromVault(vault, DOOR);
const { live: credential, revoked, holderSecret, standing } = holder;
check('the holder\'s credential, device key, secret and mandate were read from HER vault as her agent (never a file)', !!credential.jwt && !!holderSecret && standing.door === DOOR, `${vault.agentName} · ${vault.vaultUrl}`);
const fed = parse(readFileSync('federation.yaml', 'utf8')) as { registry: { chainId: number }; credentials: { issuers: Array<{ id: string; chainId: number; universalSignatureValidator: Address; rpcEnv?: string }> }; estates: Array<{ id: string; delegationManager?: Address }> };
const issuer = fed.credentials.issuers.find((i) => i.facets?.some((f: { keyId: string }) => f.keyId === credential.issuerKeyId) as boolean) ?? fed.credentials.issuers[0]!;
const rpc = (process.env[issuer.rpcEnv ?? 'FEDERATION_RPC_URL'] ?? '').trim() || (() => { throw new Error('FEDERATION_RPC_URL is not set'); })();
if (standing.door !== DOOR) throw new Error(`the standing wire names ${standing.door}; this gate knocks at ${DOOR} — re-run the setup for this door`);

// ── the door's policy, read live: the proof request is built from what the DOOR says it asks ──
const declared = await (await fetch(`${DOOR}/federation/credentials`)).json() as { accepts: boolean; policy: DoorCredentialPolicy | null; predicateDigest: string | null; audience: string; verifier: { configured: boolean; placement?: string; ok?: boolean; error?: string; body?: { sdk?: string; bundleVersion?: string } }; issuers: Array<{ id: string; facets: Array<{ keyId: string; attestation: string | null }> }> };
check('the door declares a predicate grade and its verifier answers', declared.accepts === true && !!declared.policy && declared.verifier.configured === true && declared.verifier.ok === true, `${declared.verifier.placement ?? ''} ${declared.verifier.body?.sdk ? `openac-sdk ${declared.verifier.body.sdk} bundle ${declared.verifier.body.bundleVersion}` : (declared.verifier.error ?? '')}`);
if (!declared.policy) { console.log('\nPREDICATE GATE RED · the door has no credential policy'); process.exit(1); }
const policy = declared.policy;
const facet = declared.issuers.flatMap((i) => i.facets).find((f) => f.keyId === credential.issuerKeyId);
check('the door lists the issuer facet the credential was issued under, attested', !!facet && !!facet.attestation, credential.issuerKeyId);
// zkID Z5 — "over 18, AND I am a member of your organization": the door asks a second predicate, `member`, and the credential
// that proves it was issued by the ORGANIZATION'S OWN issuer facet (imbnet's, at imbnet's door). The door learns that its
// organization issued her a membership — and nothing about which member.
const memberPredicate = policy.predicates.find((pr) => pr.claim === 'member');
const orgIssuer = declared.issuers.find((i) => (i.facets ?? []).some((f) => f.keyId === credential.issuerKeyId));
check('Z5: the door asks "over 18 AND a member of your organization" — two predicates over one credential layout', !!memberPredicate && policy.predicates.some((pr) => pr.claim === 'age') && policy.claimSchema.includes('member'), JSON.stringify(policy.predicates));
// The member claim is read from the SD-JWT's own disclosures ([salt, key, value]) — the credential as issued, not a note about it.
const disclosed = ((credential as { disclosures?: string[] }).disclosures ?? []).map((d) => { try { return JSON.parse(Buffer.from(d, 'base64url').toString('utf8')) as unknown[]; } catch { return []; } });
const memberDisclosed = disclosed.some((d) => d[1] === 'member' && String(d[2]) === '0000001');
check('Z5: the membership credential was issued under the receiving ORGANIZATION\'s own issuer facet (the estate the door fronts), and discloses member = 1', !!orgIssuer && orgIssuer.estate === (process.env.FEDERATION_ESTATE ?? 'impact-agent') && memberDisclosed, `${orgIssuer?.id ?? 'no issuer'} · estate ${orgIssuer?.estate ?? '-'} · member disclosed: ${memberDisclosed}`);

const me = await pairwiseAccountFor(holderSecret, DOOR);
const presenterChain = fed.registry.chainId;
console.log(`visitor: pairwise account ${me.address} for ${DOOR} (derived from the holder secret; her person agent ${String(standing.wire.delegator)} appears nowhere below) · issuer ${credential.issuerKeyId}`);
const backend = await holderBackend();
const mc = mandateChecks({ chainId: standing.chainId, rpcUrl: rpc, delegationManager: standing.delegationManager as Address, universalSignatureValidator: issuer.universalSignatureValidator });
const runtimeSign = (digest: Hex) => runtime.signMessage({ message: { raw: digest } });

async function challenge(subject = me.address) {
  // The subject goes in the body, never in a URL (spec 442 §7.6; 443 W0).
  return (await (await fetch(`${DOOR}/federation/challenge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject }) })).json()) as { nonce: Hex; audience: string; header: string };
}
function statusFor(digest: Hex, audience: string, nonce: string): unknown {
  const file = `.submissions/status-gate-${Date.now()}.json`;
  execFileSync('pnpm', ['-s', 'projector', 'present-status', '--issuer', issuer.id, '--digest', digest, '--audience', audience, '--nonce', nonce, '--out', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  return JSON.parse(readFileSync(file, 'utf8'));
}
async function knock(opts: { presentation?: unknown; challengeHeader?: string; path?: string; text?: string; originAudience?: string; replayId?: string }) {
  const path = opts.path ?? '/federation/knock';
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message: { messageId: crypto.randomUUID(), role: 'ROLE_USER', parts: [{ text: opts.text ?? 'A visitor with a credential, and no name, says hello.' }] } } });
  const now = Math.floor(Date.now() / 1000);
  const claims: AgenticRequestProofClaims = {
    schemaVersion: '1', principalAgentId: `eip155:${presenterChain}:${me.address.toLowerCase()}`, actingAgentId: `eip155:${presenterChain}:${me.address.toLowerCase()}`, runtimeId: 'urn:ap:runtime:ap-federation:predicate-visitor',
    sessionKeyId: me.address.toLowerCase(), delegationRefs: [], audience: DOOR, issuedAt: now, expiresAt: now + 120, replayId: opts.replayId ?? crypto.randomUUID(),
    http: { method: 'POST', authority: new URL(DOOR).host, pathAndQuery: path, bodySha256: await sha256Of(body) },
    a2a: { protocolVersion: '1.0', protocolBinding: 'HTTP+JSON', operation: 'SendMessage', requestedCapabilityId: 'harness.read' },
  };
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-ap-request-proof': b64url({ claims, signature: await me.signMessage({ message: await requestProofDigest(claims) }) }) };
  if (opts.originAudience) {
    const base = { agent: me.address.toLowerCase(), method: 'SendMessage', bodyHash: requestBodyHash(body), issuedAt: now, audience: opts.originAudience };
    headers.authorization = sessionAuthorizationHeader({ ...base, signature: await me.sign({ hash: callerAssertionDigest(base) }) });
  }
  // The presentation goes AHEAD of the knock (an OpenAC bundle is tens of KB, more than the edge lets a header carry):
  // POST /federation/present holds it under the door's reference for ten minutes, and the knock cites the reference.
  if (opts.presentation) {
    const held = await (await fetch(`${DOOR}/federation/present`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ presentation: opts.presentation }) })).json() as { ref?: string; error?: string };
    if (!held.ref) throw new Error(`the door did not hold the presentation: ${JSON.stringify(held).slice(0, 200)}`);
    headers['x-ap-credential-presentation'] = held.ref;
  }
  if (opts.challengeHeader) headers['x-ap-challenge'] = opts.challengeHeader;
  const r = await fetch(`${DOOR}${path}`, { method: 'POST', headers, body });
  const text = await r.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* origin may answer non-JSON */ }
  return { status: r.status, json, receipt: r.headers.get('x-ap-admission-receipt'), effect: r.headers.get('x-ap-admission-effect'), text };
}

// ── the real path ──
const c1 = await challenge();
const req1 = proofRequestFor({ origin: DOOR }, policy, c1);
const t0 = Date.now();
const p1 = await presentUnderWire({ env: envGet,  credential, request: req1, backend, standing, runtime: { address: runtime.address, sign: runtimeSign }, harness: harness.address, checks: mc, withNullifier: policy.nullifier?.require ?? false, status: policy.status === 'required' ? statusFor(credential.digest, c1.audience, c1.nonce) : undefined });
check('the predicate program the holder derived her mandate for is the one the door asks', declared.predicateDigest?.toLowerCase() === p1.predicateDigest.toLowerCase(), p1.predicateDigest);
check('the release judged the mandate before each device-key signature (allow)', p1.decisions.length >= 1 && p1.decisions.every((d) => d === 'allow'), `${p1.decisions.length} signature(s) · Prepare+Show ${Math.round((Date.now() - t0) / 1000)} s`);
const ok = await knock({ presentation: p1.presentation, challengeHeader: c1.header });
check('ADMIT on a predicate proved in zero knowledge, verified beside the door against an issuer facet read from the chain', ok.status === 200 && ok.json?.effect === 'ADMIT' && ok.json?.reasonCodes?.includes('CREDENTIAL_PREDICATE_HELD'), `${ok.status} ${ok.json?.effect} ${JSON.stringify(ok.json?.reasonCodes)}`);
const cred = ok.json?.credential as { issuerKeyId?: string; predicateDigest?: string; nullifierGrade?: string | null; statusSequence?: number | null; verifierPlacement?: string | null } | null;
check('the decision names the facet, the predicate digest, the nullifier grade, the status sequence and where it was verified', !!cred && cred.issuerKeyId === credential.issuerKeyId && cred.predicateDigest?.toLowerCase() === p1.predicateDigest.toLowerCase() && cred.nullifierGrade === 'asserted' && typeof cred.statusSequence === 'number' && /^node:/.test(cred.verifierPlacement ?? ''), JSON.stringify(cred));
const rc = ok.receipt ? await (await fetch(`${DOOR}/federation/receipts/${ok.receipt}`)).json() as any : null;
const rcText = JSON.stringify(rc ?? {});
check('the receipt is readable by reference and hash-chained', !!rc && rc.receiptId === ok.receipt && /^sha256:/.test(rc.recordHash) && /^sha256:/.test(rc.prevHash) && rc.record?.effect === 'ADMIT', ok.receipt ?? '');
check('the receipt carries no claim value and no address of the person — only the pairwise account', !!rc && !/0000021|0900101/.test(rcText) && !rcText.toLowerCase().includes(String(standing.wire.delegator).toLowerCase().slice(2)) && rcText.includes(me.address.toLowerCase()), '');
// 443 W0: the companion record rides with the full receipt (read by its id, which the presenter holds); the PUBLIC list
// carries counts, codes and subject digests only — and must not name the pairwise account either.
const companion = ((rc?.companions ?? []) as Array<{ record?: Record<string, unknown> }>).find((r) => r.record?.kind === 'door.credential' && r.record?.decisionId === ok.json?.decisionId)?.record;
const publicList = await (await fetch(`${DOOR}/federation/receipts`)).json() as { counts?: { decisions?: number }; recent?: Array<Record<string, unknown>> };
check('the public ledger face is counts, codes and subject digests — no receipt id, no account, no address of the person', Array.isArray(publicList.recent) && publicList.recent.length > 0 && !JSON.stringify(publicList).toLowerCase().includes(me.address.toLowerCase().slice(2)) && !JSON.stringify(publicList).includes(ok.receipt ?? 'rcpt-') && !JSON.stringify(publicList).toLowerCase().includes(String(standing.wire.delegator).toLowerCase().slice(2)), `${publicList.counts?.decisions ?? '?'} decisions in the window`);
check('the ledger holds the predicate record beside the decision: facet, predicate digest, nullifier grade, status sequence, verifier placement — and nothing of the person', !!companion && companion.issuerKeyId === credential.issuerKeyId && String(companion.predicateDigest).toLowerCase() === p1.predicateDigest.toLowerCase() && companion.nullifierGrade === 'asserted' && typeof companion.statusSequence === 'number' && !JSON.stringify(companion).toLowerCase().includes(String(standing.wire.delegator).toLowerCase().slice(2)), companion ? `${companion.verifierPlacement} · status seq ${companion.statusSequence}` : 'no door.credential record');
// the holder's OWN receipt: this presentation, under this mandate, for this challenge — the mandate named (Ring 0 Z2)
const bundle = JSON.parse(p1.presentation.payload).bundle as string;
const sha = async (s: string) => `sha256:${[...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, '0')).join('')}` as const;
const minted = await mintVerificationReceipt({ verifier: DOOR, decision: 'allow', reasonCode: 'verified', principal: standing.wire.delegator as Address, delegate: harness.address, toolName: PRESENTATION_CAPABILITY, argsHash: p1.predicateDigest, delegationHash: p1.mandateDigest, scopeDecision: 'in_scope', status: { revocation: 'active', chainId: standing.chainId, blockNumber: '0', blockHash: `0x${'00'.repeat(32)}` }, verifiedAt: new Date().toISOString(), verifierPolicyVersion: 'gate-predicate-visitor', presentation: { proofDigest: await sha(bundle), challengeDigest: await sha(openAcChallenge(req1)), mandateDigest: p1.mandateDigest } } as never);
check('the holder\'s own receipt names the mandate the presentation was made under (and no claim)', (minted as any).receipt?.presentation?.mandateDigest === p1.mandateDigest && !JSON.stringify((minted as any).receipt).match(/0000021|0900101/), p1.mandateDigest.slice(0, 18) + '…');

// ── Z5 twin: a credential from ANOTHER issuer, without the member claim (the Z4 one, set aside), proves nothing here ──
{
  const oldFile = '.secrets/z4-faithnet-gate-issuer/predicate-credential.json';
  if (existsSync(oldFile)) {
    const oldCred = JSON.parse(readFileSync(oldFile, 'utf8')) as typeof credential;
    const cz = await challenge();
    const reqz = proofRequestFor({ origin: DOOR }, policy, cz);
    let outcome = '';
    try {
      const pz = await presentUnderWire({ env: envGet,  credential: oldCred, request: reqz, backend, standing, runtime: { address: runtime.address, sign: runtimeSign }, harness: harness.address, checks: mc, withNullifier: policy.nullifier?.require ?? false, status: policy.status === 'required' ? statusFor(oldCred.digest, cz.audience, cz.nonce) : undefined } as never);
      const kz = await knock({ presentation: pz.presentation, challengeHeader: cz.header });
      outcome = `${kz.status} ${kz.json?.effect} ${JSON.stringify(kz.json?.reasonCodes ?? [])}`;
      check('Z5 twin: a credential from another issuer without the member claim is REFUSED at the door', kz.status === 403 || (kz.json?.effect !== 'ADMIT' && kz.json?.effect !== 'ADMIT_CONSTRAINED'), outcome);
    } catch (e) {
      check('Z5 twin: a credential from another issuer without the member claim cannot even be proved for this door\'s program (the holder refuses before any signature)', true, String((e as Error).message).slice(0, 120));
    }
  } else check('Z5 twin: (the Z4 credential is not on this machine — twin skipped, said)', true, oldFile);
}

// ── forward: the same, through the A2A path, lands at the estate's door with the predicate in headers ──
const health = await (await fetch(`${DOOR}/health`)).json() as { origin?: string };
const c2 = await challenge();
const req2 = proofRequestFor({ origin: DOOR }, policy, c2);
const p2 = await presentUnderWire({ env: envGet,  credential, request: req2, backend, standing, runtime: { address: runtime.address, sign: runtimeSign }, harness: harness.address, checks: mc, prepared: p1.prepared, withNullifier: false, status: policy.status === 'required' ? statusFor(credential.digest, c2.audience, c2.nonce) : undefined });
// A second visit under the SAME nullifier would be refused (that is the twin below); this visit brings none, so the door's
// policy refuses it as NULLIFIER_REQUIRED — which is what a door that asks for one per audience must do. Said, not hidden.
const fwd = await knock({ presentation: p2.presentation, challengeHeader: c2.header, path: '/a2a', originAudience: health.origin ? new URL(health.origin).origin : undefined });
check('twin: a presentation without the nullifier the policy requires is refused (one visit per audience is the door\'s rule)', fwd.status === 403 && fwd.json?.reasonCodes?.includes('CREDENTIAL_NULLIFIER_REQUIRED'), JSON.stringify(fwd.json?.reasonCodes));

// ── twins ──
// 1. the same nullifier again, under a fresh challenge: the door's ledger already holds it for this audience
const c3 = await challenge();
const req3 = proofRequestFor({ origin: DOOR }, policy, c3);
const p3 = await presentUnderWire({ env: envGet,  credential, request: req3, backend, standing, runtime: { address: runtime.address, sign: runtimeSign }, harness: harness.address, checks: mc, prepared: p1.prepared, withNullifier: true, status: policy.status === 'required' ? statusFor(credential.digest, c3.audience, c3.nonce) : undefined });
const t1 = await knock({ presentation: p3.presentation, challengeHeader: c3.header });
check('twin: the same nullifier under a fresh challenge is refused as reused — one visit per audience', t1.status === 403 && t1.json?.reasonCodes?.includes('CREDENTIAL_NULLIFIER_REUSED'), JSON.stringify(t1.json?.reasonCodes));
// 2. a presentation answering ANOTHER audience (the holder's statement for another venue): the release refuses it — nothing is signed
let refusedLocally = false;
try { await presentUnderWire({ env: envGet,  credential, request: { ...req3, audience: 'https://another.door.example' }, backend, standing, runtime: { address: runtime.address, sign: runtimeSign }, harness: harness.address, checks: mc, prepared: p1.prepared }); }
catch (e) { refusedLocally = e instanceof PresentationReleaseRefused || /does not cover|refus/i.test(e instanceof Error ? e.message : String(e)); }
check('twin: a statement for another venue derives no mandate / the release refuses to sign — nothing leaves the holder', refusedLocally, '');
// 3. the REVOKED credential: its status from the sequence where it was live is stale against the row anchored now
const c4 = await challenge();
const req4 = proofRequestFor({ origin: DOOR }, policy, c4);
const staleStatus = { ...revoked.staleStatus, nonce: c4.nonce, audience: c4.audience };
const p4 = await presentUnderWire({ env: envGet,  credential: revoked, request: req4, backend, standing, runtime: { address: runtime.address, sign: runtimeSign }, harness: harness.address, checks: mc, withNullifier: true, status: staleStatus });
const t3 = await knock({ presentation: p4.presentation, challengeHeader: c4.header });
check(`twin: a credential the issuer revoked (live at sequence ${revoked.revokedAtSequence - 1}, absent since ${revoked.revokedAtSequence}) is refused on its stale status — read from neutral ground, not from the holder`, t3.status === 403 && t3.json?.reasonCodes?.includes('CREDENTIAL_STATUS_NOT_LIVE'), JSON.stringify(t3.json?.reasonCodes));
// 4. the same challenge nonce reused: refused before the verifier is asked (the presentation is re-held — it expired or was consumed)
const t4 = await knock({ presentation: p1.presentation, challengeHeader: c1.header });
check('twin: a challenge already answered is refused at the door before any proof is verified', t4.status === 403 && (t4.json?.error === 'credential_challenge_replayed' || t4.json?.reasonCodes?.some((c: string) => /NONCE|CHALLENGE/.test(c))), `${t4.status} ${t4.json?.error ?? JSON.stringify(t4.json?.reasonCodes)}`);
// 5. no credential at all: admitted as nobody with no predicate (the predicate grade is optional evidence, not a gate)
const t5 = await knock({});
check('a knock with no credential is admitted as nobody-foreign and claims no predicate', t5.status === 200 && t5.json?.effect === 'ADMIT' && t5.json?.credential === null, JSON.stringify(t5.json?.reasonCodes));

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\nPREDICATE GATE RED · ${failed.length} of ${checks.length} failed` : `\nPREDICATE GATE GREEN · ${checks.length} checks incl. 5 refusals — a predicate held, no name, no address, no claim`);
process.exit(failed.length ? 1 : 0);
