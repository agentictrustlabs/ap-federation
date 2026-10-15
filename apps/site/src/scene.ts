// THE FEDERATION, DRAWN — an isometric scene rendered to an SVG STRING (this site has no framework and no build step).
//
// VENDORED from ap-town `packages/town-scene` (`iso.ts`, `shapes.ts`, `scene.ts`, `layout.ts`, `draw.tsx`, `IsoScene.tsx`),
// with the React layer rewritten as string builders and the numbers unchanged, so a building drawn here reads as the
// same building on a town's portal. `@ap-town/town-scene` is a private workspace package of a product repository, so it
// cannot be imported from here; when it is published this file goes and the import takes its place. Until then: keep
// the numbers in step by hand, and never add a shape here that ap-town does not have.
//
// Nothing here is authority: a lit window is a probe that answered, presence is a row in the register (spec 439 D2).

export const U = 22;
export const ZK = 0.92;
export const iso = (x: number, y: number, z = 0): { x: number; y: number } => ({ x: (x - y) * U, y: (x + y) * (U / 2) - z * U * ZK });
export const pt = (x: number, y: number, z = 0): string => { const p = iso(x, y, z); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; };
export const shade = (hex: string, k: number): string => {
  const n = parseInt(hex.slice(1), 16); const r = (n >> 16) & 255; const g = (n >> 8) & 255; const b = n & 255;
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k))));
  return `#${((f(r) << 16) | (f(g) << 8) | f(b)).toString(16).padStart(6, '0')}`;
};
export const hash01 = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };
export const INK = '#e8eef7'; export const GLOW = '#ffd27a'; export const GROUND = '#0d1626'; export const GROUND_LINE = '#182540';

export type Roof = 'flat' | 'gable' | 'dome' | 'spire' | 'slab';
export type PlaceKind = 'person' | 'household' | 'org' | 'team' | 'church' | 'circle' | 'service' | 'workspace' | 'treasury' | 'registry' | 'legacy';
export interface PlaceShape { noun: string; w: number; d: number; h: number; roof: Roof; tone: string; flag?: boolean; trim?: string; figures?: number }
export const PLACE_SHAPES: Readonly<Record<PlaceKind, PlaceShape>> = {
  person: { noun: 'a house', w: 1.2, d: 1.2, h: 0.9, roof: 'gable', tone: '#d9a15f', figures: 1 },
  household: { noun: 'a wide house', w: 1.9, d: 1.3, h: 0.9, roof: 'gable', tone: '#c98a6b', figures: 2 },
  org: { noun: 'a hall with a dome', w: 2.0, d: 2.0, h: 1.5, roof: 'dome', tone: '#7f9bd1' },
  team: { noun: 'an office flying a flag', w: 1.6, d: 1.4, h: 1.2, roof: 'flat', tone: '#5fb39a', flag: true },
  church: { noun: 'a hall with a spire', w: 1.9, d: 1.4, h: 1.2, roof: 'spire', tone: '#c9cfdb' },
  circle: { noun: 'a small round hall', w: 1.2, d: 1.2, h: 0.8, roof: 'dome', tone: '#b48fd6' },
  service: { noun: 'a workshop', w: 1.7, d: 1.3, h: 1.0, roof: 'slab', tone: '#8a97ad' },
  workspace: { noun: 'a low studio', w: 2.0, d: 1.5, h: 0.7, roof: 'flat', tone: '#6fb3c9' },
  treasury: { noun: 'a vault', w: 1.4, d: 1.4, h: 1.1, roof: 'slab', tone: '#d6b24a', trim: '#8a6d1c' },
  registry: { noun: 'a tall narrow hall', w: 1.1, d: 1.1, h: 2.2, roof: 'flat', tone: '#9aa7e8' },
  legacy: { noun: 'a plain block', w: 1.3, d: 1.3, h: 0.8, roof: 'flat', tone: '#5b6678' },
};

export interface SceneBuilding { id: string; x: number; y: number; w: number; d: number; h: number; tone: string; roof: Roof; lit: boolean; flag?: string; trim?: string; figures?: number; label?: string; sub?: string; href?: string; pinned?: boolean }
export interface ScenePlate { id: string; x: number; y: number; w: number; d: number; tone: string; label?: string; href?: string; road?: boolean }
export interface SceneTree { x: number; y: number; s: number }
export interface TownSceneV1 { plates: ScenePlate[]; buildings: SceneBuilding[]; trees?: SceneTree[]; title: string }
export const depthOf = (b: { x: number; y: number; w: number; d: number }): number => b.x + b.y + (b.w + b.d) / 2;

