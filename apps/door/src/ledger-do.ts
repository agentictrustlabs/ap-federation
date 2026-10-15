// THE DOOR'S LEDGER — one Durable Object, two tables, both SERVING-PLANE (ADR-0055):
//
//   replay    the single-use ids of request proofs (`AtomicReplayStore.consume`): atomic because a Durable Object
//             runs one event at a time, which is the whole reason this is a DO and not KV.
//   receipts  the admission decisions, hash-chained (each row carries the previous row's hash), so a deleted or
//             reordered decision is detectable. Returned to the presenter by reference and readable by id.
//   presentations  a credential presentation a visitor POSTed ahead of her knock (spec 443 W5): an OpenAC proof bundle is
//             tens of kilobytes and Cloudflare's edge refuses a request header that size, so the door HOLDS it under
//             the reference it derives and the knock cites the reference. Minutes of life, then gone — the knock's
//             receipt keeps the digest, never the bundle. A cache, rebuildable by presenting again (ADR-0055).
//
// HONEST LIMIT, said in DEPLOYER.md too: an admission receipt is evidence about an agent and belongs in a vault —
// the receiving estate's registry agent's, and the presenter's own. This door has no vault; the ledger is the
// serving copy until F2.5 hands the receipt to the estate's registry agent. Wiping it loses the door's copy only:
// every decision also went back to the presenter in the response.
export interface ReplayRow { namespace: string; replayId: string; digest: string; expiresAt: string }

const enc = new TextEncoder();
async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class DoorLedgerDO {
  private sql: SqlStorage;
  constructor(state: DurableObjectState) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS replay (namespace TEXT NOT NULL, replay_id TEXT NOT NULL, digest TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY (namespace, replay_id));
      CREATE TABLE IF NOT EXISTS receipts (seq INTEGER PRIMARY KEY AUTOINCREMENT, receipt_id TEXT NOT NULL UNIQUE, record TEXT NOT NULL, prev_hash TEXT NOT NULL, record_hash TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS presentations (ref TEXT PRIMARY KEY, body TEXT NOT NULL, expires_at TEXT NOT NULL);`);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (req.method === 'POST' && url.pathname === '/consume') {
      const r = (await req.json()) as ReplayRow;
      // Expired rows are the only thing ever deleted here; a spent id stays spent for its lifetime.
      this.sql.exec(`DELETE FROM replay WHERE expires_at < ?`, new Date().toISOString());
      const prior = this.sql.exec<{ digest: string }>(`SELECT digest FROM replay WHERE namespace = ? AND replay_id = ?`, r.namespace, r.replayId).toArray()[0];
      if (prior) return json({ result: prior.digest === r.digest ? 'REPLAY' : 'CONFLICT' });
      this.sql.exec(`INSERT INTO replay (namespace, replay_id, digest, expires_at) VALUES (?, ?, ?, ?)`, r.namespace, r.replayId, r.digest, r.expiresAt);
      return json({ result: 'CONSUMED' });
    }
    if (req.method === 'POST' && url.pathname === '/present') {
      const r = (await req.json()) as { ref: string; body: string; expiresAt: string };
      this.sql.exec(`DELETE FROM presentations WHERE expires_at < ?`, new Date().toISOString());
      this.sql.exec(`INSERT OR REPLACE INTO presentations (ref, body, expires_at) VALUES (?, ?, ?)`, r.ref, r.body, r.expiresAt);
      return json({ ok: true, ref: r.ref, expiresAt: r.expiresAt });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/presentation/')) {
      const ref = decodeURIComponent(url.pathname.slice('/presentation/'.length));
      const row = this.sql.exec<{ body: string; expires_at: string }>(`SELECT body, expires_at FROM presentations WHERE ref = ?`, ref).toArray()[0];
      if (!row || row.expires_at < new Date().toISOString()) return json({ error: 'not_found' }, 404);
      return json({ ref, body: row.body, expiresAt: row.expires_at });
    }
    if (req.method === 'POST' && url.pathname === '/append') {
      const record = (await req.json()) as Record<string, unknown>;
      const last = this.sql.exec<{ record_hash: string }>(`SELECT record_hash FROM receipts ORDER BY seq DESC LIMIT 1`).toArray()[0];
      const prevHash = last?.record_hash ?? 'sha256:genesis';
      const at = new Date().toISOString();
      const receiptId = `rcpt-${at.replace(/[-:.TZ]/g, '').slice(0, 17)}-${Math.random().toString(36).slice(2, 8)}`;
      const body = JSON.stringify({ receiptId, prevHash, record, at });
      const recordHash = `sha256:${await sha256Hex(body)}`;
      this.sql.exec(`INSERT INTO receipts (receipt_id, record, prev_hash, record_hash, at) VALUES (?, ?, ?, ?, ?)`, receiptId, JSON.stringify(record), prevHash, recordHash, at);
      return json({ receiptRef: receiptId, recordHash });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/receipt/')) {
      const id = url.pathname.slice('/receipt/'.length);
      const row = this.sql.exec<{ receipt_id: string; record: string; prev_hash: string; record_hash: string; at: string }>(`SELECT * FROM receipts WHERE receipt_id = ?`, id).toArray()[0];
      if (!row) return json({ error: 'not_found' }, 404);
      return json({ receiptId: row.receipt_id, record: JSON.parse(row.record), prevHash: row.prev_hash, recordHash: row.record_hash, at: row.at });
    }
    if (req.method === 'GET' && url.pathname === '/receipts') {
      const rows = this.sql.exec<{ receipt_id: string; record: string; record_hash: string; at: string }>(`SELECT receipt_id, record, record_hash, at FROM receipts ORDER BY seq DESC LIMIT 50`).toArray();
      return json({ receipts: rows.map((r) => ({ receiptId: r.receipt_id, record: JSON.parse(r.record), recordHash: r.record_hash, at: r.at })) });
    }
    return json({ error: 'not_found' }, 404);
  }
}
