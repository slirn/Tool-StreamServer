import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdminApi, listenAdminApi, type AdminApiDeps } from '../server.js';

function makeDeps(overrides: Partial<AdminApiDeps> = {}): AdminApiDeps {
  return {
    listStreams: () => [{ key: 'live/a', startedAt: 1, publisher: 'p' }],
    kickStream: vi.fn(() => true),
    listRecords: () => [{ name: 'live~a_20260827-120000.flv', sizeBytes: 10, startedAt: '2026-08-27T04:00:00Z' }],
    startRecord: vi.fn(() => true),
    stopRecord: vi.fn(async () => true),
    removeRecord: vi.fn(() => true),
    ...overrides,
  };
}

describe('Admin API 契约', () => {
  let close: () => Promise<void>;
  let base: string;
  const startRecordSpy = vi.fn(() => true);

  beforeAll(async () => {
    const deps = makeDeps({ startRecord: startRecordSpy });
    const api = createAdminApi({ deps, adminToken: 'secret-tok', logger: console });
    const srv = await listenAdminApi(api.handle, 0);
    close = srv.close;
    base = `http://127.0.0.1:${srv.port}`;
  });
  afterAll(() => void close());

  const get = (p: string, token?: string) =>
    fetch(base + p, token ? { headers: { 'x-admin-token': token } } : {});
  const del = (p: string, token?: string) =>
    fetch(base + p, { method: 'DELETE', headers: token ? { 'x-admin-token': token } : {} });
  const post = (p: string, body: unknown, token?: string) =>
    fetch(base + p, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-admin-token': token } : {}) },
      body: JSON.stringify(body),
    });

  it('GET /healthz 开放且返回统一包', async () => {
    const res = await get('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: 0, message: 'ok', data: { status: 'up' } });
  });

  it('GET /api/v1/streams 返回分页结构', async () => {
    const res = await get('/api/v1/streams');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(0);
    expect(body.data.items[0]).toEqual({ key: 'live/a', startedAt: 1, publisher: 'p' });
    expect(body.data.total).toBe(1);
  });

  it('写操作无 token → 401/40101', async () => {
    const res = await del('/api/v1/streams/live%2Fa');
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe(40101);
  });

  it('写操作错误 token → 401；正确 token → 200', async () => {
    expect((await del('/api/v1/streams/live%2Fa', 'wrong')).status).toBe(401);
    const ok = await del('/api/v1/streams/live%2Fa', 'secret-tok');
    expect(ok.status).toBe(200);
  });

  it('DELETE 不存在的流 → 404/40401', async () => {
    const deps404 = makeDeps({ kickStream: () => false });
    const api2 = createAdminApi({ deps: deps404, adminToken: 'secret-tok', logger: console });
    const srv2 = await listenAdminApi(api2.handle, 0);
    try {
      const res = await fetch(`http://127.0.0.1:${srv2.port}/api/v1/streams/live%2Fnone`, {
        method: 'DELETE',
        headers: { 'x-admin-token': 'secret-tok' },
      });
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe(40401);
    } finally {
      await srv2.close();
    }
  });

  it('POST /api/v1/records：非法 body → 400；成功 → 200；已在录 → 409', async () => {
    expect((await post('/api/v1/records', { key: 1 }, 'secret-tok')).status).toBe(400);
    expect((await post('/api/v1/records', { key: 'live/../../etc' }, 'secret-tok')).status).toBe(400);
    expect((await post('/api/v1/records', { key: 'live/a' }, 'secret-tok')).status).toBe(200);
    expect(startRecordSpy).toHaveBeenCalledWith('live/a');

    const deps409 = makeDeps({ startRecord: () => false });
    const api3 = createAdminApi({ deps: deps409, adminToken: 'secret-tok', logger: console });
    const srv3 = await listenAdminApi(api3.handle, 0);
    try {
      const res = await fetch(`http://127.0.0.1:${srv3.port}/api/v1/records`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-token': 'secret-tok' },
        body: JSON.stringify({ key: 'live/a' }),
      });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe(40901);
    } finally {
      await srv3.close();
    }
  });

  it('未配置 adminToken：读开放、写拒绝 403/40301（只读模式）', async () => {
    const api4 = createAdminApi({ deps: makeDeps(), logger: console });
    const srv4 = await listenAdminApi(api4.handle, 0);
    try {
      expect((await fetch(`http://127.0.0.1:${srv4.port}/api/v1/streams`)).status).toBe(200);
      const res = await fetch(`http://127.0.0.1:${srv4.port}/api/v1/streams/live%2Fa`, { method: 'DELETE' });
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe(40301);
    } finally {
      await srv4.close();
    }
  });

  it('未路由 → 404；方法不符 → 404', async () => {
    expect((await get('/api/v1/none')).status).toBe(404);
    expect((await post('/api/v1/streams', {}, 'secret-tok')).status).toBe(404);
  });
});
