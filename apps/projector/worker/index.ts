// THE PROJECTOR, ON A SCHEDULE — spec 439 §4's "runs as a job, not a person at a keyboard", one step closer.
//
// WHY THIS EXISTS, in one sentence a reader can check: a verifier accepts only a FRESH anchored sequence, so an
// estate whose projector stops running stops being provable — on 2026-10-14 both estates' anchors were ten hours old
// against the doors' 24-hour window, which is the failure DEPLOYER.md predicted and nobody had yet felt.
//
// What it does, every cron tick, per projectable estate that has a signer key here:
//   read the submissions (the Durable Object) → prune every leaf against `DelegationManager.isRevoked` on the
//   estate's chain (an unreadable chain DROPS the leaf, ADR-0013) → rebuild the roots → anchor when they changed, or
//   when the last anchor is older than the refresh window. It never re-anchors roots it did not just rebuild: a
//   heartbeat that re-asserted a stale root would extend the life of a grant the chain had already revoked.
//
// THE TENSION IT SITS IN (F1 §7.1d): anchoring invalidates every presentation in flight, so a short refresh window
// costs sequences and a long one lets anchors age out. The cadence here — a tick every 6 hours, a refresh window of
// 6 hours — keeps the anchor under ~6h against a 24h verifier window, and a presentation is built and spent in
// seconds, so the invalidation is theoretical. Both numbers are config, and a deployment that changes one should
// check the other against the SHORTEST verifier `maxAge` it serves.
//
// WHO SIGNS: never a key this Worker holds. Each row is anchored by a key-service key the register names (`anchorKey`),
// a delegate under the wire its registry agent signed; each vault is read with the key its credential names. The Worker
// holds one caller token per tenant (`AKCS_TOKEN_<TENANT>`), bound to those keys' purposes and nothing else.
import { parse as parseYaml } from 'yaml';
import { registryClient, readDeclaredSigner, type AnchorAuthority, type AnchoringWireV1 } from '../src/anchor.js';
import { projectEstate } from '../src/project.js';
import { isRevokedReader } from '../src/revocation.js';
import type { SubmissionLedger, SubmissionV1 } from '../src/ledger.js';
import { loadSubmissions, vaultCredentialsFrom, writeSubmission, type VaultCredentials } from '../src/vault-ledger.js';
import { anchorAccount } from '../src/config.js';
import { projectIssuer } from '../src/issuer.js';
import type { IssuerRow } from '../src/config.js';
import federationYaml from '../../../federation.yaml';
export { SubmissionStoreDO } from './store-do.js';

interface Env {
  STORE: DurableObjectNamespace;
  FEDERATION_RPC_URL?: string;
  /** `{"impact-agent":{…wire…}}` — the anchoring wire per estate, as `issue-anchoring-wire.mts` wrote it: what lets the
   *  register's `anchorKey` call `setRoots` as the estate's registry agent. No wire ⇒ that estate is not anchored here. */
  ANCHORING_WIRES?: string;
  /** Spec 444 — the same, per ISSUER id (its rowSigner's wire). */
  ISSUER_ANCHORING_WIRES?: string;
  /** The key service, and one caller token per tenant whose keys this job signs with (`AKCS_TOKEN_FAITHNET`, `AKCS_TOKEN_IMB`). */
  AKCS_BASE_URL?: string;
  [k: `AKCS_TOKEN_${string}`]: string | undefined;
  /** Guards the ops routes (submit / retire / project-now). A read of `/status` needs none. */
  OPS_TOKEN?: string;
  REFRESH_AFTER_SECONDS?: string;
  /** ONE SECRET PER ESTATE — `VAULT_CREDENTIALS_<ESTATE>`, as `issue-self-host-vault-credentials.mts` wrote it: the
   *  registry agent, its Home's vault, THAT estate's interactions service, the scoped grant, the DEL-001 leaf and the
   *  key-service key that leaf binds (`signer: {tenant, keyId}`). Per estate and not one map because a Cloudflare secret caps near 5 kB and one pair is 3.3 kB.
   *  Absent for an estate ⇒ that estate has no vault yet, which the status says rather than hides. */
  [k: `VAULT_CREDENTIALS_${string}`]: string | undefined;
}

