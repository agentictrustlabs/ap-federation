// THE ESTATE'S COPY, IN THE ESTATE'S OWN VAULT — the binding `ledger.ts` said this module's interface existed for.
//
// WHY IT MOVED. Each submission carries a blind, and the leaf on the tree is `keccak256(digest ‖ blind)`. The blind
// is random, per leaf, derived from nothing public, and held by exactly two parties: the holder (to open their leaf)
// and the estate (to build the tree). Put the estate's half in a Durable Object and the ADR-0055 question answers
// itself the wrong way: wipe it and the roots on chain survive, but no leaf in them can ever be proved again and the
// next rebuild yields a different tree. That is a bereavement, not a rebuild. The record belongs in the vault of the
// agent that anchors the roots — its registry service agent — as `federation.projection-submission:<set>:<digest>`,
// bound to `apest:ProjectionSubmission` (ontology `tbox/estate.ttl`, spec 410 §4).
//
// THE DURABLE OBJECT STAYS, as what ADR-0055 says a DO is for: the serving projection, rebuilt from these records and
// never their only copy. A rebuild reads the vault; the DO makes the next read cheap and the cron's work bounded.
//
// HOW IT WRITES. As the agent, at its OWN estate's vault, through the native door: a scoped grant to that vault's
// interactions service plus a DEL-001 leaf binding this Worker's key, a token per call, a per-call invocation proof.
// Two estates mean TWO vaults at two Homes with two different interactions services — which is the federation premise
// showing up in the plumbing, not an accident to paper over. A missing or refused credential writes nothing and says
// so; it never falls back to the DO as the record (ADR-0013).
import { buildInvocationProof, mintDelegationToken, type Delegation } from '@agenticprimitives/delegation';
import { hashMessage, type Address, type Hex } from 'viem';
import { keyServiceAccount, tokenFor, type KeyServiceRef } from '@ap-federation/key-service-account';
import type { SubmissionLedger, SubmissionV1, ProjectionSet } from './ledger.js';

/** A random 32-byte blind, by Web Crypto (this module runs in the Worker too, where `ledger.ts`'s Node imports cannot). */
const newBlind = (): Hex => `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;

/** One estate's vault credentials, as the Worker holds them. The KEY is a delegate under wires its custodian minted;
 *  it is never the agent's identity and it may do nothing this grant does not name. */
export interface VaultCredentials {
  /** The record's owner: the estate's registry service agent. */
  agent: Address;
  /** Its name, for the token's `iss`. */
  agentName: string;
  /** That estate's Home vault base URL. */
  vaultUrl: string;
  /** That estate's interactions-execution SA — the grant's DELEGATE. NEVER another estate's: a grant naming the
   *  wrong one is refused at the door with nothing useful to say. Note this is not the call's audience. */
  interactionsService: Address;
  /** The MCP server id the token and the proof are AUDIENCED to — `urn:mcp:server:person`, the vault's own id, not
   *  the interactions SA. Getting this wrong surfaces only as a flat `invalid_invocation_proof`. */
  audience?: string;
  chainId: number;
  grant: Delegation;
  leaf: Delegation;
  /** What signs as the leaf's delegate: the key service's key (the Worker, the CLI), or a test person's own key in a gate
   *  script. Never a private key in this shape — only something that can sign a digest and say its address. */
  signer: VaultSigner;
}

export interface VaultSigner { address: Address; sign(args: { hash: Hex }): Promise<Hex> }

export const SUBMISSION_RECORD_PREFIX = 'federation.projection-submission:';

/** One record per vouch, keyed by what makes it unique in the estate's ledger. Retiring a vouch REWRITES this record
 *  with its retirement; it never deletes it, because a projection that silently forgets a retirement cannot be
 *  audited and the retirement is the interesting half. */
export function submissionRecordType(set: ProjectionSet, digest: Hex): string {
  return `${SUBMISSION_RECORD_PREFIX}${set}:${digest.toLowerCase()}`;
}

type NativeResult = { ok?: boolean; error?: string; code?: string; detail?: string; data?: unknown; records?: Array<{ record_type?: string }> };

const DEFAULT_AUDIENCE = 'urn:mcp:server:person';

async function callVault(c: VaultCredentials, tool: string, toolArgs: Record<string, unknown>, fetchImpl: typeof fetch): Promise<NativeResult & { status: number }> {
  const account = c.signer;
  if (account.address.toLowerCase() !== c.leaf.delegate.toLowerCase()) {
    throw new Error(`the signer key is ${account.address} and ${c.agentName}'s leaf names ${c.leaf.delegate} — the key and the wire disagree, so nothing was sent`);
  }
  // RAW over the digest, not EIP-191. `buildInvocationProof` hands this callback a digest to sign as-is; wrapping it
  // in a personal-sign prefix produces a proof the server recomputes differently and refuses as
  // `invalid_invocation_proof`, with nothing to say which of five things was wrong. The TOKEN's signature is the
  // other shape on purpose: there the message is a string, hashed with EIP-191 first and then signed raw.
  const signDigest = async (d: Hex) => account.sign({ hash: d });
  const audience = c.audience ?? DEFAULT_AUDIENCE;
  const { token } = await mintDelegationToken(
    { iss: c.agentName, aud: audience, sub: c.agent, delegation: c.grant, sessionKeyAddress: c.leaf.delegate, sessionDelegation: c.leaf, usageLimit: 1, ttlSeconds: 300 } as never,
    async (message: string) => signDigest(hashMessage(message)),
  );
  const now = Date.now();
  // THE PROOF IS SIGNED OVER WHAT THE SERVER RECOMPUTES. `withDelegation` strips token/proof from the handler's
  // input and hashes THE REST, and this door hands it `{ token, invocationProof, args }` — so the rest is
  // `{ args }`, never the args alone. Signing `toolArgs` gives `arguments_mismatch`, surfaced only as a flat 401.
  const invocationProof = await buildInvocationProof({
    chainId: c.chainId, audience, principal: c.agent, sessionKey: c.leaf.delegate,
    operation: tool, args: { args: toolArgs }, rawDelegationToken: token,
    requestId: crypto.randomUUID(), issuedAt: now, expiresAt: now + 30_000, sign: signDigest,
  } as never);
  const res = await fetchImpl(`${c.vaultUrl.replace(/\/$/, '')}/mcp/native`, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ token, invocationProof, tool, args: toolArgs }),
  });
  const out = (await res.json().catch(() => ({}))) as NativeResult;
  return { ...out, status: res.status };
}

