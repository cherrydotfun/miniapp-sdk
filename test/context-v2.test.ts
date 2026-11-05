// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { destroySharedBridge } from '../src/bridge';
import { CherryMiniApp } from '../src/client';
import { applyCherryContextToDocument, normaliseProfile, readCherryDisplayContext } from '../src/context';
import {
  CherryMiniAppProvider,
  useCherryContext,
  useCherryDisplayContext,
  useCherryUser,
} from '../src/react';
import type { CherryContext, CherryDisplayContext, CherryHostContext, MiniAppPublicProfile } from '../src/types';
import { deliver, fakeToken, flush, installFakeParent, restoreParent, setUrl, type FakeParent } from './helpers/host';

const HOST = 'https://chat.cherry.fun';
let host: FakeParent;

type Win = Window & { __cherry?: boolean; ReactNativeWebView?: { postMessage: (data: string) => void } };

const claims = {
  iss: HOST,
  aud: 'app_1',
  sub: 'Identity111',
  app_id: 'app_1',
  room_id: 'room_1',
  user: { display_name: 'Alice', avatar_url: '' },
  room: { title: 'Lobby', member_count: 2 },
  iat: 1,
  exp: 2,
  jti: 'j',
};

const profile: MiniAppPublicProfile = {
  cherryId: 'cid_7',
  handle: 'alice',
  displayName: 'Alice',
  avatarUrl: null,
  bio: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  level: { level: 4, cp: 1200 },
  pet: null,
  socials: [{ provider: 'x', handle: 'alice', url: null, verified: true }],
  wallets: [{ address: 'Wallet111', chain: 'solana', cherryWallet: true, domains: ['alice.sol'] }],
  badges: [],
  social: { followers: 3, following: 5 },
  trading: null,
};

const hostContext: CherryHostContext = {
  v: 2,
  locale: 'ru',
  colorScheme: 'dark',
  brand: 'cherry',
  platform: 'ios',
  appVersion: '0.16.0',
  safeArea: { top: 0, right: 0, bottom: 34, left: 0 },
};

const display = (ctx: CherryContext | null): CherryDisplayContext | null =>
  ctx && {
    locale: ctx.locale,
    colorScheme: ctx.colorScheme,
    brand: ctx.brand,
    platform: ctx.platform,
    appVersion: ctx.appVersion,
    safeArea: ctx.safeArea,
  };

function init(context?: unknown, tokenClaims: Record<string, unknown> = claims) {
  deliver(
    { type: 'cherry:init', version: 2, token: fakeToken(tokenClaims), capabilities: [], ...(context ? { context } : {}) },
    { origin: HOST, source: host.window },
  );
}

function pushContext(context: unknown, origin = HOST, source: unknown = host.window) {
  deliver({ type: 'cherry:context', context }, { origin, source });
}

async function launch(context?: unknown, tokenClaims?: Record<string, unknown>): Promise<CherryMiniApp> {
  const app = new CherryMiniApp();
  const ready = app.init();
  init(context, tokenClaims);
  await ready;
  return app;
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  host = installFakeParent();
  setUrl('/?cherry_embed=1');
});

afterEach(() => {
  destroySharedBridge();
  restoreParent();
  delete (window as Win).__cherry;
  delete (window as Win).ReactNativeWebView;
  setUrl('/');
  document.documentElement.removeAttribute('lang');
  document.documentElement.removeAttribute('data-cherry-theme');
  document.documentElement.style.removeProperty('color-scheme');
});

