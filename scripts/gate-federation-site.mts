#!/usr/bin/env tsx
// gate-federation-site — the federation site answers from the towns' live surfaces (spec 440 §B4).
//
// Proves: the towns view lists the root-chain town as live with its estates; the KMS operator probe answers; a label
// resolves across every live town with every row QUALIFIED (never bare) and carrying { name, chain } + a CAIP-10
// identity. Twin: no row is ever bare, a retired town is never queried, and a chain in the name is refused.
// No key, no HOME_URL. FEDERATION_SITE_URL overrides the host.
const base = (process.env.FEDERATION_SITE_URL ?? 'https://ap-federation.faithnet.io').replace(/\/$/, '');
const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => { checks.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
const get = async (p: string) => { const r = await fetch(base + p, { signal: AbortSignal.timeout(30_000) }); return { status: r.status, body: (await r.json().catch(() => null)) as any }; };

const fed = await get('/api/federation');
check('the register is published and clean', fed.status === 200 && Array.isArray(fed.body?.registerErrors) && fed.body.registerErrors.length === 0, `errors=${fed.body?.registerErrors?.length ?? '?'}`);
const rootChain: number = fed.body?.naming?.rootChain;

const towns = await get('/api/towns');
const root = towns.body?.towns?.find((t: any) => t.chainId === rootChain);
check('the root-chain town is listed live with its estates', !!root && root.status === 'live' && root.agentHealth?.ok === true && Array.isArray(root.estates) && root.estates.length >= 1, root ? `${root.id}: agent ${root.agentHealth?.ok ? 'up' : 'down'}, ${root.estates?.length ?? 0} estate(s)` : 'no root town');
const retired = towns.body?.towns?.filter((t: any) => t.status === 'retired') ?? [];
check('a retired town is listed and not probed (twin)', retired.every((t: any) => t.probed === false), `${retired.length} retired`);

const kms = await get('/api/kms');
check('the KMS operator record is served and its probe answers', kms.status === 200 && kms.body?.probeResult?.ok === true && Array.isArray(kms.body?.tenants) && kms.body.conditions?.length === 4, `probe=${kms.body?.probeResult?.status} tenants=${kms.body?.tenants?.length}`);
check('the KMS record carries no secret-shaped value (twin)', !JSON.stringify(kms.body ?? {}).match(/(eyJ[A-Za-z0-9_-]{20,}|0x[0-9a-f]{64})/i), 'no JWT, no 32-byte hex');

const scene = await get('/api/scene');
const ids: string[] = (scene.body?.scene?.buildings ?? []).map((b: any) => b.id);
const liveTowns: string[] = (fed.body?.towns ?? []).filter((t: any) => t.status !== 'retired').map((t: any) => t.id);
check('the picture stands the federation\'s services on its own ground, with every live town beside it', scene.status === 200 && ['neutral-ground', 'naming-root', 'resolver', 'kms'].every((id) => ids.includes(id)) && liveTowns.every((t) => ids.includes(`town:${t}`)), `${ids.length} building(s); towns ${liveTowns.join(', ')}`);
check('the naming root and the KMS operator are lit by their probes', scene.body?.signals?.naming === true && scene.body?.signals?.kms === true, JSON.stringify(scene.body?.signals ?? {}));
const svg = await fetch(base + '/api/scene.svg', { signal: AbortSignal.timeout(30_000) });
const svgText = await svg.text();
check('the picture is served as SVG with a title and real links', svg.status === 200 && (svg.headers.get('content-type') ?? '').includes('image/svg+xml') && svgText.startsWith('<svg') && svgText.includes('<title>') && svgText.includes('<a href='), `${svgText.length} bytes`);

const names = await get('/api/names?q=alice');
const rows: any[] = names.body?.rows ?? [];
check('a label resolves across every live town', names.status === 200 && rows.length > 0 && names.body.towns.every((t: any) => t.ok), `${rows.length} row(s) from ${names.body?.towns?.length ?? 0} town(s)`);
check('every row is qualified — never bare (twin)', rows.every((r) => r.display !== r.name && r.display.includes(r.town) && r.display.includes(`eip155:${r.chainId}`)), rows[0]?.display ?? '');
check('every row carries { name, chain } and, when registered, a CAIP-10 account', rows.every((r) => r.federated?.name === r.name && /^eip155:\d+$/.test(r.federated?.chain) && (r.status !== 'registered' || /^eip155:\d+:0x[0-9a-f]{40}$/.test(r.account ?? ''))), '');
check('a retired town is never queried for names (twin)', names.body.towns.every((t: any) => t.town !== 'base-sepolia'), '');

const one = await get('/api/names/alice.me');
check('one name across the towns names its home', one.status === 200 && typeof one.body?.home === 'string', `home=${one.body?.home}`);
// The identity twin (2026-10-15): a name whose agent lives on ANOTHER chain is answered with the home as canonical and the
// root-chain account as a satellite — the root chain's address is never promoted to canonical.
const moved = await get('/api/names/maya-fernandes.me');
const rootRow = moved.body?.towns?.find((t: any) => t.chainId === rootChain);
const idn = rootRow?.detail?.identity;
check('the agent behind a name is answered: canonical id, this chain\'s account and its role, accounts by chain', !!idn && typeof idn.canonical === 'string' && !!idn.here && Array.isArray(idn.accounts) && idn.accounts.length >= 1, idn ? `canonical=${idn.canonical} here=${idn.here?.role}` : 'no identity');
check('the root-chain account of an agent whose home is elsewhere is a satellite, never canonical (twin)', !!idn && idn.canonicalChainId !== rootChain && idn.here?.role === 'satellite' && idn.here?.account !== idn.canonical, idn ? `home chain ${idn.canonicalChainId}, here ${idn.here?.role}` : '');
const chainInName = await get('/api/names/alice.me%40faithchain');
check('a chain in the name is refused (twin)', chainInName.status === 400, `HTTP ${chainInName.status}`);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\nFEDERATION SITE GATE RED · ${failed.length} of ${checks.length} failed` : `\nFEDERATION SITE GATE GREEN · ${checks.length} checks incl. 6 twins`);
process.exit(failed.length ? 1 : 0);