function refusal(tool: string, c: VaultCredentials, r: NativeResult & { status: number }): string {
  return `${c.agentName}'s vault refused ${tool}: ${r.error ?? r.code ?? r.status}${r.detail ? ` (${r.detail})` : ''}`;
}

// ─── Generic record access, same door, same credential — for records that are not submissions (the predicate gate's
// holder records, spec 443 W5). The record family a credential may touch is the GRANT's scope, not this code's.
export async function putVaultRecord(c: VaultCredentials, recordType: string, data: unknown, fetchImpl: typeof fetch = fetch): Promise<void> {
  const r = await callVault(c, 'set_vault_record', { recordType, data }, fetchImpl);
  if (!(r.status < 400 && r.ok !== false)) throw new Error(refusal(`set_vault_record ${recordType}`, c, r));
}
export async function getVaultRecord<T = unknown>(c: VaultCredentials, recordType: string, fetchImpl: typeof fetch = fetch): Promise<T | null> {
  const r = await callVault(c, 'get_vault_record', { recordType }, fetchImpl);
  if (r.status === 404) return null;
  if (!(r.status < 400 && r.ok !== false)) throw new Error(refusal(`get_vault_record ${recordType}`, c, r));
  return (r.data ?? null) as T | null;
}
export async function listVaultRecords(c: VaultCredentials, prefix: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const listed = await callVault(c, 'list_vault_record', {}, fetchImpl);
  if (!(listed.status < 400 && listed.ok !== false)) throw new Error(refusal('list_vault_record', c, listed));
  return (listed.records ?? []).map((x) => String(x.record_type ?? '')).filter((t) => t.startsWith(prefix));
}

/** WRITE one submission as the agent. Resolves on `ok`; THROWS on refusal — a submission the estate's own vault would
 *  not take is not a submission, and recording it anywhere else would make the DO the record again. */
export async function writeSubmission(c: VaultCredentials, row: SubmissionV1, fetchImpl: typeof fetch = fetch): Promise<void> {
  const recordType = submissionRecordType(row.set, row.digest);
  const r = await callVault(c, 'set_vault_record', { recordType, data: row }, fetchImpl);
  if (!(r.status < 400 && r.ok !== false)) throw new Error(refusal('set_vault_record', c, r));
}

/** READ every submission this estate vouches for, from the vault. The list enumerates only record types the grant may
 *  READ (spec 317 §3.2), so a write-only credential lists nothing rather than half of something. */