export const LOT = 3; export const ROAD = 1.2;
export interface PlaceInput { id: string; kind: PlaceKind; label?: string; sub?: string; href?: string; lit: boolean; pinned?: boolean; tone?: string; scale?: number }
export function placeOnLot(p: PlaceInput, lx: number, ly: number, lot = LOT): SceneBuilding {
  const s = PLACE_SHAPES[p.kind]; const k = p.scale ?? 1; const w = s.w * k; const d = s.d * k;
  return { id: p.id, x: lx + (lot - w) / 2, y: ly + (lot - d) / 2, w, d, h: s.h * k, tone: p.tone ?? s.tone, roof: s.roof, lit: p.lit,
    ...(s.flag ? { flag: s.tone } : {}), ...(s.trim ? { trim: s.trim } : {}), ...(s.figures ? { figures: s.figures } : {}),
    ...(p.label ? { label: p.label } : {}), ...(p.sub ? { sub: p.sub } : {}), ...(p.href ? { href: p.href } : {}), ...(p.pinned ? { pinned: true } : {}) };
}
export interface StreetOpts { cols: number; tone: string; label?: string; href?: string; ox?: number; oy?: number; trees?: boolean }
export function street(places: PlaceInput[], opts: StreetOpts): { plates: ScenePlate[]; buildings: SceneBuilding[]; trees: SceneTree[]; w: number; d: number } {
  const ox = opts.ox ?? 0; const oy = opts.oy ?? 0; const cols = Math.max(1, opts.cols);
  const rows = Math.max(1, Math.ceil(places.length / cols)); const blocks = Math.ceil(rows / 2); const w = cols * LOT;
  const single = rows === 1; const d = single ? LOT + ROAD : blocks * (2 * LOT + ROAD); const idp = opts.label ?? 'street';
  const plates: ScenePlate[] = [{ id: `${idp}:ground`, x: ox, y: oy, w, d, tone: opts.tone, ...(opts.label ? { label: opts.label } : {}), ...(opts.href ? { href: opts.href } : {}) }];
  for (let b = 0; b < blocks; b++) plates.push({ id: `${idp}:road${b}`, x: ox, y: oy + b * (2 * LOT + ROAD) + LOT, w, d: ROAD, tone: '#0a1220', road: true });
  const buildings: SceneBuilding[] = []; const trees: SceneTree[] = [];
  for (let r = 0; r < rows; r++) {
    const block = Math.floor(r / 2); const far = r % 2 === 0; const ly = oy + block * (2 * LOT + ROAD) + (far ? 0 : LOT + ROAD);
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c; const lx = ox + c * LOT; const p = places[i];
      if (p) buildings.push(placeOnLot(p, lx, ly));
      else if (opts.trees !== false) { const j = hash01(`${idp}:${i}`); trees.push({ x: lx + 0.8 + j * 1.4, y: ly + 0.8 + (1 - j) * 1.4, s: 0.7 + j * 0.5 }); }
    }
  }
  return { plates, buildings, trees, w, d };
}
export function town(parts: Array<ReturnType<typeof street>>, title: string): TownSceneV1 {
  return { title, plates: parts.flatMap((p) => p.plates), buildings: parts.flatMap((p) => p.buildings).sort((a, b) => depthOf(a) - depthOf(b)), trees: parts.flatMap((p) => p.trees) };
}

