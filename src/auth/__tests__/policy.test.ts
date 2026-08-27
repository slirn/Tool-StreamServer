import { describe, expect, it } from 'vitest';
import { HmacAuthPolicy } from '../policy.js';
import { streamSign } from '../signature.js';

const SECRET = 'policy-test-secret-0123456789';

function policy(): HmacAuthPolicy {
  return new HmacAuthPolicy(SECRET);
}

describe('HmacAuthPolicy', () => {
  it('verifyPublish：合法签名通过', async () => {
    const expire = Math.floor(Date.now() / 1000) + 300;
    const sign = streamSign(SECRET, '/live/a', expire);
    const result = await policy().verifyPublish({ key: 'live/a', query: { expire: String(expire), sign } });
    expect(result).toEqual({ ok: true });
  });

  it('verifyPublish 拒绝路径：缺参/过期/篡改/非法 key 重建', async () => {
    const p = policy();
    expect((await p.verifyPublish({ key: 'live/a', query: {} })).reason).toBe('missing-expire');
    const expire = Math.floor(Date.now() / 1000) + 300;
    const sign = streamSign(SECRET, '/live/a', expire);
    expect((await p.verifyPublish({ key: 'live/a', query: { expire: '1', sign } })).reason).toBe('expired');
    expect((await p.verifyPublish({ key: 'live/a', query: { expire: String(expire), sign: 'f'.repeat(64) } })).reason).toBe('sign-mismatch');
    // key 与重建路径不一致（签名针对 /live/b，用 key live/a 校验）→ 拒绝
    const otherSign = streamSign(SECRET, '/live/b', expire);
    expect((await p.verifyPublish({ key: 'live/a', query: { expire: String(expire), sign: otherSign } })).reason).toBe('sign-mismatch');
    expect((await p.verifyPublish({ key: 'live/a', query: undefined })).reason).toBe('missing-expire');
  });

  it('verifyPlay：v1 恒开放', async () => {
    const result = await policy().verifyPlay({ key: 'live/a', query: {} });
    expect(result).toEqual({ ok: true });
  });
});
