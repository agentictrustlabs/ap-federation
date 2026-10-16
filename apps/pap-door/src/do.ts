// THE DOOR'S LEDGER — one Durable Object, serving-plane only (ADR-0055): jti replay for assertions and DPoP proofs,
// sessions (bound to a DPoP key thumbprint), device codes, account tokens, operations (with the company agent's task
// id), receipts (hash-chained; the public face is counts and subject digests). Wipe it and every session ends and every
// open operation is lost on THIS side — the company agent's own run and its receipts live at the company agent.
export interface SessionRow { sessionId: string; clientId: string; sub: string; account: string | null; jkt: string; token: string; scope: string; expiresAt: number }
export interface AccountTokenRow { token: string; clientId: string; sub: string; account: string; scope: string; expiresAt: number }
export interface DeviceRow { deviceCode: string; userCode: string; clientId: string; scope: string; approved: boolean; account: string | null; expiresAt: number }
export interface OperationRow { operationId: string; sessionId: string; account: string | null; clientId: string; sub: string; revision: number; state: string; summary: string; terms: unknown; expiresAt: number; userApprovalRequired: boolean; confirmation: null | Record<string, unknown>; result: null | Record<string, unknown>; taskId: string | null; runRef: string | null; url?: string }

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const enc = new TextEncoder();
async function sha256Hex(s: string): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join(''); }

