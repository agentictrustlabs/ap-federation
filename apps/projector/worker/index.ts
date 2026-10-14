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
// WHAT IT IS NOT: the estate's `.registry` service agent with the key in a vault (spec 439 §4). The signer key is a
// Worker secret here. That is better than an operator's laptop and is not the destination; `DEPLOYER.md` says so.
import { parse as parseYaml } from 'yaml';
import type { Hex } from 'viem';
import { registryClient, readDeclaredSigner } from '../src/anchor.js';
import { projectEstate } from '../src/project.js';
import { isRevokedReader } from '../src/revocation.js';
import type { SubmissionLedger, SubmissionV1 } from '../src/ledger.js';
import federationYaml from '../../../federation.yaml';
export { SubmissionStoreDO } from './store-do.js';

interface Env {
  STORE: DurableObjectNamespace;
  FEDERATION_RPC_URL?: string;
  /** `{"imbnet":"0x…","faithnet":"0x…"}` — one anchoring key per estate this deployment projects. */
  PROJECTION_SIGNER_KEYS?: string;
  /** Guards the ops routes (submit / retire / project-now). A read of `/status` needs none. */
  OPS_TOKEN?: string;
  REFRESH_AFTER_SECONDS?: string;
}

interface EstateRow { id: string; chainId: number; governance: string | null; signer?: string; delegationManager?: string; profileResolver?: string; rpcUrl?: string; blocked?: string }
interface Register { registry: { chainId: number; address: string }; estates: EstateRow[] }
const register = (): Register => parseYaml(federationYaml) as Register;
const projectable = (f: Register): EstateRow[] => f.estates.filter((e) => e.governance && !e.blocked);

const json = (b: unknown, status = 200, maxAge = 10) =>
  new Response(JSON.stringify(b, null, 2), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${maxAge}`, 'access-control-allow-origin': '*' } });

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

/** The ledger a projection run reads. READ-ONLY on purpose: a scheduled job vouches for nothing on its own — adding a
 *  leaf is a submission someone made, and this job is not someone. */
function readOnlyLedger(rows: SubmissionV1[]): SubmissionLedger {
  const refuse = (what: string) => { throw new Error(`the scheduled projector does not ${what}: inclusion is a submission, and a job is not a submitter (spec 439 §7.1a)`); };
  return { list: () => rows, add: () => refuse('add a leaf') as never, retire: () => refuse('retire a leaf') as never };
}

async function projectOne(env: Env, estate: EstateRow, f: Register): Promise<Record<string, unknown>> {
  const keys = JSON.parse(env.PROJECTION_SIGNER_KEYS ?? '{}') as Record<string, string>;
  const signerKey = keys[estate.id];
  const rpc = env.FEDERATION_RPC_URL!;
  const registry = registryClient({ rpcUrl: rpc, chainId: f.registry.chainId, address: f.registry.address as `0x${string}` });
  const rows = await store(env).rows(estate.id);
  const declaredSigner = await readDeclaredSigner({ rpcUrl: rpc, chainId: estate.chainId, governance: estate.governance as `0x${string}`, profileResolver: (estate.profileResolver ?? '0xB03F7C06ad3274F584AB72794406D639c02A45e1') as `0x${string}` }).catch(() => undefined);
  const run = await projectEstate(
    { ...estate, governance: estate.governance as `0x${string}`, estateId: await registry.estateIdOf(estate.chainId, estate.governance as `0x${string}`) } as never,
    {
      registry, ledger: readOnlyLedger(rows),
      liveness: { isRevoked: await isRevokedReader({ ...estate, rpcUrl: estate.rpcUrl ?? rpc } as never) },
      refreshAfterSeconds: Number(env.REFRESH_AFTER_SECONDS ?? 21_600),
      ...(declaredSigner ? { declaredSigner } : {}),
      ...(signerKey ? { signerKey: signerKey as Hex } : {}),
    },
  );
  return {
    estate: estate.id, estateId: run.estateId, anchored: run.decision.anchor, sequence: run.decision.sequence, changed: run.decision.changed, why: run.decision.why,
    counts: run.counts, dropped: run.dropped.length, ...(run.txHash ? { txHash: run.txHash } : {}),
    ...(signerKey ? {} : { note: 'no signer key for this estate on this deployment — reported what it would do, wrote nothing' }),
    ...(run.warnings.length ? { warnings: run.warnings } : {}),
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
          // The number a reader actually needs: how long until a verifier with a 24-hour window refuses every
          // presentation against this estate. Said, not implied.
          staleInSeconds: r.never ? null : 86_400 - (now - r.anchoredAt),
        };
      }));
      return json({ ok: true, service: 'ap-federation-projector', refreshAfterSeconds: Number(env.REFRESH_AFTER_SECONDS ?? 21_600), estates, says: 'what is anchored and how old it is. It holds the anchoring keys and no vault; a leaf enters only by a submission someone made.' });
    }

    if (req.method === 'POST' && p === '/ops/project') {
      if (!ops()) return json({ error: 'unauthorized' }, 401);
      return json({ runs: await runAll(env) });
    }
    if (req.method === 'POST' && (p === '/ops/submit' || p === '/ops/retire')) {
      if (!ops()) return json({ error: 'unauthorized' }, 401);
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body?.estate || !body.set || !body.digest) return json({ error: 'estate, set and digest are required' }, 400);
      const r = await store(env).call(p === '/ops/submit' ? '/add' : '/retire', { ...body, ...(p === '/ops/retire' ? { at: new Date().toISOString() } : { submittedAt: new Date().toISOString() }) });
      return json(await r.json(), r.status);
    }
    return json({ error: 'not_found' }, 404);
  },
};
