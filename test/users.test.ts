// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { destroySharedBridge } from '../src/bridge';
import { CherryMiniApp } from '../src/client';
import { CherryApiError, cherryApiOrigin, createCherryUsersApi } from '../src/users';
import { deliver, fakeToken, installFakeParent, restoreParent, setUrl, type FakeParent } from './helpers/host';

const HOST = 'https://chat.cherry.fun';

const profileBody = {
  cherryId: 'cid_7',
  handle: 'alice',
  displayName: 'Alice',
  avatarUrl: 'https://cdn.cherry.fun/a.png',
  bio: 'gm',
  createdAt: '2026-01-01T00:00:00.000Z',
  level: { level: 4, cp: 1200 },
  pet: { name: 'Bun', species: 'cat', stage: 'teen', imageUrl: null },
  socials: [],
  wallets: [{ address: 'Wallet111', chain: 'solana', cherryWallet: true, domains: [] }],
  badges: [{ id: 'early', label: 'Early', iconUrl: null }],
  social: { followers: 3, following: 5 },
  trading: { pnlUsd: 12.5, volumeUsd: 900, window: '30d' },
};

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

function api(token: string | null, fetchImpl: typeof fetch, trusted: readonly string[] = []) {
  return createCherryUsersApi({ getToken: () => token, trustedOrigins: () => trusted, fetch: fetchImpl });
}

const token = fakeToken({ iss: HOST, sub: 'S', exp: 9e9 });

async function rejection(promise: Promise<unknown>): Promise<CherryApiError> {
  const error = await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CherryApiError);
  return error as CherryApiError;
}

describe('cherryApiOrigin', () => {
  it('is the token issuer when it is a trusted Cherry origin', () => {
    expect(cherryApiOrigin(token)).toBe(HOST);
    expect(cherryApiOrigin(fakeToken({ iss: 'https://chat.cherry.fun/' }))).toBe(HOST);
    expect(cherryApiOrigin(fakeToken({}))).toBe(HOST); // no iss = production
    expect(cherryApiOrigin(fakeToken({ iss: 'https://stage.example.com' }), ['https://stage.example.com'])).toBe(
      'https://stage.example.com',
    );
  });

  it('refuses any other issuer', () => {
    for (const iss of ['https://evil.example.com', 'http://chat.cherry.fun', 'not a url', 42]) {
      expect(() => cherryApiOrigin(fakeToken({ iss }))).toThrowError(
        expect.objectContaining({ code: 'UNTRUSTED_ISSUER' }) as Error,
      );
    }
  });
});

