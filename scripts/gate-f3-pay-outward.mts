// GATE — PAYING OUTWARD: a resident of one estate pays a treasury in the other, under her OWN permission.
//
// THE OTHER DIRECTION, and the one that makes the rule legible. §6's positive half had a visitor PAID from a
// resident's treasury: the money was the resident's, so the resident's wire authorized it, and the receiving
// estate's harness verified every link. This is the reverse. The money is the VISITOR's, so:
//
//   · the RECEIVING treasury needs no permission at all. Accepting money is not an act requiring authority, and
//     the receiving estate checks nothing except that the money arrived;
//   · the PAYER's permission comes from the payer's OWN home, for the payer's own treasury, signed by its own
//     custodian, and is redeemed in the payer's own estate under the payer's own harness. No door, no
//     presentation, no foreign standing — none of that machinery is involved, because nothing foreign is trusted.
//
// THE RULE UNDERNEATH BOTH DIRECTIONS: whoever's money it is grants the permission, on their own chain, and
// NEITHER ESTATE EVER HONOURS A SPENDING PERMISSION ISSUED BY THE OTHER. The last check proves that sentence by
// taking the OTHER estate's real, valid, signed wire and showing it derives nothing here.
//
// Still one chain: both treasuries live on faithchain, so the money never crosses chains. Paying from a treasury
// on chain A to one on chain B needs a way to move value between them, which is open (spec 243 reserves it).
//
//   FEDERATION_RPC_URL=… npx tsx scripts/gate-f3-pay-outward.mts [--payer-home https://www.impact-agent.me]
import { existsSync, readFileSync } from 'node:fs';
import { createPublicClient, http, formatUnits, type Address, type Hex } from 'viem';
import { deriveFromStanding, parkedNeedOf, type StandingWireV1 } from '@agenticprimitives/delegation';

const arg = (k: string): string | undefined => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const PAYER_HOME = (arg('payer-home') ?? 'https://www.impact-agent.me').replace(/\/$/, '');
const PAYER = arg('payer') ?? 'maya';
const WIRE_FILE = arg('wire') ?? '.secrets/outward-wire-imbnet.json';
/** The OTHER estate's wire, used only to be refused — the proof that a permission from elsewhere is not honoured. */
const FOREIGN_WIRE_FILE = arg('foreign-wire') ?? '.secrets/f3-standing-wire-faithnet.json';
const RPC = process.env.FEDERATION_RPC_URL ?? process.env.RPC_URL;
if (!RPC) { console.error('FEDERATION_RPC_URL is required'); process.exit(2); }
if (!existsSync(WIRE_FILE)) { console.error(`${WIRE_FILE} is missing — ap-home scripts/issue-visitor-standing-wire.mts issues the payer's own wire`); process.exit(2); }