const vaultSecretOf = (env: Env, estate: string) => env[`VAULT_CREDENTIALS_${estate.toUpperCase().replace(/[^A-Z0-9]/g, '_')}` as `VAULT_CREDENTIALS_${string}`];
/** The estate's vault credentials, or `null` when this deployment holds none for it. */
async function vaultFor(env: Env, estate: string): Promise<VaultCredentials | null> {
  const raw = vaultSecretOf(env, estate);
  return raw ? vaultCredentialsFrom(raw, `${estate}.registry`, env as never) : null;
}

interface EstateRow { id: string; chainId: number; governance: string | null; signer?: string; delegationManager?: string; profileResolver?: string; rpcUrl?: string; blocked?: string; anchorKey?: { tenant: string; keyId: string } }
interface Register { registry: { chainId: number; address: string }; estates: EstateRow[]; credentials?: { issuers?: IssuerRow[] } }
/** Spec 444 — the issuers this job keeps fresh: those whose ledger is their own vault. A file-ledger issuer is the operator's. */
const vaultIssuers = (f: Register): IssuerRow[] => (f.credentials?.issuers ?? []).filter((i) => i.ledger === 'vault');
const register = (): Register => parseYaml(federationYaml) as Register;
const projectable = (f: Register): EstateRow[] => f.estates.filter((e) => e.governance && !e.blocked);

