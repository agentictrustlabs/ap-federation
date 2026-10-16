#!/usr/bin/env tsx
// gate-pap-twin — spec 443 §4: faithnet's person agent, as faithnet-pap.svc, at a company's PAP door (ligonier's, in front of
// ligonier.svc). The positive path: discover · session (the door verified OUR client document and JWKS at pap.faithnet.io) ·
// device sign-in approved by alice's OWN agent signing the code (ERC-1271 at the door; no password anywhere) · an operation
// proposed by the company's API · parked at alice's approval door · her mandate signature over THIS revision's intent digest
// is what produces approved_by: user · confirmed with an identity proof · the door records the claim and parks the act at
// ligonier.svc for the owner's mandate (in_progress, effect-uncertain) · receipts on both sides name no person.
// The twin: standing_permission with no covering wire is refused and parks; a second confirm of the same revision is refused
// here; a changed revision under the old mandate parks; mediated sign-in returns the refusal; the public ledger face names nobody.
//
//   set -a; . .secrets/ops.env; set +a; A2A_ALLOW_LOCAL_DEVICE_KEY=true npx tsx scripts/gate-pap-twin.mts
import { existsSync, readFileSync } from 'node:fs';
import { createPublicClient, http, keccak256, toBytes, parseAbi, hashMessage, type Address, type Hex } from 'viem';
import { LocalEs256Signer, derivePairwiseSubject, type ExternalAccountLinkV1 } from '@agenticprimitives/key-custody';
import { externalOperationIntentDigest, type ExternalOperationAuthorityFacts } from '@agenticprimitives/intent-engagement';
import type { ClientKeyBindingV1 } from '@agenticprimitives/agent-profile';
import { createPersonalAgentClient, type ParkedExternalOperation } from '../packages/personal-agent-client/src/index.js';

