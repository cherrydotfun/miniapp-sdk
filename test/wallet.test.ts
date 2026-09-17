import { afterEach, describe, expect, test } from 'bun:test';
import { CherryMiniApp } from '../src/client';
import { BridgeError } from '../src/bridge';
import { createCherrySigner } from '../src/kit';
import { CherryWalletAdapter } from '../src/solana';
import type { CherryWalletChangedEvent } from '../src/types';
import {
  installHost,
  uninstallHost,
  unsignedJwt,
  flush,
  b64,
  SUB,
  PAYER,
  OTHER,
  LEGACY_EMBED_CLAIMS,
  LEGACY_INLINE_CLAIMS,
  type FakeHost,
} from './harness';

afterEach(() => uninstallHost());

const CID = 'cid_alice';

async function fullscreen(
  claims: Record<string, unknown> = {},
  init: Record<string, unknown> = {},
): Promise<{ host: FakeHost; app: CherryMiniApp; token: string }> {
  const host = installHost({ transport: 'webview' });
  const app = new CherryMiniApp();
  const token = unsignedJwt({ ...LEGACY_EMBED_CLAIMS, ...claims });
  const ready = app.init();
  host.post({ type: 'cherry:init', version: 2, token, ...init });
  await ready;
  return { host, app, token };
}

async function inline(hostInit: Record<string, unknown>, claims: Record<string, unknown> = {}) {
  const token = unsignedJwt({ ...LEGACY_INLINE_CLAIMS, ...claims });
  const host = installHost({ transport: 'iframe', hash: `mode=inline&token=${token}` });
  host.answerNext('host.init', { result: hostInit });
  const app = new CherryMiniApp();
  await app.init();
  return { host, app, token };
}

function walletChanged(host: FakeHost, payload: unknown, key: 'payload' | 'data' = 'payload'): void {
  host.post({ type: 'cherry:event', event: 'wallet.changed', [key]: payload });
}

function collect(app: CherryMiniApp): CherryWalletChangedEvent[] {
  const seen: CherryWalletChangedEvent[] = [];
  app.on('wallet.changed', (e) => seen.push(e));
  return seen;
}

describe('publicKey precedence — fullscreen token', () => {
  test('payment_wallet is the payer; sub stays the identity', async () => {
    const { app } = await fullscreen({ cherry_id: CID, payment_wallet: PAYER, payment_wallet_kind: 'app_held' });
    expect(app.wallet.publicKey).toBe(PAYER);
    expect(app.getPublicKey()).toBe(PAYER);
    expect(app.wallet.custodial).toBe(true);
    expect(app.user.publicKey).toBe(SUB);
    expect(app.user.cherryId).toBe(CID);
  });

  test('an external payment wallet is not custodial', async () => {
    const { app } = await fullscreen({ payment_wallet: PAYER, payment_wallet_kind: 'external' });
    expect(app.wallet.publicKey).toBe(PAYER);
    expect(app.wallet.custodial).toBe(false);
  });

  test('no payment_wallet → payer is sub, not custodial, no cherryId key', async () => {
    const { app } = await fullscreen();
    expect(app.wallet.publicKey).toBe(SUB);
    expect(app.wallet.custodial).toBe(false);
    expect(app.user).toStrictEqual({ publicKey: SUB, displayName: 'Alice', avatarUrl: 'https://cdn.example/a.png' });
  });

  test('an empty or non-string payment_wallet falls back to sub', async () => {
    expect((await fullscreen({ payment_wallet: '' })).app.wallet.publicKey).toBe(SUB);
    uninstallHost();
    expect((await fullscreen({ payment_wallet: 42 })).app.wallet.publicKey).toBe(SUB);
  });
});