const json = (b: unknown, status = 200, maxAge = 10) =>
  new Response(JSON.stringify(b, null, 2), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${maxAge}`, 'access-control-allow-origin': '*' } });

// THE DURABLE OBJECT IS THE SERVING PROJECTION (ADR-0055). The RECORD is the estate's registry agent's vault, and
// the two reads below are deliberately different: a rebuild reads the vault, because anchoring a root from a cache
// would anchor whatever the cache last happened to hold; `/status` reads the DO, because a status page that cannot
// answer while a Home is down is a worse status page and it is not vouching for anything.
const store = (env: Env) => {
  const stub = env.STORE.get(env.STORE.idFromName('submissions'));
  return {
    async rows(estate: string): Promise<SubmissionV1[]> {
      const r = await stub.fetch(new Request(`https://store/rows?estate=${encodeURIComponent(estate)}`));
      const b = (await r.json()) as { rows: Array<Record<string, unknown>> };
      return b.rows.map((x) => ({ type: 'ap.federation-submission.v1', ...x } as unknown as SubmissionV1));
    },
    call: (path: string, body: unknown) => stub.fetch(new Request(`https://store${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })),
  };
};

/** What a rebuild vouches from. From the VAULT when this deployment holds the estate's credentials, mirrored into the
 *  DO on the way through so the projection stays warm; from the DO only for an estate with no vault yet, and that
 *  case says so in the run's output rather than passing silently for the other kind. */
async function rowsOfRecord(env: Env, estate: string): Promise<{ rows: SubmissionV1[]; from: 'vault' | 'durable-object' }> {
  const c = await vaultFor(env, estate);
  if (!c) return { rows: await store(env).rows(estate), from: 'durable-object' };
  const rows = await loadSubmissions(c);
  // Mirror, never merge: the vault said what the estate vouches for, so a DO row the vault does not have is a stale
  // projection and not a second opinion. `/mirror` replaces the estate's rows wholesale.
  await store(env).call('/mirror', { estate, rows });
  return { rows, from: 'vault' };
}

/** The ledger a projection run reads. READ-ONLY on purpose: a scheduled job vouches for nothing on its own — adding a
 *  leaf is a submission someone made, and this job is not someone. */
function readOnlyLedger(rows: SubmissionV1[]): SubmissionLedger {
  const refuse = (what: string) => { throw new Error(`the scheduled projector does not ${what}: inclusion is a submission, and a job is not a submitter (spec 439 §7.1a)`); };
  return { list: () => rows, add: () => refuse('add a leaf') as never, retire: () => refuse('retire a leaf') as never };
}

/** The row's key-service key and the wire its owner lent it, or null when this deployment cannot anchor it (said, not hidden). */
async function anchorFor(env: Env, row: { id: string; anchorKey?: { tenant: string; keyId: string } }, wires: Record<string, AnchoringWireV1>): Promise<AnchorAuthority | null> {
  const wire = wires[row.id];
  if (!wire || !row.anchorKey) return null;
  return { account: await anchorAccount(row, env as never), wire };
}

async function projectOne(env: Env, estate: EstateRow, f: Register): Promise<Record<string, unknown>> {
  const anchor = await anchorFor(env, estate, JSON.parse(env.ANCHORING_WIRES ?? '{}') as Record<string, AnchoringWireV1>);
  const rpc = env.FEDERATION_RPC_URL!;
  const registry = registryClient({ rpcUrl: rpc, chainId: f.registry.chainId, address: f.registry.address as `0x${string}` });
  const record = await rowsOfRecord(env, estate.id);
  const rows = record.rows;
  const declaredSigner = await readDeclaredSigner({ rpcUrl: rpc, chainId: estate.chainId, governance: estate.governance as `0x${string}`, profileResolver: (estate.profileResolver ?? '0xB03F7C06ad3274F584AB72794406D639c02A45e1') as `0x${string}` }).catch(() => undefined);
  const run = await projectEstate(
    { ...estate, governance: estate.governance as `0x${string}`, estateId: await registry.estateIdOf(estate.chainId, estate.governance as `0x${string}`) } as never,
    {
      registry, ledger: readOnlyLedger(rows),
      liveness: { isRevoked: await isRevokedReader({ ...estate, rpcUrl: estate.rpcUrl ?? rpc } as never) },
      refreshAfterSeconds: Number(env.REFRESH_AFTER_SECONDS ?? 21_600),
      ...(declaredSigner ? { declaredSigner } : {}),
      ...(anchor ? { anchor } : {}),
    },
  );
  return {
    estate: estate.id, estateId: run.estateId, anchored: run.decision.anchor, sequence: run.decision.sequence, changed: run.decision.changed, why: run.decision.why,
    counts: run.counts, dropped: run.dropped.length, ...(run.txHash ? { txHash: run.txHash } : {}),
    vouchedFrom: record.from,
    ...(record.from === 'durable-object' ? { note2: `${estate.id} has no vault credentials on this deployment — vouched from the serving projection, which ADR-0055 says is not the record` } : {}),
    anchorsAs: anchor ? `${estate.id}'s registry agent, by key-service key ${anchor.account.address} under a wire it signed` : null,
    ...(anchor ? {} : { note: `no anchorKey in the register or no anchoring wire for ${estate.id} on this deployment — reported what it would do, wrote nothing` }),
    ...(run.warnings.length ? { warnings: run.warnings } : {}),
  };
}

/** AN ISSUER'S ROW, kept fresh the way an estate's is (spec 444): its live-credential submissions read from ITS vault
 *  (`VAULT_CREDENTIALS_ISSUER_<ID>`), the row rebuilt, anchored when it changed or aged past the refresh window, by the
 *  rowSigner's key-service key (the register's `anchorKey`) under the wire held per issuer (`ISSUER_ANCHORING_WIRES`). Without this a door refuses every member's status a day after
 *  the operator last ran the CLI. No credentials or no key here ⇒ said, and nothing is written. */
