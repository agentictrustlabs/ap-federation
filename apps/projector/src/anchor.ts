// NEUTRAL GROUND, READ AND WRITTEN — `EstateProjectionRegistry` (spec 410 §4, spec 439 F1).
//
// Four calls, and that is the whole surface: `register`, `rotateSigner`, `setRoots`, `roots`. The ABI is
// written out here rather than imported because the registry HAS NO UPGRADE PATH — no admin, no pause, no
// proxy — so the deployed surface is final and cannot drift under this file. The same property is why the
// contract can be common ground at all.
//
// THE SEQUENCE IS THE WHOLE FRESHNESS STORY, and it has a consequence worth stating before anyone is
// surprised by it. A verifier accepts a presentation only when its sequence IS the anchored one and the
// anchor is younger than that verifier's `maxAge` (`verifyAuthorityPresentation`). There is no way to
// refresh `anchoredAt` without raising the sequence, because `setRoots` demands a strictly higher one. So:
//
//   · anchoring invalidates every presentation already in flight — holders re-fetch, by design;
//   · a set that never changes must STILL be re-anchored, or every presentation against it ages out;
//   · therefore the heartbeat interval must sit below the shortest `maxAge` any counterparty uses, and a
//     presentation is deliberately short-lived. That is the cost of "a stale root is a refusal".
import { createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const ESTATE_PROJECTION_REGISTRY_ABI = [
  { type: 'function', name: 'signerOf', stateMutability: 'view', inputs: [{ name: 'estateId', type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'estateIdOf', stateMutability: 'pure', inputs: [{ name: 'chainId', type: 'uint256' }, { name: 'governance', type: 'address' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'roots', stateMutability: 'view', inputs: [{ name: 'estateId', type: 'bytes32' }], outputs: [
    { name: 'liveGrantRoot', type: 'bytes32' }, { name: 'membershipRoot', type: 'bytes32' }, { name: 'charterHash', type: 'bytes32' },
    { name: 'sequence', type: 'uint64' }, { name: 'anchoredAt', type: 'uint64' }] },
  { type: 'function', name: 'register', stateMutability: 'nonpayable', inputs: [{ name: 'estateId', type: 'bytes32' }, { name: 'signer', type: 'address' }], outputs: [] },
  { type: 'function', name: 'rotateSigner', stateMutability: 'nonpayable', inputs: [{ name: 'estateId', type: 'bytes32' }, { name: 'to', type: 'address' }], outputs: [] },
  { type: 'function', name: 'setRoots', stateMutability: 'nonpayable', inputs: [
    { name: 'estateId', type: 'bytes32' }, { name: 'liveGrantRoot', type: 'bytes32' }, { name: 'membershipRoot', type: 'bytes32' },
    { name: 'charterHash', type: 'bytes32' }, { name: 'sequence', type: 'uint64' }], outputs: [] },
] as const;

export const ZERO_32 = `0x${'00'.repeat(32)}` as Hex;

export interface AnchoredState {
  liveGrantRoot: Hex; membershipRoot: Hex; charterHash: Hex; sequence: number; anchoredAt: number;
  /** Nothing has ever been anchored for this estate. `sequence === 0` is the registry's own "never". */
  never: boolean;
}

export interface RegistryClient {
  address: Address;
  chainId: number;
  signerOf(estateId: Hex): Promise<Address | null>;
  roots(estateId: Hex): Promise<AnchoredState>;
  estateIdOf(chainId: number, governance: Address): Promise<Hex>;
  register(estateId: Hex, signer: Address, key: Hex): Promise<Hex>;
  setRoots(input: { estateId: Hex; liveGrantRoot: Hex; membershipRoot: Hex; charterHash?: Hex; sequence: number }, key: Hex): Promise<Hex>;
}

export function registryClient(opts: { rpcUrl: string; chainId: number; address: Address }): RegistryClient {
  const chain = { id: opts.chainId, name: `chain-${opts.chainId}`, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [opts.rpcUrl] } } } as const;
  const pub = createPublicClient({ chain, transport: http(opts.rpcUrl) });
  const wallet = (key: Hex) => createWalletClient({ account: privateKeyToAccount(key), chain, transport: http(opts.rpcUrl) });
  const base = { address: opts.address, abi: ESTATE_PROJECTION_REGISTRY_ABI } as const;
  return {
    address: opts.address,
    chainId: opts.chainId,
    async signerOf(estateId) {
      const s = (await pub.readContract({ ...base, functionName: 'signerOf', args: [estateId] })) as Address;
      return /^0x0{40}$/i.test(s) ? null : s;
    },
    async roots(estateId) {
      const r = (await pub.readContract({ ...base, functionName: 'roots', args: [estateId] })) as readonly [Hex, Hex, Hex, bigint, bigint];
      const sequence = Number(r[3]);
      return { liveGrantRoot: r[0], membershipRoot: r[1], charterHash: r[2], sequence, anchoredAt: Number(r[4]), never: sequence === 0 };
    },
    async estateIdOf(chainId, governance) {
      return (await pub.readContract({ ...base, functionName: 'estateIdOf', args: [BigInt(chainId), governance] })) as Hex;
    },
    async register(estateId, signer, key) {
      const hash = await wallet(key).writeContract({ ...base, functionName: 'register', args: [estateId, signer] });
      await pub.waitForTransactionReceipt({ hash });
      return hash;
    },
    async setRoots(input, key) {
      const hash = await wallet(key).writeContract({
        ...base, functionName: 'setRoots',
        args: [input.estateId, input.liveGrantRoot, input.membershipRoot, input.charterHash ?? ZERO_32, BigInt(input.sequence)],
      });
      await pub.waitForTransactionReceipt({ hash });
      return hash;
    },
  };
}

export interface AnchorDecision {
  anchor: boolean;
  sequence: number;
  why: string;
  changed: boolean;
}

/**
 * Anchor, or say why not. Three reasons to write and one not to:
 *   · nothing has ever been anchored  → write (sequence 1);
 *   · the roots differ from what is anchored → write (the set moved);
 *   · the anchor is older than `refreshAfterSeconds` → write (presentations against it are about to age out);
 *   · otherwise → do not write. A sequence spent for no change is not free: it invalidates every
 *     presentation in flight for nothing.
 */
export function anchorDecision(input: {
  anchored: AnchoredState; liveGrantRoot: Hex; membershipRoot: Hex; charterHash?: Hex;
  now: number; refreshAfterSeconds: number;
}): AnchorDecision {
  const a = input.anchored;
  const same = a.liveGrantRoot.toLowerCase() === input.liveGrantRoot.toLowerCase()
    && a.membershipRoot.toLowerCase() === input.membershipRoot.toLowerCase()
    && a.charterHash.toLowerCase() === (input.charterHash ?? ZERO_32).toLowerCase();
  const next = a.sequence + 1;
  if (a.never) return { anchor: true, sequence: next, changed: true, why: 'nothing is anchored for this estate yet' };
  if (!same) return { anchor: true, sequence: next, changed: true, why: 'the roots moved: what the estate vouches for has changed' };
  const age = input.now - a.anchoredAt;
  if (age > input.refreshAfterSeconds) {
    return { anchor: true, sequence: next, changed: false, why: `unchanged, but the anchor is ${age}s old (> ${input.refreshAfterSeconds}s) and a verifier's freshness window is about to refuse it` };
  }
  return { anchor: false, sequence: a.sequence, changed: false, why: `unchanged and ${age}s fresh — a sequence spent here would invalidate every presentation in flight for nothing` };
}