describe('publicKey precedence — inline host.init', () => {
  test('viewerPaymentWallet is the payer; viewerWallet stays the identity', async () => {
    const { app } = await inline({
      viewerWallet: SUB,
      viewerCherryId: CID,
      viewerPaymentWallet: PAYER,
      viewerPaymentWalletKind: 'app_held',
    });
    expect(app.wallet.publicKey).toBe(PAYER);
    expect(app.wallet.custodial).toBe(true);
    expect(app.user.publicKey).toBe(SUB);
    expect(app.user.cherryId).toBe(CID);
    expect(app.blink?.viewerWallet).toBe(SUB);
  });

  test('without viewerPaymentWallet the payer is viewerWallet', async () => {
    const { app } = await inline({ viewerWallet: SUB, viewerPaymentWalletKind: 'external' });
    expect(app.wallet.publicKey).toBe(SUB);
    expect(app.wallet.custodial).toBe(false);
    expect('cherryId' in app.user).toBe(false);
  });

  test('cherryId falls back to the token claim', async () => {
    const { app } = await inline({ viewerWallet: SUB }, { cherry_id: CID });
    expect(app.user.cherryId).toBe(CID);
  });
});

describe("'wallet.changed'", () => {
  test('fullscreen: updates payer, custody and launch token; identity unchanged', async () => {
    const { host, app } = await fullscreen();
    const seen = collect(app);
    const reminted = unsignedJwt({ ...LEGACY_EMBED_CLAIMS, payment_wallet: PAYER, payment_wallet_kind: 'app_held' });
    walletChanged(host, { publicKey: PAYER, custodial: true, token: reminted });

    expect(seen).toStrictEqual([{ publicKey: PAYER, custodial: true, token: reminted }]);
    expect(app.wallet.publicKey).toBe(PAYER);
    expect(app.getPublicKey()).toBe(PAYER);
    expect(app.wallet.custodial).toBe(true);
    expect(app.launchToken).toBe(reminted);
    expect(app.user.publicKey).toBe(SUB);
  });

  test('inline: emitted and applied; no token keeps the launch token', async () => {
    const { host, app, token } = await inline({ viewerWallet: SUB });
    const seen = collect(app);
    walletChanged(host, { publicKey: PAYER, custodial: false });

    expect(seen).toStrictEqual([{ publicKey: PAYER, custodial: false }]);
    expect(app.wallet.publicKey).toBe(PAYER);
    expect(app.launchToken).toBe(token);
    expect(app.blink?.viewerWallet).toBe(SUB);
  });

  test('accepts the payload under `data` and as a serialized string', async () => {
    const { host, app } = await fullscreen();
    const seen = collect(app);
    walletChanged(host, { publicKey: PAYER, custodial: true }, 'data');
    host.post(JSON.stringify({ type: 'cherry:event', event: 'wallet.changed', payload: { publicKey: OTHER, custodial: false } }));
    expect(seen.map((e) => e.publicKey)).toStrictEqual([PAYER, OTHER]);
    expect(app.wallet.publicKey).toBe(OTHER);
  });

  test('a malformed payload is ignored: no state change, no event', async () => {
    const { host, app, token } = await fullscreen();
    const seen = collect(app);
    walletChanged(host, undefined);
    walletChanged(host, { custodial: true });
    walletChanged(host, { publicKey: '', custodial: true });
    walletChanged(host, { publicKey: 7 });
    expect(seen).toStrictEqual([]);
    expect(app.wallet.publicKey).toBe(SUB);
    expect(app.wallet.custodial).toBe(false);
    expect(app.launchToken).toBe(token);
  });

  test('a non-boolean custodial is read as false', async () => {
    const { host, app } = await fullscreen();
    const seen = collect(app);
    walletChanged(host, { publicKey: PAYER, custodial: 'yes' });
    expect(seen).toStrictEqual([{ publicKey: PAYER, custodial: false }]);
  });

  test('off() stops delivery', async () => {
    const { host, app } = await fullscreen();
    const seen: unknown[] = [];
    const listener = (e: CherryWalletChangedEvent): void => void seen.push(e);
    app.on('wallet.changed', listener);
    app.off('wallet.changed', listener);
    walletChanged(host, { publicKey: PAYER, custodial: false });
    expect(seen).toStrictEqual([]);
    expect(app.wallet.publicKey).toBe(PAYER);
  });
});

