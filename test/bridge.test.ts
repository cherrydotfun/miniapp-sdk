// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bridge, BridgeError, destroySharedBridge, isTrustedHostOrigin } from '../src/bridge';
import { CherryMiniApp } from '../src/client';
import { deliver, fakeToken, flush, installFakeParent, restoreParent, setUrl, type FakeParent } from './helpers/host';

const HOST = 'https://chat.cherry.fun';

type Win = Window & { __cherry?: boolean; ReactNativeWebView?: { postMessage: (data: string) => void } };

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  destroySharedBridge();
  restoreParent();
  delete (window as Win).__cherry;
  delete (window as Win).ReactNativeWebView;
  setUrl('/');
});

describe('isTrustedHostOrigin', () => {
  it.each([
    ['https://chat.cherry.fun', true],
    ['https://cherry.fun', true],
    ['https://stage.cherry.fun', true],
    ['https://a.b.cherry.fun', true],
    ['http://chat.cherry.fun', false],
    ['https://chat.cherry.fun:8443', false],
    ['https://evilcherry.fun', false],
    ['https://cherry.fun.evil.com', false],
    ['https://evil.com', false],
    ['null', false],
    ['', false],
  ])('%s → %s', (origin, trusted) => {
    expect(isTrustedHostOrigin(origin)).toBe(trusted);
  });

  it('accepts configured extra origins and wildcards', () => {
    expect(isTrustedHostOrigin('https://staging.example.com', ['https://staging.example.com'])).toBe(true);
    expect(isTrustedHostOrigin('https://pr-1.preview.example.com', ['https://*.preview.example.com'])).toBe(true);
    expect(isTrustedHostOrigin('https://preview.example.com', ['https://*.preview.example.com'])).toBe(false);
  });
});