export class PapDoorDO {
  private sql: SqlStorage;
  constructor(state: DurableObjectState) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS jti (ns TEXT NOT NULL, jti TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (ns, jti));
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, expires_at INTEGER);
      CREATE TABLE IF NOT EXISTS receipts (seq INTEGER PRIMARY KEY AUTOINCREMENT, receipt_id TEXT NOT NULL UNIQUE, record TEXT NOT NULL, prev_hash TEXT NOT NULL, record_hash TEXT NOT NULL, at TEXT NOT NULL);`);
  }
  private get(k: string): unknown | null { const r = this.sql.exec<{ v: string; expires_at: number | null }>(`SELECT v, expires_at FROM kv WHERE k = ?`, k).toArray()[0]; if (!r) return null; if (r.expires_at && r.expires_at < Math.floor(Date.now() / 1000)) return null; return JSON.parse(r.v); }
  private put(k: string, v: unknown, expiresAt?: number): void { this.sql.exec(`INSERT OR REPLACE INTO kv (k, v, expires_at) VALUES (?, ?, ?)`, k, JSON.stringify(v), expiresAt ?? null); }
  private del(k: string): void { this.sql.exec(`DELETE FROM kv WHERE k = ?`, k); }
  private list(prefix: string): unknown[] { return this.sql.exec<{ v: string }>(`SELECT v FROM kv WHERE k LIKE ? AND (expires_at IS NULL OR expires_at >= ?)`, `${prefix}%`, Math.floor(Date.now() / 1000)).toArray().map((r: { v: string }) => JSON.parse(r.v)); }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url); const op = url.pathname.slice(1);
    const body = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};
    const now = Math.floor(Date.now() / 1000);
    switch (op) {
      case 'jti.consume': { // single use within the window; expired rows are the only thing ever deleted
        this.sql.exec(`DELETE FROM jti WHERE expires_at < ?`, now);
        const seen = this.sql.exec(`SELECT 1 FROM jti WHERE ns = ? AND jti = ?`, String(body.ns), String(body.jti)).toArray().length > 0;
        if (seen) return json({ result: 'REPLAY' });
        this.sql.exec(`INSERT INTO jti (ns, jti, expires_at) VALUES (?, ?, ?)`, String(body.ns), String(body.jti), Number(body.expiresAt ?? now + 300));
        return json({ result: 'CONSUMED' });
      }
      case 'session.put': { const s = body.session as SessionRow; this.put(`session:${s.sessionId}`, s, s.expiresAt + 86400); this.put(`token:${s.token}`, s.sessionId, s.expiresAt); return json({ ok: true }); }
      case 'session.get': return json({ session: this.get(`session:${String(body.sessionId)}`) });
      case 'session.byToken': { const id = this.get(`token:${String(body.token)}`); return json({ session: id ? this.get(`session:${String(id)}`) : null }); }
      case 'session.signOutAccount': { for (const s of this.list('session:') as SessionRow[]) if (s.account === String(body.account) && s.clientId === String(body.clientId)) this.put(`session:${s.sessionId}`, { ...s, account: null }, s.expiresAt + 86400); return json({ ok: true }); }
      case 'account.put': { const a = body.account as AccountTokenRow; this.put(`account:${a.token}`, a, a.expiresAt); return json({ ok: true }); }
      case 'account.get': return json({ account: this.get(`account:${String(body.token)}`) });
      case 'account.del': { this.del(`account:${String(body.token)}`); return json({ ok: true }); }
      case 'device.put': { const d = body.device as DeviceRow; this.put(`device:${d.deviceCode}`, d, d.expiresAt); this.put(`usercode:${d.userCode}`, d.deviceCode, d.expiresAt); return json({ ok: true }); }
      case 'device.get': return json({ device: this.get(`device:${String(body.deviceCode)}`) });
      case 'device.byUserCode': { const dc = this.get(`usercode:${String(body.userCode)}`); return json({ device: dc ? this.get(`device:${String(dc)}`) : null }); }
      case 'device.approve': { const dc = this.get(`usercode:${String(body.userCode)}`); if (!dc) return json({ ok: false, error: 'unknown_code' }); const d = this.get(`device:${String(dc)}`) as DeviceRow | null; if (!d) return json({ ok: false, error: 'expired' }); this.put(`device:${d.deviceCode}`, { ...d, approved: true, account: String(body.account) }, d.expiresAt); return json({ ok: true }); }
      case 'op.put': { const o = body.operation as OperationRow; this.put(`op:${o.operationId}`, o); return json({ ok: true }); }
      case 'op.get': return json({ operation: this.get(`op:${String(body.operationId)}`) });
      case 'receipt.append': {
        const record = body.record as Record<string, unknown>;
        const last = this.sql.exec<{ record_hash: string }>(`SELECT record_hash FROM receipts ORDER BY seq DESC LIMIT 1`).toArray()[0];
        const prevHash = last?.record_hash ?? 'sha256:genesis'; const at = new Date().toISOString();
        const rnd = new Uint8Array(16); crypto.getRandomValues(rnd);
        const receiptId = `rcpt-${at.replace(/[-:.TZ]/g, '').slice(0, 17)}-${[...rnd].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
        const recordHash = `sha256:${await sha256Hex(JSON.stringify({ receiptId, prevHash, record, at }))}`;
        this.sql.exec(`INSERT INTO receipts (receipt_id, record, prev_hash, record_hash, at) VALUES (?, ?, ?, ?, ?)`, receiptId, JSON.stringify(record), prevHash, recordHash, at);
        return json({ receiptRef: receiptId, recordHash });
      }
      case 'receipt.get': { const r = this.sql.exec<{ receipt_id: string; record: string; prev_hash: string; record_hash: string; at: string }>(`SELECT * FROM receipts WHERE receipt_id = ?`, String(body.receiptId)).toArray()[0]; return r ? json({ receiptId: r.receipt_id, record: JSON.parse(r.record), prevHash: r.prev_hash, recordHash: r.record_hash, at: r.at }) : json({ error: 'not_found' }, 404); }
      case 'receipts.recent': return json({ receipts: this.sql.exec<{ record: string; at: string }>(`SELECT record, at FROM receipts ORDER BY seq DESC LIMIT 50`).toArray().map((r: { record: string; at: string }) => ({ record: JSON.parse(r.record), at: r.at })) });
      default: return json({ error: 'not_found' }, 404);
    }
  }
}
