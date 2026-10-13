#!/usr/bin/env tsx
// gate-f2-door — the receiving door admits a foreign presentation on evidence read from neutral ground, and
// refuses what it must (spec 439 F2; Ring 0 spec 410 §4.2).
//
// The presenter: the gate's test account (setup-f2-test-grant.mts), the delegate of a real grant in the projecting
// estate, whose leaf is anchored. It asks the door for a challenge, builds a presentation against the ANCHORED
// sequence with the projector, signs a request proof over the exact request, and knocks.
//
// Proves: ADMIT with FOREIGN_ESTATE_LIVE_GRANT and a receipt by reference; the receipt is readable and hash-chained;
// a forwarded request reaches the estate's A2A door with the standing in headers.
// Twins: the same presentation one sequence behind → FOREIGN_ESTATE_STALE; a presentation for another audience →
// FOREIGN_ESTATE_CHALLENGE_MISMATCH; a replayed proof → 401; no proof → 401; a presentation about another subject →
// FOREIGN_ESTATE_SUBJECT_MISMATCH. Needs FEDERATION_RPC_URL (reads the anchor the way the door does) and the test key.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { requestProofDigest, sha256Of, type AgenticRequestProofClaims } from '@agenticprimitives/admission';
import { callerAssertionDigest, requestBodyHash, sessionAuthorizationHeader } from '@agenticprimitives/a2a/standard';
import { deriveFromStanding, parkedNeedOf, type StandingWireV1 } from '@agenticprimitives/delegation';
import { parse } from 'yaml';