// ── drawing, as strings ──
const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const n1 = (v: number) => v.toFixed(1);
export const rect = (p: { x: number; y: number; w: number; d: number }, z = 0): string => `${pt(p.x, p.y, z)} ${pt(p.x + p.w, p.y, z)} ${pt(p.x + p.w, p.y + p.d, z)} ${pt(p.x, p.y + p.d, z)}`;
const poly = (points: string, attrs: string) => `<polygon points="${points}" ${attrs}/>`;
function pawn(x: number, y: number, tone: string, s = 1): string {
  return `<g><ellipse cx="${n1(x)}" cy="${n1(y + 2 * s)}" rx="${n1(8 * s)}" ry="${n1(3.6 * s)}" fill="#000" opacity="0.35"/><rect x="${n1(x - 5 * s)}" y="${n1(y - 15 * s)}" width="${n1(10 * s)}" height="${n1(14 * s)}" rx="${n1(5 * s)}" fill="${tone}" stroke="#0b1830" stroke-width="1"/><circle cx="${n1(x)}" cy="${n1(y - 20 * s)}" r="${n1(5 * s)}" fill="${shade(tone, 0.45)}" stroke="#0b1830" stroke-width="1"/></g>`;
}
function tree(t: SceneTree): string {
  const b = iso(t.x, t.y); const h = 24 * t.s; const s = t.s;
  return `<g><ellipse cx="${n1(b.x + 2)}" cy="${n1(b.y + 2)}" rx="${n1(7 * s)}" ry="${n1(3.4 * s)}" fill="#000" opacity="0.25"/><line x1="${n1(b.x)}" y1="${n1(b.y)}" x2="${n1(b.x)}" y2="${n1(b.y - h * 0.4)}" stroke="#6b4a2b" stroke-width="${n1(2 * s)}"/><polygon points="${n1(b.x - 8 * s)},${n1(b.y - h * 0.35)} ${n1(b.x + 8 * s)},${n1(b.y - h * 0.35)} ${n1(b.x)},${n1(b.y - h)}" fill="#2e8b6a"/><polygon points="${n1(b.x)},${n1(b.y - h * 0.35)} ${n1(b.x + 8 * s)},${n1(b.y - h * 0.35)} ${n1(b.x)},${n1(b.y - h)}" fill="#1f6149"/></g>`;
}
function box(b: SceneBuilding): string {
  const { x, y, w, d, h } = b; const base = b.tone;
  const top = shade(base, 0.36); const left = shade(base, 0.02); const right = shade(base, -0.32); const roofL = shade(base, -0.1); const roofR = shade(base, -0.42);
  const out: string[] = [];
  out.push(poly(`${pt(x + 0.12, y + d + 0.04)} ${pt(x + w + 0.5, y + d + 0.04)} ${pt(x + w + 0.5, y + d + 0.4)} ${pt(x + 0.12, y + d + 0.4)}`, 'fill="#000" opacity="0.26"'));
  out.push(poly(`${pt(x, y + d)} ${pt(x + w, y + d)} ${pt(x + w, y + d, h)} ${pt(x, y + d, h)}`, `fill="${left}" class="ts-face"`));
  out.push(poly(`${pt(x + w, y + d)} ${pt(x + w, y)} ${pt(x + w, y, h)} ${pt(x + w, y + d, h)}`, `fill="${right}" class="ts-face"`));
  out.push(poly(`${pt(x, y, h)} ${pt(x + w, y, h)} ${pt(x + w, y + d, h)} ${pt(x, y + d, h)}`, `fill="${top}" class="ts-face"`));
  if (b.trim) {
    out.push(poly(`${pt(x, y + d, 0.04)} ${pt(x + w, y + d, 0.04)} ${pt(x + w, y + d, 0.22)} ${pt(x, y + d, 0.22)}`, `fill="${b.trim}"`));
    out.push(poly(`${pt(x + w, y + d, 0.04)} ${pt(x + w, y, 0.04)} ${pt(x + w, y, 0.22)} ${pt(x + w, y + d, 0.22)}`, `fill="${shade(b.trim, -0.3)}"`));
  }
  const rows = Math.max(1, Math.min(4, Math.floor(h / 0.5))); const win = b.lit ? GLOW : '#1b2740';
  for (let r = 0; r < rows; r++) {
    const z0 = 0.26 + r * 0.46; const z1 = Math.min(h - 0.08, z0 + 0.24); if (z1 <= z0) continue;
    const nL = Math.max(1, Math.round(w * 1.6)); const nR = Math.max(1, Math.round(d * 1.6));
    for (let i = 0; i < nL; i++) { const t0 = (i + 0.28) / nL; const t1 = (i + 0.72) / nL; out.push(poly(`${pt(x + w * t0, y + d, z0)} ${pt(x + w * t1, y + d, z0)} ${pt(x + w * t1, y + d, z1)} ${pt(x + w * t0, y + d, z1)}`, `fill="${win}" opacity="${b.lit ? 0.92 : 0.7}"`)); }
    for (let i = 0; i < nR; i++) { const t0 = (i + 0.28) / nR; const t1 = (i + 0.72) / nR; out.push(poly(`${pt(x + w, y + d * (1 - t0), z0)} ${pt(x + w, y + d * (1 - t1), z0)} ${pt(x + w, y + d * (1 - t1), z1)} ${pt(x + w, y + d * (1 - t0), z1)}`, `fill="${shade(win, -0.28)}" opacity="${b.lit ? 0.9 : 0.7}"`)); }
  }
  const rh = Math.max(0.35, Math.min(0.75, h * 0.6));
  if (b.roof === 'gable' || b.roof === 'spire') {
    const r0 = pt(x, y + d / 2, h + rh); const r1 = pt(x + w, y + d / 2, h + rh);
    out.push(poly(`${pt(x, y, h)} ${pt(x + w, y, h)} ${r1} ${r0}`, `fill="${shade(base, 0.12)}"`));
    out.push(poly(`${pt(x, y + d, h)} ${pt(x + w, y + d, h)} ${r1} ${r0}`, `fill="${roofL}"`));
    out.push(poly(`${pt(x + w, y + d, h)} ${pt(x + w, y, h)} ${r1}`, `fill="${roofR}"`));
  }
  if (b.roof === 'dome') {
    const c = iso(x + w / 2, y + d / 2, h); const rx = w * U * 0.62; const ry = rx * 0.5;
    out.push(`<ellipse cx="${n1(c.x)}" cy="${n1(c.y)}" rx="${n1(rx)}" ry="${n1(ry)}" fill="${roofR}"/>`);
    out.push(`<path d="M ${n1(c.x - rx)} ${n1(c.y)} A ${n1(rx)} ${n1(rx * 0.9)} 0 0 1 ${n1(c.x + rx)} ${n1(c.y)} Z" fill="${shade(base, 0.2)}"/>`);
    out.push(`<path d="M ${n1(c.x - rx * 0.55)} ${n1(c.y - rx * 0.72)} A ${n1(rx * 0.9)} ${n1(rx * 0.8)} 0 0 1 ${n1(c.x + rx * 0.2)} ${n1(c.y - rx * 0.86)}" fill="none" stroke="${shade(base, 0.6)}" stroke-width="2" opacity="0.7"/>`);
  } else if (b.roof === 'spire') {
    const tw = Math.min(0.5, w * 0.34); const tx = x + w - tw - 0.05; const ty = y + d - tw - 0.05; const th = h + rh + 0.55;
    out.push(poly(`${pt(tx, ty + tw)} ${pt(tx + tw, ty + tw)} ${pt(tx + tw, ty + tw, th)} ${pt(tx, ty + tw, th)}`, `fill="${shade(base, 0.08)}"`));
    out.push(poly(`${pt(tx + tw, ty + tw)} ${pt(tx + tw, ty)} ${pt(tx + tw, ty, th)} ${pt(tx + tw, ty + tw, th)}`, `fill="${shade(base, -0.3)}"`));
    const apex = iso(tx + tw / 2, ty + tw / 2, th + 0.85);
    out.push(poly(`${pt(tx, ty + tw, th)} ${pt(tx + tw, ty + tw, th)} ${n1(apex.x)},${n1(apex.y)}`, `fill="${roofL}"`));
    out.push(poly(`${pt(tx + tw, ty + tw, th)} ${pt(tx + tw, ty, th)} ${n1(apex.x)},${n1(apex.y)}`, `fill="${roofR}"`));
    out.push(`<path d="M ${n1(apex.x)} ${n1(apex.y)} v ${n1(-U * 0.5)} M ${n1(apex.x - U * 0.16)} ${n1(apex.y - U * 0.34)} h ${n1(U * 0.32)}" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`);
  } else if (b.roof === 'slab') {
    out.push(poly(`${pt(x - 0.1, y - 0.1, h + 0.14)} ${pt(x + w + 0.1, y - 0.1, h + 0.14)} ${pt(x + w + 0.1, y + d + 0.1, h + 0.14)} ${pt(x - 0.1, y + d + 0.1, h + 0.14)}`, `fill="${shade(base, 0.5)}"`));
  }
  if (b.flag) {
    const m = iso(x + 0.25, y + 0.25, h); const mt = iso(x + 0.25, y + 0.25, h + 1.0);
    out.push(`<line x1="${n1(m.x)}" y1="${n1(m.y)}" x2="${n1(mt.x)}" y2="${n1(mt.y)}" stroke="${INK}" stroke-width="2"/>`);
    out.push(`<path d="M ${n1(mt.x)} ${n1(mt.y)} l ${n1(U * 0.62)} ${n1(U * 0.16)} l ${n1(-U * 0.62)} ${n1(U * 0.2)} Z" fill="${shade(b.flag, 0.25)}"/>`);
  }
  for (let i = 0; i < Math.min(3, b.figures ?? 0); i++) { const p = iso(x + w + 0.28 + i * 0.3, y + d - 0.1, 0); out.push(pawn(p.x, p.y, shade(base, 0.2), 0.8)); }
  return out.join('');
}
function label(b: SceneBuilding): string {
  if (!b.label) return '';
  const top = iso(b.x + b.w / 2, b.y + b.d / 2, b.h + (b.roof === 'spire' ? 2.1 : b.roof === 'flat' || b.roof === 'slab' ? 0.5 : 1.1) + (b.flag ? 0.7 : 0));
  const text = b.label.length > 26 ? `${b.label.slice(0, 25)}…` : b.label; const wpx = Math.max(40, text.length * 6.6 + 16);
  return `<g class="ts-label${b.pinned ? ' ts-on' : ''}" aria-hidden="true"><rect x="${n1(top.x - wpx / 2)}" y="${n1(top.y - 22)}" width="${n1(wpx)}" height="${b.sub ? 30 : 18}" rx="9" fill="#0b1424" stroke="#2a3b5c" stroke-width="1" opacity="0.94"/><text x="${n1(top.x)}" y="${n1(top.y - 9.5)}" text-anchor="middle" font-size="11" font-weight="650" fill="${INK}">${esc(text)}</text>${b.sub ? `<text x="${n1(top.x)}" y="${n1(top.y + 2.5)}" text-anchor="middle" font-size="9" fill="#9fb0c9">${esc(b.sub)}</text>` : ''}</g>`;
}
function plateLabel(p: ScenePlate): string {
  if (!p.label) return '';
  const at = iso(p.x + 0.3, p.y + p.d + 0.75, 0);
  return `<text x="${n1(at.x)}" y="${n1(at.y)}" font-size="17" font-weight="750" fill="#dbe6f7" transform="rotate(26.565 ${n1(at.x)} ${n1(at.y)})" class="ts-plate-label">${esc(p.label)}</text>`;
}
export function extent(scene: TownSceneV1, pad = 46): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  const add = (x: number, y: number, z = 0) => { const p = iso(x, y, z); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); };
  for (const p of scene.plates) { add(p.x, p.y); add(p.x + p.w, p.y); add(p.x, p.y + p.d); add(p.x + p.w, p.y + p.d); }
  for (const b of scene.buildings) { add(b.x, b.y, b.h + 3.2); add(b.x + b.w, b.y + b.d); add(b.x, b.y + b.d); add(b.x + b.w, b.y); }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 100, h: 60 };
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 + 14 };
}
/** The whole scene as one `<svg>`: a building with an href is a real link with its label as its name; a pinned label always shows, the rest on hover or focus. */
export function sceneSvg(scene: TownSceneV1): string {
  const e = extent(scene);
  const grounds = scene.plates.filter((p) => !p.road).sort((a, b) => depthOf(a) - depthOf(b)); const roads = scene.plates.filter((p) => p.road);
  const buildings = [...scene.buildings].sort((a, b) => depthOf(a) - depthOf(b));
  const parts: string[] = [];
  parts.push(`<svg class="ts-scene" viewBox="${e.x.toFixed(0)} ${e.y.toFixed(0)} ${e.w.toFixed(0)} ${e.h.toFixed(0)}" role="img" aria-label="${esc(scene.title)}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><title>${esc(scene.title)}</title>`);
  parts.push(`<rect x="${n1(e.x)}" y="${n1(e.y)}" width="${n1(e.w)}" height="${n1(e.h)}" fill="${GROUND}"/>`);
  for (const p of grounds) { const g = poly(rect(p), `fill="${shade(p.tone, -0.78)}" stroke="${shade(p.tone, -0.45)}" stroke-width="1.2"`) + plateLabel(p); parts.push(p.href ? `<a href="${esc(p.href)}" class="ts-plate" aria-label="${esc(p.label ?? p.id)}">${g}</a>` : `<g>${g}</g>`); }
  for (const p of roads) parts.push(poly(rect(p), `fill="${p.tone}" stroke="${GROUND_LINE}" stroke-width="1"`));
  for (const t of scene.trees ?? []) parts.push(tree(t));
  for (const b of buildings) parts.push(b.href ? `<a href="${esc(b.href)}" class="ts-building" aria-label="${esc([b.label, b.sub].filter(Boolean).join(' — ') || b.id)}">${box(b)}</a>` : `<g class="ts-building">${box(b)}</g>`);
  for (const b of buildings) parts.push(label(b));
  parts.push('</svg>');
  return parts.join('');
}
export const SCENE_CSS = `
.ts-scene{display:block;width:100%;height:auto;border-radius:14px;font-family:inherit}
.ts-scene a{cursor:pointer;outline:none}
.ts-scene .ts-building:hover .ts-face,.ts-scene a.ts-building:focus-visible .ts-face{filter:brightness(1.22)}
.ts-scene a.ts-plate:hover polygon,.ts-scene a.ts-plate:focus-visible polygon{filter:brightness(1.5)}
.ts-scene .ts-label{opacity:0;pointer-events:none;transition:opacity .12s}
.ts-scene .ts-label.ts-on{opacity:1}
.ts-scene .ts-building:hover + .ts-label{opacity:1}
.ts-scene .ts-plate-label{pointer-events:none}
`;