describe('Bridge — iframe mode', () => {
  let host: FakeParent;

  beforeEach(() => {
    host = installFakeParent();
  });

  it('accepts a response only from window.parent on a trusted origin', async () => {
    const bridge = new Bridge();
    deliver({ type: 'cherry:init', version: 2, token: 't', capabilities: [] }, { origin: HOST, source: host.window });
    const result = bridge.request('wallet.connect');
    const { id } = host.lastRequest();

    // Wrong origin, right source → dropped.
    deliver({ type: 'cherry:response', id, result: { publicKey: 'evil' } }, { origin: 'https://evil.example', source: host.window });
    // Right origin, wrong source (a child frame / popup) → dropped.
    deliver({ type: 'cherry:response', id, result: { publicKey: 'evil' } }, { origin: HOST, source: {} });
    // No source (synthetic event) → dropped in iframe mode.
    deliver({ type: 'cherry:response', id, result: { publicKey: 'evil' } }, { origin: HOST });
    await flush();

    deliver({ type: 'cherry:response', id, result: { publicKey: 'good' } }, { origin: HOST, source: host.window });
    await expect(result).resolves.toEqual({ publicKey: 'good' });
    expect(bridge.ignoredOrigins).toContain('https://evil.example');
    bridge.destroy();
  });

  it('queues requests until the host origin is known, then targets that origin only', () => {
    const bridge = new Bridge();
    void bridge.request('wallet.connect').catch(() => {});
    expect(host.posted).toHaveLength(0);

    deliver({ type: 'cherry:init', version: 2, token: 't', capabilities: [] }, { origin: HOST, source: host.window });
    expect(bridge.hostOrigin).toBe(HOST);
    expect(host.posted).toHaveLength(1);
    expect(host.posted[0]).toMatchObject({ targetOrigin: HOST, message: { method: 'wallet.connect' } });

    bridge.sendToHost({ type: 'cherry:ready', version: 2 });
    expect(host.posted[1]?.targetOrigin).toBe(HOST);
    expect(host.posted.every((p) => p.targetOrigin !== '*')).toBe(true);
    bridge.destroy();
  });

  it('never locks onto an untrusted origin', () => {
    const bridge = new Bridge();
    void bridge.request('wallet.connect').catch(() => {});
    deliver({ type: 'cherry:init', version: 2, token: 't', capabilities: [] }, { origin: 'https://evil.example', source: host.window });
    expect(bridge.hostOrigin).toBeNull();
    expect(host.posted).toHaveLength(0);
    expect(warn).toHaveBeenCalledOnce();
    bridge.destroy();
  });

  it('stays locked: a second trusted origin is ignored after the first', async () => {
    const bridge = new Bridge();
    deliver({ type: 'cherry:init', version: 2, token: 't', capabilities: [] }, { origin: HOST, source: host.window });
    const result = bridge.request('wallet.connect');
    const { id } = host.lastRequest();
    deliver({ type: 'cherry:response', id, result: 'other' }, { origin: 'https://cherry.fun', source: host.window });
    await flush();
    deliver({ type: 'cherry:response', id, result: 'locked' }, { origin: HOST, source: host.window });
    await expect(result).resolves.toBe('locked');
    bridge.destroy();
  });

  it("posts the inline handshake (host.init) with '*' and locks on the answer", async () => {
    const bridge = new Bridge();
    const init = bridge.request('host.init', {});
    const queued = bridge.request('host.resize', { height: 100 });
    expect(host.posted).toHaveLength(1);
    expect(host.posted[0]).toMatchObject({ targetOrigin: '*', message: { method: 'host.init' } });

    const { id } = host.posted[0]!.message as { id: string };
    deliver({ type: 'cherry:response', id, result: { viewerWallet: 'w' } }, { origin: HOST, source: host.window });
    await expect(init).resolves.toEqual({ viewerWallet: 'w' });
    expect(bridge.hostOrigin).toBe(HOST);
    expect(host.posted[1]).toMatchObject({ targetOrigin: HOST, message: { method: 'host.resize' } });
    void queued.catch(() => {});
    bridge.destroy();
  });

  it('accepts a configured staging origin and refuses a wildcard-everything entry', () => {
    const bridge = new Bridge({ trustedOrigins: ['https://staging.example.com/'] });
    expect(bridge.isTrustedOrigin('https://staging.example.com')).toBe(true);
    deliver({ type: 'cherry:init', version: 2, token: 't', capabilities: [] }, { origin: 'https://staging.example.com', source: host.window });
    expect(bridge.hostOrigin).toBe('https://staging.example.com');
    bridge.destroy();
    expect(() => new Bridge({ trustedOrigins: ['*'] })).toThrow(TypeError);
    expect(() => new Bridge({ trustedOrigins: ['https://x.example.com/path'] })).toThrow(TypeError);
  });

  it('turns a coded error response into a BridgeError', async () => {
    const bridge = new Bridge();
    deliver({ type: 'cherry:init', version: 2, token: 't', capabilities: [] }, { origin: HOST, source: host.window });
    const result = bridge.request('wallet.signMessage', { message: 'aGk=' });
    const { id } = host.lastRequest();
    deliver(
      { type: 'cherry:response', id, error: { code: 'USER_REJECTED', message: 'Declined' } },
      { origin: HOST, source: host.window },
    );
    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BridgeError);
    expect(error).toMatchObject({ code: 'USER_REJECTED', message: 'Declined' });
    bridge.destroy();
  });
});

describe('Bridge — WebView mode', () => {
  it('posts through ReactNativeWebView and accepts host-injected events only', async () => {
    const rnw = { postMessage: vi.fn() };
    (window as Win).__cherry = true;
    (window as Win).ReactNativeWebView = rnw;
    const bridge = new Bridge();
    expect(bridge.transport).toBe('webview');

    const result = bridge.request('wallet.connect');
    expect(rnw.postMessage).toHaveBeenCalledOnce();
    const sent = JSON.parse(rnw.postMessage.mock.calls[0]![0] as string) as { id: string; method: string };
    expect(sent.method).toBe('wallet.connect');

    // A frame inside the mini-app posting to it is not the host.
    deliver({ type: 'cherry:response', id: sent.id, result: 'from-child-frame' }, { origin: 'https://ads.example', source: {} });
    await flush();
    // The RN host injects a synthetic MessageEvent (no source, no origin) — as a JSON string here.
    deliver(JSON.stringify({ type: 'cherry:response', id: sent.id, result: 'from-host' }));
    await expect(result).resolves.toBe('from-host');
    bridge.destroy();
  });

  it('strict mode ignores a bare ReactNativeWebView (no Cherry signal)', () => {
    (window as Win).ReactNativeWebView = { postMessage: vi.fn() };
    expect(new Bridge().transport).toBe('webview');
    const strict = new Bridge({ strict: true });
    expect(strict.transport).toBe('none');
    strict.sendToHost({ type: 'cherry:ready', version: 2 });
    expect((window as Win).ReactNativeWebView!.postMessage).not.toHaveBeenCalled();
  });
});