const DOOR = (process.env.FEDERATION_DOOR_URL ?? 'https://door.ap-federation.faithnet.io').replace(/\/$/, '');
const estateId = process.env.FEDERATION_ESTATE ?? 'imbnet';
const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => { checks.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

const wireFile = `.secrets/f2-test-wire${estateId === 'imbnet' ? '' : `-${estateId}`}.json`;
if (!existsSync('.secrets/f2-test-agent.env') || !existsSync(wireFile)) throw new Error(`run scripts/setup-f2-test-grant.mts --estate ${estateId} first`);
const key = /F2_TEST_AGENT_KEY=(0x[0-9a-fA-F]{64})/.exec(readFileSync('.secrets/f2-test-agent.env', 'utf8'))![1] as Hex;
const me = privateKeyToAccount(key);
const wire = JSON.parse(readFileSync(wireFile, 'utf8')) as { digest: Hex; chainId: number };
const fed = parse(readFileSync('federation.yaml', 'utf8')) as { registry: { address: string; chainId: number }; estates: { id: string; governance: string | null }[] };
const rpc = process.env.FEDERATION_RPC_URL ?? (() => { throw new Error('FEDERATION_RPC_URL is not set'); })();
const pub = createPublicClient({ chain: { id: fed.registry.chainId, name: 'x', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } }, transport: http(rpc) });
const REGISTRY_ABI = [{ type: 'function', name: 'estateIdOf', stateMutability: 'pure', inputs: [{ name: 'chainId', type: 'uint256' }, { name: 'governance', type: 'address' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'roots', stateMutability: 'view', inputs: [{ name: 'estateId', type: 'bytes32' }], outputs: [{ name: 'liveGrantRoot', type: 'bytes32' }, { name: 'membershipRoot', type: 'bytes32' }, { name: 'charterHash', type: 'bytes32' }, { name: 'sequence', type: 'uint64' }, { name: 'anchoredAt', type: 'uint64' }] }] as const;
const estate = fed.estates.find((e) => e.id === estateId)!;
const estateKey = (await pub.readContract({ address: fed.registry.address as Address, abi: REGISTRY_ABI, functionName: 'estateIdOf', args: [BigInt(wire.chainId), estate.governance as Address] })) as Hex;
const anchored = (await pub.readContract({ address: fed.registry.address as Address, abi: REGISTRY_ABI, functionName: 'roots', args: [estateKey] })) as readonly [Hex, Hex, Hex, bigint, bigint];
console.log(`presenter ${me.address} · estate ${estateId} ${estateKey.slice(0, 10)}… anchored at sequence ${anchored[3]} · door ${DOOR}`);

const health = await (await fetch(`${DOOR}/health`)).json() as { configured?: boolean; boundaryId?: string; origin?: string };
check('the door is up and configured', health.configured === true, health.boundaryId ?? '');

async function challenge(subject = me.address) {
  return (await (await fetch(`${DOOR}/federation/challenge?subject=${subject}`)).json()) as { nonce: Hex; audience: string; header: string };
}
function present(nonce: Hex, audience: string): unknown {
  const file = `.submissions/presentation-f2-${Date.now()}.json`;
  execFileSync('pnpm', ['-s', 'projector', 'present', '--estate', estateId, '--digest', wire.digest, '--audience', audience, '--nonce', nonce, '--out', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  return JSON.parse(readFileSync(file, 'utf8'));
}
async function knock(opts: { pres?: unknown; challengeHeader?: string; path?: string; body?: string; sign?: boolean; replayId?: string; audience?: string; proofOverride?: string; originAudience?: string; text?: string; taskId?: string; metadata?: Record<string, unknown> }) {
  const path = opts.path ?? '/federation/knock';
  const body = opts.body ?? JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message: { messageId: crypto.randomUUID(), role: 'ROLE_USER', parts: [{ text: opts.text ?? 'A visiting agent from another estate says hello. In one sentence, what may a visitor ask you about?' }], ...(opts.taskId ? { taskId: opts.taskId } : {}), ...(opts.metadata ? { metadata: opts.metadata } : {}) } } });
  const now = Math.floor(Date.now() / 1000);
  const presRef = opts.pres ? `estate:${String((opts.pres as { estateId: string }).estateId).toLowerCase()}:presentation:${(await sha256Of(JSON.stringify(opts.pres))).slice(7, 39)}` : null;
  const claims: AgenticRequestProofClaims = {
    schemaVersion: '1', principalAgentId: `eip155:${wire.chainId}:${me.address.toLowerCase()}`, actingAgentId: `eip155:${wire.chainId}:${me.address.toLowerCase()}`, runtimeId: 'urn:ap:runtime:ap-federation:f2-presenter',
    sessionKeyId: me.address.toLowerCase(), delegationRefs: presRef ? [presRef] : [], audience: opts.audience ?? DOOR, issuedAt: now, expiresAt: now + 120, replayId: opts.replayId ?? crypto.randomUUID(),
    http: { method: 'POST', authority: new URL(DOOR).host, pathAndQuery: path, bodySha256: await sha256Of(body) },
    a2a: { protocolVersion: '1.0', protocolBinding: 'HTTP+JSON', operation: 'SendMessage', requestedCapabilityId: 'harness.read' },
  };
  const signature = await me.signMessage({ message: await requestProofDigest(claims) });
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  // THE ESTATE'S OWN DOOR ASKS WHO IS CALLING, separately from the federation door (spec 372 S3c): an `A2A-Session`
  // caller assertion bound to the method, the body, the ORIGIN's host and the moment, signed DIRECTLY by the agent
  // (the universal validator answers for an EOA as for a Smart Agent). The door forwards it untouched. Without it
  // the origin answers 401 — correct, and uninformative.
  if (opts.originAudience) {
    const base = { agent: me.address.toLowerCase(), method: 'SendMessage', bodyHash: requestBodyHash(body), issuedAt: now, audience: opts.originAudience };
    const sig = await me.sign({ hash: callerAssertionDigest(base) });
    headers.authorization = sessionAuthorizationHeader({ ...base, signature: sig });
  }
  if (opts.sign !== false) headers['x-ap-request-proof'] = opts.proofOverride ?? b64url({ claims, signature });
  if (opts.pres) headers['x-ap-authority-presentation'] = b64url(opts.pres);
  if (opts.challengeHeader) headers['x-ap-challenge'] = opts.challengeHeader;
  const r = await fetch(`${DOOR}${path}`, { method: 'POST', headers, body });
  const text = await r.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* origin may answer non-JSON */ }
  return { status: r.status, json, receipt: r.headers.get('x-ap-admission-receipt'), effect: r.headers.get('x-ap-admission-effect'), text };
}

