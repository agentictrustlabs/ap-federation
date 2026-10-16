#!/usr/bin/env tsx
// gate-member-payment — "a member over 18 pays the organization": the holder proves, in zero knowledge at the organization's
// door, that she is over 18 AND a member (the credential the organization's own issuer gave her earlier, Z5); the door issues a
// payment TICKET only on that ADMIT; her OWN agent pays from HER treasury to the organization's treasury under HER mandate
// (signed at her Home — the confirmation IS the mandate signature, spec 350 §3.6); `settled` lets the door read the transfer on
// the chain and record the acceptance beside the predicate admission. Treasury to treasury, one chain. The organization learns
// that a member over 18 paid, and not which member.
// The payment's authority is HER STANDING DUES WIRE — the act-as-me shape (spec 397 §11): she decided once, at her Home, that her
// treasury may pay this organization's treasury up to a cap for thirty days (`issue-visitor-standing-wire.mts`); each payment is a
// child mandate derived from that wire for THIS intent and signed by her agent (`deriveFromStanding` + persona-sign, ERC-1271),
// and her harness verifies every link before the money moves. Membership previously established; dues under a standing decision.
// Twins: no ticket without a predicate ADMIT; a ticket settles once; a forged ticket is refused; the identical payment repeated
// moves nothing (one intent, one payment).
//
//   set -a; . .secrets/ops.env; set +a; A2A_ALLOW_LOCAL_DEVICE_KEY=true OPENAC_KEYS_DIR=~/.cache/openac-5.0.0 npx tsx scripts/gate-member-payment.mts
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createPublicClient, http, formatUnits, parseAbi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { parse } from 'yaml';
import { requestProofDigest, sha256Of, type AgenticRequestProofClaims } from '@agenticprimitives/admission';
import { deriveFromStanding, parkedNeedOf, type StandingWireV1, type MandateRequirementV1 } from '@agenticprimitives/delegation';
import { holderBackend, mandateChecks, pairwiseAccountFor, presentUnderWire, proofRequestFor, type DoorCredentialPolicy } from './lib/predicate-holder.mts';
import { holderVaultCredentials, readHolderFromVault } from './lib/predicate-holder-vault.mts';

