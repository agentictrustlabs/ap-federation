// IS THIS GRANT STILL LIVE? — read from the ESTATE'S chain, never from neutral ground (spec 439 F1).
//
// Neutral ground holds commitments; it knows nothing about a delegation. Revocation is a fact on the
// estate's own chain, and `DelegationManager.isRevoked(hash)` is a world-readable view — which is why the
// projector can prune without holding anybody's wire, and why a verifier on a THIRD chain could, in
// principle, check the same thing itself (reading a public chain needs no trust, only an endpoint).
//
// One mechanism, no fallback (ADR-0013): an unreadable chain THROWS here, and the caller drops the leaf
// rather than vouching for it (`liveness.ts`). An error is not a "probably still live".
import { createPublicClient, http, type Address, type Hex } from 'viem';
import type { EstateRow } from './config.js';

export const IS_REVOKED_ABI = [
  { type: 'function', name: 'isRevoked', stateMutability: 'view', inputs: [{ name: 'delegationHash', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
] as const;

/** The estate's chain endpoint. Its own `rpcEnv` when it has one; otherwise the registry's, which is only
 *  correct while the estate and neutral ground share a chain — an estate elsewhere MUST name its own. */
export function estateRpc(row: EstateRow, env: NodeJS.ProcessEnv = process.env): string {
  const name = row.rpcEnv ?? 'FEDERATION_RPC_URL';
  const url = (env[name] ?? '').trim();
  if (!url) throw new Error(`${name} is not set — the projector reads ${row.id}'s chain over it to see what has been revoked`);
  return url;
}

export async function isRevokedReader(row: EstateRow, env: NodeJS.ProcessEnv = process.env): Promise<(digest: Hex) => Promise<boolean>> {
  if (!row.delegationManager) {
    throw new Error(`estate ${row.id} names no delegationManager, so nothing here can tell a live grant from a revoked one — refusing to vouch for a set it cannot prune`);
  }
  const rpcUrl = estateRpc(row, env);
  // Grants are issued and revoked where the people live (`homeChainId`), not where the projection anchors.
  const chainId = row.homeChainId ?? row.chainId;
  const chain = { id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } } as const;
  const pub = createPublicClient({ chain, transport: http(rpcUrl) });
  const manager = row.delegationManager as Address;
  return async (digest: Hex) => (await pub.readContract({ address: manager, abi: IS_REVOKED_ABI, functionName: 'isRevoked', args: [digest] })) as boolean;
}
