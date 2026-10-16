// The DO's op switch over Maps — so the Worker's routes run in vitest without a Durable Object runtime.
import type { AccountTokenRow, DeviceRow, OperationRow, SessionRow } from '../src/do.js';
export function fakeLedger() {
  const jti = new Set<string>(); const kv = new Map<string, unknown>(); const receipts: Array<{ receiptId: string; record: Record<string, unknown>; at: string; prevHash: string; recordHash: string }> = [];
  const list = (prefix: string) => [...kv.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
  const handle = async (op: string, body: Record<string, unknown>): Promise<unknown> => {
    switch (op) {
      case 'jti.consume': { const k = `${body.ns}|${body.jti}`; if (jti.has(k)) return { result: 'REPLAY' }; jti.add(k); return { result: 'CONSUMED' }; }
      case 'session.put': { const s = body.session as SessionRow; kv.set(`session:${s.sessionId}`, s); kv.set(`token:${s.token}`, s.sessionId); return { ok: true }; }
      case 'session.get': return { session: kv.get(`session:${body.sessionId}`) ?? null };
      case 'session.byToken': { const id = kv.get(`token:${body.token}`); return { session: id ? kv.get(`session:${id}`) ?? null : null }; }
      case 'session.signOutAccount': { for (const s of list('session:') as SessionRow[]) if (s.account === body.account && s.clientId === body.clientId) kv.set(`session:${s.sessionId}`, { ...s, account: null }); return { ok: true }; }
      case 'account.put': { const a = body.account as AccountTokenRow; kv.set(`account:${a.token}`, a); return { ok: true }; }
      case 'account.get': return { account: kv.get(`account:${body.token}`) ?? null };
      case 'account.del': { kv.delete(`account:${body.token}`); return { ok: true }; }
      case 'device.put': { const d = body.device as DeviceRow; kv.set(`device:${d.deviceCode}`, d); kv.set(`usercode:${d.userCode}`, d.deviceCode); return { ok: true }; }
      case 'device.get': return { device: kv.get(`device:${body.deviceCode}`) ?? null };
      case 'device.approve': { const dc = kv.get(`usercode:${body.userCode}`); if (!dc) return { ok: false, error: 'unknown_code' }; const d = kv.get(`device:${dc}`) as DeviceRow; kv.set(`device:${dc}`, { ...d, approved: true, account: body.account }); return { ok: true }; }
      case 'op.put': { const o = body.operation as OperationRow; kv.set(`op:${o.operationId}`, o); return { ok: true }; }
      case 'op.get': return { operation: kv.get(`op:${body.operationId}`) ?? null };
      case 'receipt.append': { const id = `rcpt-${receipts.length + 1}-${Math.random().toString(16).slice(2, 34)}`; receipts.unshift({ receiptId: id, record: body.record as Record<string, unknown>, at: new Date().toISOString(), prevHash: 'x', recordHash: 'y' }); return { receiptRef: id, recordHash: 'y' }; }
      case 'receipt.get': { const r = receipts.find((x) => x.receiptId === body.receiptId); return r ?? { error: 'not_found' }; }
      case 'receipts.recent': return { receipts: receipts.map((r) => ({ record: r.record, at: r.at })) };
      default: return { error: 'not_found' };
    }
  };
  const ns = { idFromName: (n: string) => ({ toString: () => n }), get: (_id: { toString(): string }) => ({ fetch: async (input: string | Request, init?: RequestInit) => { const u = new URL(typeof input === 'string' ? input : input.url); const b = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}; return new Response(JSON.stringify(await handle(u.pathname.slice(1), b)), { headers: { 'content-type': 'application/json' } }); } }) };
  return { ns, kv, receipts };
}