process.env.A2A_ALLOW_LOCAL_DEVICE_KEY = 'true';
const DOOR = (process.env.PAP_DOOR_DOMAIN ?? 'ligonier-door.ap-federation.faithnet.io').replace(/^https?:\/\//, '');
const HOME = process.env.PAP_HOLDER_HOME ?? 'https://www.faithnet.me';
const HOLDER = process.env.PAP_HOLDER ?? 'alice';
const RPC = (process.env.FEDERATION_RPC_URL ?? '').trim() || (() => { throw new Error('FEDERATION_RPC_URL is not set'); })();
const USV = '0xeDd56f500325D4701B9985A34e5Fa6EED6716137' as Address;
const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => { checks.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
const j = async (r: Response) => { const t = await r.text(); try { return JSON.parse(t) as Record<string, unknown>; } catch { return { _raw: t.slice(0, 200) }; } };

// ── the service's binding key and bundle (what pap.faithnet.io serves) ──
const keyFile = '.secrets/pap-faithnet-client-key.env'; if (!existsSync(keyFile)) throw new Error(`${keyFile} missing — run scripts/bind-client-key.mts`);
const privHex = /^PAP_CLIENT_KEY_P256=(0x[0-9a-f]{64})/m.exec(readFileSync(keyFile, 'utf8'))![1]!;
const bundle = JSON.parse(readFileSync('apps/pap/binding.json', 'utf8')) as { binding: { binding: ClientKeyBindingV1 } };
const clientSigner = new LocalEs256Signer({ privateKeyHex: privHex });
const binding = bundle.binding.binding;
check('the service presents with the key its on-chain binding names', clientSigner.kid === binding.jwkThumbprint && binding.scope === 'service', `${binding.clientId} · kid ${binding.jwkThumbprint}`);

// ── alice at her Home: signs the device approval and the mandate with her OWN agent ──
const signin = await j(await fetch(`${HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: HOLDER, client_id: 'demo-jp' }) }));
const aliceAgent = String(signin.agent ?? '').toLowerCase() as Address; const token = String(signin.homeSession ?? '');
if (!/^0x[0-9a-f]{40}$/.test(aliceAgent) || !token) throw new Error(`no session for ${HOLDER} at ${HOME}`);
const personaSign = async (digest: Hex): Promise<Hex> => { const b = await j(await fetch(`${HOME}/connect/persona-sign`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ digest }) })); if (!b.signature) throw new Error(`persona-sign: ${JSON.stringify(b).slice(0, 160)}`); return b.signature as Hex; };
const pc = createPublicClient({ transport: http(RPC) });
const isValidSig = (signer: Address, hash: Hex, sig: Hex) => pc.readContract({ address: USV, abi: parseAbi(['function isValidSig(address,bytes32,bytes) view returns (bool)']), functionName: 'isValidSig', args: [signer, hash, sig] }).catch(() => false) as Promise<boolean>;

// ── the person's vault, in memory for the gate (her real vault is the Home's; the client never sees a token in clear) ──
const links = new Map<string, ExternalAccountLinkV1>(); const sealed = new Map<string, string>();
const pairwiseSecret = new Uint8Array(32); crypto.getRandomValues(pairwiseSecret);
const parked: ParkedExternalOperation[] = []; let approvalAnswer: ExternalOperationAuthorityFacts | null = null;
let mandateSignatures = 0;
const client = createPersonalAgentClient({
  clientKey: { binding, signer: clientSigner, redirectUris: ['https://pap.faithnet.io/oauth/return'] },
  dpopKeys: { forIssuer: async (iss) => Object.assign(LocalEs256Signer.generate(), { keyRef: `gate:dpop:${iss}` }) },
  vault: { pairwiseSecret: async () => pairwiseSecret, subjectDigestKey: async () => new Uint8Array(32).fill(7), readLink: async (iss) => links.get(iss) ?? null, writeLink: async (l) => { links.set(l.issuer, l); }, seal: async (s) => { const ref = `vault:sealed:${sealed.size + 1}`; sealed.set(ref, s); return ref; }, unseal: async (ref) => sealed.get(ref)! },
  // THE APPROVAL DOOR: the act parks; when the gate "signs", alice's agent signs the intent digest (EIP-191 through her Home) and
  // the gate VERIFIES that signature through the universal validator before it becomes a fact the client may act on.
  approval: { park: async (act) => { parked.push(act); return approvalAnswer; } },
  proofs: { identity: async (ref) => { const digest = keccak256(toBytes(`pap-confirm:${ref.operationId}:${ref.revision}:${ref.termsDigest}`)); const sig = await personaSign(digest); mandateSignatures++; const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url'); return `${b64({ alg: 'ERC1271', kid: aliceAgent, 'x-caip10': `eip155:34348:${aliceAgent}` })}.${b64({ operation_id: ref.operationId, revision: ref.revision, terms_digest: ref.termsDigest })}.${Buffer.from(sig.slice(2), 'hex').toString('base64url')}`; } },
  posture: { naming: 'public', listing: 'public' },
});

// ── 1. discovery ──
const d = await client.discover(DOOR);
check('the company door discovered: poppy.json and its OAuth metadata checked as PAP 3.1–3.2 says', d.ok, d.ok ? `${d.company.name} · issuer ${d.company.issuer} · operations ${d.company.operationsEndpoint}` : `${d.refusal} ${d.detail ?? ''}`);
if (!d.ok) { console.log('\nPAP TWIN RED'); process.exit(1); }
const company = d.company;

// ── 2. a signed-out session: the DOOR fetched pap.faithnet.io's client.json and jwks.json and verified our assertions ──
const s0 = await client.startSession(company);
check('the door admitted the service on its own documents (client assertion + session assertion verified against pap.faithnet.io, DPoP-bound)', s0.ok, s0.ok ? `session ${s0.session.sessionId} signed_in=${s0.session.signedIn}` : `${s0.error} ${s0.detail ?? ''}`);
if (!s0.ok) { console.log('\nPAP TWIN RED'); process.exit(1); }
const sub = await client.subjectAt(company);
check('the person is only a pairwise subject at this company; her agent appears nowhere', /^usr_/.test(sub) && sub === derivePairwiseSubject({ personSecret: pairwiseSecret, issuer: company.issuer }), sub);

// ── 3. mediated sign-in is refused ──
check('TWIN: mediated sign-in (a password relayed) is refused by the client', 'refusal' in client.signIn.mediated(company));

// ── 4. device sign-in, approved by alice's OWN agent signing the code at the door ──
const dev = await client.signIn.device.start(company, ['poppy:read', 'poppy:write']);
if ('refusal' in dev) { check('device sign-in offered', false, dev.refusal); console.log('\nPAP TWIN RED'); process.exit(1); }
const approveDigest = keccak256(toBytes(`pap-device-approve:${company.issuer}:${dev.userCode}`));
const approveSig = await personaSign(approveDigest);
check('alice\'s agent signed the device code (EIP-191 through her Home) and the validator answers for her account', await isValidSig(aliceAgent, hashMessage({ raw: approveDigest }), approveSig), aliceAgent);
const approved = await j(await fetch(`${company.issuer}/oauth/device/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user_code: dev.userCode, agent: aliceAgent, signature: approveSig }) }));
check('the door accepted the approval through ERC-1271 — no password, no Home session, a signature', approved.ok === true, JSON.stringify(approved).slice(0, 120));
let session = s0.session;
for (let i = 0; i < 5; i++) { const p = await client.signIn.device.poll(company, session, dev); if (p.ok) { session = p.session; break; } if (p.error !== 'authorization_pending' && p.error !== 'slow_down') { check('device poll', false, String(p.error)); break; } await new Promise((r) => setTimeout(r, 1500)); }
check('the session is signed in; the account token is SEALED in the vault and listed as an account at a company', session.signedIn && links.get(company.issuer)?.status === 'active' && /^vault:sealed:/.test(links.get(company.issuer)?.accountToken.sealedRef ?? ''), `scopes ${session.scope.join(' ')}`);

