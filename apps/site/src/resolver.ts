// The universal resolver's pure half (spec 440 C5; naming doc N4): a name that crosses a town is the pair
// { name, chain }, its identity is CAIP-10 on the chain the row came from, and it is NEVER displayed bare outside
// its home town. The site is in no town, so every row it prints is qualified. Nothing here fetches.

export interface TownRef { id: string; chainId: number }

/** One row of the town's naming read API (`/api/search`), the fields we read. */
export interface TownSearchRow {
  name: string;
  tld?: string;
  kind?: string | null;
  status?: string;
  agent?: string | null;
  by?: string;
  coins?: number;
}

export interface NameRow {
  /** The federated reference — the pair that crosses a town boundary. */
  federated: { name: string; chain: string };
  name: string;
  town: string;
  chainId: number;
  /** CAIP-10 of the agent on the row's chain, or null when the name points at nobody. */
  account: string | null;
  agent: string | null;
  kind: string | null;
  status: string;
  /** What to print. Bare only when the viewer is inside the row's home town; the site never is. */
  display: string;
  /** True when this row's chain is the federation's root chain (spec 440 C1). */
  root: boolean;
}

export const chainOf = (chainId: number): string => `eip155:${chainId}`;

export function accountOf(chainId: number, address: string | null | undefined): string | null {
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  return `eip155:${chainId}:${address.toLowerCase()}`;
}

/**
 * The display rule. Inside its home town a handle is bare; anywhere else it carries its town. `viewerChainId`
 * undefined means "no town" (the federation site), so the name is qualified.
 */
export function qualify(name: string, town: TownRef, viewerChainId?: number): string {
  return viewerChainId !== undefined && viewerChainId === town.chainId ? name : `${name} · ${town.id} (${chainOf(town.chainId)})`;
}

export function toNameRow(row: TownSearchRow, town: TownRef, rootChain: number, viewerChainId?: number): NameRow {
  const agent = row.agent && /^0x[0-9a-fA-F]{40}$/.test(row.agent) ? row.agent.toLowerCase() : null;
  return {
    federated: { name: row.name, chain: chainOf(town.chainId) },
    name: row.name,
    town: town.id,
    chainId: town.chainId,
    account: accountOf(town.chainId, agent),
    agent,
    kind: row.kind ?? null,
    status: row.status ?? 'unknown',
    display: qualify(row.name, town, viewerChainId),
    root: town.chainId === rootChain,
  };
}

export interface TownNameResult { town: string; chainId: number; ok: boolean; block: number | null; error?: string; rows: NameRow[] }

const STATUS_ORDER: Record<string, number> = { registered: 0, reserved: 1, available: 2 };

/** Flatten per-town answers: registered before available, the root chain before the rest, then by name. */
export function mergeTownRows(per: TownNameResult[]): NameRow[] {
  return per.flatMap((p) => p.rows).sort((a, b) => {
    const s = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
    if (s) return s;
    if (a.root !== b.root) return a.root ? -1 : 1;
    return a.name.localeCompare(b.name) || a.town.localeCompare(b.town);
  });
}

/** `alice` is a label; `alice.me` / `x.svc@y.org` is a name. The read API answers both, differently. */
export function looksLikeName(q: string): boolean {
  return /^[a-z0-9-]+\.[a-z]+(@[a-z0-9-]+\.[a-z]+)?$/i.test(q.trim());
}
