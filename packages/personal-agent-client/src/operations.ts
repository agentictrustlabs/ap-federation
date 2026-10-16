// OPERATIONS — the PAP Operations extension as parked acts (spec 442 §5; PAP Operations 3–8).
//
// A company proposes a revision-pinned set of terms. On our side that is an INTENT (`ExternalOperationRefV1`) whose
// digest a mandate binds. The act PARKS at the person's approval door; `approved_by: user` is produced only by the
// mandate signature over that digest, `standing_permission` only by a covering standing wire (spec 397 §11); a chat
// "yes", a company's message, a transcript — none of them is an input. A new revision is a new intent (the parked act
// is replaced, never silently re-approved). One `(authority, operationId, revision)` is confirmed at most once by this
// client; `in_progress` is `effect-uncertain`, and the company's `result.summary` is kept as its account, never ours.
import { externalApprovedBy, externalOperationConfirmKey, externalOperationIntentDigest, externalOperationRef, EXTERNAL_OPERATION_STATE, type ExternalOperationAuthorityFacts, type ExternalOperationRefV1 } from '@agenticprimitives/intent-engagement';
import type { Company } from './discovery.js';
import type { ApprovalPort, ParkedExternalOperation, ProofPorts } from './ports.js';
import { sessionFetch, type Session, type SessionDeps } from './session.js';

export type PapOperationState = 'proposed' | 'in_progress' | 'succeeded' | 'failed' | 'cancelled' | 'expired';

export interface PapOperation {
  operation_id: string;
  revision: number;
  state: PapOperationState;
  summary: string;
  terms?: unknown;
  expires_at?: string;
  user_approval_required?: boolean;
  url?: string;
  confirmation: null | { revision: number; approved_by: 'user' | 'standing_permission'; confirmed_at: string };
  result: null | { summary: string; data?: unknown };
}

export interface OperationDeps extends SessionDeps {
  approval: ApprovalPort;
  proofs?: ProofPorts;
  posture: { naming: string; listing: string };
}

/** The company's operation → OUR ref. `authority` = the company's issuer (its CAIP-10 when it has one is spec 443 W2's door). */
export function refOf(company: Company, op: PapOperation): ExternalOperationRefV1 {
  const expiresAt = op.expires_at ? Math.floor(new Date(op.expires_at).getTime() / 1000) : Math.floor(Date.now() / 1000) + 3600;
  return externalOperationRef({ authority: company.issuer, operationId: op.operation_id, revision: op.revision, terms: op.terms ?? { summary: op.summary }, expiresAt });
}

export function parkedOf(company: Company, op: PapOperation): ParkedExternalOperation {
  const ref = refOf(company, op);
  return { ref, companyName: company.name, issuer: company.issuer, summary: op.summary, terms: op.terms ?? null, userApprovalRequired: op.user_approval_required === true, expiresAt: ref.expiresAt };
}

export type OperationCallResult = { ok: true; operation: PapOperation; retryAfterSeconds?: number; session: Session } | { ok: false; error: string; status: number; operation?: PapOperation; session: Session };