describe('Bridge — not embedded', () => {
  it('does not post to itself at the top level', () => {
    const self = vi.spyOn(window, 'postMessage');
    const bridge = new Bridge();
    expect(bridge.transport).toBe('none');
    bridge.sendToHost({ type: 'cherry:ready', version: 2 });
    expect(self).not.toHaveBeenCalled();
    bridge.destroy();
  });
});

describe('CherryMiniApp handshake', () => {
  let host: FakeParent;
  const token = fakeToken({
    sub: 'Wallet111',
    app_id: 'app_1',
    room_id: 'room_1',
    user: { display_name: 'Alice', avatar_url: '' },
    room: { title: 'Lobby', member_count: 2 },
  });

  beforeEach(() => {
    host = installFakeParent();
    setUrl('/?cherry_embed=1');
  });

  it('acks cherry:init to the locked origin, and acks a resend again', async () => {
    const app = new CherryMiniApp();
    const ready = app.init();
    deliver({ type: 'cherry:init', version: 2, token, capabilities: [] }, { origin: HOST, source: host.window });
    await ready;
    expect(app.user.displayName).toBe('Alice');
    expect(host.sent('cherry:ready')).toHaveLength(1);

    deliver({ type: 'cherry:init', version: 2, token, capabilities: [] }, { origin: HOST, source: host.window });
    expect(host.sent('cherry:ready')).toHaveLength(2);
    expect(host.posted.every((p) => p.targetOrigin === HOST)).toBe(true);
    app.destroy();
  });

  it('accepts a cherry:init that arrived before init() was called', async () => {
    const app = new CherryMiniApp();
    deliver({ type: 'cherry:init', version: 2, token, capabilities: [] }, { origin: HOST, source: host.window });
    await app.init();
    expect(app.room.id).toBe('room_1');
    app.destroy();
  });

  it('ignores a cherry:init from an untrusted origin and says so on timeout', async () => {
    const app = new CherryMiniApp({ initTimeout: 50 });
    const ready = app.init();
    deliver({ type: 'cherry:init', version: 2, token, capabilities: [] }, { origin: 'https://evil.example', source: host.window });
    await expect(ready).rejects.toThrow(/untrusted origin\(s\) https:\/\/evil\.example/);
    expect(host.sent('cherry:ready')).toHaveLength(0);
    app.destroy();
  });

  it('trusts a staging host passed in trustedOrigins', async () => {
    const app = new CherryMiniApp({ trustedOrigins: ['https://staging.example.com'] });
    const ready = app.init();
    deliver({ type: 'cherry:init', version: 2, token, capabilities: [] }, { origin: 'https://staging.example.com', source: host.window });
    await ready;
    expect(host.sent('cherry:ready')).toHaveLength(1);
    app.destroy();
  });

  it('runs the inline handshake through host.init', async () => {
    setUrl(`/inline?cherry_embed=1#token=${token}&mode=inline`);
    const app = new CherryMiniApp();
    const ready = app.init();
    const handshake = host.lastRequest();
    expect(handshake.method).toBe('host.init');
    expect(host.posted[0]?.targetOrigin).toBe('*');
    deliver(
      { type: 'cherry:response', id: handshake.id, result: { viewerWallet: 'Viewer111', roomId: 'room_9', messageId: 'm1', params: { a: 1 } } },
      { origin: HOST, source: host.window },
    );
    await ready;
    expect(app.blink).toMatchObject({ messageId: 'm1', viewerWallet: 'Viewer111', params: { a: 1 } });
    expect(app.getPublicKey()).toBe('Viewer111');
    app.destroy();
  });
});