// ── the real path ──
const c1 = await challenge();
const pres = present(c1.nonce, c1.audience);
const ok = await knock({ pres, challengeHeader: c1.header });
check('ADMIT on a live leaf proved against the root read from neutral ground', ok.status === 200 && ok.json?.effect === 'ADMIT' && ok.json?.reasonCodes?.includes('FOREIGN_ESTATE_LIVE_GRANT'), `${ok.status} ${ok.json?.effect} ${JSON.stringify(ok.json?.reasonCodes)} standing=${JSON.stringify(ok.json?.standing)}`);
const rc = ok.receipt ? await (await fetch(`${DOOR}/federation/receipts/${ok.receipt}`)).json() as any : null;
check('F2.5: the estate agent\'s declared signer agrees with neutral ground (first-come-wins closed)', ok.json?.reasonCodes?.includes('FOREIGN_ESTATE_SIGNER_DECLARED') === true, JSON.stringify(ok.json?.reasonCodes));
check('the receipt is readable by reference and hash-chained', !!rc && rc.receiptId === ok.receipt && /^sha256:/.test(rc.recordHash) && /^sha256:/.test(rc.prevHash) && rc.record?.effect === 'ADMIT', ok.receipt ?? '');
check('the receipt names the acting account and the boundary, nothing else of the estate', !!rc && rc.record?.actingAgentId === `eip155:${wire.chainId}:${me.address.toLowerCase()}` && typeof rc.record?.boundaryId === 'string' && !JSON.stringify(rc.record).includes('blind'), '');

// ── forward: the same, through the A2A path, lands at the estate's door with the standing in headers ──
const c2 = await challenge();
const originAudience = new URL(String((health as { origin?: string }).origin ?? '')).origin;
const fwd = await knock({ pres: present(c2.nonce, c2.audience), challengeHeader: c2.header, path: '/a2a', originAudience });
// A2A 1.0 SendMessage answers `{ task }` or `{ message }`; an agent asking as itself gets a task.
const res = fwd.json?.result as { task?: Record<string, unknown>; message?: Record<string, unknown> } | undefined;
const task = (res?.task ?? (res && 'id' in res ? res : undefined)) as { id?: string; status?: { state?: string }; metadata?: { foreignStanding?: { verified?: boolean; standing?: { estateId?: string; sequence?: number }; boundaryId?: string } } } | undefined;
if (!task) console.log('  origin result:', JSON.stringify(fwd.json ?? fwd.text).slice(0, 400));
check('F3: the estate\'s own door admits the visitor as an agent asking as itself and answers with a task', fwd.effect === 'ADMIT' && !!fwd.receipt && !!task?.id, `origin answered ${fwd.status} ${task ? `task ${task.id} ${task.status?.state}` : JSON.stringify(fwd.json?.error ?? fwd.text.slice(0, 120))}`);
check('F3: the task carries the door\'s receipt as VERIFIED evidence of standing — never as authority', task?.metadata?.foreignStanding?.verified === true && typeof task?.metadata?.foreignStanding?.standing?.estateId === 'string', JSON.stringify(task?.metadata?.foreignStanding ?? null));