describe('wallet.requestSwitch()', () => {
  test('sends wallet.requestSwitch and resolves with the picked wallet', async () => {
    const { host, app } = await fullscreen({}, { capabilities: ['wallet-switch'] });
    host.answerNext('wallet.requestSwitch', { result: { publicKey: PAYER, custodial: true } });
    await expect(app.wallet.requestSwitch()).resolves.toStrictEqual({ publicKey: PAYER, custodial: true });
    expect(host.requests('wallet.requestSwitch')).toStrictEqual([
      { type: 'cherry:request', id: 'req#1', method: 'wallet.requestSwitch', params: {} },
    ]);
    expect(app.wallet.publicKey).toBe(PAYER);
    expect(app.wallet.custodial).toBe(true);
  });

  test('rejects with a typed USER_REJECTED and keeps the current wallet', async () => {
    const { host, app } = await fullscreen();
    host.answerNext('wallet.requestSwitch', { error: { code: 'USER_REJECTED', message: 'Picker dismissed' } });
    const err = await app.wallet.requestSwitch().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BridgeError);
    expect((err as BridgeError).code).toBe('USER_REJECTED');
    expect(app.wallet.publicKey).toBe(SUB);
  });

  test('a result without a wallet rejects with INVALID_RESPONSE', async () => {
    const { host, app } = await fullscreen();
    host.answerNext('wallet.requestSwitch', { result: { custodial: true } });
    const err = await app.wallet.requestSwitch().catch((e: unknown) => e);
    expect((err as BridgeError).code).toBe('INVALID_RESPONSE');
    expect(app.wallet.publicKey).toBe(SUB);
  });

  test('is allowed inline', async () => {
    const { host, app } = await inline({ viewerWallet: SUB });
    host.answerNext('wallet.requestSwitch', { result: { publicKey: PAYER, custodial: false } });
    await expect(app.wallet.requestSwitch()).resolves.toStrictEqual({ publicKey: PAYER, custodial: false });
    expect(app.wallet.publicKey).toBe(PAYER);
  });

  test('host event + answer notify listeners once, in either order', async () => {
    const { host, app } = await fullscreen();
    const seen = collect(app);
    host.answerNext('wallet.requestSwitch', () => {
      walletChanged(host, { publicKey: PAYER, custodial: true, token: 'reminted' });
      return { result: { publicKey: PAYER, custodial: true } };
    });
    await app.wallet.requestSwitch();
    expect(seen).toHaveLength(1);
    expect(app.launchToken).toBe('reminted');
  });

  test('throws synchronously before init()', () => {
    installHost({ transport: 'webview' });
    const app = new CherryMiniApp();
    expect(() => app.wallet.requestSwitch()).toThrow('CherryMiniApp is not ready');
  });
});

describe('WALLET_CHANGED from the host', () => {
  const cases: Array<[string, string, (app: CherryMiniApp) => Promise<unknown>]> = [
    ['signTransaction', 'wallet.signTransaction', (a) => a.wallet.signTransaction(new Uint8Array([1]))],
    ['signAllTransactions', 'wallet.signTransactions', (a) => a.wallet.signAllTransactions([new Uint8Array([1])])],
    ['signAndSendTransaction', 'wallet.signAndSendTransaction', (a) => a.wallet.signAndSendTransaction(new Uint8Array([1]))],
    ['signMessage', 'wallet.signMessage', (a) => a.wallet.signMessage(new Uint8Array([1]))],
  ];
  for (const [name, method, call] of cases) {
    test(`${name} rejects with code WALLET_CHANGED`, async () => {
      const { host, app } = await fullscreen();
      host.answerNext(method, { error: { code: 'WALLET_CHANGED', message: 'Fee payer is not the selected wallet' } });
      const err = await call(app).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BridgeError);
      expect((err as BridgeError).code).toBe('WALLET_CHANGED');
    });
  }

  test('the app can rebuild for the new wallet announced alongside', async () => {
    const { host, app } = await fullscreen();
    host.answerNext('wallet.signTransaction', () => {
      walletChanged(host, { publicKey: PAYER, custodial: true });
      return { error: { code: 'WALLET_CHANGED', message: 'Fee payer is not the selected wallet' } };
    });
    const err = await app.wallet.signTransaction(new Uint8Array([1])).catch((e: unknown) => e);
    expect((err as BridgeError).code).toBe('WALLET_CHANGED');
    expect(app.wallet.publicKey).toBe(PAYER);
  });
});