describe('users API', () => {
  it('me() reads /api/miniapp/me with the launch token, no cookies', async () => {
    const fetchImpl = respond(200, profileBody);
    const me = await api(token, fetchImpl as unknown as typeof fetch).me();
    expect(me).toEqual(profileBody);
    expect(fetchImpl).toHaveBeenCalledWith(`${HOST}/api/miniapp/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      credentials: 'omit',
    });
  });

  it('get(), followers(), following(), relationship() hit their paths', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/relationship')) return new Response(JSON.stringify({ following: true, followedBy: false }));
      if (url.includes('/follow')) {
        return new Response(
          JSON.stringify({
            items: [{ cherryId: 'cid_2', handle: null, displayName: 'Bob', avatarUrl: null, level: 2 }, { nope: 1 }],
            nextCursor: 'c2',
          }),
        );
      }
      return new Response(JSON.stringify(profileBody));
    });
    const users = api(token, fetchImpl as unknown as typeof fetch);
    expect((await users.get('cid/7')).cherryId).toBe('cid_7');
    const page = await users.followers('cid_7', { cursor: 'c1', limit: 500 });
    expect(page).toEqual({
      items: [{ cherryId: 'cid_2', handle: null, displayName: 'Bob', avatarUrl: null, level: 2 }],
      nextCursor: 'c2',
    });
    await users.following('cid_7', { limit: 0 });
    await users.following('cid_7');
    expect(await users.relationship('cid_7')).toEqual({ following: true, followedBy: false });
    expect(calls).toEqual([
      `${HOST}/api/miniapp/users/cid%2F7`,
      `${HOST}/api/miniapp/users/cid_7/followers?cursor=c1&limit=100`,
      `${HOST}/api/miniapp/users/cid_7/following?limit=1`,
      `${HOST}/api/miniapp/users/cid_7/following`,
      `${HOST}/api/miniapp/users/cid_7/relationship`,
    ]);
  });

  it('accepts a { data } wrapped answer', async () => {
    const me = await api(token, respond(200, { data: profileBody }) as unknown as typeof fetch).me();
    expect(me.cherryId).toBe('cid_7');
  });

  it.each([
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [500, 'HTTP_ERROR'],
  ])('maps HTTP %i to %s', async (status, code) => {
    const error = await rejection(
      api(token, respond(status, { code: 'SERVER_CODE', message: 'nope' }) as unknown as typeof fetch).me(),
    );
    expect(error).toMatchObject({ code, status, serverCode: 'SERVER_CODE', message: 'nope' });
  });

  it('rejects an answer that is not the documented shape', async () => {
    const error = await rejection(api(token, respond(200, { hello: 'world' }) as unknown as typeof fetch).me());
    expect(error.code).toBe('INVALID_RESPONSE');
    const rel = await rejection(api(token, respond(200, { following: 'yes' }) as unknown as typeof fetch).relationship('c'));
    expect(rel.code).toBe('INVALID_RESPONSE');
  });

  it('reports a network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const error = await rejection(api(token, fetchImpl as unknown as typeof fetch).me());
    expect(error).toMatchObject({ code: 'NETWORK_ERROR', status: null });
  });

  it('never sends the token to an untrusted issuer', async () => {
    const fetchImpl = respond(200, profileBody);
    const error = await rejection(api(fakeToken({ iss: 'https://evil.example.com' }), fetchImpl as unknown as typeof fetch).me());
    expect(error.code).toBe('UNTRUSTED_ISSUER');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('NOT_READY without a token; a bad cherryId rejects (never throws synchronously)', async () => {
    const fetchImpl = respond(200, profileBody);
    expect((await rejection(api(null, fetchImpl as unknown as typeof fetch).me())).code).toBe('NOT_READY');
    const users = api(token, fetchImpl as unknown as typeof fetch);
    const pending = users.get('');
    await expect(pending).rejects.toBeInstanceOf(TypeError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('cherry.users on the client', () => {
  let host: FakeParent;

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    host = installFakeParent();
    setUrl('/?cherry_embed=1');
  });

  afterEach(() => {
    destroySharedBridge();
    restoreParent();
    vi.unstubAllGlobals();
    setUrl('/');
  });

  it('uses the launch token from init, and the trustedOrigins for a staging issuer', async () => {
    const fetchImpl = respond(200, profileBody);
    vi.stubGlobal('fetch', fetchImpl);
    const app = new CherryMiniApp({ trustedOrigins: ['https://stage.example.com'] });
    expect((await rejection(app.users.me())).code).toBe('NOT_READY');

    const launchToken = fakeToken({
      iss: 'https://stage.example.com',
      sub: 'S',
      app_id: 'a',
      room_id: 'r',
      user: { display_name: '', avatar_url: '' },
      room: { title: '', member_count: 1 },
    });
    const ready = app.init();
    deliver(
      { type: 'cherry:init', version: 2, token: launchToken, capabilities: [] },
      { origin: 'https://stage.example.com', source: host.window },
    );
    await ready;
    expect((await app.users.me()).cherryId).toBe('cid_7');
    expect(fetchImpl).toHaveBeenCalledWith('https://stage.example.com/api/miniapp/me', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Bearer ${launchToken}` }) as unknown,
    }));
    app.destroy();
  });
});
