// SEND A CALL AS A SMART AGENT, through its Home (the way scripts/bind-client-key.mts writes `atl:clientKeys`).
//
// Spec 445 / generation 4 / B2 (REG-8): `AttestationRegistry.assertAssociation` must be sent BY THE SUBJECT
// (`msg.sender == subject`, else `NotSubject()`). A relayer's key — what these ceremonies used to send with — reverts.
// The subject here is an organization's Smart Agent, so the call is its own `execute`: a UserOperation the Home builds,
// the agent's custodian signs (persona-sign), and the Home submits. `sign` is the custodian's signature over the
// userOpHash (a digest the Home computed — the same shape every other persona-sign in this repo carries).
import { buildExecuteBatchCallData } from '@agenticprimitives/agent-account';
import type { Address, Hex } from 'viem';

const j = async (r: Response): Promise<Record<string, unknown>> => { const t = await r.text(); try { return JSON.parse(t) as Record<string, unknown>; } catch { return { _raw: t.slice(0, 200) }; } };

export async function sendAsAccount(opts: { home: string; sender: Address; call: { to: Address; data: Hex }; sign: (digest: Hex) => Promise<Hex> }): Promise<Hex> {
  const home = opts.home.replace(/\/$/, '');
  const csrfRes = await fetch(`${home}/a2a/auth/csrf`, { headers: { origin: home } });
  const csrf = (await j(csrfRes)) as { token?: string };
  const H = { 'content-type': 'application/json', origin: home, cookie: (csrfRes.headers.get('set-cookie') ?? '').split(';')[0] ?? '', 'x-csrf-token': csrf.token ?? '' };
  const callData = buildExecuteBatchCallData([{ to: opts.call.to, value: 0n, data: opts.call.data }]);
  let lastErr = '';
  for (let i = 0; i < 4; i++) {
    if (i) await new Promise((r) => setTimeout(r, 3000));
    const b = await j(await fetch(`${home}/a2a/account/build-call-userop`, { method: 'POST', headers: H, body: JSON.stringify({ sender: opts.sender, callData }) }));
    if (!b.ok || !b.userOpHash) { lastErr = `${b.error ?? ''} ${b.detail ?? JSON.stringify(b).slice(0, 200)}`; continue; }
    const s = await j(await fetch(`${home}/a2a/account/submit-call-userop`, { method: 'POST', headers: H, body: JSON.stringify({ userOp: { ...(b.userOp as object), signature: await opts.sign(b.userOpHash as Hex) } }) }));
    if (s.ok) return String(s.transactionHash) as Hex;
    lastErr = `${s.error ?? ''} ${s.detail ?? JSON.stringify(s).slice(0, 200)}`;
  }
  throw new Error(`the call as ${opts.sender} did not land through ${home}: ${lastErr}`);
}