const checks: Array<{ ok: boolean; name: string }> = [];
const check = (name: string, ok: boolean, detail = '') => { checks.push({ ok, name }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
const j = async (r: Response) => { const t = await r.text(); try { return JSON.parse(t) as Record<string, unknown>; } catch { return { _raw: t.slice(0, 300) }; } };

const standing = JSON.parse(readFileSync(WIRE_FILE, 'utf8')) as StandingWireV1 & { treasuryName?: string };
const limits = (standing.requirement.limits ?? {}) as { payee?: string; asset?: string };
const payee = String(limits.payee ?? '').toLowerCase() as Address;
const asset = String(limits.asset ?? '').toLowerCase() as Address;
if (!/^0x[0-9a-f]{40}$/.test(payee) || !/^0x[0-9a-f]{40}$/.test(asset)) { console.error('the payer\'s wire names no payee or asset'); process.exit(2); }

const pub = createPublicClient({ transport: http(RPC) });
const ERC20 = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const;
const symbol = (await pub.readContract({ address: asset, abi: ERC20, functionName: 'symbol' })) as string;
const balance = (a: Address) => pub.readContract({ address: asset, abi: ERC20, functionName: 'balanceOf', args: [a] }) as Promise<bigint>;

// ── the payer, at her OWN home ────────────────────────────────────────────────────────────────────────
const csrfRes = await fetch(`${PAYER_HOME}/a2a/auth/csrf`, { headers: { origin: PAYER_HOME } });
const csrf = (await j(csrfRes)) as { token?: string };
const H = { 'content-type': 'application/json', origin: PAYER_HOME, cookie: (csrfRes.headers.get('set-cookie') ?? '').split(';')[0], 'x-csrf-token': csrf.token ?? '' };
const si = await j(await fetch(`${PAYER_HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: PAYER, client_id: 'demo-jp' }) }));
const session = String(si.homeSession ?? ''); const payerAgent = String(si.agent ?? '').toLowerCase() as Address;
if (!session || !/^0x[0-9a-f]{40}$/.test(payerAgent)) { console.error(`no session for ${PAYER} at ${PAYER_HOME}`); process.exit(1); }
console.log(`payer ${PAYER} ${payerAgent} at ${PAYER_HOME}\n  wire ${standing.ref.slice(0, 14)}… → payee ${payee} (${symbol})\n`);

/** The child is signed by the wire's DELEGATE — here the payer's own agent — so the signature is its custodian's,
 *  validated through ERC-1271. This is the act-as-me shape: her agent holds the standing wire, and only she can
 *  derive from it. */
const sign = async (digest: Hex): Promise<Hex> => {
  const b = await j(await fetch(`${PAYER_HOME}/connect/persona-sign`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` }, body: JSON.stringify({ digest }) }));
  if (!b.signature) throw new Error(`persona-sign: ${JSON.stringify(b).slice(0, 140)}`);
  return b.signature as Hex;
};
/** The ask reply for a parked act IS the need, flattened: `{kind, runRef, requirement, delegator, delegate, …}`.
 *  `parkedNeedOf` wants that whole object — handed its `requirement` alone it finds no delegator and returns null,
 *  which reads as "the run did not park" when it did. */
const ask = async (message: string, runRef: string, presented?: unknown[]) => {
  const body: Record<string, unknown> = { session, addressee: payerAgent, message, runRef, surface: 'ask' };
  if (presented) body.presented = presented;
  const r = await j(await fetch(`${PAYER_HOME}/a2a/harness/ask`, { method: 'POST', headers: H, body: JSON.stringify(body) }));
  return (r.reply ?? r) as { kind?: string; text?: string; summary?: string; requirement?: unknown; delegator?: string; delegate?: string; error?: string };
};

// ── the invoice, from the OTHER estate ────────────────────────────────────────────────────────────────
// Today the amount, asset and payee come from the wire and the reference from this gate. An invoice RECORD the
// receiving estate issues (spec 337's offer algebra) is the next increment; said here so the gate does not read
// as though one existed.
const reference = `outward ${new Date().toISOString().slice(0, 16)} ${Math.random().toString(36).slice(2, 6)}`;
const amount = 3n * 10n ** 6n;
// The payee address stays LAST: the planner has twice glued trailing words into the payee.
const payMessage = `Memo ${reference}: pay 3 ${symbol} from my treasury to ${payee}`;
const before = await balance(payee);

const runRef = `pay-outward-${Date.now().toString(36)}`;
let reply = await ask(payMessage, runRef);
const need = parkedNeedOf(reply);
check('a payment the payer\'s OWN wire covers parks for authority, with the requirement she can derive against', reply.kind === 'authority_required' && !!need, `${reply.kind ?? 'no kind'}${need ? ` · ${need.requirement.type}` : ` · ${(reply.text ?? reply.error ?? '').slice(0, 120)}`}`);