async function call(deps: OperationDeps, company: Company, session: Session, path: string, method: 'GET' | 'POST', body?: unknown): Promise<OperationCallResult> {
  if (!company.operationsEndpoint) return { ok: false, error: 'extension_required', status: 0, session };
  const url = `${company.operationsEndpoint.replace(/\/$/, '')}${path}`;
  const { response: r, session: s } = await sessionFetch(deps, session, url, { method, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(text) as Record<string, unknown>; } catch { /* not json */ }
  const ra = r.headers.get('Retry-After');
  if (r.ok) return { ok: true, operation: j as unknown as PapOperation, ...(ra ? { retryAfterSeconds: Number(ra) || 0 } : {}), session: s };
  return { ok: false, error: String(j.error ?? `http_${r.status}`), status: r.status, ...(j.operation ? { operation: j.operation as PapOperation } : {}), session: s };
}

/** PAP Operations 6 — read. `in_progress` is `effect-uncertain`: the caller waits `retryAfterSeconds` and reads again. */
export async function readOperation(deps: OperationDeps, company: Company, session: Session, operationId: string): Promise<OperationCallResult & { runState?: string }> {
  const r = await call(deps, company, session, `/${encodeURIComponent(operationId)}`, 'GET');
  return r.ok ? { ...r, runState: EXTERNAL_OPERATION_STATE[r.operation.state as keyof typeof EXTERNAL_OPERATION_STATE] ?? r.operation.state } : r;
}

export type ConfirmOutcome =
  | { kind: 'parked'; act: ParkedExternalOperation }
  | { kind: 'refused'; reason: 'STANDING_NOT_ALLOWED_FOR_REVISION' | 'ALREADY_CONFIRMED_BY_THIS_CLIENT' | 'NOT_PROPOSED' | 'EXPIRED' | 'PROOF_GRADE_NOT_ALLOWED'; act: ParkedExternalOperation }
  | { kind: 'confirmed'; approvedBy: 'user' | 'standing_permission'; result: OperationCallResult; runState: string; intentDigest: `0x${string}` };

/**
 * The confirm: park → the approval door answers with VERIFIED facts (or not) → `approved_by` from those facts only →
 * one confirm per (authority, operationId, revision) → the company's answer. The optional `proof` is spec 442 §5's
 * proposal to PAP: `identity` only for a public naming posture; `standing` for anyone.
 */
export async function confirmOperation(deps: OperationDeps, company: Company, session: Session, op: PapOperation, confirmed: Set<string>, proofGrade?: 'identity' | 'standing'): Promise<ConfirmOutcome> {
  const act = parkedOf(company, op);
  const now = deps.now();
  const key = externalOperationConfirmKey(act.ref);
  if (confirmed.has(key)) return { kind: 'refused', reason: 'ALREADY_CONFIRMED_BY_THIS_CLIENT', act };
  if (op.state !== 'proposed') return { kind: 'refused', reason: 'NOT_PROPOSED', act };
  if (act.expiresAt <= now) return { kind: 'refused', reason: 'EXPIRED', act };
  const facts: ExternalOperationAuthorityFacts | null = await deps.approval.park(act);
  const approvedBy = facts ? externalApprovedBy(act.ref, facts) : null;
  if (!approvedBy) return { kind: 'parked', act };
  if (approvedBy === 'standing_permission' && act.userApprovalRequired) return { kind: 'refused', reason: 'STANDING_NOT_ALLOWED_FOR_REVISION', act };
  let proof: Record<string, unknown> | undefined;
  if (proofGrade === 'identity') {
    if (deps.posture.naming !== 'public' || !deps.proofs?.identity) return { kind: 'refused', reason: 'PROOF_GRADE_NOT_ALLOWED', act };
    proof = { grade: 'identity', jws: await deps.proofs.identity(act.ref) };
  } else if (proofGrade === 'standing') {
    if (!deps.proofs?.standing) return { kind: 'refused', reason: 'PROOF_GRADE_NOT_ALLOWED', act };
    proof = { grade: 'standing', presentation: await deps.proofs.standing(act.ref) };
  }
  confirmed.add(key);
  const result = await call(deps, company, session, `/${encodeURIComponent(op.operation_id)}/confirm`, 'POST', { revision: op.revision, approved_by: approvedBy, ...(proof ? { proof } : {}) });
  const state = result.ok ? result.operation.state : result.operation?.state;
  return { kind: 'confirmed', approvedBy, result, runState: state ? (EXTERNAL_OPERATION_STATE[state as keyof typeof EXTERNAL_OPERATION_STATE] ?? state) : 'effect-uncertain', intentDigest: externalOperationIntentDigest(act.ref) };
}

/** PAP Operations 7 — decline a proposal, or ask the company to stop one in progress (a revoke after confirm is a request to stop). */
export function cancelOperation(deps: OperationDeps, company: Company, session: Session, operationId: string): Promise<OperationCallResult> {
  return call(deps, company, session, `/${encodeURIComponent(operationId)}/cancel`, 'POST');
}