describe('context v2 — init', () => {
  it('reads the cherry:init context', async () => {
    const app = await launch({ ...hostContext, user: profile });
    expect(display(app.context)).toEqual({
      locale: 'ru',
      colorScheme: 'dark',
      brand: 'cherry',
      platform: 'ios',
      appVersion: '0.16.0',
      safeArea: { top: 0, right: 0, bottom: 34, left: 0 },
    });
    expect(app.context?.user).toEqual(profile);
    // The launch half is untouched.
    expect(app.context).toMatchObject({ appId: 'app_1', mode: 'fullscreen' });
    app.destroy();
  });

  it('falls back to cherry_lang / cherry_theme, then the token locale claim', async () => {
    setUrl('/?cherry_embed=1&cherry_lang=de&cherry_theme=light');
    let app = await launch(undefined, { ...claims, locale: 'ja' });
    expect(display(app.context)).toMatchObject({ locale: 'de', colorScheme: 'light', safeArea: null, platform: null });
    app.destroy();

    setUrl('/?cherry_embed=1');
    app = await launch(undefined, { ...claims, locale: 'ja' });
    expect(app.context?.locale).toBe('ja');
    expect(app.context?.colorScheme).toBeNull();
    app.destroy();
  });

  it('the host context wins over the URL; an invalid field falls through to the next source', async () => {
    setUrl('/?cherry_embed=1&cherry_lang=de&cherry_theme=light');
    const app = await launch({
      ...hostContext,
      locale: '<script>',
      colorScheme: 'sepia',
      platform: 'windows',
      safeArea: { top: 1, right: 'x', bottom: 0, left: 0 },
      appVersion: 7,
    });
    expect(display(app.context)).toEqual({
      locale: 'de',
      colorScheme: 'light',
      brand: 'cherry',
      platform: null,
      appVersion: null,
      safeArea: null,
    });
    app.destroy();
  });

  it('clamps negative insets to zero', async () => {
    const app = await launch({ ...hostContext, safeArea: { top: -5, right: 0, bottom: 20.5, left: 0 } });
    expect(app.context?.safeArea).toEqual({ top: 0, right: 0, bottom: 20.5, left: 0 });
    app.destroy();
  });
});

