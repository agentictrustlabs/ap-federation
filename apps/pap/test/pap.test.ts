import { describe, expect, it } from 'vitest';
import worker, { thumbprintOf } from '../src/index.js';

const env = { PUBLIC_ORIGIN: 'https://pap.estate.example', HOME_RETURN: 'https://www.estate.example/oauth/return', ESTATE: 'estate' };
const get = (p: string) => worker.fetch(new Request(`https://pap.estate.example${p}`), env as never);

describe('pap.svc — the public face (spec 443 W1)', () => {
  it('health says what is bound and that the key is a stand-in; a placeholder binding is not live', async () => {
    const h = await (await get('/health')).json() as { bindingLive: boolean; keyHeld: string };
    expect(h.keyHeld).toBe('absent');
    expect(typeof h.bindingLive).toBe('boolean');
  });
  it('the Direct Sign-In return hands the person to HER Home with code and state, keeping nothing', async () => {
    const r = await get('/oauth/return?code=abc&state=xyz');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('https://www.estate.example/oauth/return?code=abc&state=xyz');
  });
  it('a per-person document is never served; the thumbprint helper is the RFC 7638 one', async () => {
    expect((await get('/agents/alice/client.json')).status).toBe(404);
    expect(thumbprintOf({ kty: 'EC', crv: 'P-256', x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU', y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0' })).toBe('oKIywvGUpTVTyxMQ3bwIIeQUudfr_CkLMjCE19ECD-U');
  });
});
