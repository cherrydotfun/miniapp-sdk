import { afterEach, describe, expect, test } from 'bun:test';
import { CherryMiniApp } from '../src/client';
import { BridgeError, getSharedBridge } from '../src/bridge';
import { createCherrySigner } from '../src/kit';
import { CherryWalletAdapter } from '../src/solana';
import type { CherryChain, CherryWalletChangedEvent } from '../src/types';
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
  outcome,
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

  test('inline author token never supplies viewer cherryId', async () => {
    const { app } = await inline({ viewerWallet: SUB }, { cherry_id: CID });
    expect(app.user.cherryId).toBeUndefined();
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

describe('chain on the wallet API', () => {
  /** A chain outside the union the SDK can serve — what a plain-JS caller passes. */
  const evm = 'evm' as unknown as CherryChain;

  test('omitting the chain sends the 0.1.x payload, byte-for-byte', async () => {
    const { host, app } = await fullscreen();
    host.answerNext('wallet.signTransaction', { result: { transaction: b64([1]) } });
    await expect(app.wallet.signTransaction(new Uint8Array([1, 2, 3]))).resolves.toStrictEqual(
      new Uint8Array([1]),
    );
    expect(host.requests('wallet.signTransaction')).toStrictEqual([
      { type: 'cherry:request', id: 'req#1', method: 'wallet.signTransaction', params: { transaction: 'AQID' } },
    ]);
  });

  test("an explicit chain: 'solana' is absent on the wire too (absent = solana)", async () => {
    const { host, app } = await fullscreen();
    host.answerNext('wallet.signTransaction', { result: { transaction: b64([1]) } });
    await app.wallet.signTransaction(new Uint8Array([1, 2, 3]), { chain: 'solana' });
    expect(host.requests('wallet.signTransaction')).toStrictEqual([
      { type: 'cherry:request', id: 'req#1', method: 'wallet.signTransaction', params: { transaction: 'AQID' } },
    ]);
  });

  test('an unsupported chain is refused locally: no request ever reaches the host', async () => {
    const { host, app } = await fullscreen();
    const result = await outcome(() =>
      app.wallet.signTransaction(new Uint8Array([1]), { chain: evm }),
    );
    expect(result).toStrictEqual({
      threw: {
        name: 'BridgeError',
        message: 'Chain not supported: evm',
        code: 'CHAIN_NOT_SUPPORTED',
      },
    });
    expect(host.sent.filter((r) => r.message['type'] === 'cherry:request')).toStrictEqual([]);
  });

  test('the chain is refused before the transaction is even serialized', async () => {
    const { app } = await fullscreen();
    // An unserializable tx would be a TypeError; the chain check comes first.
    const result = await outcome(() => app.wallet.signTransaction(123, { chain: evm }));
    expect(result).toStrictEqual({
      threw: {
        name: 'BridgeError',
        message: 'Chain not supported: evm',
        code: 'CHAIN_NOT_SUPPORTED',
      },
    });
  });

  test('a host-reported chain is passed through; absent keys stay absent', async () => {
    const { host, app } = await fullscreen();
    const seen = collect(app);
    walletChanged(host, { publicKey: PAYER, custodial: true, chain: 'solana' });
    walletChanged(host, { publicKey: OTHER, custodial: false });
    // Non-Solana wallet events cannot update the legacy facade.
    walletChanged(host, { publicKey: SUB, custodial: false, chain: 'evm' });
    expect(seen).toStrictEqual([
      { publicKey: PAYER, custodial: true, chain: 'solana' },
      { publicKey: OTHER, custodial: false },
    ]);
  });

  test('requestSwitch passes the chain through', async () => {
    const { host, app } = await fullscreen();
    host.answerNext('wallet.requestSwitch', {
      result: { publicKey: PAYER, custodial: true, chain: 'solana' },
    });
    await expect(app.wallet.requestSwitch()).resolves.toStrictEqual({
      publicKey: PAYER,
      custodial: true,
      chain: 'solana',
    });
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

  test("'evm' is an opaque capability like any other (no special handling)", async () => {
    const { app } = await fullscreen({}, { capabilities: ['evm', 'wallet-switch'] });
    expect(app.hostCapabilities).toStrictEqual(['evm', 'wallet-switch']);
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

describe('multichain capability negotiation', () => {
  test('old hosts fail locally without sending new methods', async () => {
    const { app, host } = await fullscreen();
    await expect(app.accounts.list()).rejects.toMatchObject({ code: 'METHOD_NOT_SUPPORTED' });
    await expect(app.evm.request({ method: 'eth_chainId' })).rejects.toMatchObject({ code: 'METHOD_NOT_SUPPORTED' });
    expect(host.requests('wallet.accounts')).toHaveLength(0);
    expect(host.requests('wallet.eth.eth_chainId')).toHaveLength(0);
  });

  test('new host returns authorized chain-qualified accounts and supports EVM requests', async () => {
    const { app, host } = await fullscreen({}, { capabilities: ['accounts-v1', 'evm'] });
    const account = { address: '0x1111111111111111111111111111111111111111', chainId: 'eip155:8453', kind: 'external', capabilities: ['send'] };
    host.answerNext('wallet.accounts', { result: { accounts: [account] } });
    host.answerNext('wallet.eth.eth_chainId', { result: '0x2105' });
    expect(await app.accounts.list()).toEqual([account]);
    expect(await app.evm.request({ method: 'eth_chainId' })).toBe('0x2105');
    expect(host.requests('wallet.eth.eth_chainId')[0]?.['params']).toEqual({});
    expect(app.wallet.publicKey).toBe(SUB);
    expect(app.user.publicKey).toBe(SUB);
    walletChanged(host, { publicKey: OTHER, chain: 'evm', custodial: false });
    expect(app.wallet.publicKey).toBe(SUB);
    await expect(app.evm.request({ method: 'personal_sign' as never })).rejects.toMatchObject({ code: 'METHOD_NOT_SUPPORTED' });
    expect(host.requests('wallet.eth.personal_sign')).toHaveLength(0);
  });

  test('rejects malformed account response', async () => {
    const { app, host } = await fullscreen({}, { capabilities: ['accounts-v1'] });
    host.answerNext('wallet.accounts', { result: { accounts: [{ address: 'x', chainId: 'evm', kind: 'external', capabilities: [] }] } });
    await expect(app.accounts.list()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('Solana facade isolation', () => {
  test('rejects EVM payer and falls back to Solana subject', async () => {
    const { app } = await fullscreen({ payment_wallet: '0x1111111111111111111111111111111111111111', payment_wallet_chain: 'eip155:1' });
    expect(app.wallet.publicKey).toBe(SUB);
    expect(app.user.publicKey).toBe(SUB);
  });
  test('EVM subject remains identity but is not a Solana payer', async () => {
    const subject = '0x1111111111111111111111111111111111111111';
    const { app } = await fullscreen({ sub: subject, payment_wallet: subject });
    expect(app.wallet.publicKey).toBeNull();
    expect(app.user.publicKey).toBe(subject);
  });
  test('inline EVM payer never becomes Solana payer', async () => {
    const { app } = await inline({ viewerWallet: SUB, viewerPaymentWallet: '0x1111111111111111111111111111111111111111', viewerPaymentWalletChain: 'eip155:1' });
    expect(app.wallet.publicKey).toBe(SUB);
  });
});

describe('trading bridge', () => {
  test('old host fails locally and sends no trading request', async () => {
    const { app, host } = await fullscreen();
    await expect(app.trade.capabilities()).rejects.toMatchObject({ code: 'METHOD_NOT_SUPPORTED' });
    expect(host.requests('trade.capabilities')).toHaveLength(0);
  });
  test('sends exact base units and stable idempotency key, receives operation id before settlement', async () => {
    const { app, host } = await fullscreen({}, { capabilities: ['trading-v1'] });
    const preview = { kind: 'swap' as const, input: { chainId: 'eip155:8453', address: 'native' }, output: { chainId: 'eip155:8453', address: '0xtoken' }, amount: '123456789012345678901', slippageBps: 50, account: { chainId: 'eip155:8453', address: '0xabc' } };
    host.answerNext('trade.preview', { result: { reviewId: 'r1', inputAmount: preview.amount, outputAmount: '77', minOutputAmount: '75', provider: 'p', expiresAt: '2027-01-01T00:00:00Z', destinationOwner: 'payer', inputSymbol: 'ETH', outputSymbol: 'T', inputDecimals: 18, outputDecimals: 6, input: preview.input, output: preview.output, account: preview.account, fees: [], nativeBudget: null, constraints: { kind: preview.kind, slippageBps: preview.slippageBps } } });
    host.answerNext('trade.request', { result: { operationId: 'op1', stage: 'created' } });
    host.answerNext('trade.request', { result: { operationId: 'op1', stage: 'created' } });
    expect((await app.trade.preview(preview)).reviewId).toBe('r1');
    const request = { reviewId: 'r1', idempotencyKey: 'stable-key' };
    expect(await app.trade.request(request)).toEqual({ operationId: 'op1', stage: 'created' });
    expect(await app.trade.request(request)).toEqual({ operationId: 'op1', stage: 'created' });
    expect(host.requests('trade.preview')[0]?.['params']).toEqual(preview);
    expect(host.requests('trade.request').map((r) => r['params'])).toEqual([request, request]);
    await expect(app.trade.preview({ ...preview, amount: '1.5' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('malformed trading responses', () => {
  test('rejects malformed preview, operation, capability and asset responses', async () => {
    const { app, host } = await fullscreen({}, { capabilities: ['trading-v1'] });
    const request = { kind: 'swap' as const, input: { chainId: 'eip155:1', address: 'a' }, output: { chainId: 'eip155:1', address: 'b' }, amount: '1', slippageBps: 1, account: { chainId: 'eip155:1', address: 'c' } };
    host.answerNext('trade.preview', { result: { reviewId: 'r', inputAmount: '1', outputAmount: '1.2', minOutputAmount: '1', provider: 'p', expiresAt: '2027-01-01' } });
    host.answerNext('trade.request', { result: { stage: 'created' } });
    host.answerNext('trade.capabilities', { result: { version: 1, chains: [{}], providers: [] } });
    host.answerNext('trade.assets', { result: { assets: [{ chainId: 'eip155:1', address: 'x', symbol: 'X', decimals: -1 }] } });
    await expect(app.trade.preview(request)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(app.trade.request({ reviewId: 'r', idempotencyKey: 'k' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(app.trade.capabilities()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(app.trade.assets()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

test('accounts reject malformed known-family addresses, chains and capabilities', async () => {
  const { app, host } = await fullscreen({}, { capabilities: ['accounts-v1'] });
  const invalid = [
    { address: 'x', chainId: 'eip155:8453', kind: 'external', capabilities: ['send'] },
    { address: '0x1111111111111111111111111111111111111111', chainId: 'eip155:0', kind: 'external', capabilities: ['send'] },
    { address: '0x1111111111111111111111111111111111111111', chainId: 'eip155:1', kind: 'external', capabilities: [1] },
    { address: SUB, chainId: 'cosmos:one', kind: 'external', capabilities: ['send'] },
    { address: 'abc', chainId: 'solana:mainnet', kind: 'app_held', capabilities: [] },
  ];
  for (const account of invalid) {
    host.answerNext('wallet.accounts', { result: { accounts: [account] } });
    await expect(app.accounts.list()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  }
});

test('EVM app-held payer does not mark fallback Solana wallet custodial', async () => {
  const { app } = await fullscreen({ payment_wallet: '0x1111111111111111111111111111111111111111', payment_wallet_chain: 'eip155:1', payment_wallet_kind: 'app_held' });
  expect(app.wallet.publicKey).toBe(SUB);
  expect(app.wallet.custodial).toBe(false);
});

test('trade preview refuses a valid-looking quote for a different account', async () => {
  const { app, host } = await fullscreen({}, { capabilities: ['trading-v1'] });
  const input = { chainId: 'eip155:1', address: 'native' }, output = { chainId: 'eip155:1', address: 'token' }, account = { chainId: 'eip155:1', address: 'payer' };
  const preview = { kind: 'swap' as const, input, output, account, amount: '10', slippageBps: 50 };
  host.answerNext('trade.preview', { result: { reviewId: 'r', inputAmount: '10', outputAmount: '9', minOutputAmount: '8', provider: 'p', expiresAt: '2027-01-01', destinationOwner: 'payer', inputSymbol: 'ETH', outputSymbol: 'T', inputDecimals: 18, outputDecimals: 6, input, output, account: { ...account, address: 'other' }, fees: [], nativeBudget: null, constraints: { kind: 'swap', slippageBps: 50 } } });
  await expect(app.trade.preview(preview)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

test('preview accepts only bounded server route budget policy', async () => {
  const { app, host } = await fullscreen({}, { capabilities: ['trading-v1'] });
  const input = { chainId:'solana:mainnet', address:'native' }, output = { chainId:'eip155:1', address:'token' }, account = { chainId:'solana:mainnet', address:'payer' };
  const request = { kind:'cross-chain' as const, input, output, account, amount:'10', slippageBps:50 };
  const result = { reviewId:'r', inputAmount:'10', outputAmount:'9', minOutputAmount:'8', provider:'p', expiresAt:'2099-01-01T00:00:00Z', destinationOwner:'payer', inputSymbol:'SOL', outputSymbol:'T', inputDecimals:9, outputDecimals:6, input, output, account, fees:[], nativeBudget:null, constraints:{kind:'cross-chain',slippageBps:50}, budgetPolicy:'reviewed-partial', executionSupported:false };
  host.answerNext('trade.preview', { result });
  expect((await app.trade.preview(request)).budgetPolicy).toBe('reviewed-partial');
  host.answerNext('trade.preview', { result:{ ...result, executionSupported:'yes' } });
  await expect(app.trade.preview(request)).rejects.toMatchObject({ code:'INVALID_RESPONSE' });
  host.answerNext('trade.preview', { result: { ...result, budgetPolicy:'automatic' } });
  await expect(app.trade.preview(request)).rejects.toMatchObject({ code:'INVALID_RESPONSE' });
});

test('operation envelopes do not expose host execution payloads', async () => {
  const { app, host } = await fullscreen({}, { capabilities: ['trading-v1'] });
  const operation = { operationId: 'op', stage: 'pending', intent: { tx: 'secret' }, token: 'private' };
  host.answerNext('trade.get', { result: operation });
  host.answerNext('trade.list', { result: { operations: [operation] } });
  expect(await app.trade.get('op')).toEqual({ operationId: 'op', stage: 'pending' });
  expect(await app.trade.list()).toEqual({ operations: [{ operationId: 'op', stage: 'pending' }] });
});

test('asset discovery preserves valid optional market data and rejects unsafe metadata', async () => {
  const { app, host } = await fullscreen({}, { capabilities: ['trading-v1'] });
  const asset = { chainId: 'eip155:8453', address: 'native', symbol: 'ETH', decimals: 18, name: 'Ether', iconUrl: 'https://cdn.example/eth.png', usdPrice: 2500, priceChange24h: -2.5 };
  host.answerNext('trade.assets', { result: { assets: [asset] } });
  expect(await app.trade.assets({ q: 'eth' })).toEqual({ assets: [asset] });
  host.answerNext('trade.assets', { result: { assets: [{ ...asset, iconUrl: 'javascript:alert(1)' }] } });
  await expect(app.trade.assets()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

test('operation history keeps public trade details and strips private nested fields', async () => {
  const { app, host } = await fullscreen({}, { capabilities: ['trading-v1'] });
  host.answerNext('trade.list', { result: { operations: [{ operationId: 'op', stage: 'settled', kind: 'swap', createdAt: '2026-01-01T00:00:00Z', input: { chainId: 'eip155:1', address: 'native', private: 'no' }, output: { chainId: 'eip155:1', address: 'token' }, inputAmount: '100', outputAmount: '80', intent: { tx: 'secret' } }] } });
  expect((await app.trade.list()).operations[0]).toEqual({ operationId: 'op', stage: 'settled', kind: 'swap', createdAt: '2026-01-01T00:00:00Z', input: { chainId: 'eip155:1', address: 'native' }, output: { chainId: 'eip155:1', address: 'token' }, inputAmount: '100', outputAmount: '80' });
});

test('manual recovery status is public but cannot contain arbitrary values', async () => {
  const { app, host } = await fullscreen({}, { capabilities: ['trading-v1'] });
  host.answerNext('trade.get', { result: { operationId: 'op', stage: 'unknown', recoveryReview: 'manual_review', intent: { secret: true } } });
  expect(await app.trade.get('op')).toEqual({ operationId: 'op', stage: 'unknown', recoveryReview: 'manual_review' });
  host.answerNext('trade.get', { result: { operationId: 'op', stage: 'unknown', recoveryReview: 'automatic' } });
  await expect(app.trade.get('op')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

test('source status exposes only bounded server evidence', async () => {
  const { app, host } = await fullscreen({}, { capabilities:['trading-v1'] });
  host.answerNext('trade.get', { result:{operationId:'op',stage:'executing',sourceState:'confirmed',intent:{secret:true}} });
  expect(await app.trade.get('op')).toEqual({operationId:'op',stage:'executing',sourceState:'confirmed'});
  host.answerNext('trade.get', { result:{operationId:'op',stage:'executing',sourceState:'guessed'} });
  await expect(app.trade.get('op')).rejects.toMatchObject({code:'INVALID_RESPONSE'});
});

test('confirmed approval evidence is a bounded pair of fields', async () => {
  const { app, host } = await fullscreen({}, { capabilities:['trading-v1'] });
  const approvalTxHash=`0x${'ab'.repeat(32)}`;
  host.answerNext('trade.get', { result:{operationId:'op',stage:'needs_review',approvalRetained:true,approvalTxHash} });
  expect(await app.trade.get('op')).toEqual({operationId:'op',stage:'needs_review',approvalRetained:true,approvalTxHash});
  host.answerNext('trade.get', { result:{operationId:'op',stage:'needs_review',approvalRetained:true,approvalTxHash:'bad'} });
  await expect(app.trade.get('op')).rejects.toMatchObject({code:'INVALID_RESPONSE'});
});

test('capabilities validate provider corridors without inventing them', async () => {
  const { app, host } = await fullscreen({}, { capabilities: ['trading-v1'] });
  const result = { version: 1, chains: [], providers: [{ id: 'p', enabled: true, corridors: [{ originChainId: 'eip155:1', destChainId: 'eip155:8453' }] }] };
  host.answerNext('trade.capabilities', { result });
  expect(await app.trade.capabilities()).toEqual(result);
  host.answerNext('trade.capabilities', { result: { ...result, providers: [{ id: 'p', enabled: true, corridors: [{}] }] } });
  await expect(app.trade.capabilities()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

test('lookup is capability gated and sends only the saved idempotency and review keys', async () => {
  const { app, host } = await fullscreen({}, { capabilities: ['trading-v1'] });
  host.answerNext('trade.lookup', { result: { operationId: 'op', stage: 'unknown', intent: { tx: 'private' } } });
  expect(await app.trade.lookup({ reviewId: 'r', idempotencyKey: 'k' })).toEqual({ operationId: 'op', stage: 'unknown' });
  expect(host.requests('trade.lookup')[0]?.['params']).toEqual({ reviewId: 'r', idempotencyKey: 'k' });
});

test('discard exposes only server-confirmed cancelled operation', async () => {
  const { app, host } = await fullscreen({}, { capabilities:['trading-v1'] });
  host.answerNext('trade.discard', { result:{ operationId:'op', stage:'cancelled', intent:{ private:true } } });
  expect(await app.trade.discard('op')).toEqual({ operationId:'op',stage:'cancelled' });
  expect(host.requests('trade.discard')[0]?.['params']).toEqual({operationId:'op'});
  host.answerNext('trade.discard', { result:{operationId:'op',stage:'unknown'} });
  await expect(app.trade.discard('op')).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  host.answerNext('trade.discard', { result:{operationId:'other',stage:'cancelled'} });
  await expect(app.trade.discard('op')).rejects.toMatchObject({code:'INVALID_RESPONSE'});
});

test('viewer expand forwards bounded context only on a supporting host', async () => {
  const first = await fullscreen();
  await expect(Promise.resolve().then(() => first.app.requestExpand({ route:'/trade', params:{chainId:'eip155:8453'} }))).rejects.toMatchObject({ code:'METHOD_NOT_SUPPORTED' });
  expect(first.host.requests('host.requestExpand')).toHaveLength(0);
  uninstallHost();
  const { app, host } = await fullscreen({}, { capabilities:['viewer-expand-v1'] });
  host.answerNext('host.requestExpand', { result:{} });
  await app.requestExpand({route:'/trade',params:{chainId:'eip155:8453'}});
  expect(host.requests('host.requestExpand')[0]?.['params']).toEqual({route:'/trade',params:{chainId:'eip155:8453'}});
});

test('capability metadata preserves disabled reasons and validates explorer links', async () => {
  const { app, host } = await fullscreen({}, { capabilities:['trading-v1'] });
  const chain = {chainId:'eip155:8453',enabled:true,active:false,assets:false,holdings:false,trade:false,displayName:'Base',nativeSymbol:'ETH',nativeDecimals:18,explorerUrl:'https://example.com/',unavailableReason:'rpc-unavailable'};
  host.answerNext('trade.capabilities',{result:{version:1,chains:[chain],providers:[]}});
  expect((await app.trade.capabilities()).chains[0]).toEqual(chain);
  host.answerNext('trade.capabilities',{result:{version:1,chains:[{...chain,explorerUrl:'javascript:bad'}],providers:[]}});
  await expect(app.trade.capabilities()).rejects.toMatchObject({code:'INVALID_RESPONSE'});
});

test('budget policy accepts only supported host-reviewed modes', async () => {
  const { app, host } = await fullscreen({}, { capabilities: ['trading-v1'] });
  host.answerNext('trade.capabilities', { result: { version: 1, chains: [], providers: [], budgetPolicy: 'reviewed-partial' } });
  expect((await app.trade.capabilities()).budgetPolicy).toBe('reviewed-partial');
  host.answerNext('trade.capabilities', { result: { version: 1, chains: [], providers: [], budgetPolicy: 'automatic' } });
  await expect(app.trade.capabilities()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  const chain = { chainId: 'solana:mainnet', enabled: true, assets: true, holdings: true, trade: true, budgetPolicy: 'reviewed-partial' };
  host.answerNext('trade.capabilities', { result: { version: 1, chains: [chain], providers: [] } });
  expect((await app.trade.capabilities()).chains[0]?.budgetPolicy).toBe('reviewed-partial');
  host.answerNext('trade.capabilities', { result: { version: 1, chains: [{ ...chain, budgetPolicy: 'automatic' }], providers: [] } });
  await expect(app.trade.capabilities()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

test('destroy clears host capabilities and a new legacy session cannot use new methods', async () => {
  const { app } = await fullscreen({}, { capabilities:['accounts-v1','trading-v1'] });
  expect(app.hostCapabilities).toEqual(['accounts-v1','trading-v1']);
  app.destroy();
  expect(app.hostCapabilities).toEqual([]);
  uninstallHost();
  const legacyHost = installHost();
  const ready = app.init();
  legacyHost.post({ type:'cherry:init', version:2, token:unsignedJwt(LEGACY_EMBED_CLAIMS) });
  await ready;
  expect(app.hostCapabilities).toEqual([]);
  await expect(app.accounts.list()).rejects.toMatchObject({code:'METHOD_NOT_SUPPORTED'});
  expect(legacyHost.requests('wallet.accounts')).toHaveLength(0);
  app.destroy();
  uninstallHost();
  const old = await fullscreen();
  expect(old.app.hostCapabilities).toEqual([]);
  await expect(old.app.accounts.list()).rejects.toMatchObject({code:'METHOD_NOT_SUPPORTED'});
  expect(old.host.requests('wallet.accounts')).toHaveLength(0);
});

test.each(['buffered', 'delivered'])('destroy fences %s fullscreen init before continuation and allows legacy reinit', async (mode) => {
  const host = installHost();
  const app = new CherryMiniApp();
  const token = unsignedJwt(LEGACY_EMBED_CLAIMS);
  const message = { type:'cherry:init', version:2, token, capabilities:['trading-v1'] };
  if (mode === 'buffered') host.post(message);
  const pending = app.init();
  if (mode === 'delivered') host.post(message);
  app.destroy();
  await expect(pending).rejects.toMatchObject({ code:'DESTROYED' });
  expect(app.isReady).toBe(false); expect(app.hostCapabilities).toEqual([]);
  expect(host.sent.filter(row => row.message['type'] === 'cherry:ready')).toHaveLength(0);
  const next = app.init(); host.post({ type:'cherry:init', version:2, token }); await next;
  expect(app.hostCapabilities).toEqual([]);
  expect(host.sent.filter(row => row.message['type'] === 'cherry:ready')).toHaveLength(1);
});

test('destroy cancels an outstanding init wait without waiting for its timeout', async () => {
  installHost(); const app = new CherryMiniApp({ initTimeout:60_000 }); const pending = app.init();
  app.destroy(); await expect(pending).rejects.toMatchObject({ code:'DESTROYED' });
});

test('destroy fences a resolved inline host.init before continuation', async () => {
  const host = installHost({ transport:'iframe', hash:'mode=inline' });
  host.answerNext('host.init', { result:{ viewerWallet:SUB, capabilities:['trading-v1'] } });
  const app = new CherryMiniApp(); const pending = app.init();
  await Promise.resolve(); app.destroy();
  await expect(pending).rejects.toMatchObject({ code:'DESTROYED' });
  expect(app.isReady).toBe(false); expect(app.hostCapabilities).toEqual([]); expect(app.blink).toBeNull();
});

test('synchronous destroy during ready acknowledgement cannot revive the instance', async () => {
  const host=installHost(); const app=new CherryMiniApp(); const receive=host.receive.bind(host);
  host.receive=(transport,message,options)=>{receive(transport,message,options);if(message['type']==='cherry:ready') app.destroy();};
  const pending=app.init();host.post({type:'cherry:init',version:2,token:unsignedJwt(LEGACY_EMBED_CLAIMS),capabilities:['trading-v1']});
  await expect(pending).rejects.toMatchObject({code:'DESTROYED'});expect(app.isReady).toBe(false);expect(app.hostCapabilities).toEqual([]);
});

describe('accounts.changed hint', () => {
  test('only a trusted initialized parent origin and negotiated capability can emit an empty hint', async () => {
    const token=unsignedJwt(LEGACY_EMBED_CLAIMS);
    const host=installHost({transport:'iframe'}), app=new CherryMiniApp();
    const ready=app.init();host.post({type:'cherry:init',version:2,token,capabilities:['accounts-v1','accounts-events-v1']});await ready;
    let count=0;app.on('accounts.changed',()=>{count++;});
    const hint={type:'cherry:event',event:'accounts.changed',payload:{}};
    host.post(hint,{source:{}});host.post(hint,{origin:'https://evil.example'});host.post(hint,{isTrusted:false});
    host.post({...hint,payload:{account:'forged'}});host.post(hint);
    expect(count).toBe(1);expect(app.wallet.publicKey).toBe(SUB);expect(app.user.publicKey).toBe(SUB);
    app.destroy();host.post(hint);expect(count).toBe(1);
  });
  test('inline binds hint origin to the parent host.init response; old hosts are silent', async () => {
    const {host,app}=await inline({viewerWallet:SUB,capabilities:['accounts-v1','accounts-events-v1']});
    let count=0;app.on('accounts.changed',()=>{count++;});
    host.post({type:'cherry:event',event:'accounts.changed',payload:{}},{origin:'https://evil.example'});
    host.post({type:'cherry:event',event:'accounts.changed',payload:{}});expect(count).toBe(1);
    app.destroy();uninstallHost();
    const old=await inline({viewerWallet:SUB,capabilities:['accounts-v1']});
    old.app.on('accounts.changed',()=>{count++;});old.host.post({type:'cherry:event',event:'accounts.changed',payload:{}});expect(count).toBe(1);
  });
  test('a queued same-origin hint after reinit carries no stale state', async () => {
    const token=unsignedJwt(LEGACY_EMBED_CLAIMS),host=installHost({transport:'iframe'}),app=new CherryMiniApp();
    let ready=app.init();host.post({type:'cherry:init',version:2,token,capabilities:['accounts-v1','accounts-events-v1']});await ready;app.destroy();
    ready=app.init();host.post({type:'cherry:init',version:2,token,capabilities:['accounts-v1','accounts-events-v1']});await ready;
    let seen:unknown='not-called';app.on('accounts.changed',value=>{seen=value;});
    host.post({type:'cherry:event',event:'accounts.changed',payload:{}});
    expect(seen).toBeUndefined();expect(app.wallet.publicKey).toBe(SUB);
  });
});

test('buffered fullscreen init binds only real parent source metadata', async () => {
  const token=unsignedJwt(LEGACY_EMBED_CLAIMS),host=installHost({transport:'iframe'}),app=new CherryMiniApp();
  host.post({type:'cherry:init',version:2,token,capabilities:['accounts-v1','accounts-events-v1']});
  await app.init();let calls=0;app.on('accounts.changed',()=>{calls++;});host.post({type:'cherry:event',event:'accounts.changed',payload:{}});expect(calls).toBe(1);
  app.destroy();uninstallHost();
  const spoofHost=installHost({transport:'iframe'}),spoofApp=new CherryMiniApp();
  spoofHost.post({type:'cherry:init',version:2,token,capabilities:['accounts-v1','accounts-events-v1']},{source:{}});
  await spoofApp.init();spoofApp.on('accounts.changed',()=>{calls++;});
  spoofHost.post({type:'cherry:event',event:'accounts.changed',payload:{}});expect(calls).toBe(1);
});

test.each(['wallet.accounts','trade.capabilities'])('new iframe response %s only settles from bound parent origin', async method => {
  const host=installHost({transport:'iframe'}),app=new CherryMiniApp(),token=unsignedJwt(LEGACY_EMBED_CLAIMS);
  const ready=app.init();host.post({type:'cherry:init',version:2,token,capabilities:['accounts-v1','trading-v1']});await ready;
  let id='';const receive=host.receive.bind(host);host.receive=(transport,message,options)=>{if(message['method']===method) id=String(message['id']);receive(transport,message,options);};
  let settled=false;
  const pending=method==='wallet.accounts' ? app.accounts.list() : app.trade.capabilities();
  void pending.then(()=>{settled=true;});
  expect(id).not.toBe('');
  const result=method==='wallet.accounts' ? {accounts:[]} : {version:1,chains:[],providers:[]};
  host.post({type:'cherry:response',id,result},{source:{}});
  host.post({type:'cherry:response',id,result},{origin:'https://evil.example'});
  host.post({type:'cherry:response',id,result},{isTrusted:false});
  await Promise.resolve();expect(settled).toBe(false);
  host.post({type:'cherry:response',id,result});
  await pending;expect(settled).toBe(true);
});

test('a spoofed buffered init cannot inherit binding from a different buffered init',async()=>{
  const host=installHost({transport:'iframe'}),app=new CherryMiniApp(),token=unsignedJwt(LEGACY_EMBED_CLAIMS);
  const init={type:'cherry:init',version:2,token,capabilities:['accounts-v1','accounts-events-v1']};
  host.post(init);host.post(init,{source:{}});await app.init();
  let hints=0;app.on('accounts.changed',()=>{hints++;});host.post({type:'cherry:event',event:'accounts.changed',payload:{}});
  expect(hints).toBe(0);
});