// ── 5. the company's API proposes an operation ──
const { response: pr } = await client.fetch(session, `${company.issuer}/api/orders/exchange`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order_id: 'ord_7Hk2', item_id: 'itm_4Qa', replacement_sku: 'stormline-insulated-m', price_difference: { amount: '70.00', currency: 'USD' } }) });
const proposed = (await pr.json()) as { operation?: { operation_id: string; revision: number; state: string; summary: string; terms: unknown; expires_at: string; user_approval_required: boolean; confirmation: null; result: null } };
check('the company proposed an operation (HTTP 202, PAP Operations 4.1) — proposing performs nothing', pr.status === 202 && proposed.operation?.state === 'proposed', proposed.operation?.summary ?? `${pr.status}`);
const op = proposed.operation!;

// ── 6. the act parks; nothing but her mandate signature over THIS digest produces approved_by: user ──
const first = await client.operations.confirm(company, session, op);
check('the act PARKED at the approval door: no mandate, no confirm sent', first.kind === 'parked' && parked.length === 1, first.kind);
const act = parked[0]!; const intentDigest = externalOperationIntentDigest(act.ref);
approvalAnswer = { coveringStandingWire: { wireRef: 'wire:none', coversIntentDigest: `0x${'ab'.repeat(32)}` } };
check('TWIN: standing_permission with no COVERING wire is refused — the act stays parked', (await client.operations.confirm(company, session, op)).kind === 'parked');
const mandateDigest = keccak256(toBytes(`pap-mandate:${intentDigest}`));
const mandateSig = await personaSign(mandateDigest);
const mandateOk = await isValidSig(aliceAgent, hashMessage({ raw: mandateDigest }), mandateSig);
check('alice\'s agent SIGNED the mandate over this revision\'s intent digest; verified through the validator before it counts', mandateOk, `${intentDigest.slice(0, 18)}…`);
approvalAnswer = mandateOk ? { mandateVerifiedForIntentDigest: intentDigest } : null;
const confirmed = await client.operations.confirm(company, session, op, 'identity');
check('confirmed with approved_by: user and an identity proof; the door recorded the claim and handed the act to ligonier.svc\'s OWN harness as the door agent (an act parks for the owner\'s mandate; a question is answered) — in_progress until the task finishes, then the company agent\'s own words', confirmed.kind === 'confirmed' && confirmed.approvedBy === 'user' && confirmed.result.ok && ['in_progress', 'succeeded'].includes(String(confirmed.result.operation.state)), confirmed.kind === 'confirmed' ? `${confirmed.result.ok ? confirmed.result.operation.state : confirmed.result.error} · ${String((confirmed.result as { operation?: { 'ap:says'?: string } }).operation?.['ap:says'] ?? '').slice(0, 100)}` : confirmed.kind);
const conf = confirmed.kind === 'confirmed' && confirmed.result.ok ? confirmed.result.operation : null;
check('the door recorded approved_by as the PRESENTER\'S CLAIM, and the proof as received', (conf?.confirmation as Record<string, unknown> | null)?.['ap:recordedAs'] === 'the presenter\'s claim' && (conf?.confirmation as Record<string, unknown> | null)?.['ap:proofReceived'] === true);
check('TWIN: a second confirm of the same revision is refused by the client (one operationId‖revision = one confirm)', (await client.operations.confirm(company, session, op)).kind === 'refused');
const tracked = await client.operations.read(company, session, op.operation_id);
check('the operation is readable and tracked (in_progress with Retry-After, or final with the company\'s account of what happened)', tracked.ok && ['in_progress', 'succeeded', 'failed'].includes(tracked.operation.state), tracked.ok ? `${tracked.operation.state} · ${tracked.operation.result?.summary ?? ''}`.slice(0, 120) : tracked.error);