const DOOR = (process.env.FEDERATION_DOOR_URL ?? 'https://door.ap-federation.faithnet.io').replace(/\/$/, '');
const ESTATE = process.env.FEDERATION_ESTATE ?? 'impact-agent';
const PAYER_HOME = (process.env.PAP_HOLDER_HOME ?? 'https://www.faithnet.me').replace(/\/$/, '');
const PAYER = process.env.PAP_HOLDER ?? 'alice';
/** Her standing dues wire: delegator = HER treasury, delegate = HER agent, payee = the organization's treasury (issued at her Home). */
const DUES_WIRE_FILE = process.env.MEMBER_DUES_WIRE ?? '.secrets/member-dues-wire-faithnet.json';
const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => { checks.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const j = async (r: Response) => { const t = await r.text(); try { return JSON.parse(t) as Record<string, unknown>; } catch { return { _raw: t.slice(0, 300), _status: r.status }; } };
const need = (f: string) => { if (!existsSync(f)) throw new Error(`${f} is missing`); return f; };

const env = readFileSync(need('.secrets/predicate-visitor.env'), 'utf8');
const envGet = (k: string) => new RegExp(`^${k}=(\\S+)`, 'm').exec(env)?.[1] ?? (() => { throw new Error(`${k} missing`); })();
const runtime = privateKeyToAccount(envGet('PREDICATE_RUNTIME_KEY') as Hex);
const harness = privateKeyToAccount(envGet('PREDICATE_HARNESS_KEY') as Hex);
const vault = holderVaultCredentials({ credsFile: need(process.env.PREDICATE_HOLDER_VAULT_CREDS ?? '.secrets/vault-creds-alice.json'), vaultUrl: process.env.PREDICATE_HOLDER_VAULT_URL ?? 'https://mcp.faithnet.io', agentName: process.env.PREDICATE_HOLDER_AGENT ?? 'alice.me', ...(process.env.PREDICATE_HOLDER_CHAIN_ID ? { chainId: Number(process.env.PREDICATE_HOLDER_CHAIN_ID) } : {}) });
const holder = await readHolderFromVault(vault, DOOR);
const { live: credential, holderSecret, standing } = holder;
const fed = parse(readFileSync('federation.yaml', 'utf8')) as { registry: { chainId: number }; credentials: { issuers: Array<{ id: string; estate: string; chainId: number; universalSignatureValidator: Address; rpcEnv?: string; facets?: Array<{ keyId: string }> }> }; doors: Array<{ estate: string; url: string; membershipPayments?: { payee: string; asset: string; amount: string; symbol?: string; byIssuer?: Record<string, { payee: string; asset: string; amount: string; symbol?: string; chainId?: number }> } }> };
const issuer = fed.credentials.issuers.find((i) => i.facets?.some((f) => f.keyId === credential.issuerKeyId)) ?? fed.credentials.issuers[0]!;
const rpc = (process.env[issuer.rpcEnv ?? 'FEDERATION_RPC_URL'] ?? '').trim() || (() => { throw new Error('FEDERATION_RPC_URL is not set'); })();
const declaredPayments = fed.doors.find((d) => d.estate === ESTATE)?.membershipPayments;
if (!declaredPayments) throw new Error(`doors[${ESTATE}] declares no membershipPayments`);
// Spec 444: the terms the door will ticket for THIS credential's issuer — its organization's treasury and chain, when it names them.
const mp = { ...declaredPayments, ...(declaredPayments.byIssuer?.[issuer.id] ?? {}) };
const pc = createPublicClient({ transport: http(rpc) });
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function symbol() view returns (string)']);
const balance = (a: string) => pc.readContract({ address: mp.asset as Address, abi: ERC20, functionName: 'balanceOf', args: [a as Address] }) as Promise<bigint>;
const symbol = mp.symbol ?? (await pc.readContract({ address: mp.asset as Address, abi: ERC20, functionName: 'symbol' })) as string;
check('the organization\'s door declares a member-gated payment: its treasury, the asset, the amount', /^0x[0-9a-fA-F]{40}$/.test(mp.payee) && Number(mp.amount) > 0, `${mp.amount} ${symbol} → ${mp.payee}`);

// ── 1. prove over 18 AND member at the organization's door (Z5) ──
const declared = await (await fetch(`${DOOR}/federation/credentials`)).json() as { policy: DoorCredentialPolicy | null; predicateDigest: string | null };
if (!declared.policy) throw new Error('the door has no credential policy');
check('the door asks over 18 AND a member of the organization', declared.policy.predicates.some((p) => p.claim === 'member') && declared.policy.predicates.some((p) => p.claim === 'age'));
const me = await pairwiseAccountFor(holderSecret, DOOR);
const backend = await holderBackend();
const mc = mandateChecks({ chainId: standing.chainId, rpcUrl: rpc, delegationManager: standing.delegationManager as Address, universalSignatureValidator: issuer.universalSignatureValidator });
const runtimeSign = (digest: Hex) => runtime.signMessage({ message: { raw: digest } });
const challenge = async () => (await (await fetch(`${DOOR}/federation/challenge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject: me.address }) })).json()) as { nonce: Hex; audience: string; header: string };
const statusFor = (digest: Hex, audience: string, nonce: string): unknown => { const file = `.submissions/status-mp-${Date.now()}.json`; execFileSync('pnpm', ['-s', 'projector', 'present-status', '--issuer', issuer.id, '--digest', digest, '--audience', audience, '--nonce', nonce, '--out', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }); return JSON.parse(readFileSync(file, 'utf8')); };
const c1 = await challenge();
const req1 = proofRequestFor({ origin: DOOR }, declared.policy, c1);
const p1 = await presentUnderWire({ env: envGet,  credential, request: req1, backend, standing, runtime: { address: runtime.address, sign: runtimeSign }, harness: harness.address, checks: mc, withNullifier: declared.policy.nullifier?.require ?? false, status: declared.policy.status === 'required' ? statusFor(credential.digest, c1.audience, c1.nonce) : undefined } as never);
const presenterChain = fed.registry.chainId;
async function knock(presentation: unknown, header: string) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message: { messageId: crypto.randomUUID(), role: 'ROLE_USER', parts: [{ text: 'A member, over 18, with no name, asks to pay the membership dues.' }] } } });
  const now = Math.floor(Date.now() / 1000);
  const held = await (await fetch(`${DOOR}/federation/present`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ presentation }) })).json() as { ref?: string };
  if (!held.ref) throw new Error('the door did not hold the presentation');
  const claims: AgenticRequestProofClaims = { schemaVersion: '1', principalAgentId: `eip155:${presenterChain}:${me.address.toLowerCase()}`, actingAgentId: `eip155:${presenterChain}:${me.address.toLowerCase()}`, runtimeId: 'urn:ap:runtime:ap-federation:member-payment', sessionKeyId: me.address.toLowerCase(), delegationRefs: [], entitlementRefs: [held.ref], audience: DOOR, issuedAt: now, expiresAt: now + 120, replayId: crypto.randomUUID(), http: { method: 'POST', authority: new URL(DOOR).host, pathAndQuery: '/federation/knock', bodySha256: await sha256Of(body) }, a2a: { protocolVersion: '1.0', protocolBinding: 'HTTP+JSON', operation: 'SendMessage', requestedCapabilityId: 'harness.read' } } as AgenticRequestProofClaims;
  const signature = await me.signMessage({ message: await requestProofDigest(claims) });
  const r = await fetch(`${DOOR}/federation/knock`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ap-request-proof': b64url({ claims, signature }), 'x-ap-challenge': header, 'x-ap-credential-presentation': held.ref }, body });
  return { status: r.status, json: (await r.json().catch(() => null)) as { effect?: string; reasonCodes?: string[]; receiptRef?: string } | null, receipt: r.headers.get('x-ap-admission-receipt') };
}
const k = await knock(p1.presentation, c1.header);
check('ADMIT on the predicate proved in zero knowledge (over 18 AND member), the issuer facet read from the chain', k.status === 200 && k.json?.effect === 'ADMIT' && !!k.json?.reasonCodes?.includes('CREDENTIAL_PREDICATE_HELD'), `${k.status} ${k.json?.effect} ${JSON.stringify(k.json?.reasonCodes ?? [])}`);
// A DENY carries a receipt too (the refusal is on the record) — only an ADMIT's receipt buys a ticket, so stop here on anything else.
if (k.json?.effect !== 'ADMIT' || !k.receipt) { console.log('\nMEMBER-PAYMENT GATE RED · no admission (the door refuses a reused nullifier for an hour per device key — re-run after the window)'); process.exit(1); }

// ── 2. the ticket, on the ADMIT only ──
const noReceipt = await j(await fetch(`${DOOR}/federation/pay-ticket`, { method: 'POST' }));
check('TWIN: no ticket without an admission receipt', noReceipt.error === 'admission_receipt_required');
const ticket = await j(await fetch(`${DOOR}/federation/pay-ticket`, { method: 'POST', headers: { 'x-ap-admission-receipt': k.receipt } })) as { reference?: string; payee?: string; amount?: string; ticket?: string; expiresAt?: number; admissionReceipt?: string; error?: string };
check('the organization issued a payment ticket to the member: its treasury, the amount, a reference bound to the predicate admission', !!ticket.reference && ticket.payee?.toLowerCase() === mp.payee.toLowerCase() && ticket.amount === mp.amount && !!ticket.ticket, `${ticket.reference ?? ticket.error} · ${ticket.amount} ${symbol} → ${ticket.payee}`);
// No ticket, no payment: the member pays only what the organization asked her for.
if (!ticket.ticket || !ticket.reference) { console.log('\nMEMBER-PAYMENT GATE RED · no ticket, so nothing is paid'); process.exit(1); }

// ── 3. the member pays from HER treasury under HER mandate, at her own Home ──
const csrfRes = await fetch(`${PAYER_HOME}/a2a/auth/csrf`, { headers: { origin: PAYER_HOME } });
const csrf = (await j(csrfRes)) as { token?: string };
const H = { 'content-type': 'application/json', origin: PAYER_HOME, cookie: (csrfRes.headers.get('set-cookie') ?? '').split(';')[0] ?? '', 'x-csrf-token': csrf.token ?? '' };
const si = await j(await fetch(`${PAYER_HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: PAYER, client_id: 'demo-web' }) }));
const session = String(si.homeSession ?? ''); const payerAgent = String(si.agent ?? '').toLowerCase() as Address;
if (!session) throw new Error(`no session for ${PAYER} at ${PAYER_HOME}`);
const sign = async (digest: Hex): Promise<Hex> => { const b = await j(await fetch(`${PAYER_HOME}/connect/persona-sign`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` }, body: JSON.stringify({ digest }) })); if (!b.signature) throw new Error(`persona-sign: ${JSON.stringify(b).slice(0, 140)}`); return b.signature as Hex; };
const post = async (path: string, body: unknown) => j(await fetch(`${PAYER_HOME}/a2a${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) }));
const dues = JSON.parse(readFileSync(need(DUES_WIRE_FILE), 'utf8')) as StandingWireV1;
const duesLimits = (dues.requirement.limits ?? {}) as { payee?: string; asset?: string; maxAmount?: string };
check('her standing dues wire names the organization\'s treasury as payee and her own treasury as the money (issued once, at her Home, revocable on chain)', String(duesLimits.payee ?? '').toLowerCase() === mp.payee.toLowerCase() && String(duesLimits.asset ?? '').toLowerCase() === mp.asset.toLowerCase(), `wire ${dues.ref.slice(0, 14)}… payee ${duesLimits.payee} cap ${duesLimits.maxAmount}`);
const payMessage = `Memo ${ticket.reference}: pay ${mp.amount} ${symbol} from my treasury to ${mp.payee}`;
const before = { org: await balance(mp.payee) };
const runRef = `member-payment-${Date.now().toString(36)}`;
let r = await post('/harness/ask', { session, addressee: payerAgent, message: payMessage, runRef, surface: 'ask' });
let rep = (r.reply ?? r) as { kind?: string; text?: string; error?: string; summary?: string; runRef?: string; requirement?: MandateRequirementV1; delegator?: Address; delegate?: Address; result?: unknown };
const needPay = parkedNeedOf(rep);
check('her own harness PARKS the payment for her authority (a payment is an act; nothing moved yet)', rep.kind === 'authority_required' && !!needPay, `${rep.kind} ${rep.error ?? ''} ${String(rep.text ?? '').slice(0, 100)}`);
let txHash: string | null = null;
if (needPay) {
  // THE DUES, UNDER HER STANDING DECISION: the child mandate for THIS intent derives from her wire (a subset on payee, asset,
  // amount and window) and her agent signs it — the per-payment signature; the wire was her one standing signature.
  const derived = await deriveFromStanding(dues, needPay, sign);
  check('the child mandate for THIS payment derives from her standing dues wire and her agent signs it', derived.ok === true, derived.ok ? `child ${derived.childRef.slice(0, 12)}…` : derived.reason.slice(0, 140));
  if (derived.ok) {
    r = await post('/harness/ask', { session, addressee: payerAgent, runRef, message: payMessage, surface: 'ask', presented: derived.presented });
    rep = (r.reply ?? r) as typeof rep;
    // a done reply's `result` IS the payment invoker's result: `{txHash, asset, payee, amount, payer, outcome: 'committed'}`
    txHash = String((rep.result as { txHash?: string } | undefined)?.txHash ?? '') || null;
    check('the run resumed under the presented chain and the payment executed — treasury to treasury, every link verified by her own harness', rep.kind === 'done' || rep.kind === 'effect', `${rep.kind} ${rep.error ?? ''} · tx ${txHash ?? '?'} · ${String(rep.text ?? rep.summary ?? '').slice(0, 100)}`);
  }
}
const after = { org: await balance(mp.payee) };
const moved = after.org - before.org;
check(`${mp.amount} ${symbol} arrived in the organization's treasury`, moved === BigInt(Math.round(Number(mp.amount) * 1e6)), `org ${formatUnits(before.org, 6)} → ${formatUnits(after.org, 6)} ${symbol}`);