// ── §6's negative twin: the same visitor, admitted on the same standing, asks for an ACT that needs a mandate ──
// It is refused AT THE AUTHORITY STAGE, by the estate's own harness, with what it would need named on the task
// (TASK_STATE_AUTH_REQUIRED + the requirement). Admission said "has standing"; authority said "no mandate". The gap
// between those two sentences is the whole architecture.
const c2b = await challenge();
const actBody = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'SendMessage', params: { message: { messageId: crypto.randomUUID(), role: 'ROLE_USER', parts: [{ text: `Send a message to the agent at ${me.address} that says: hello from the federation. Then tell me it was sent.` }] } } });
const act = await knock({ pres: present(c2b.nonce, c2b.audience), challengeHeader: c2b.header, path: '/a2a', originAudience, body: actBody });
const actRes = act.json?.result as { task?: { id?: string; status?: { state?: string; message?: { parts?: Array<{ text?: string; data?: Record<string, unknown> }> } }; metadata?: { foreignStanding?: { verified?: boolean } } } } | undefined;
const actTask = actRes?.task;
const need = actTask?.status?.message?.parts?.find((pt) => pt.data)?.data as { requirement?: unknown; openToStewards?: boolean; runRef?: string } | undefined;
const said = actTask?.status?.message?.parts?.find((pt) => pt.text)?.text ?? '';
// Two honest shapes of the same refusal: the harness PARKS it (AUTH_REQUIRED, a mandate could later cover it — the
// requirement rides on the task) or REJECTS it at plan admission (the capability needs a steward's mandate the caller
// cannot derive — the text names the authority that is missing). Either is the authority stage speaking; neither is
// the door.
const refusedAtAuthority = actTask?.status?.state === 'TASK_STATE_AUTH_REQUIRED'
  ? !!need && (need.requirement !== undefined || need.openToStewards === true)
  : actTask?.status?.state === 'TASK_STATE_REJECTED' && /authority|mandate|steward/i.test(said);
check('§6 twin: an act that needs a mandate is refused at the AUTHORITY stage, by the estate\'s own harness, with the missing authority named — standing is not a mandate', act.effect === 'ADMIT' && refusedAtAuthority, `door ${act.effect}; origin ${act.status} ${actTask ? `${actTask.status?.state} · "${said.slice(0, 120)}" · requirement ${need?.requirement ? 'named' : 'absent'}` : JSON.stringify(act.json?.error ?? act.text.slice(0, 160))}`);
check('§6 twin: the parked act still carries the verified standing, so a steward reading it knows who asked and from where', actTask?.metadata?.foreignStanding?.verified === true, '');