async function projectIssuerOne(env: Env, issuer: IssuerRow, f: Register): Promise<Record<string, unknown>> {
  const raw = env[`VAULT_CREDENTIALS_ISSUER_${issuer.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}` as `VAULT_CREDENTIALS_${string}`];
  if (!raw) return { issuer: issuer.id, note: `no vault credentials for issuer ${issuer.id} on this deployment — nothing projected` };
  const rows = await loadSubmissions(await vaultCredentialsFrom(raw, issuer.id, env as never));
  // KEYED BY ISSUER, never by estate: an issuer row is anchored under the rowSigner's wire held under THIS issuer's id,
  // so this job can never re-anchor the estate's own row from what the issuer's vault holds (2026-10-16: impact-agent's
  // vault held 0 rows, its file 3).
  const anchor = await anchorFor(env, issuer, JSON.parse(env.ISSUER_ANCHORING_WIRES ?? '{}') as Record<string, AnchoringWireV1>);
  const registry = registryClient({ rpcUrl: env.FEDERATION_RPC_URL!, chainId: f.registry.chainId, address: f.registry.address as `0x${string}` });
  const issuerId = await registry.estateIdOf(issuer.chainId, issuer.sa);
  const run = await projectIssuer({ ...issuer, issuerId }, {
    registry, ledger: readOnlyLedger(rows), refreshAfterSeconds: Number(env.REFRESH_AFTER_SECONDS ?? 21_600),
    ...(anchor ? { anchor } : {}),
  });
  return {
    issuer: issuer.id, issuerId, anchored: run.decision.anchor, sequence: run.decision.sequence, why: run.decision.why, counts: run.counts,
    vouchedFrom: 'vault', ...(run.txHash ? { txHash: run.txHash } : {}),
    ...(anchor ? {} : { note: `no anchorKey in the register or no ISSUER_ANCHORING_WIRES entry for ${issuer.id} on this deployment — reported what it would do, wrote nothing` }),
  };
}

async function runAll(env: Env): Promise<Record<string, unknown>[]> {
  const f = register();
  const out: Record<string, unknown>[] = [];
  for (const e of projectable(f)) {
    try { out.push(await projectOne(env, e, f)); }
    // One estate's chain being unreachable must not stop another's anchor from being refreshed.
    catch (err) { out.push({ estate: e.id, error: err instanceof Error ? err.message : String(err) }); }
  }
  for (const i of vaultIssuers(f)) {
    try { out.push(await projectIssuerOne(env, i, f)); }
    catch (err) { out.push({ issuer: i.id, error: err instanceof Error ? err.message : String(err) }); }
  }
  return out;
}