// ── 4. settled: the organization reads the transfer and records the acceptance beside the predicate ──
if (txHash) {
  const settle = async (body: unknown) => j(await fetch(`${DOOR}/federation/pay-ticket/settled`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  const s1 = await settle({ reference: ticket.reference, ticket: ticket.ticket, txHash, admissionReceipt: ticket.admissionReceipt, expiresAt: ticket.expiresAt });
  check('the organization ACCEPTED the payment: the transfer read from the chain, recorded beside the predicate admission — a member over 18 paid, not which member', s1.accepted === true, `${s1.reference ?? s1.error} · receipt ${String((s1.receipt as { receiptRef?: string } | null)?.receiptRef ?? '').slice(0, 24)}`);
  const s2 = await settle({ reference: ticket.reference, ticket: ticket.ticket, txHash, admissionReceipt: ticket.admissionReceipt, expiresAt: ticket.expiresAt });
  check('TWIN: one ticket settles once', s2.error === 'ticket_already_settled');
  const s3 = await settle({ reference: `${ticket.reference}-x`, ticket: ticket.ticket, txHash, admissionReceipt: ticket.admissionReceipt, expiresAt: ticket.expiresAt });
  check('TWIN: a forged reference is refused (the ticket is the door\'s own MAC)', s3.error === 'ticket_invalid');
  // the identical payment again: the chain refuses the reused nonce, nothing moves
  const again = await post('/harness/ask', { session, addressee: payerAgent, message: payMessage, runRef: `${runRef}-again`, surface: 'ask' });
  let repAgain = (again.reply ?? again) as typeof rep;
  const needAgain = parkedNeedOf(repAgain);
  if (needAgain) { const d2 = await deriveFromStanding(dues, needAgain, sign); if (d2.ok) repAgain = ((await post('/harness/ask', { session, addressee: payerAgent, runRef: `${runRef}-again`, message: payMessage, surface: 'ask', presented: d2.presented })).reply ?? {}) as typeof rep; }
  const afterAgain = await balance(mp.payee);
  check('TWIN: the identical intent repeated moves nothing — one intent, one payment', afterAgain === after.org, `${repAgain.kind} ${String(repAgain.error ?? repAgain.text ?? '').slice(0, 80)} · org still ${formatUnits(afterAgain, 6)} ${symbol}`);
  const face = await j(await fetch(`${DOOR}/federation/receipts`));
  check('the door\'s public ledger face names no member: counts and digests only', !JSON.stringify(face).toLowerCase().includes(me.address.toLowerCase().slice(2)) && !JSON.stringify(face).toLowerCase().includes(payerAgent.slice(2)), JSON.stringify((face as { counts?: unknown }).counts ?? {}).slice(0, 100));
}
function await_<T>(p: Promise<T>): Promise<T> { return p; }
const failed = checks.filter((c) => !c.ok);
console.log(`\nMEMBER-PAYMENT GATE ${failed.length ? 'RED' : 'GREEN'} · ${checks.length} checks incl. ${checks.filter((c) => c.name.startsWith('TWIN')).length} refusals — a member over 18, nameless, paid the organization's treasury from her own`);
process.exit(failed.length ? 1 : 0);
