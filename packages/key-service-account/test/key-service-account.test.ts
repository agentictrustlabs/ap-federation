import { describe, expect, it } from 'vitest';
import { keccak256, parseTransaction, recoverAddress, recoverMessageAddress, recoverTransactionAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { keyServiceAccount, tokenFor } from '../src/index.js';

// A STAND-IN KEY SERVICE: answers the two routes the account uses, signs with a throwaway key, and records each
// signature's purpose — so the test checks what the real service checks (the purpose per act) and what a chain checks
// (the signature recovers to the key's address).
function stubKeyService() {
  const key = privateKeyToAccount(`0x${'42'.repeat(32)}`);
  const purposes: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/public-key')) return ok({ ethereumAddress: key.address, protectionLevel: 'CVM_WRAPPED' });
    if (url.endsWith('/sign')) {
      const raw = init?.body; const body = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw as Uint8Array)) as { digest: Hex; signingPurpose: string };
      purposes.push(body.signingPurpose);
      return ok({ signature: await key.sign({ hash: body.digest }), signatureEncoding: 'RSV_65', signerAddress: key.address, keyId: 'k-1', protectionLevel: 'CVM_WRAPPED' });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { key, purposes, fetch: f };
}

describe('key-service account', () => {
  it('signs each act under its own purpose, and every signature recovers to the key', async () => {
    const svc = stubKeyService();
    const a = await keyServiceAccount({ tenant: 'faithnet', keyId: 'k-1' }, { token: 't', baseUrl: 'https://kms.test', fetch: svc.fetch });
    expect(a.address).toBe(svc.key.address);

    const digest = keccak256('0x1234');
    expect(await recoverAddress({ hash: digest, signature: await a.sign({ hash: digest }) })).toBe(svc.key.address);
    expect(await recoverMessageAddress({ message: 'hello', signature: await a.signMessage({ message: 'hello' }) })).toBe(svc.key.address);
    const tx = await a.signTransaction({ chainId: 34348, to: svc.key.address, value: 0n, nonce: 0, gas: 21000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, type: 'eip1559' });
    expect(await recoverTransactionAddress({ serializedTransaction: tx as never })).toBe(svc.key.address);
    expect(parseTransaction(tx).chainId).toBe(34348);

    expect(svc.purposes).toEqual(['RAW_32_BYTE_DIGEST', 'PERSONAL_SIGN_DIGEST', 'EIP155_TRANSACTION']);
  });

  it('signs no typed data — its caller is not bound for it', async () => {
    const svc = stubKeyService();
    const a = await keyServiceAccount({ tenant: 'faithnet', keyId: 'k-1' }, { token: 't', baseUrl: 'https://kms.test', fetch: svc.fetch });
    await expect(a.signTypedData({ domain: {}, types: { X: [{ name: 'a', type: 'uint256' }] }, primaryType: 'X', message: { a: 1n } })).rejects.toThrow(/EIP712/);
  });

  it('names the caller token a tenant needs, and refuses when it is absent', () => {
    expect(tokenFor({ AKCS_TOKEN_IMB: ' t ' }, 'imb')).toBe('t');
    expect(() => tokenFor({}, 'faithnet')).toThrow(/no AKCS_TOKEN_FAITHNET/);
  });
});
