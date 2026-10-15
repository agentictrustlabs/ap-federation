// THE FEDERATION'S GROUND, DRAWN (owner, 2026-10-15): what the federation runs and the towns merely host — neutral ground
// with each estate's projection on it, the naming root and the universal resolver, the shared KMS operator and the
// doors — and then each town beside it with the estates it holds. The picture is built from the register and lit by
// probes; it adds nothing a reader could not get from /api/federation, /api/towns, /api/kms and /api/doors as text.
//
// Why these buildings are HERE and not on a town's portal: spec 440 roots the universal namespace on one chain (§C) and
// makes the KMS one operator for every town (§A). A town that hosts them lists them as `kind: federation` and draws
// them no more than it draws another town's registry. Lit windows are probes that answered; presence is the register;
// nothing drawn is a permission (spec 439 D2).
import type { Federation, FederationTown } from './federation';
import { street, town, type PlaceInput, type TownSceneV1 } from './scene';

export interface GroundSignals {
  towns: Record<string, boolean | null>;
  /** The estates each town LISTS (its own /api/town), by town id. An estate lives in the town whose manifest holds it — the
   *  register's `chainId` on an estate is the chain its PROJECTION anchors on, which stays put when the estate moves. */
  townEstates: Record<string, string[]>;
  naming: boolean | null;
  kms: boolean | null;
  doors: Record<string, boolean | null>;
}

const host = (u: string | undefined | null): string => { try { return u ? new URL(u).host : ''; } catch { return ''; } };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The town whose naming service answers for the root chain — the one the universal namespace is rooted on. */
export function rootTown(fed: Federation): FederationTown | undefined {
  return fed.towns.find((t) => t.chainId === fed.naming.rootChain);
}

export function groundScene(fed: Federation, s: GroundSignals, origin: string): TownSceneV1 {
  const parts: ReturnType<typeof street>[] = [];
  let ox = 0;
  const live = fed.towns.filter((t) => t.status !== 'retired');

  // Neutral ground: the registry no estate controls, and each estate's projection on it.
  const neutral: PlaceInput[] = [
    { id: 'neutral-ground', kind: 'registry', label: 'neutral ground', sub: `eip155:${fed.registry.chainId} · ${short(fed.registry.address)}`, href: '#ground', lit: true, pinned: true },
    ...fed.estates.map((e): PlaceInput => ({ id: `projection:${e.id}`, kind: 'org', label: `${e.id} · projection`, sub: e.declaredOnChain ? 'signer declared on chain' : e.governance ? 'signer not declared on chain' : 'no estate agent', href: '#ground', lit: !!e.governance && !!e.declaredOnChain })),
  ];
  const g = street(neutral, { cols: Math.max(2, neutral.length), tone: '#9aa7e8', label: 'neutral ground', href: '#ground', ox, oy: 0 });
  parts.push(g); ox += g.w + 2;

  // The federation's services: the naming root, the resolver, the shared operator, the doors.
  const root = rootTown(fed);
  const services: PlaceInput[] = [
    { id: 'naming-root', kind: 'registry', label: 'naming root', sub: root?.naming ? host(root.naming) : `eip155:${fed.naming.rootChain}`, href: root?.naming ?? '#names', lit: s.naming === true, pinned: true },
    { id: 'resolver', kind: 'service', label: 'universal resolver', sub: host(origin), href: '#names', lit: true, pinned: true },
    { id: 'kms', kind: 'treasury', label: 'kms · shared operator', sub: fed.kms.host, href: '#kms', lit: s.kms === true, pinned: true },
    ...fed.doors.map((d): PlaceInput => ({ id: `door:${d.estate}`, kind: 'service', label: `door · ${d.estate}`, sub: host(d.url), href: '#doors', lit: s.doors[d.estate] === true })),
  ];
  const f = street(services, { cols: Math.max(3, Math.ceil(services.length / 2)), tone: '#d6b24a', label: 'the federation', href: '#names', ox, oy: 0 });
  parts.push(f); ox += f.w + 2;

  // Each town beside the ground: its agent, and the estates the register places on its chain.
  for (const t of live) {
    const listed = s.townEstates[t.id];
    const estates = listed ? fed.estates.filter((e) => listed.includes(e.id)) : fed.estates.filter((e) => e.chainId === t.chainId);
    const places: PlaceInput[] = [
      { id: `town:${t.id}`, kind: 'org', label: `${t.id} · town`, sub: `eip155:${t.chainId} · ${t.status}`, href: t.portal ?? t.agent ?? '#towns', lit: s.towns[t.id] === true, pinned: true },
      ...estates.map((e): PlaceInput => ({ id: `estate:${e.id}`, kind: 'household', label: e.id, sub: host(e.home) || 'an estate', href: e.home ?? '#towns', lit: !!e.governance })),
    ];
    const p = street(places, { cols: Math.max(2, places.length), tone: '#7f9bd1', label: `the ${t.id} town`, href: t.portal ?? '#towns', ox, oy: 0 });
    parts.push(p); ox += p.w + 2;
  }
  return town(parts, `The federation: neutral ground with ${fed.estates.length} projection(s), the naming root and resolver, the KMS operator, ${fed.doors.length} door(s), and ${live.length} town(s). Lit windows are services that answered their probe.`);
}