// ── §6's POSITIVE half: the same visitor, an act a resident's STANDING WIRE covers, run under a mandate derived from it ──
// A steward of the receiving estate decided once (issue-visitor-standing-wire.mts): this visitor may be paid from her
// treasury, up to a cap, for thirty days. The visitor asks for a payment within those bounds; the run parks
// authority_required with what it would need; the visitor derives the child for THAT intent from the standing wire
// (`deriveFromStanding`), signs it, and continues the same task presenting [child, standing]. The estate's harness
// verifies every link before the money moves. Then the twin: the same wire does not cover a payment to someone else.
const standingFile = `.secrets/f3-standing-wire-${(health as { receivingEstate?: string }).receivingEstate ?? 'x'}.json`;
if (existsSync(standingFile)) {
  const standing = JSON.parse(readFileSync(standingFile, 'utf8')) as StandingWireV1 & { treasuryName?: string; capShq?: string };
  // The asset is the one the wire names — the treasury's payment rail (mock USDC on faithchain), not the naming coin.
  const SHQ = String((standing.requirement.limits as { asset?: string } | undefined)?.asset ?? '').toLowerCase() as Address;
  const ERC20 = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }, { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }] as const;
  const symbol = (await pub.readContract({ address: SHQ, abi: ERC20, functionName: 'symbol' })) as string;
  // THE PAYEE IS NOT THE ASKER. The harness refuses an asker naming itself as the counterparty of its own act
  // ('That would be you. Who is being paid?'), which is right; and assets live only in treasuries anyway. So the
  // wire names a payee account the visitor holds separately, and the payment lands there.
  const payee = String((standing.requirement.limits as { payee?: string } | undefined)?.payee ?? '').toLowerCase() as Address;
  if (!/^0x[0-9a-f]{40}$/.test(payee)) throw new Error('the standing wire names no payee');
  const before = (await pub.readContract({ address: SHQ, abi: ERC20, functionName: 'balanceOf', args: [payee] })) as bigint;
  const c3a = await challenge();
  const ask = await knock({ pres: present(c3a.nonce, c3a.audience), challengeHeader: c3a.header, path: '/a2a', originAudience, text: `Pay 5 ${symbol} from ${standing.treasuryName ?? 'your treasury'} to ${payee}.` });
  const askTask = (ask.json?.result as { task?: { id?: string; status?: { state?: string; message?: { parts?: Array<{ text?: string; data?: Record<string, unknown> }> } }; metadata?: { runRef?: string } } } | undefined)?.task;
  const parkedData = askTask?.status?.message?.parts?.find((pt) => pt.data)?.data;
  const need = parkedNeedOf(parkedData);
  check('§6 positive: a payment within a standing wire\'s bounds parks AUTH_REQUIRED with the requirement the visitor can derive against', askTask?.status?.state === 'TASK_STATE_AUTH_REQUIRED' && !!need, `${askTask?.status?.state ?? ask.status} · ${need ? `${need.requirement.type} of ${need.delegator.slice(0, 10)}… for ${need.delegate.slice(0, 10)}…` : (askTask?.status?.message?.parts?.find((pt) => pt.text)?.text ?? JSON.stringify(ask.json?.error ?? '')).slice(0, 140)}`);
  if (need && askTask?.id) {
    const derived = await deriveFromStanding(standing, need, (digest) => me.signMessage({ message: { raw: digest } }));
    check('§6 positive: the child mandate for THIS intent derives from the standing wire (a subset: payee, asset, amount, window)', derived.ok === true, derived.ok ? `child ${derived.childRef.slice(0, 10)}… under ${derived.parentRef.slice(0, 10)}…` : derived.reason);
    if (!derived.ok) console.log('  need:     ' + JSON.stringify(need.requirement) + '\n  standing: ' + JSON.stringify(standing.requirement));
    if (derived.ok) {
      const c3b = await challenge();
      const cont = await knock({ pres: present(c3b.nonce, c3b.audience), challengeHeader: c3b.header, path: '/a2a', originAudience, text: 'Here is the mandate for that payment.', taskId: askTask.id, metadata: { presented: derived.presented } });
      const doneTask = (cont.json?.result as { task?: { id?: string; status?: { state?: string; message?: { parts?: Array<{ text?: string }> } }; metadata?: { foreignStanding?: { verified?: boolean }; runRef?: string } } } | undefined)?.task;
      const said = doneTask?.status?.message?.parts?.find((pt) => pt.text)?.text ?? '';
      const after = (await pub.readContract({ address: SHQ, abi: ERC20, functionName: 'balanceOf', args: [payee] })) as bigint;
      check('§6 positive: the same task continues under the presented chain and COMPLETES — the estate\'s harness verified every link before the money moved', doneTask?.status?.state === 'TASK_STATE_COMPLETED', `${doneTask?.status?.state ?? cont.status} · "${said.slice(0, 120)}"`);
      check('§6 positive: 5 ' + symbol + ' actually moved from the treasury to the wire\'s payee', after - before === 5_000_000n, `payee balance ${Number(before) / 1e6} → ${Number(after) / 1e6} ${symbol}`);
      check('§6 positive: the completed act still carries the verified foreign standing and names its run', doneTask?.metadata?.foreignStanding?.verified === true && typeof doneTask?.metadata?.runRef === 'string', doneTask?.metadata?.runRef ?? '');
    }
  }
  // the twin: the wire names ONE payee; a payment to anyone else is not a subset and derives nothing
  const other = '0x000000000000000000000000000000000000dEaD';
  const c3c = await challenge();
  const ask2 = await knock({ pres: present(c3c.nonce, c3c.audience), challengeHeader: c3c.header, path: '/a2a', originAudience, text: `Pay 5 ${symbol} from ${standing.treasuryName ?? 'your treasury'} to ${other}.` });
  const task2 = (ask2.json?.result as { task?: { status?: { state?: string; message?: { parts?: Array<{ data?: Record<string, unknown> }> } } } } | undefined)?.task;
  const need2 = parkedNeedOf(task2?.status?.message?.parts?.find((pt) => pt.data)?.data);
  const derived2 = need2 ? await deriveFromStanding(standing, need2, (digest) => me.signMessage({ message: { raw: digest } })) : null;
  check('§6 twin: the same standing wire does not cover a payment to another payee — nothing derives, the run stays parked for the steward', task2?.status?.state === 'TASK_STATE_AUTH_REQUIRED' && !!derived2 && derived2.ok === false, derived2 ? (derived2.ok ? 'DERIVED (wrong)' : derived2.reason.slice(0, 120)) : `${task2?.status?.state ?? ask2.status}`);
} else console.log(`  (no standing wire at ${standingFile} — §6's positive half not run here; ap-home scripts/issue-visitor-standing-wire.mts)`);

