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

const names = await get('/api/names?q=alice');
const rows: any[] = names.body?.rows ?? [];
check('a label resolves across every live town', names.status === 200 && rows.length > 0 && names.body.towns.every((t: any) => t.ok), `${rows.length} row(s) from ${names.body?.towns?.length ?? 0} town(s)`);
check('every row is qualified — never bare (twin)', rows.every((r) => r.display !== r.name && r.display.includes(r.town) && r.display.includes(`eip155:${r.chainId}`)), rows[0]?.display ?? '');
check('every row carries { name, chain } and, when registered, a CAIP-10 identity', rows.every((r) => r.federated?.name === r.name && /^eip155:\d+$/.test(r.federated?.chain) && (r.status !== 'registered' || /^eip155:\d+:0x[0-9a-f]{40}$/.test(r.identity ?? ''))), '');
check('a retired town is never queried for names (twin)', names.body.towns.every((t: any) => t.town !== 'base-sepolia'), '');

const one = await get('/api/names/alice.me');
check('one name across the towns names its home', one.status === 200 && typeof one.body?.home === 'string', `home=${one.body?.home}`);
const chainInName = await get('/api/names/alice.me%40faithchain');
check('a chain in the name is refused (twin)', chainInName.status === 400, `HTTP ${chainInName.status}`);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\nFEDERATION SITE GATE RED · ${failed.length} of ${checks.length} failed` : `\nFEDERATION SITE GATE GREEN · ${checks.length} checks incl. 5 twins`);
process.exit(failed.length ? 1 : 0);
