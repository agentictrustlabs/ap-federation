import { describe, expect, it } from 'vitest';
import { encodeChallengeHeader, issueChallenge, verifyChallengeHeader } from '../src/challenge';

const SUBJECT = '0x1111111111111111111111111111111111111111' as const;
const AUD = 'https://door.example';

describe('the challenge ticket', () => {
  it('is recognised by the door that issued it, for that subject and audience, until it expires', async () => {
    const c = await issueChallenge('s3cret', SUBJECT, AUD, 300, () => 1000);
    const h = encodeChallengeHeader(c);
    expect(await verifyChallengeHeader('s3cret', h, SUBJECT, AUD, () => 1100)).toEqual({ ok: true, nonce: c.nonce, audience: AUD });
    expect((await verifyChallengeHeader('s3cret', h, SUBJECT, AUD, () => 1301)).ok).toBe(false);
    expect((await verifyChallengeHeader('s3cret', h, '0x2222222222222222222222222222222222222222', AUD, () => 1100)).ok).toBe(false);
    expect((await verifyChallengeHeader('s3cret', h, SUBJECT, 'https://other.example', () => 1100)).ok).toBe(false);
    expect((await verifyChallengeHeader('other', h, SUBJECT, AUD, () => 1100)).ok).toBe(false);
    expect((await verifyChallengeHeader('s3cret', 'garbage', SUBJECT, AUD, () => 1100)).ok).toBe(false);
  });
});