// ── 7. receipts: nobody named ──
const face = await j(await fetch(`${company.issuer}/federation/receipts`));
const faceText = JSON.stringify(face).toLowerCase();
check('the door\'s public ledger face names no subject, no client id, no receipt id, no person', !faceText.includes(sub.toLowerCase()) && !faceText.includes('pap.faithnet.io') && !faceText.includes('rcpt-') && !faceText.includes(aliceAgent.slice(2)), `${JSON.stringify(face.counts ?? {}).slice(0, 120)}`);
const rcptRef = String((conf as Record<string, unknown> | null)?.['ap:receipt'] ?? '');
const rcpt = rcptRef ? await j(await fetch(`${company.issuer}/federation/receipts/${rcptRef}`)) : null;
check('the full receipt is read by its id (the presenter holds it): it names the operation, the claim and where the act parked', !!rcpt && (rcpt.record as Record<string, unknown>)?.kind === 'door.operation' && (rcpt.record as Record<string, unknown>)?.approvedByClaim === 'user', rcptRef.slice(0, 24));

// ── 8. sign out: the token revoked at the company, the link retired ──
const out = await client.signOut(company);
check('sign-out revoked the account token at the company and RETIRED the link (never a quiet delete)', out.ok && out.companyNotified && links.get(company.issuer)?.status === 'revoked');
check('after sign-out a signed-in session is refused as signed out (one mechanism, no retry with another credential)', !(await client.signedInSession(company)).ok);

const failed = checks.filter((c) => !c.ok);
console.log(`\nPAP TWIN ${failed.length ? 'RED' : 'GREEN'} · ${checks.length} checks incl. ${checks.filter((c) => c.name.startsWith('TWIN')).length} refusals · ${mandateSignatures} identity proof(s) signed by alice's agent`);
process.exit(failed.length ? 1 : 0);