// ── twins ──
const c3 = await challenge();
const stale = { ...(present(c3.nonce, c3.audience) as Record<string, unknown>), sequence: Number(anchored[3]) - 1 };
const t1 = await knock({ pres: stale, challengeHeader: c3.header });
check('twin: a presentation one sequence behind is refused as stale', t1.status === 403 && t1.json?.reasonCodes?.includes('FOREIGN_ESTATE_STALE'), JSON.stringify(t1.json?.reasonCodes));
const c4 = await challenge();
const t2 = await knock({ pres: present(c4.nonce, 'https://another.door.example'), challengeHeader: c4.header });
check('twin: a presentation answering another door\'s challenge is refused', t2.status === 403 && t2.json?.reasonCodes?.includes('FOREIGN_ESTATE_CHALLENGE_MISMATCH'), JSON.stringify(t2.json?.reasonCodes));
const c5 = await challenge();
const other = { ...(present(c5.nonce, c5.audience) as Record<string, unknown>), subject: '0x000000000000000000000000000000000000dead' };
const t3 = await knock({ pres: other, challengeHeader: c5.header });
check('twin: a presentation about someone else is refused', t3.status === 403 && (t3.json?.reasonCodes?.includes('FOREIGN_ESTATE_SUBJECT_MISMATCH') || t3.json?.reasonCodes?.includes('FOREIGN_ESTATE_NOT_IN_ROOT')), JSON.stringify(t3.json?.reasonCodes));
const rid = crypto.randomUUID();
const c6 = await challenge();
const p6 = present(c6.nonce, c6.audience);
const first = await knock({ pres: p6, challengeHeader: c6.header, replayId: rid });
const replay = await knock({ pres: p6, challengeHeader: c6.header, replayId: rid });
check('twin: a replayed proof is refused generically after the first was spent', first.status === 200 && replay.status === 401 && replay.json?.error === 'authentication_failed', `${first.status} then ${replay.status}`);
const t5 = await knock({ sign: false });
check('twin: no proof, no admission — a TLS connection authenticates no principal', t5.status === 401, String(t5.status));
const t6 = await knock({});
check('a request with no presentation is admitted as nobody-foreign and claims no standing', t6.status === 200 && t6.json?.effect === 'ADMIT' && t6.json?.standing === null && t6.json?.reasonCodes?.includes('FOREIGN_ESTATE_NOT_PRESENTED'), JSON.stringify(t6.json?.reasonCodes));

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\nF2 DOOR GATE RED · ${failed.length} of ${checks.length} failed` : `\nF2 DOOR GATE GREEN · ${checks.length} checks incl. 5 refusals`);
process.exit(failed.length ? 1 : 0);
