// RECEIPT RETENTION — the door's ledger is a small honeypot of who visited where (the essay's "a door's receipts" row). The
// pairwise account already keeps the person out of it; this keeps the ACCOUNT out of it too, after the window in which a
// dispute could need the full record. A collapsed receipt keeps what the hash chain and the public face need — kind, effect,
// codes, the decision it belongs to, when — and drops the parties, the detail and the references. The row's hash does not
// change: the chain still vouches for a record the door no longer holds, and says so (`collapsed: true`).
export const DEFAULT_FULL_RECORD_DAYS = 30;

const KEPT = new Set(['kind', 'effect', 'code', 'reasonCodes', 'decisionId', 'estateId', 'at', 'grade', 'statusSequence', 'nullifierGrade', 'verifiedBy', 'predicateDigest', 'issuerKeyId']);

export function collapseRecord(record: Record<string, unknown>, collapsedAt: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) if (KEPT.has(k)) out[k] = v;
  // nested credential facts keep the predicate, never the account
  const cred = record['credential'] as Record<string, unknown> | undefined;
  if (cred && typeof cred === 'object') out['credential'] = Object.fromEntries(Object.entries(cred).filter(([k]) => KEPT.has(k)));
  out['collapsed'] = true;
  out['collapsedAt'] = collapsedAt;
  return out;
}

export function fullRecordUntil(at: string, days: number): string {
  return new Date(new Date(at).getTime() + days * 86_400_000).toISOString();
}

export function retentionDays(raw: string | undefined): number {
  const n = Number(raw ?? DEFAULT_FULL_RECORD_DAYS);
  if (!Number.isInteger(n) || n < 1) throw new Error(`RECEIPT_FULL_RECORD_DAYS must be a positive integer of days; got ${raw}`);
  return n;
}
