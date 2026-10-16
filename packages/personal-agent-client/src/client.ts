// THE CLIENT — one object per estate runtime, composing discovery · sessions · sign-in · operations over the ports.
import { discoverCompany, type Company, type DiscoveryResult } from './discovery.js';
import { cancelOperation, confirmOperation, readOperation, type ConfirmOutcome, type OperationCallResult, type OperationDeps, type PapOperation } from './operations.js';
import type { PersonalAgentClientConfig } from './ports.js';
import { deviceSignInPoll, deviceSignInStart, directSignInComplete, directSignInStart, mediatedSignIn, type DeviceSignInStart, type DirectSignInStart } from './signin.js';
import { sessionFetch, signedInSession, signOut, startSession, subjectFor, type Session, type SessionResult } from './session.js';

/** The extensions this client lists in its metadata document (PAP 3.3). */
export const CLIENT_EXTENSIONS = { operations: { version: '1' } } as const;

const defaultRandom = (n: number) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; };

export function createPersonalAgentClient(config: PersonalAgentClientConfig) {
  const deps: OperationDeps = {
    clientKey: config.clientKey, dpopKeys: config.dpopKeys, vault: config.vault, approval: config.approval,
    ...(config.proofs ? { proofs: config.proofs } : {}), posture: config.posture,
    fetch: config.fetch ?? fetch, now: config.now ?? (() => Math.floor(Date.now() / 1000)), random: config.random ?? defaultRandom,
  };
  if (config.clientKey.binding.scope === 'person' && config.posture.naming !== 'public') {
    throw new Error("a scope:'person' client key is refused for a non-public naming posture — present through the estate's personal-agent service (spec 442 §7.1)");
  }
  /** One confirm per (authority, operationId, revision) for the life of this client. */
  const confirmed = new Set<string>();
  return {
    discover: (domain: string): Promise<DiscoveryResult> => discoverCompany(domain, deps.fetch),
    /** What this company calls the person. Derived, never stored, never derived from PII. */
    subjectAt: (company: Company) => subjectFor(deps, company.issuer),
    startSession: (company: Company, opts?: { sessionId?: string; scope?: string[]; resource?: string }): Promise<SessionResult> => startSession(deps, company, opts),
    signedInSession: (company: Company, opts?: { sessionId?: string; scope?: string[]; resource?: string }) => signedInSession(deps, company, opts),
    signOut: (company: Company, reason?: string) => signOut(deps, company, reason),
    /** A DPoP-bound call to one of the company's APIs under the session. */
    fetch: (session: Session, url: string, init?: RequestInit) => sessionFetch(deps, session, url, init),
    signIn: {
      direct: { start: (company: Company, session: Session, scopes: string[]) => directSignInStart(deps, company, session, scopes), complete: (company: Company, session: Session, started: DirectSignInStart, cb: { code: string; state: string }) => directSignInComplete(deps, company, session, started, cb) },
      device: { start: (company: Company, scopes: string[]) => deviceSignInStart(deps, company, scopes), poll: (company: Company, session: Session, started: DeviceSignInStart) => deviceSignInPoll(deps, company, session, started) },
      mediated: (company: Company) => mediatedSignIn(company, config.operatorPolicy),
    },
    operations: {
      read: (company: Company, session: Session, id: string) => readOperation(deps, company, session, id),
      confirm: (company: Company, session: Session, op: PapOperation, proofGrade?: 'identity' | 'standing'): Promise<ConfirmOutcome> => confirmOperation(deps, company, session, op, confirmed, proofGrade),
      cancel: (company: Company, session: Session, id: string): Promise<OperationCallResult> => cancelOperation(deps, company, session, id),
    },
  };
}

export type PersonalAgentClient = ReturnType<typeof createPersonalAgentClient>;
