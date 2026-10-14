// THE SUBMISSION STORE — the deployed home of what an estate vouches for (spec 439 F2 leftover; DEPLOYER.md said
// `.submissions/` on a workstation was the wrong place and why).
//
// A row is an opening: a digest, a random blind, and whom the leaf is about. It is the estate's record of a
// SUBMISSION a holder made — never something the estate read out of anyone's vault (F1 §7.1a). Rows are never
// deleted: a retirement is a field, because a projection that stopped including something is exactly what an
// auditor comes looking for.
//
// HONEST LIMIT, unchanged from the runbook: this is serving-plane storage, not a vault. The estate's copy belongs in
// its registry agent's vault and the holder's in the holder's (ADR-0055, spec 439 §4). A Durable Object is a better
// place than an operator's laptop — one writer, survives the laptop, readable by the job that needs it — and it is
// still not the place. The interface is the same `SubmissionLedger` port, so moving it again is a binding change.
export interface StoredRow { estate: string; set: string; digest: string; blind: string; subject: string; submittedBy: string; source: string; submittedAt: string; expiresAt?: string; retired?: { at: string; reason: string } }

export class SubmissionStoreDO {
  private sql: SqlStorage;
  constructor(state: DurableObjectState) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS rows_ (
      estate TEXT NOT NULL, set_ TEXT NOT NULL, digest TEXT NOT NULL, blind TEXT NOT NULL, subject TEXT NOT NULL,
      submitted_by TEXT NOT NULL, source TEXT NOT NULL, submitted_at TEXT NOT NULL, expires_at TEXT,
      retired_at TEXT, retired_reason TEXT,
      PRIMARY KEY (estate, set_, digest, submitted_at));`);
  }

  private rowsFor(estate: string): StoredRow[] {
    return this.sql.exec<Record<string, string | null>>(`SELECT * FROM rows_ WHERE estate = ? ORDER BY submitted_at`, estate).toArray().map((r) => ({
      estate: String(r.estate), set: String(r.set_), digest: String(r.digest), blind: String(r.blind), subject: String(r.subject),
      submittedBy: String(r.submitted_by), source: String(r.source), submittedAt: String(r.submitted_at),
      ...(r.expires_at ? { expiresAt: String(r.expires_at) } : {}),
      ...(r.retired_at ? { retired: { at: String(r.retired_at), reason: String(r.retired_reason ?? '') } } : {}),
    }));
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    const estate = url.searchParams.get('estate') ?? '';
    if (req.method === 'GET' && url.pathname === '/rows') return json({ rows: this.rowsFor(estate) });
    if (req.method === 'POST' && url.pathname === '/add') {
      const r = (await req.json()) as StoredRow;
      // One live row per (set, digest): vouching twice for the same grant is the same vouch, and the second would
      // put the same leaf in the tree under a different blind.
      const live = this.rowsFor(r.estate).find((x) => x.set === r.set && x.digest.toLowerCase() === r.digest.toLowerCase() && !x.retired);
      if (live) return json({ added: false, row: live, why: 'already vouched for in this set' });
      this.sql.exec(`INSERT INTO rows_ (estate, set_, digest, blind, subject, submitted_by, source, submitted_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        r.estate, r.set, r.digest.toLowerCase(), r.blind, r.subject.toLowerCase(), r.submittedBy, r.source, r.submittedAt, r.expiresAt ?? null);
      return json({ added: true, row: { ...r, digest: r.digest.toLowerCase(), subject: r.subject.toLowerCase() } });
    }
    if (req.method === 'POST' && url.pathname === '/retire') {
      const b = (await req.json()) as { estate: string; set: string; digest: string; reason: string; at: string };
      const n = this.sql.exec(`UPDATE rows_ SET retired_at = ?, retired_reason = ? WHERE estate = ? AND set_ = ? AND lower(digest) = lower(?) AND retired_at IS NULL`,
        b.at, b.reason, b.estate, b.set, b.digest).rowsWritten;
      return json({ retired: n > 0 });
    }
    return json({ error: 'not_found' }, 404);
  }
}