export default {
  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.FEDERATION_RPC_URL) return;
    ctx.waitUntil(runAll(env).then((r) => console.log(`[projector] ${JSON.stringify(r)}`)));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const f = register();
    const ops = () => !!env.OPS_TOKEN && req.headers.get('authorization') === `Bearer ${env.OPS_TOKEN}`;

    if (req.method === 'GET' && (p === '/' || p === '/status')) {
      if (!env.FEDERATION_RPC_URL) return json({ ok: false, error: 'this deployment has no RPC' }, 503);
      const registry = registryClient({ rpcUrl: env.FEDERATION_RPC_URL, chainId: f.registry.chainId, address: f.registry.address as `0x${string}` });
      const now = Math.floor(Date.now() / 1000);
      const estates = await Promise.all(projectable(f).map(async (e) => {
        const estateId = await registry.estateIdOf(e.chainId, e.governance as `0x${string}`);
        const r = await registry.roots(estateId);
        const rows = await store(env).rows(e.id);
        return {
          estate: e.id, estateId, sequence: r.sequence, anchoredAt: r.never ? null : new Date(r.anchoredAt * 1000).toISOString(),
          ageSeconds: r.never ? null : now - r.anchoredAt,
          live: rows.filter((x) => !x.retired).length, ever: rows.length,
          // Where this estate's submissions actually live. `/status` reads the projection either way and says which
          // one is the record, so a reader is never left thinking a DO row is the estate's own copy.
          recordIn: vaultSecretOf(env, e.id) ? 'the registry agent vault' : 'the durable object (no vault credentials here)',
          // The number a reader actually needs: how long until a verifier with a 24-hour window refuses every
          // presentation against this estate. Said, not implied.
          staleInSeconds: r.never ? null : 86_400 - (now - r.anchoredAt),
        };
      }));
      return json({ ok: true, service: 'ap-federation-projector', refreshAfterSeconds: Number(env.REFRESH_AFTER_SECONDS ?? 21_600), estates, says: 'what is anchored and how old it is. A leaf enters only by a submission someone made; the estate\'s copy of it lives in its registry agent\'s vault and the durable object is the projection.' });
    }

    // ONE-WAY MIGRATION, run once per estate before anything rebuilds from the vault. The rows were minted in the
    // Durable Object and the vault has never seen them, so a rebuild that read the vault first would mirror an empty
    // record over the live projection and anchor a tree with nothing in it. This copies DO → vault; after it, the
    // vault is the record and `/mirror` runs the other way for good. Idempotent: a record key is `<set>:<digest>`,
    // so re-running rewrites the same rows rather than duplicating them.
    if (req.method === 'POST' && p === '/ops/backfill-vault') {
      if (!ops()) return json({ error: 'unauthorized' }, 401);
      const body = (await req.json().catch(() => null)) as { estate?: string } | null;
      if (!body?.estate) return json({ error: 'estate is required' }, 400);
      const c = await vaultFor(env, body.estate);
      if (!c) return json({ error: `no vault credentials for ${body.estate} on this deployment` }, 400);
      const rows = await store(env).rows(body.estate);
      const landed: string[] = []; const refused: Array<{ digest: string; error: string }> = [];
      for (const row of rows) {
        try { await writeSubmission(c, row); landed.push(`${row.set}:${row.digest}`); }
        catch (e) { refused.push({ digest: row.digest, error: e instanceof Error ? e.message : String(e) }); }
      }
      return json({ estate: body.estate, into: `${c.agentName}'s vault`, rows: rows.length, landed: landed.length, keys: landed, ...(refused.length ? { refused } : {}) }, refused.length ? 502 : 200);
    }
    if (req.method === 'POST' && p === '/ops/project') {
      if (!ops()) return json({ error: 'unauthorized' }, 401);
      return json({ runs: await runAll(env) });
    }
    if (req.method === 'POST' && (p === '/ops/submit' || p === '/ops/retire')) {
      if (!ops()) return json({ error: 'unauthorized' }, 401);
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body?.estate || !body.set || !body.digest) return json({ error: 'estate, set and digest are required' }, 400);
      const estate = String(body.estate);
      // THE VAULT FIRST, and nothing mirrored if it refuses. The other order would leave a leaf the projection
      // vouches for and the estate's own record has never heard of — which is the whole failure ADR-0055 names.
      const r = await store(env).call(p === '/ops/submit' ? '/add' : '/retire', { ...body, ...(p === '/ops/retire' ? { at: new Date().toISOString() } : { submittedAt: new Date().toISOString() }) });
      const out = (await r.json()) as { added?: boolean; row?: SubmissionV1; retired?: boolean };
      const c = await vaultFor(env, estate);
      if (!c) return json({ ...out, recordIn: 'the durable object', warning: `${estate} has no vault credentials on this deployment, so this submission has no record outside the projection (ADR-0055)` }, r.status);
      // The DO minted the row (and its blind) — now the vault keeps it. A retirement rewrites the same record.
      const rows = await store(env).rows(estate);
      const row = out.row ?? rows.find((x) => x.set === body.set && x.digest.toLowerCase() === String(body.digest).toLowerCase());
      if (!row) return json({ ...out, recordIn: 'nothing written: the projection has no such row to record' }, r.status);
      try { await writeSubmission(c, row); } catch (e) {
        return json({ ...out, error: e instanceof Error ? e.message : String(e), recordIn: 'REFUSED — the projection has the row and the vault does not; re-run this submission' }, 502);
      }
      return json({ ...out, recordIn: `${c.agentName}'s vault`, recordType: `federation.projection-submission:${body.set}:${String(body.digest).toLowerCase()}` }, r.status);
    }
    return json({ error: 'not_found' }, 404);
  },
};