describe('hostCapabilities', () => {
  test('[] before init', () => {
    installHost({ transport: 'webview' });
    expect(new CherryMiniApp().hostCapabilities).toStrictEqual([]);
  });

  test('[] when an old host sends no capabilities', async () => {
    expect((await fullscreen()).app.hostCapabilities).toStrictEqual([]);
  });

  test('read from cherry:init, non-strings dropped', async () => {
    const { app } = await fullscreen({}, { capabilities: ['wallet-switch', 3, null, 'x'] });
    expect(app.hostCapabilities).toStrictEqual(['wallet-switch', 'x']);
    expect(app.hostCapabilities.includes('wallet-switch')).toBe(true);
  });

  test('a non-array value is treated as none', async () => {
    expect((await fullscreen({}, { capabilities: 'wallet-switch' })).app.hostCapabilities).toStrictEqual([]);
  });

  test('inline reads host.init capabilities, default []', async () => {
    expect((await inline({ viewerWallet: SUB })).app.hostCapabilities).toStrictEqual([]);
    uninstallHost();
    const { app } = await inline({ viewerWallet: SUB, capabilities: ['wallet-switch'] });
    expect(app.hostCapabilities).toStrictEqual(['wallet-switch']);
  });

  test('the returned array is a copy', async () => {
    const { app } = await fullscreen({}, { capabilities: ['wallet-switch'] });
    app.hostCapabilities.push('forged');
    expect(app.hostCapabilities).toStrictEqual(['wallet-switch']);
  });
});

describe('kit signer', () => {
  test('address is the payment wallet', async () => {
    const { app } = await fullscreen({ payment_wallet: PAYER });
    expect(createCherrySigner(app).address).toBe(PAYER);
  });

  test('address is sub without a payment wallet', async () => {
    const { app } = await fullscreen();
    expect(createCherrySigner(app).address).toBe(SUB);
  });
});

describe('CherryWalletAdapter', () => {
  async function connected(): Promise<{ host: FakeHost; adapter: CherryWalletAdapter; keys: string[] }> {
    const host = installHost({ transport: 'webview' });
    host.answerNext('wallet.connect', { result: { publicKey: SUB } });
    const adapter = new CherryWalletAdapter();
    const keys: string[] = [];
    adapter.on('connect', (pk) => keys.push(pk.toBase58()));
    await adapter.connect();
    return { host, adapter, keys };
  }

  test("follows 'wallet.changed' by re-emitting connect", async () => {
    const { host, adapter, keys } = await connected();
    walletChanged(host, { publicKey: PAYER, custodial: true });
    expect(adapter.publicKey?.toBase58()).toBe(PAYER);
    expect(keys).toStrictEqual([SUB, PAYER]);
  });

  test('ignores a same-key, invalid or post-disconnect change', async () => {
    const { host, adapter, keys } = await connected();
    walletChanged(host, { publicKey: SUB, custodial: false });
    walletChanged(host, { publicKey: 'not-base58!', custodial: false });
    expect(keys).toStrictEqual([SUB]);
    await adapter.disconnect();
    walletChanged(host, { publicKey: PAYER, custodial: false });
    expect(adapter.publicKey).toBeNull();
    expect(keys).toStrictEqual([SUB]);
  });

  test('a connected adapter does not swallow cherry:init sent before init()', async () => {
    const { host } = await connected();
    const app = new CherryMiniApp({ initTimeout: 50 });
    host.post({ type: 'cherry:init', version: 2, token: unsignedJwt({ ...LEGACY_EMBED_CLAIMS }) });
    await app.init();
    expect(app.user.publicKey).toBe(SUB);
  });
});

describe('cherry:init buffering', () => {
  test('a live cherry:init taken by init() is not replayed to a later client', async () => {
    const { host } = await fullscreen();
    const second = new CherryMiniApp({ initTimeout: 20 });
    await expect(second.init()).rejects.toThrow('cherry:init not received within 20ms');
    expect(host.sent.filter((r) => r.message['type'] === 'cherry:ready')).toHaveLength(1);
    await flush();
  });

  test('sign calls still round-trip after a wallet change', async () => {
    const { host, app } = await fullscreen();
    walletChanged(host, { publicKey: PAYER, custodial: true });
    host.answerNext('wallet.signMessage', { result: { signature: b64([1, 2]) } });
    await expect(app.wallet.signMessage(new Uint8Array([1]))).resolves.toStrictEqual(new Uint8Array([1, 2]));
  });
});