if (need) {
  const derived = await deriveFromStanding(standing, need, sign);
  check('the child mandate derives from HER OWN standing wire (a subset on payee, asset, amount and window)', derived.ok === true, derived.ok ? `child ${derived.childRef.slice(0, 12)}…` : derived.reason.slice(0, 140));

  // THE RULE, PROVEN: the other estate's wire is real, signed and valid THERE, and it authorizes nothing here.
  if (existsSync(FOREIGN_WIRE_FILE)) {
    const foreign = JSON.parse(readFileSync(FOREIGN_WIRE_FILE, 'utf8')) as StandingWireV1;
    const crossed = await deriveFromStanding(foreign, need, sign).catch((e) => ({ ok: false as const, reason: String(e).slice(0, 120) }));
    check('THE RULE: the other estate\'s own valid wire derives NOTHING against this payer\'s requirement — neither estate honours a spending permission issued by the other', crossed.ok === false, crossed.ok ? 'DERIVED (wrong)' : `refused: ${crossed.reason.slice(0, 110)}`);
  } else console.log(`  (no ${FOREIGN_WIRE_FILE} — the cross-estate refusal was not exercised here)`);

  if (derived.ok) {
    reply = await ask(payMessage, runRef, derived.presented as unknown[]);
    const after = await balance(payee);
    check('the same run continues under the presented chain and the payment lands — her own harness verified every link before the money moved', reply.kind === 'done' || reply.kind === 'effect', `${reply.kind ?? '?'} · "${String(reply.text ?? reply.summary ?? '').slice(0, 110)}"`);
    check(`3 ${symbol} actually moved to the OTHER estate's treasury`, after - before === amount, `payee ${formatUnits(before, 6)} → ${formatUnits(after, 6)} ${symbol}`);

    // ONE INTENT, ONE PAYMENT — the same words are the same intent, so the chain refuses the second redemption.
    const again = await ask(payMessage, `${runRef}-again`);
    const needAgain = parkedNeedOf(again);
    let saidAgain = String(again.text ?? again.summary ?? again.error ?? '');
    if (needAgain) {
      const d2 = await deriveFromStanding(standing, needAgain, sign);
      if (d2.ok) { const r2 = await ask(payMessage, `${runRef}-again`, d2.presented as unknown[]); saidAgain = String(r2.text ?? r2.summary ?? r2.error ?? r2.kind ?? ''); }
    }
    const afterAgain = await balance(payee);
    check('the identical intent repeated moves nothing — the chain refuses the reused nonce', afterAgain === after, `payee still ${formatUnits(afterAgain, 6)} ${symbol} · "${saidAgain.slice(0, 90)}"`);
  }

  // the twins the wire's own bounds enforce
  const other = '0x000000000000000000000000000000000000dEaD';
  const r3 = await ask(`Memo ${reference}-other: pay 3 ${symbol} from my treasury to ${other}`, `${runRef}-other`);
  const n3 = parkedNeedOf(r3);
  const d3 = n3 ? await deriveFromStanding(standing, n3, sign) : null;
  check('a payment to another payee derives nothing from this wire — it names one destination', !!d3 && d3.ok === false, d3 ? (d3.ok ? 'DERIVED (wrong)' : d3.reason.slice(0, 110)) : `parked? ${r3.kind ?? '?'}`);

  const r4 = await ask(`Memo ${reference}-over: pay 9 ${symbol} from my treasury to ${payee}`, `${runRef}-over`);
  const n4 = parkedNeedOf(r4);
  const d4 = n4 ? await deriveFromStanding(standing, n4, sign) : null;
  check('a payment over the per-payment cap derives nothing — the cap is the wire\'s, not the asker\'s', !!d4 && d4.ok === false, d4 ? (d4.ok ? 'DERIVED (wrong)' : d4.reason.slice(0, 110)) : `parked? ${r4.kind ?? '?'}`);
}

const failed = checks.filter((c) => !c.ok);
console.log('');
if (failed.length) { console.error(`PAY-OUTWARD GATE RED · ${failed.length} of ${checks.length} checks failed`); process.exit(1); }
console.log(`PAY-OUTWARD GATE GREEN · ${checks.length} checks — the payer's own estate authorized it, the receiving estate honoured no permission of ours`);