export async function loadSubmissions(c: VaultCredentials, fetchImpl: typeof fetch = fetch): Promise<SubmissionV1[]> {
  const listed = await callVault(c, 'list_vault_record', {}, fetchImpl);
  if (!(listed.status < 400 && listed.ok !== false)) throw new Error(refusal('list_vault_record', c, listed));
  const types = (listed.records ?? []).map((x) => String(x.record_type ?? '')).filter((t) => t.startsWith(SUBMISSION_RECORD_PREFIX));
  const rows: SubmissionV1[] = [];
  for (const recordType of types) {
    const got = await callVault(c, 'get_vault_record', { recordType }, fetchImpl);
    if (!(got.status < 400 && got.ok !== false)) throw new Error(refusal(`get_vault_record ${recordType}`, c, got));
    const data = (got.data ?? null) as SubmissionV1 | null;
    // A record whose body is not a submission is skipped rather than coerced: a shape we do not recognize is a
    // shape we must not vouch from.
    if (data && data.type === 'ap.federation-submission.v1' && typeof data.digest === 'string' && typeof data.blind === 'string') rows.push(data);
  }
  return rows.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

/** A SubmissionLedger over the vault, for callers that work in one sitting (the CLI, the scheduled projector): the rows are
 *  read once, `add`/`retire` change the in-memory copy and queue the record they rewrite, and `flush()` writes each queued
 *  record and reads it back. A write the vault refuses throws; nothing is kept anywhere else in its place (ADR-0013). */
export async function vaultLedger(c: VaultCredentials, fetchImpl: typeof fetch = fetch): Promise<SubmissionLedger & { flush(): Promise<number> }> {
  const rows = await loadSubmissions(c, fetchImpl);
  const pending = new Map<string, SubmissionV1>();
  const queue = (row: SubmissionV1) => pending.set(submissionRecordType(row.set, row.digest), row);
  return {
    list: () => rows,
    add(input) {
      const digest = input.digest.toLowerCase() as Hex;
      const dup = rows.find((r) => r.set === input.set && r.digest.toLowerCase() === digest && !r.retired);
      if (dup) return { added: false, row: dup, why: 'already vouched for in this set' };
      const row: SubmissionV1 = {
        type: 'ap.federation-submission.v1', estate: input.estate, set: input.set, digest, blind: input.blind ?? newBlind(),
        subject: input.subject.toLowerCase() as `0x${string}`, submittedBy: input.submittedBy, source: input.source,
        submittedAt: new Date().toISOString(), ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      };
      rows.push(row); queue(row);
      return { added: true, row };
    },
    retire(set, digest, reason, at) {
      const i = rows.findIndex((r) => r.set === set && r.digest.toLowerCase() === digest.toLowerCase() && !r.retired);
      if (i < 0) return false;
      rows[i] = { ...rows[i]!, retired: { at: (at ?? new Date()).toISOString(), reason } };
      queue(rows[i]!);
      return true;
    },
    async flush() {
      for (const row of pending.values()) {
        await writeSubmission(c, row, fetchImpl);
        const back = await getVaultRecord<SubmissionV1>(c, submissionRecordType(row.set, row.digest), fetchImpl);
        if (!back || JSON.stringify(back) !== JSON.stringify(row)) throw new Error(`${submissionRecordType(row.set, row.digest)}: written and not read back as written`);
      }
      const n = pending.size; pending.clear(); return n;
    },
  };
}

/** The vault credential shape both the CLI file and the Worker secret hold (`issue-self-host-vault-credentials.mts` plus
 *  `signer: {tenant, keyId}`, the key-service key the leaf binds): parsed in one place so the two cannot read it differently.
 *  A credential carrying a private key is refused by name — that shape is retired. */
export async function vaultCredentialsFrom(raw: string, fallbackName: string, env: Record<string, unknown> = process.env): Promise<VaultCredentials> {
  const d = JSON.parse(raw) as Record<string, unknown>;
  if (!d.chainId) throw new Error(`${fallbackName}: the vault credential names no chainId — a grant is verified on its delegator's chain, which must be declared`);
  if ('signerKey' in d) throw new Error(`${fallbackName}: the vault credential carries a private key (signerKey) — re-issue it to a key-service key and name it as signer: {tenant, keyId}`);
  const ref = d.signer as Partial<KeyServiceRef> | undefined;
  if (!ref?.tenant || !ref.keyId) throw new Error(`${fallbackName}: the vault credential names no signer {tenant, keyId}`);
  const signer = await keyServiceAccount({ tenant: ref.tenant, keyId: ref.keyId }, { token: tokenFor(env, ref.tenant), ...(typeof env.AKCS_BASE_URL === 'string' ? { baseUrl: env.AKCS_BASE_URL } : {}) });
  return {
    agent: d.agent as `0x${string}`, agentName: String(d.agentName ?? fallbackName),
    vaultUrl: String(d.vaultUrl ?? d.home), interactionsService: d.interactionsService as `0x${string}`,
    chainId: Number(d.chainId), ...(d.audience ? { audience: String(d.audience) } : {}),
    grant: d.grant as VaultCredentials['grant'], leaf: (d.sessionLeaf ?? d.leaf) as VaultCredentials['leaf'],
    signer,
  };
}
