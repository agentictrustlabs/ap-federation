// The page: five views over the site's own API. Vanilla, no build step, no framework — the Worker is the site.
// Every name printed here is qualified (the never-bare rule); every signal is named; nothing is a score.
// The script is plain functions, one per view, so a bug in one view cannot take the others down.
import type { Federation } from './federation';
import { SCENE_CSS } from './scene';

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export function page(fed: Federation, errors: string[], origin: string): string {
  const live = fed.towns.filter((t) => t.status === 'live').length;
  const projecting = fed.estates.filter((e) => e.governance).length;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ap-federation</title>
<meta name="description" content="The towns of the Agentic Primitives federation, the shared KMS operator record, the universal name resolver, the receiving doors and neutral ground. Public, read-only. It lists; it never grants.">
<style>
:root{--bg:#0e1116;--card:#171b22;--line:#2a313c;--fg:#e6e9ef;--mute:#9aa4b2;--ok:#3fb950;--warn:#d29922;--bad:#f85149;--acc:#7aa2f7}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;overflow-x:hidden}
header{padding:16px 20px;border-bottom:1px solid var(--line);display:flex;gap:10px 18px;align-items:baseline;flex-wrap:wrap}
header h1{margin:0;font-size:20px}header .sub{color:var(--mute);font-size:14px}
nav{display:flex;gap:6px;padding:10px 20px;border-bottom:1px solid var(--line);flex-wrap:wrap;position:sticky;top:0;background:var(--bg);z-index:2}
nav button{background:none;border:1px solid var(--line);color:var(--fg);padding:6px 12px;border-radius:6px;cursor:pointer;font:inherit}
nav button.on{border-color:var(--acc);color:var(--acc)}
main{padding:16px 20px 32px;max-width:1200px;margin:0 auto}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin:12px 0;min-width:0}
.row{display:flex;gap:8px 14px;flex-wrap:wrap;align-items:center}
.k{color:var(--mute)}.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;overflow-wrap:anywhere}
.host{white-space:nowrap}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:8px 0}
table{border-collapse:collapse;width:100%;min-width:560px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mute);font-weight:500;white-space:nowrap}
input{background:var(--bg);border:1px solid var(--line);color:var(--fg);padding:8px 10px;border-radius:6px;width:min(420px,100%);font:inherit}
button.go{background:var(--acc);color:#0e1116;border:0;padding:8px 14px;border-radius:6px;cursor:pointer;font:inherit;font-weight:600}
button.more{background:none;border:1px solid var(--line);color:var(--acc);padding:4px 10px;border-radius:6px;cursor:pointer;font:inherit;font-size:13px}
.pill{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:1px 8px;font-size:12px;color:var(--mute);margin-right:4px;white-space:nowrap}
.note{color:var(--mute);font-size:13px}.lead{color:var(--mute);margin:0 0 6px}
.intro{border-left:3px solid var(--acc);padding:6px 12px;margin:4px 0 14px;color:var(--mute);font-size:14px}
.stat{display:inline-block;margin-right:14px}.stat b{color:var(--fg)}
.empty{color:var(--mute);padding:8px 0}
h3{margin:14px 0 6px;font-size:14px;color:var(--mute);font-weight:500;text-transform:uppercase;letter-spacing:.04em}
footer{padding:16px 20px;color:var(--mute);font-size:13px;border-top:1px solid var(--line)}
a{color:var(--acc)}
@media (max-width:640px){header{padding:12px 16px}nav,main{padding-left:16px;padding-right:16px}table{min-width:520px}}
#scene{padding:6px}#scene svg{min-height:200px}
${SCENE_CSS}
</style></head><body>
<header><h1>ap-federation</h1><span class="sub">${esc(fed.federation)} · ${fed.towns.length} town${fed.towns.length === 1 ? '' : 's'} (${live} live) · ${projecting} estate${projecting === 1 ? '' : 's'} on neutral ground · root chain eip155:${fed.naming.rootChain}</span>
<span class="sub">public · read-only · it lists, it never grants</span></header>
<nav><button data-v="towns" class="on">Towns</button><button data-v="ground">Neutral ground</button><button data-v="doors">Doors</button><button data-v="credentials">Credentials</button><button data-v="names">Names</button><button data-v="kms">KMS</button></nav>
<main>
<div class="intro">The federation's estates, each in its town, joined on <b>neutral ground</b>: each publishes a commitment to the grants it vouches for; a visiting agent proves one leaf at the other's <b>door</b>; the door admits on evidence and the estate's own mandate decides what runs. <a href="https://github.com/agentictrustlabs/ap-federation/blob/master/docs/architecture/primer.md">Read the primer</a> · <a href="https://github.com/agentictrustlabs/ap-federation/blob/master/docs/architecture/how-it-works.md">how one crossing works</a>.</div>
${errors.length ? `<div class="card bad"><b>The register has ${errors.length} problem(s)</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
<section id="towns"><div id="scene" class="card" aria-live="polite">drawing the federation…</div><p class="note" style="margin:-4px 0 12px">What the federation runs and the towns host — neutral ground, the naming root and resolver, the shared KMS operator, the doors — and each town beside it. Lit windows answered their probe just now; a building is a link. Nothing drawn is a permission.</p><p class="lead">Every town we have, read live from each town's own surfaces: its town agent, its naming service, its services' probes. A town is one chain and the estates on it.</p><div id="towns-body" class="card">loading…</div></section>
<section id="ground" hidden><p class="lead">The registry no estate controls, and the estates that project their live sets onto it. A root is a commitment; the leaves stay the estate's record. <b>Neutral</b> is a property of the contract (no admin, no pause, no upgrade), not of the chain.</p><div id="ground-body" class="card"></div></section>
<section id="doors" hidden><p class="lead">The receiving doors: where a visiting agent's presentation reaches an admission receipt. Each decision was taken on a root read from neutral ground at that moment. A door admits on evidence; it never decides what the agent may do.</p><div id="doors-body" class="card">loading…</div></section>
<section id="credentials" hidden><p class="lead">The predicate grade (spec 443 W5): a visitor proves, in zero knowledge, that a credential she holds satisfies what a door asks — bound to that door's challenge, under an issuer the door resolves through the chain, one visit per audience, with the issuer's live status read from neutral ground. The door learns that a predicate held. It learns no claim, no name, no address of hers.</p><div id="credentials-body" class="card">loading…</div></section>
<section id="names" hidden><p class="lead">The universal resolver: one namespace rooted on the root chain, answered across every live town. A name outside its home town is never shown bare. Resolution is never authority.</p>
<div class="card"><form id="nf" class="row"><input id="nq" placeholder="a label or a name — try alice, alice.me, vault.svc@richcanvas.org" autocomplete="off"><button class="go">Resolve</button></form><div id="names-body" class="empty">Type a label to see it across every live town.</div></div></section>
<section id="kms" hidden><p class="lead">The shared KMS operator: one operator of record, one tenant per estate, never a shared seed. Keys are delegates under wires custodians hold. Nothing here is a key, a token or a seed.</p><div id="kms-body" class="card">loading…</div></section>
</main>
<footer>Spec 439 · 440 · reads <code>federation.yaml</code> and each town's public API · <a href="/api/federation">/api/federation</a> · <a href="/api/towns">/api/towns</a> · <a href="/api/scene.svg">/api/scene.svg</a> · <a href="/api/doors">/api/doors</a> · <a href="/api/credentials">/api/credentials</a> · <a href="/api/names?q=alice">/api/names?q=</a> · <a href="/api/kms">/api/kms</a> · ${esc(origin)}</footer>
<script>
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const st = (ok, txt) => '<span class="' + (ok === true ? 'ok' : ok === false ? 'bad' : 'warn') + '">' + esc(txt) + '</span>';
const short = (a) => (typeof a === 'string' && a.length > 14 ? a.slice(0, 8) + '…' + a.slice(-4) : esc(a));
const when = (iso) => { const d = new Date(iso); return isNaN(d) ? esc(iso) : d.toISOString().replace('T', ' ').slice(0, 19) + 'Z'; };
const tbl = (head, rows, hiddenRows) => '<div class="scroll"><table><thead><tr>' + head.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody>' + (hiddenRows && hiddenRows.length ? '<tbody class="more" hidden>' + hiddenRows.join('') + '</tbody>' : '') + '</table></div>';
const FED = ${JSON.stringify({ registry: fed.registry, estates: fed.estates, towns: fed.towns, naming: fed.naming, doors: fed.doors })};

// ── tabs (the hash remembers which) ──
function show(v) { document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x.dataset.v === v)); document.querySelectorAll('main section').forEach((s) => (s.hidden = s.id !== v)); history.replaceState(null, '', '#' + v); }
document.querySelectorAll('nav button').forEach((b) => (b.onclick = () => show(b.dataset.v)));
const initial = location.hash.slice(1); if (['towns', 'ground', 'doors', 'credentials', 'names', 'kms'].includes(initial)) show(initial);

// ── neutral ground ──
function ground() {
  const r = FED.registry;
  const doorFor = (id) => (FED.doors || []).find((d) => d.estate === id);
  $('#ground-body').innerHTML = '<div><span class="k">EstateProjectionRegistry</span> <code>' + esc(r.address) + '</code> on ' + esc(r.chain) + ' (eip155:' + r.chainId + ') · deployed ' + esc(r.deployed || '') + '</div>'
    + tbl(['estate', 'chain', 'governance (the estate agent)', 'projection signer', 'declared on chain', 'state', 'door'], FED.estates.map((e) => {
      const d = doorFor(e.id);
      return '<tr><td><b>' + esc(e.id) + '</b></td><td>eip155:' + e.chainId + '</td><td class="mono">' + esc(e.governance || '—') + (e.governanceName ? '<br><span class="k">' + esc(e.governanceName) + '</span>' : '') + '</td><td class="mono">' + esc(e.signer || '—') + '</td><td>' + (e.governance ? st(e.declaredOnChain === true, e.declaredOnChain ? 'yes' : 'no — register only') : '—') + '</td><td>' + (e.blocked ? st(false, 'refused: ' + e.blocked) : st(true, 'projecting')) + '</td><td>' + (d ? '<a href="' + esc(d.url) + '/health">' + esc(new URL(d.url).host) + '</a>' : '—') + '</td></tr>';
    }))
    + '<div class="note">The register says what it believes; the projector and the doors read the chain and compare. "declared on chain" is the estate agent\\'s own <code>atl:projectionSigner</code>, which closes first-come-wins.</div>';
}
ground();

// ── the picture ──
fetch('/api/scene.svg').then((r) => r.text()).then((svg) => { $('#scene').innerHTML = svg; }).catch((e) => ($('#scene').innerHTML = '<span class="bad">the picture could not be drawn: ' + esc(e.message) + '</span>'));

// ── towns ──
async function towns() {
  const d = await (await fetch('/api/towns')).json();
  $('#towns-body').innerHTML = d.towns.map((t) => {
    const h = t.agentHealth;
    const head = '<div class="row"><b>' + esc(t.id) + '</b> <span class="pill">eip155:' + t.chainId + '</span> <span class="pill">' + esc(t.status) + '</span> ' + (t.probed ? '<span class="k">town agent</span> ' + st(h && h.ok, h && h.ok ? 'up ' + h.ms + 'ms' : (h && (h.error || 'HTTP ' + h.status)) || 'not declared') : '<span class="k">' + esc(t.reason) + '</span>') + (t.portal ? ' · <a href="' + esc(t.portal) + '">portal</a>' : '') + (t.naming ? ' · <a href="' + esc(t.naming) + '">names</a>' : '') + (t.manifest ? ' · <a href="' + esc(t.manifest) + '">manifest</a>' : '') + '</div>' + (t.note ? '<div class="note">' + esc(t.note) + '</div>' : '');
    if (!t.probed) return '<div class="card">' + head + '</div>';
    const estates = tbl(['estate', 'home', 'A2A door', 'agent zone', 'estate agent', 'name roots'], (t.estates || []).map((e) => '<tr><td><b>' + esc(e.id) + '</b></td><td><a href="' + esc(e.home) + '">' + esc(String(e.home || '').replace(/^https?:\\/\\//, '')) + '</a></td><td class="mono host">' + esc(String(e.a2a || '').replace(/^https?:\\/\\//, '')) + '</td><td>' + esc(e.agentZone || '—') + '</td><td class="mono">' + esc(e.estateName || '—') + '</td><td class="note">' + esc((e.nameRoots || []).map((x) => '.' + x).join(' ')) + '</td></tr>'));
    const svc = (t.services || []);
    const up = svc.filter((s) => s.signals && s.signals.healthy === 'up').length;
    const services = t.servicesError ? '<h3>services</h3><div class="warn">' + (String(t.servicesError).includes('401') ? 'the town shows its services to its own people — see the <a href="' + esc(t.portal || '#') + '">portal</a>' : 'the town agent\\'s service probes did not answer: ' + esc(t.servicesError)) + '</div>' : '<h3>services · ' + svc.length + ' declared, ' + up + ' up</h3>' + tbl(['id', 'kind', 'hosts', 'listed', 'healthy', 'serves'], svc.map((s) => '<tr><td>' + esc(s.id) + (s.agentName ? '<br><span class="k">' + esc(s.agentName) + '</span>' : '') + '</td><td>' + esc(s.kind) + '</td><td class="mono">' + esc((s.hosts || []).join(', ') || '—') + '</td><td>' + (s.signals ? st(!!s.signals.listed, s.signals.listed ? 'yes' : 'no') : '—') + '</td><td>' + (s.signals ? st(s.signals.healthy === 'up', s.signals.healthy || '?') : '—') + '</td><td class="note">' + esc((s.estates || []).join(', ') || 'every estate') + '</td></tr>'));
    const names = t.names && t.names.ok ? '<h3>names on this chain · block ' + esc(t.names.block) + '</h3><div class="row">' + (t.names.roots || []).map((r) => '<span class="pill">.' + esc(r.tld) + ' <b>' + esc(r.count) + '</b>' + (r.priced ? ' · priced' : '') + '</span>').join('') + '</div>' : '<div class="warn">naming service: ' + esc((t.names && t.names.error) || 'unreachable') + '</div>';
    return '<div class="card">' + head + '<h3>estates · ' + (t.estates || []).length + '</h3>' + estates + services + names + '</div>';
  }).join('') || '<div class="empty">no towns in the register</div>';
}
towns().catch((e) => ($('#towns-body').innerHTML = '<span class="bad">towns: ' + esc(e.message) + '</span>'));

// ── doors ──
async function doors() {
  const d = await (await fetch('/api/doors')).json();
  if (!d.doors.length) { $('#doors-body').innerHTML = '<div class="empty">no doors declared</div>'; return; }
  $('#doors-body').innerHTML = d.doors.map((x, i) => {
    const rows = x.receipts || [];
    const dec = rows.filter((rc) => rc.record && rc.record.kind === 'admission.decision');
    const admitted = dec.filter((rc) => /^ADMIT/.test(rc.record.effect || '')).length;
    const auth = rows.filter((rc) => rc.record && rc.record.kind === 'door.authentication').length;
    const head = '<div class="row"><b>' + esc(new URL(x.url).host) + '</b> <span class="pill">in front of ' + esc(x.estate) + '</span>' + (x.target ? ' <span class="k">receiving agent</span> <code>' + esc(x.target) + '</code>' : '') + ' ' + st(x.health.ok, x.health.ok ? 'up ' + x.health.ms + 'ms · ' + (x.health.configured ? 'configured' : 'unconfigured') : (x.health.error || 'HTTP ' + x.health.status)) + '</div>'
      + '<div class="note" style="margin:6px 0"><span class="stat">last <b>' + rows.length + '</b> records</span><span class="stat">admitted <b class="ok">' + admitted + '</b></span><span class="stat">refused at admission <b class="bad">' + (dec.length - admitted) + '</b></span><span class="stat">refused at authentication <b class="bad">' + auth + '</b></span></div>';
    if (x.receiptsError) return '<div class="card">' + head + '<div class="warn">receipts: ' + esc(x.receiptsError) + '</div></div>';
    const row = (rc) => { const rec = rc.record || {}; const codes = (rec.reasonCodes || []).filter((c) => /^FOREIGN_ESTATE_/.test(c)).map((c) => c.replace('FOREIGN_ESTATE_', '').toLowerCase().replace(/_/g, ' ')); return '<tr><td class="note" style="white-space:nowrap">' + when(rc.at) + '</td><td>' + (rec.kind === 'door.authentication' ? '<span class="k">authentication</span>' : 'admission') + '</td><td>' + st(/^ADMIT/.test(rec.effect || ''), rec.effect || '—') + '</td><td class="mono" title="' + esc(rec.actingAgentId || '') + '">' + short(String(rec.actingAgentId || '').replace(/^eip155:\\d+:/, '')) + '</td><td class="note">' + (codes.length ? esc(codes.join(' · ')) : rec.code ? '<i>logged, not shown</i>' : '—') + '</td><td class="mono"><a href="' + esc(x.url) + '/federation/receipts/' + esc(rc.receiptId) + '">' + esc(String(rc.receiptId).slice(-6)) + '</a></td></tr>'; };
    const first = rows.slice(0, 8).map(row), rest = rows.slice(8).map(row);
    return '<div class="card">' + head + tbl(['at (UTC)', 'kind', 'effect', 'acting account', 'reason', 'receipt'], first, rest)
      + (rest.length ? '<button class="more" data-more="1">show ' + rest.length + ' more</button>' : '') + '</div>';
  }).join('') + '<div class="note">A receipt names the acting account, the boundary and the reason codes, and nothing else about the estate. Authentication failures are logged with their precise code and shown generically, by design.</div>';
}
document.addEventListener('click', (ev) => { const b = ev.target.closest('button[data-more]'); if (!b) return; const more = b.parentElement.querySelector('tbody.more'); if (more) more.hidden = false; b.remove(); });
doors().catch((e) => ($('#doors-body').innerHTML = '<span class="bad">doors: ' + esc(e.message) + '</span>'));

// ── credentials (the predicate grade) ──
async function credentials() {
  const c = await (await fetch('/api/credentials')).json();
  if (!c.credentials) { $('#credentials-body').innerHTML = '<div class="empty">no credentials block declared</div>'; return; }
  const k = c.credentials;
  const head = '<div class="row"><b>' + esc(k.suite) + '</b> <span class="pill">' + esc((k.backend && (k.backend.package + ' ' + k.backend.version)) || '') + ' · ' + esc((k.backend && k.backend.role) || 'verifier') + '</span> <span class="k">verifier placement</span> <code>' + esc(k.verifierPlacement || '') + '</code> <span class="k">issuer trust</span> <code>' + esc(k.issuerTrust || '') + '</code></div>'
    + '<div class="note">Proof validity is evidence, never authority. A door that admits on a predicate still runs its own mandate per act. The verifier is a Node service beside the door (the 1k Prepare verifying key is 274 MB) and every receipt names that placement.</div>';
  const doors = '<h3>doors with a predicate grade</h3>' + ((c.doors || []).length ? (c.doors || []).map((d) => {
    const live = d.live || {}; const v = live.verifier || {};
    const preds = (d.policy.predicates || []).map((p) => '<code>' + esc(p.claim + ' ' + p.op + ' ' + JSON.stringify(p.value)) + '</code>').join(' ');
    return '<div class="card"><div class="row"><b>' + esc(new URL(d.url).host) + '</b> <span class="pill">in front of ' + esc(d.estate) + '</span> ' + (d.error ? st(false, d.error) : st(true, 'answers')) + '</div>'
      + '<div class="note">asks ' + preds + ' over <code>' + esc((d.policy.claimSchema || []).join(', ')) + '</code> (' + esc(d.policy.vcSize) + ') · nullifier ' + esc(d.policy.nullifier ? (d.policy.nullifier.require ? 'required, ' + d.policy.nullifier.grade : 'optional') : 'none') + ' · status ' + esc(d.policy.status || 'none') + (live.predicateDigest ? ' · predicate program <code>' + short(live.predicateDigest) + '</code>' : '') + '</div>'
      + '<div class="note">verifier: ' + (v.configured ? st(v.ok === true, (v.placement || '') + (v.body && v.body.sdk ? ' · openac-sdk ' + v.body.sdk + ' · bundle ' + v.body.bundleVersion + ' · keys ' + (v.body.keys || []).join(',') + ' · rss ' + v.body.rssMb + ' MB' : v.ok ? '' : ' (not answering: ' + ((v.body && v.body.error) || v.status) + ')')) : st(false, v.error || 'not configured')) + '</div></div>';
  }).join('') : '<div class="empty">no door declares credentialProofs</div>');
  const issuers = '<h3>issuers — facets read the way a stranger reads them</h3>' + tbl(['issuer', 'estate', 'issuing agent', 'chain', 'facets (keyId · thumbprint · attestation)'], (c.issuers || []).map((i) => '<tr><td>' + esc(i.id) + (i.kind ? ' <span class="pill">' + esc(i.kind) + '</span>' : '') + '</td><td>' + esc(i.estate) + '</td><td class="mono">' + esc(i.sa) + '</td><td>eip155:' + esc(i.chainId) + '</td><td>' + ((i.facets || []).map((f) => '<code>' + esc(f.keyId) + '</code> · ' + esc(f.thumbprint || (f.document && f.document.facet && f.document.facet.publicKeyJwk && f.document.facet.publicKeyJwk.kid) || '—') + ' · ' + (f.attestation ? st(true, short(f.attestation)) : st(false, 'not attested')) + ' · revocation: ' + esc(f.revocationRoot || '—')).join('<br>') || '<span class="warn">none</span>') + '</td></tr>'))
    + '<div class="note">An issuer is an organization or a service, never a person, and never an estate\'s governance agent (its revocation row on neutral ground would collide). The facet document is public — a key and the agent\'s signature over it; the attestation on the issuer\'s chain is what a verifier checks, not this page.</div>';
  $('#credentials-body').innerHTML = head + doors + issuers;
}
credentials().catch((e) => ($('#credentials-body').innerHTML = '<span class="bad">credentials: ' + esc(e.message) + '</span>'));

// ── kms ──
async function kms() {
  const k = await (await fetch('/api/kms')).json();
  const pr = k.probeResult || {};
  const roots = (k.platformRoots || []); const billable = roots.filter((r) => r.billable).length;
  const head = '<div class="row"><b>' + esc(k.operator) + '</b> <span class="pill">' + esc(k.backend) + '</span> <span class="k">host</span> <code>' + esc(k.host) + '</code>' + (k.hostPlanned ? ' <span class="k">→ planned</span> <code>' + esc(k.hostPlanned) + '</code>' : '') + ' ' + st(pr.ok, pr.ok ? 'alive ' + pr.ms + 'ms' : (pr.error || 'HTTP ' + pr.status)) + '</div>'
    + '<div class="note">operator role: ' + esc(k.operatorRole) + (k.repo ? ' · code: ' + esc(k.repo) : '') + '</div>'
    + '<div class="note" style="margin-top:6px"><span class="stat">keys the cloud bills for <b>' + billable + '</b> of a budget of ' + esc(k.billableKeyBudget ?? 2) + '</span>' + (k.evidence ? '<span class="stat">logical keys under them <b>' + esc(k.evidence.logicalKeys) + '</b> (' + esc(Object.entries(k.evidence.byProtection || {}).map(([a, b]) => a + ' ' + b).join(', ')) + '), none billable</span><span class="stat">' + esc(k.evidence.keyVaultCostMonthToDate || '') + '</span><span class="stat">checked ' + esc(k.evidence.checked) + '</span>' : '') + '</div>'
    + (roots.length ? '<div class="note">' + roots.map((r) => '<code>' + esc(r.key) + '</code> (' + esc(r.provider) + (r.vault ? ', ' + esc(r.vault) : '') + (r.billable ? ', billable' : '') + ')').join(' · ') + '</div>' : '')
    + '<div class="note">protection levels: <code>' + esc((k.protectionLevels || []).join(', ')) + '</code> — ' + esc(k.costRule || '') + '</div>'
    + '<div class="note">attestation: ' + (k.attestationResult && k.attestationResult.ok ? st(true, 'published') : st(false, (k.attestationResult && k.attestationResult.error) || 'not published')) + '</div>';
  const conds = '<h3>the four conditions (spec 440 A3)</h3>' + tbl(['#', 'condition', 'status', 'detail'], (k.conditions || []).map((c) => '<tr><td>' + c.id + '</td><td>' + esc(c.condition) + '</td><td>' + st(c.status === 'met', c.status) + '</td><td class="note">' + esc(c.detail || '') + '</td></tr>'));
  const tenants = '<h3>tenants — one per estate, never shared</h3>' + tbl(['tenant', 'estate', 'town', 'callers (subject · operations · levels)', 'note'], (k.tenants || []).map((t) => '<tr><td class="mono">' + esc(t.tenant) + '</td><td>' + esc(t.estate) + '</td><td>' + esc(t.town) + '</td><td>' + (t.callers === null ? '<span class="warn">not recorded here — the operator\\'s record on the CVM is authoritative</span>' : (t.callers.map((c) => '<div class="mono">' + esc(c.subject) + ' <span class="k">' + esc((c.operations || []).join(',')) + '</span> <span class="k">' + esc((c.protectionLevels || []).join(',')) + '</span></div>').join('') || '<span class="warn">none bound</span>')) + (t.sharedCredential ? '<div class="bad">a credential is shared across Workers (407 D10) — condition 1 open</div>' : '') + '</td><td class="note">' + esc(t.note || '') + '</td></tr>'));
  $('#kms-body').innerHTML = head + conds + tenants + '<div class="note">' + esc(k.holds) + '</div>';
}
kms().catch((e) => ($('#kms-body').innerHTML = '<span class="bad">kms: ' + esc(e.message) + '</span>'));

// ── names ──
$('#nf').onsubmit = async (ev) => {
  ev.preventDefault();
  const q = $('#nq').value.trim(); if (!q) return;
  $('#names-body').className = 'empty'; $('#names-body').innerHTML = 'resolving across ' + FED.towns.filter((t) => t.status !== 'retired').length + ' town(s)…';
  const d = await (await fetch('/api/names?q=' + encodeURIComponent(q))).json();
  if (d.error) { $('#names-body').innerHTML = '<span class="bad">' + esc(d.error) + (d.hint ? ' — ' + esc(d.hint) : '') + '</span>'; return; }
  $('#names-body').className = '';
  $('#names-body').innerHTML = '<div class="note">' + d.towns.map((t) => esc(t.town) + ' ' + (t.ok ? st(true, 'block ' + t.block) : st(false, t.error || 'unreachable'))).join(' · ') + '</div>'
    + tbl(['display (never bare)', 'status', 'type', 'account on that chain (CAIP-10) — not the canonical id', 'federated reference'], d.rows.map((x) => '<tr><td><b>' + esc(x.display) + '</b>' + (x.root ? ' <span class="pill">root chain</span>' : '') + '</td><td>' + st(x.status === 'registered' ? true : x.status === 'available' ? undefined : false, x.status) + '</td><td>' + esc(x.kind || '—') + '</td><td class="mono">' + esc(x.identity || '—') + '</td><td class="mono">{ name: ' + esc(x.federated.name) + ', chain: ' + esc(x.federated.chain) + ' }</td></tr>'))
    + '<div class="note">' + esc(d.rule) + ' · <i>authorized</i> is the caller\\'s own mandate, which no resolver answers.</div>'
    + '<div id="identities"></div>';
  // THE AGENT BEHIND EACH NAME (owner, 2026-10-15): for every registered name in the answer, what the home town's naming
  // service says the name is a name OF — the canonical id is the HOME account; the account the name points at on the root
  // chain is the agent's account there, a satellite, and the one every reader will want to call canonical. It is not, and
  // this card keeps saying so. Undeclared stays undeclared: nothing here promotes a chain's account by default.
  const named = [...new Set(d.rows.filter((x) => x.status === 'registered').map((x) => x.name))].slice(0, 3);
  for (const name of named) {
    const one = await (await fetch('/api/names/' + encodeURIComponent(name))).json().catch(() => null);
    const chainWord = (a) => 'eip155:' + a.chainId + (a.town ? ' · the ' + esc(a.town) + ' town' : '');
    const roleWord = (r) => (r === 'home' ? 'home — the canonical id' : r === 'satellite' ? 'satellite — holds the name on this chain' : 'role not declared');
    const cards = (one && one.towns ? one.towns : []).filter((t) => t.detail && t.detail.identity && t.detail.identity.here).map((t) => {
      const id = t.detail.identity;
      return '<div class="card"><div class="row"><b>' + esc(name) + '</b> <span class="pill">as ' + esc(t.town) + ' sees it</span></div>'
        + '<h3>the agent behind this name</h3><div class="scroll"><table>'
        + '<tr><th>agent (canonical id)</th><td>' + (id.canonical ? '<code>' + esc(id.canonical) + '</code><br><span class="k">the account this name is a name of; its Home and custody live on eip155:' + id.canonicalChainId + (id.canonicalTown ? ' · the ' + esc(id.canonicalTown) + ' town' : '') + '</span>' : '<b>not declared</b> <span class="k">— the name lists no home account (atl:nativeId); nothing on chain says which account is the agent\\'s canonical id</span>') + '</td></tr>'
        + '<tr><th>on ' + esc(t.town) + '\\'s chain</th><td><code>' + esc(id.here.account) + '</code><br><span class="k">' + (id.here.role === 'home' ? 'the agent\\'s home account: the canonical id, on this chain' : id.here.role === 'satellite' ? 'the agent\\'s account here — it holds the name on ' + chainWord(id.here) + '; a satellite, NOT the canonical id' : 'the agent\\'s account on ' + chainWord(id.here) + '; whether it is the home is not written') + '</span></td></tr>'
        + (id.estate ? '<tr><th>estate and Home</th><td>' + (id.estate.home ? '<a href="' + esc(id.estate.home) + '">' + esc(String(id.estate.home).replace(/^https?:\\/\\//, '')) + '</a>' : '—') + (id.estate.id ? ' · the <b>' + esc(id.estate.id) + '</b> estate' : '') + (id.estate.town ? ' · the ' + esc(id.estate.town) + ' town' : '') + '<br><span class="k">' + (id.estate.how === 'declared' ? 'declared by the agent itself (atl:estate)' : 'placed by its endpoint against the towns\\' manifests — an inference') + '</span></td></tr>' : '')
        + (id.accounts.length > 1 ? '<tr><th>accounts by chain</th><td>' + id.accounts.map((a) => '<code>' + esc(a.account) + '</code> <span class="k">· ' + chainWord(a) + ' · ' + roleWord(a.role) + (a.here ? ' · this chain' : '') + '</span>').join('<br>') + '</td></tr>' : '')
        + '</table></div><div class="note">A name is a projection of the agent\\'s identity, not the identity. The root chain is where the name lives; the home account is where the agent lives. A grant lives on one chain, so an act is signed by the account on the chain it runs on.</div></div>';
    });
    $('#identities').insertAdjacentHTML('beforeend', cards.join(''));
  }
};
</script></body></html>`;
}
