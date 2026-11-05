// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { destroySharedBridge } from '../src/bridge';
import { CherryMiniApp } from '../src/client';
import { CherryMiniAppProvider, useCherryContext, useCherryMiniApp } from '../src/react';
import type { CherryContext } from '../src/types';
import { deliver, fakeToken, flush, installFakeParent, restoreParent, setUrl, type FakeParent } from './helpers/host';

const HOST = 'https://chat.cherry.fun';
let host: FakeParent;

const roomClaims = {
  iss: 'https://chat.cherry.fun',
  aud: 'app_1',
  sub: 'Identity111',
  app_id: 'app_1',
  room_id: 'room_1',
  cherry_id: 'cid_7',
  payment_wallet: 'Payer111',
  payment_wallet_kind: 'external',
  payment_wallet_set_by: 'user',
  permissions: ['wallet:sign', 'navigate:profile'],
  reach: 'project',
  tier: 'verified',
  user: { display_name: 'Alice', avatar_url: '' },
  room: { title: 'Lobby', member_count: 2 },
  iat: 1,
  exp: 2,
  jti: 'j',
};

beforeEach(() => {
  host = installFakeParent();
  setUrl('/?cherry_embed=1');
});

afterEach(() => {
  destroySharedBridge();
  restoreParent();
  setUrl('/');
});

async function launch(claims: Record<string, unknown>, capabilities: string[] = []): Promise<CherryMiniApp> {
  const app = new CherryMiniApp();
  const ready = app.init();
  deliver({ type: 'cherry:init', version: 2, token: fakeToken(claims), capabilities }, { origin: HOST, source: host.window });
  await ready;
  return app;
}

describe('CherryMiniApp context', () => {
  it('is empty before init', () => {
    const app = new CherryMiniApp();
    expect(app.context).toBeNull();
    expect(app.appId).toBeNull();
    expect(app.permissions).toEqual([]);
    expect(app.claims).toBeNull();
    app.destroy();
  });

  it('exposes the room-launch claims', async () => {
    const app = await launch(roomClaims, ['wallet:sign', 'navigate:profile', 'wallet-switch']);
    expect(app.context).toEqual<CherryContext>({
      appId: 'app_1',
      cherryId: 'cid_7',
      paymentWallet: 'Payer111',
      paymentWalletKind: 'external',
      paymentWalletSetBy: 'user',
      permissions: ['wallet:sign', 'navigate:profile'],
      reach: 'project',
      tier: 'verified',
      mode: 'fullscreen',
      hostCapabilities: ['wallet-switch'],
      // No context v2 from this host, nothing in the URL or the token.
      locale: null,
      colorScheme: null,
      brand: null,
      platform: null,
      appVersion: null,
      safeArea: null,
      user: null,
    });
    expect(app.cherryId).toBe('cid_7');
    expect(app.paymentWallet).toBe('Payer111');
    expect(app.tier).toBe('verified');
    expect(app.hasPermission('wallet:sign')).toBe(true);
    expect(app.hasPermission('wallet:send')).toBe(false);
    expect(app.claims?.sub).toBe('Identity111');
    // The identity wallet is unchanged by the payment wallet.
    expect(app.user.publicKey).toBe('Identity111');
    app.destroy();
  });

  it('copes with a token that predates the new claims', async () => {
    const legacy: Record<string, unknown> = { ...roomClaims };
    for (const k of ['aud', 'cherry_id', 'payment_wallet', 'payment_wallet_kind', 'payment_wallet_set_by', 'permissions', 'reach', 'tier']) {
      delete legacy[k];
    }
    const app = await launch({ ...legacy, tier: 'platinum' }, ['wallet:sign', 'wallet-switch']);
    expect(app.context).toMatchObject({
      appId: 'app_1',
      cherryId: null,
      paymentWallet: null,
      paymentWalletKind: null,
      permissions: ['wallet:sign'],
      reach: null,
      tier: null,
      hostCapabilities: ['wallet-switch'],
    });
    app.destroy();
  });

  it('takes the viewer identity from host.init in an inline blink', async () => {
    const token = fakeToken({ iss: 'https://chat.cherry.fun', aud: 'mini_1', scope: 'inline', app_id: 'bot_1', mini_app_id: 'mini_1', tier: 'unverified', message_id: 'm1' });
    setUrl(`/inline?cherry_embed=1#token=${token}&mode=inline`);
    const app = new CherryMiniApp();
    const ready = app.init();
    const { id } = host.lastRequest();
    deliver(
      {
        type: 'cherry:response',
        id,
        result: {
          viewerWallet: 'Viewer111',
          viewerCherryId: 'cid_viewer',
          viewerPaymentWallet: 'ViewerPayer',
          viewerPaymentWalletKind: 'app_held',
          capabilities: ['wallet-switch'],
        },
      },
      { origin: HOST, source: host.window },
    );
    await ready;
    expect(app.context).toMatchObject({
      appId: 'mini_1',
      cherryId: 'cid_viewer',
      paymentWallet: 'ViewerPayer',
      paymentWalletKind: 'app_held',
      tier: 'unverified',
      mode: 'inline',
      permissions: [],
    });
    app.destroy();
  });
});

describe('React context hooks', () => {
  it('provides the context once the handshake completes', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const seen: Array<CherryContext | null> = [];
    let fromMiniApp: CherryContext | null = null;
    function Probe() {
      seen.push(useCherryContext());
      fromMiniApp = useCherryMiniApp().context;
      return null;
    }
    const el = document.createElement('div');
    const root = createRoot(el);
    await act(async () => {
      root.render(createElement(CherryMiniAppProvider, null, createElement(Probe)));
    });
    expect(seen[seen.length - 1]).toBeNull();

    await act(async () => {
      deliver({ type: 'cherry:init', version: 2, token: fakeToken(roomClaims), capabilities: [] }, { origin: HOST, source: host.window });
      await flush();
    });
    expect(seen[seen.length - 1]).toMatchObject({ appId: 'app_1', tier: 'verified', paymentWallet: 'Payer111' });
    expect(fromMiniApp).toMatchObject({ cherryId: 'cid_7' });
    await act(async () => root.unmount());
  });
});