describe('context v2 — live updates', () => {
  it('follows cherry:context and tells onContextChange, once per real change', async () => {
    const app = new CherryMiniApp();
    const seen: CherryContext[] = [];
    app.onContextChange((ctx) => seen.push(ctx));
    const ready = app.init();
    init(hostContext);
    await ready;
    expect(seen).toHaveLength(1); // the initial resolution

    pushContext({ ...hostContext, locale: 'fr', safeArea: { top: 0, right: 44, bottom: 21, left: 44 } });
    expect(seen).toHaveLength(2);
    expect(app.context?.locale).toBe('fr');
    expect(app.context?.safeArea).toEqual({ top: 0, right: 44, bottom: 21, left: 44 });
    expect(seen[1]).toBe(app.context);

    // The same values again: no call, same object.
    const before = app.context;
    pushContext({ ...hostContext, locale: 'fr', safeArea: { top: 0, right: 44, bottom: 21, left: 44 } });
    expect(seen).toHaveLength(2);
    expect(app.context).toBe(before);
    app.destroy();
  });

  it('unsubscribes', async () => {
    const app = await launch(hostContext);
    const listener = vi.fn();
    const off = app.onContextChange(listener);
    pushContext({ ...hostContext, colorScheme: 'light' });
    off();
    pushContext({ ...hostContext, colorScheme: 'dark' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(app.context?.colorScheme).toBe('dark');
    app.destroy();
  });

  it('a throwing listener does not stop the others', async () => {
    const app = await launch(hostContext);
    const second = vi.fn();
    app.onContextChange(() => {
      throw new Error('boom');
    });
    app.onContextChange(second);
    pushContext({ ...hostContext, locale: 'es' });
    expect(second).toHaveBeenCalledOnce();
    app.destroy();
  });

  it('keeps the last user when an update leaves it out, and takes a new one', async () => {
    const app = await launch({ ...hostContext, user: profile });
    pushContext({ ...hostContext, locale: 'ko' });
    expect(app.context?.locale).toBe('ko');
    expect(app.context?.user?.cherryId).toBe('cid_7');
    pushContext({ ...hostContext, user: { ...profile, displayName: 'Alice B' } });
    expect(app.context?.user?.displayName).toBe('Alice B');
    app.destroy();
  });

  it('applies a cherry:context that arrived before init() was called', async () => {
    const app = new CherryMiniApp();
    init(hostContext); // buffered — the app has not called init() yet
    pushContext({ ...hostContext, locale: 'vi' });
    await app.init();
    expect(app.context?.locale).toBe('vi');
    app.destroy();
  });

  it('a repeated cherry:init carries the current context', async () => {
    const app = await launch(hostContext);
    init({ ...hostContext, locale: 'id' });
    expect(app.context?.locale).toBe('id');
    app.destroy();
  });
});

describe('context v2 — origin rules (iframe)', () => {
  it('ignores cherry:context from another origin once locked', async () => {
    const app = await launch(hostContext);
    pushContext({ ...hostContext, locale: 'zh' }, 'https://evil.example.com');
    pushContext({ ...hostContext, locale: 'zh' }, 'https://stage.cherry.fun'); // trusted, but not THE host
    expect(app.context?.locale).toBe('ru');
    app.destroy();
  });

  it('ignores cherry:context from a frame that is not window.parent', async () => {
    const app = await launch(hostContext);
    pushContext({ ...hostContext, locale: 'zh' }, HOST, window);
    expect(app.context?.locale).toBe('ru');
    app.destroy();
  });

  it('a cherry:context never locks the origin by itself', async () => {
    const app = new CherryMiniApp();
    const ready = app.init();
    pushContext({ ...hostContext, locale: 'zh' }, 'https://stage.cherry.fun');
    init(hostContext); // the real host locks it
    await ready;
    expect(app.context?.locale).toBe('ru');
    pushContext({ ...hostContext, locale: 'zh' }, 'https://stage.cherry.fun');
    expect(app.context?.locale).toBe('ru');
    app.destroy();
  });
});

describe('context v2 — WebView (Cherry mobile)', () => {
  beforeEach(() => {
    restoreParent();
    (window as Win).__cherry = true;
    (window as Win).ReactNativeWebView = { postMessage: vi.fn() };
  });

  it('accepts host-injected cherry:context only', async () => {
    const app = new CherryMiniApp();
    const ready = app.init();
    deliver({ type: 'cherry:init', version: 2, token: fakeToken(claims), capabilities: [], context: hostContext });
    await ready;
    deliver({ type: 'cherry:context', context: { ...hostContext, platform: 'android', locale: 'es' } });
    expect(app.context).toMatchObject({ platform: 'android', locale: 'es' });
    // A frame inside the mini-app is not the host.
    deliver({ type: 'cherry:context', context: { ...hostContext, locale: 'zh' } }, { source: {} });
    expect(app.context?.locale).toBe('es');
    app.destroy();
  });

  it('reads the context from the inline host.init answer, then follows cherry:context', async () => {
    const token = fakeToken({ iss: HOST, aud: 'mini_1', scope: 'inline', mini_app_id: 'mini_1', message_id: 'm1', locale: 'ja' });
    setUrl(`/inline?cherry_embed=1&cherry_lang=de#token=${token}&mode=inline`);
    const posted = (window as Win).ReactNativeWebView!.postMessage as ReturnType<typeof vi.fn>;
    const app = new CherryMiniApp();
    const ready = app.init();
    const request = JSON.parse(String(posted.mock.calls[0]?.[0])) as { id: string };
    deliver({
      type: 'cherry:response',
      id: request.id,
      result: { viewerWallet: 'Viewer111', context: { ...hostContext, platform: 'android', user: profile } },
    });
    await ready;
    expect(app.context).toMatchObject({ mode: 'inline', locale: 'ru', platform: 'android' });
    expect(app.context?.user?.cherryId).toBe('cid_7');
    deliver({ type: 'cherry:context', context: { ...hostContext, colorScheme: 'light' } });
    expect(app.context?.colorScheme).toBe('light');
    expect(app.context?.user?.cherryId).toBe('cid_7');
    app.destroy();
  });

  it('an inline host without context: URL first, then the token claim', async () => {
    const token = fakeToken({ iss: HOST, scope: 'inline', mini_app_id: 'mini_1', locale: 'ja' });
    setUrl(`/inline?cherry_embed=1&cherry_theme=dark#token=${token}&mode=inline`);
    const posted = (window as Win).ReactNativeWebView!.postMessage as ReturnType<typeof vi.fn>;
    const app = new CherryMiniApp();
    const ready = app.init();
    const request = JSON.parse(String(posted.mock.calls[0]?.[0])) as { id: string };
    deliver({ type: 'cherry:response', id: request.id, result: { viewerWallet: 'Viewer111' } });
    await ready;
    expect(display(app.context)).toMatchObject({ locale: 'ja', colorScheme: 'dark', safeArea: null });
    expect(app.context?.user).toBeNull();
    app.destroy();
  });
});

describe('readCherryDisplayContext', () => {
  it('reads the current URL before init', () => {
    setUrl('/?cherry_embed=1&cherry_lang=fr&cherry_theme=light');
    expect(readCherryDisplayContext()).toEqual({
      locale: 'fr',
      colorScheme: 'light',
      brand: null,
      platform: null,
      appVersion: null,
      safeArea: null,
    });
  });

  it('reads a given URL (SSR), the fragment, and the inline token claim', () => {
    const token = fakeToken({ locale: 'ko' });
    expect(readCherryDisplayContext(`/inline?cherry_embed=1#token=${token}&mode=inline`).locale).toBe('ko');
    expect(readCherryDisplayContext(new URL('https://app.example.com/?cherry_lang=zh-TW')).locale).toBe('zh-TW');
    expect(readCherryDisplayContext('/?cherry_lang=en&cherry_theme=purple')).toMatchObject({ locale: 'en', colorScheme: null });
    expect(readCherryDisplayContext('/?cherry_lang=%3Cb%3E').locale).toBeNull();
    expect(readCherryDisplayContext('/#token=not-a-jwt').locale).toBeNull();
  });
});

describe('applyCherryContextToDocument', () => {
  it('sets lang, data-cherry-theme and color-scheme', () => {
    applyCherryContextToDocument({ locale: 'de', colorScheme: 'light' });
    const root = document.documentElement;
    expect(root.lang).toBe('de');
    expect(root.getAttribute('data-cherry-theme')).toBe('light');
    expect(root.style.getPropertyValue('color-scheme')).toBe('light');
  });

  it('leaves unknown fields alone and ignores junk', () => {
    applyCherryContextToDocument({ locale: 'de', colorScheme: 'dark' });
    applyCherryContextToDocument({ locale: null, colorScheme: null });
    applyCherryContextToDocument(null);
    applyCherryContextToDocument({ locale: '"><img>' as string, colorScheme: 'blue' as 'dark' });
    expect(document.documentElement.lang).toBe('de');
    expect(document.documentElement.getAttribute('data-cherry-theme')).toBe('dark');
  });

  it('is never applied by the SDK itself', async () => {
    const app = await launch(hostContext);
    expect(document.documentElement.hasAttribute('data-cherry-theme')).toBe(false);
    expect(document.documentElement.lang).toBe('');
    app.destroy();
  });
});

describe('normaliseProfile', () => {
  it('coerces fields and drops malformed list items', () => {
    expect(
      normaliseProfile({
        cherryId: 'cid_1',
        displayName: 42,
        level: { level: 2 },
        socials: [{ provider: 'x', handle: 'a' }, { provider: 'x' }, 'junk'],
        wallets: [{ address: 'W', chain: 'btc' }, { address: 'V', chain: 'evm', domains: ['v.eth', 3] }],
        badges: [{ id: 'b1' }],
        social: { followers: 'many' },
        privateEmail: 'a@b.c',
      }),
    ).toEqual({
      cherryId: 'cid_1',
      handle: null,
      displayName: '',
      avatarUrl: null,
      bio: null,
      createdAt: null,
      level: { level: 2, cp: 0 },
      pet: null,
      socials: [{ provider: 'x', handle: 'a', url: null, verified: false }],
      wallets: [{ address: 'V', chain: 'evm', cherryWallet: false, domains: ['v.eth'] }],
      badges: [{ id: 'b1', label: 'b1', iconUrl: null }],
      social: { followers: 0, following: 0 },
      trading: null,
    });
    expect(normaliseProfile({ displayName: 'x' })).toBeNull();
    expect(normaliseProfile(null)).toBeNull();
  });
});

describe('React — context v2', () => {
  async function render(probe: () => null) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(createElement(CherryMiniAppProvider, null, createElement(probe)));
    });
    return root;
  }

  it('re-renders the hooks on cherry:context, with the URL before the handshake', async () => {
    setUrl('/?cherry_embed=1&cherry_lang=de&cherry_theme=light');
    const displays: CherryDisplayContext[] = [];
    const contexts: Array<CherryContext | null> = [];
    const users: Array<MiniAppPublicProfile | null> = [];
    const root = await render(function Probe() {
      displays.push(useCherryDisplayContext());
      contexts.push(useCherryContext());
      users.push(useCherryUser());
      return null;
    });
    expect(displays[displays.length - 1]).toMatchObject({ locale: 'de', colorScheme: 'light' });
    expect(contexts[contexts.length - 1]).toBeNull();
    expect(users[users.length - 1]).toBeNull();

    await act(async () => {
      init({ ...hostContext, user: profile });
      await flush();
    });
    expect(displays[displays.length - 1]).toMatchObject({ locale: 'ru', colorScheme: 'dark' });
    expect(users[users.length - 1]?.cherryId).toBe('cid_7');

    await act(async () => {
      pushContext({ ...hostContext, locale: 'fr', colorScheme: 'light' });
      await flush();
    });
    expect(contexts[contexts.length - 1]).toMatchObject({ locale: 'fr', colorScheme: 'light', appId: 'app_1' });
    expect(displays[displays.length - 1]).toMatchObject({ locale: 'fr', colorScheme: 'light' });
    await act(async () => root.unmount());
  });
});
