// The federation's site (spec 440 §B) — ap-federation.faithnet.io.
//
// PUBLIC, READ-ONLY, KEYLESS. It answers from the register (federation.yaml, bundled as text) and from the towns'
// own public surfaces, fetched live: the town agent's API, the naming read API, the KMS operator's health. It holds
// no copy of any town's manifest and no record of anyone. It lists; it never grants (ADR-0056: resolution is never
// authority). One mechanism per read (ADR-0013): a surface that cannot be reached is reported as unreachable with
// its reason, never replaced by a cached or inferred answer.
//
//   GET /                      the page (Towns · KMS · Names · Neutral ground)
//   GET /api/federation        the register, as published
//   GET /api/towns             every town with live probes
//   GET /api/kms               the operator record, tenants, the four conditions, a live probe
//   GET /api/names?q=          the universal resolver (wave 1: over every live town's naming read API)
//   GET /api/names/<name>      one name across every live town
import federationYaml from '../../../federation.yaml';
import { parseFederation, validateFederation, type Federation, type FederationTown } from './federation';
import { looksLikeName, mergeTownRows, toNameRow, type NameRow, type TownNameResult, type TownSearchRow } from './resolver';
import { page } from './html';

interface Env { PUBLIC_ORIGIN?: string }

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS' };
const json = (body: unknown, status = 200, maxAge = 15): Response =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${maxAge}` } });

let cached: { fed: Federation; errors: string[] } | null = null;
function register(): { fed: Federation; errors: string[] } {
  if (!cached) {
    const fed = parseFederation(federationYaml);
    cached = { fed, errors: validateFederation(fed) };
  }
  return cached;
}

export interface Probe { url: string; ok: boolean; status: number | null; ms: number; body?: unknown; error?: string }

/** One GET, one timeout, the answer or the reason. Never a second mechanism. */
export async function probe(url: string, timeoutMs = 8000): Promise<Probe> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* not JSON: keep the text */ }
    return { url, ok: r.ok, status: r.status, ms: Date.now() - t0, body: typeof body === 'string' ? body.slice(0, 2000) : body };
  } catch (e) {
    return { url, ok: false, status: null, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  }
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

async function townView(t: FederationTown) {
  if (t.status === 'retired') return { ...t, probed: false, reason: 'retired: not probed' };
  const [health, town, naming, services] = await Promise.all([
    t.agent ? probe(`${t.agent}/api/health`) : null,
    t.agent ? probe(`${t.agent}/api/town`) : null,
    t.naming ? probe(`${t.naming}/api/town`) : null,
    // The town agent probes every service live before answering; give it longer than the rest.
    t.agent ? probe(`${t.agent}/api/services`, 25_000) : null,
  ]);
  const townBody = obj(town?.body);
  const namingBody = obj(naming?.body);
  const svc = Array.isArray(services?.body) ? (services!.body as Record<string, unknown>[]) : [];
  return {
    ...t,
    probed: true,
    agentHealth: health ? { ok: health.ok, status: health.status, ms: health.ms, error: health.error } : null,
    declaredStatus: townBody?.status ?? null,
    chain: townBody?.chain ?? null,
    estates: Array.isArray(townBody?.estates) ? townBody!.estates : [],
    services: svc.map((s) => ({ id: s.id, kind: s.kind, hosts: s.hosts, agentName: s.agentName, estates: s.estates, signals: s.signals, description: s.description })),
    servicesError: services && !services.ok ? (services.error ?? `HTTP ${services.status}`) : undefined,
    names: namingBody
      ? { ok: naming!.ok, block: namingBody.block ?? null, roots: Array.isArray(namingBody.roots) ? (namingBody.roots as Record<string, unknown>[]).map((r) => ({ tld: r.tld, kind: r.kind, count: r.count, priced: r.priced, estates: r.estates })) : [], fees: namingBody.fees ?? null }
      : { ok: false, error: naming?.error ?? (naming ? `HTTP ${naming.status}` : 'no naming service declared') },
  };
}

async function namesSearch(fed: Federation, q: string): Promise<{ q: string; kind: 'label' | 'name'; rootChain: number; towns: TownNameResult[]; rows: NameRow[]; rule: string }> {
  const live = fed.towns.filter((t) => t.naming && t.status !== 'retired');
  const kind = looksLikeName(q) ? 'name' : 'label';
  const towns = await Promise.all(live.map(async (t): Promise<TownNameResult> => {
    const r = await probe(`${t.naming}/api/search?q=${encodeURIComponent(q)}`);
    const body = obj(r.body);
    const rows = Array.isArray(body?.rows) ? (body!.rows as TownSearchRow[]) : [];
    return {
      town: t.id,
      chainId: t.chainId,
      ok: r.ok,
      block: typeof body?.block === 'number' ? (body.block as number) : null,
      error: r.ok ? undefined : (r.error ?? `HTTP ${r.status}`),
      rows: rows.map((row) => toNameRow(row, t, fed.naming.rootChain)),
    };
  }));
  return { q, kind, rootChain: fed.naming.rootChain, towns, rows: mergeTownRows(towns), rule: 'a name outside its home town is never shown bare; the site is in no town, so every row carries its town and chain (naming doc N4)' };
}

async function nameAcross(fed: Federation, name: string) {
  const live = fed.towns.filter((t) => t.naming && t.status !== 'retired');
  const towns = await Promise.all(live.map(async (t) => {
    const r = await probe(`${t.naming}/api/name/${encodeURIComponent(name)}`);
    const b = obj(r.body);
    const row = b ? toNameRow({ name: String(b.name ?? name), kind: (b.kind as string) ?? null, status: (b.status as string) ?? 'unknown', agent: (b.agent as string) ?? null }, t, fed.naming.rootChain) : null;
    return {
      town: t.id, chainId: t.chainId, ok: r.ok, block: b?.block ?? null, error: r.ok ? undefined : (r.error ?? `HTTP ${r.status}`),
      row,
      detail: b ? { displayName: b.displayName ?? null, owner: b.owner ?? null, presented: b.presented ?? null, presentsThis: b.presentsThis ?? null, declared: b.declared ?? null, signals: b.signals ?? null, records: b.records ?? null, issuedBy: b.estate ?? b.by ?? null } : null,
    };
  }));
  return { name, rootChain: fed.naming.rootChain, towns, home: towns.find((t) => t.row?.status === 'registered')?.town ?? null };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    const { fed, errors } = register();
    const p = url.pathname.replace(/\/+$/, '') || '/';

    if (p === '/api/federation') return json({ ...fed, registerErrors: errors, generatedBy: 'ap-federation apps/site', readOnly: true }, 200, 60);
    if (p === '/api/towns') return json({ towns: await Promise.all(fed.towns.map(townView)), at: new Date().toISOString() }, 200, 15);
    if (p === '/api/kms') {
      const k = fed.kms;
      const [health, attestation] = await Promise.all([probe(k.probe), k.attestation ? probe(k.attestation) : null]);
      return json({ ...k, probeResult: { ok: health.ok, status: health.status, ms: health.ms, body: health.body, error: health.error }, attestationResult: attestation ? { ok: attestation.ok, status: attestation.status } : { ok: false, error: 'not published yet (spec 440 A5 step 4)' }, holds: 'no key, token, seed or caller credential appears here; the operator\'s record on the CVM is authoritative' }, 200, 15);
    }
    if (p === '/api/names') {
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      if (!q) return json({ error: 'q_required', hint: 'a label (alice) or a name (alice.me, vault.svc@richcanvas.org)' }, 400);
      if (q.length > 128) return json({ error: 'q_too_long' }, 400);
      return json(await namesSearch(fed, q), 200, 15);
    }
    if (p.startsWith('/api/names/')) {
      const name = decodeURIComponent(p.slice('/api/names/'.length)).trim().toLowerCase();
      if (!looksLikeName(name)) return json({ error: 'not_a_name', name }, 400);
      return json(await nameAcross(fed, name), 200, 15);
    }
    if (p === '/api/doors') {
      const doors = await Promise.all(fed.doors.map(async (d) => {
        const [health, receipts] = await Promise.all([probe(`${d.url}/health`), probe(`${d.url}/federation/receipts`)]);
        const rb = obj(receipts.body);
        return { ...d, health: { ok: health.ok, status: health.status, ms: health.ms, configured: obj(health.body)?.configured ?? null, boundaryId: obj(health.body)?.boundaryId ?? null }, receipts: Array.isArray(rb?.receipts) ? (rb!.receipts as Record<string, unknown>[]).slice(0, 25) : [], receiptsError: receipts.ok ? undefined : (receipts.error ?? `HTTP ${receipts.status}`) };
      }));
      return json({ doors, at: new Date().toISOString() }, 200, 10);
    }
    if (p === '/api/health') return json({ ok: true, service: 'ap-federation-site', federation: fed.federation, towns: fed.towns.length, registerErrors: errors.length }, 200, 5);
    if (p.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    return new Response(page(fed, errors, env.PUBLIC_ORIGIN ?? url.origin), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' } });
  },
};
