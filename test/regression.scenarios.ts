/**
 * A11 regression checklist, executable.
 *
 * Each scenario drives the SDK against a host that behaves exactly like the
 * hosts that shipped with 0.1.21: no `capabilities`, no CherryID claims
 * (`cherry_id`, `payment_wallet*`), no `wallet.changed`, the old `host.init`
 * fields only. The scenario returns a transcript of everything observable —
 * public state, every message sent to the host, every resolved value / error,
 * every event delivered — and `regression.test.ts` compares it with the
 * fixture recorded from the unmodified 0.1.21 code.
 *
 * Only 0.1.21 surface is recorded here. New surface (`hostCapabilities`,
 * `wallet.custodial`, `requestSwitch`, …) is covered by the feature tests.
 */
import { Transaction, SystemProgram, PublicKey } from '@solana/web3.js';
import { CherryMiniApp, type CherryMiniAppEvent } from '../src/client';
import { createCherrySigner } from '../src/kit';
import { CherryWalletAdapter } from '../src/solana';
import {
  installHost,
  unsignedJwt,
  outcome,
  plain,
  flush,
  b64,
  SUB,
  OTHER,
  LEGACY_EMBED_CLAIMS,
  LEGACY_INLINE_CLAIMS,
  type FakeHost,
} from './harness';

const ALL_EVENTS = [
  'suspended',
  'resumed',
  'walletDisconnected',
  'blink:update',
  // Not a 0.1.21 event: recorded so the transcript proves an old host never
  // causes it to fire.
  'wallet.changed',
] as const;

function recordEvents(app: CherryMiniApp): Array<{ event: string; data: unknown }> {
  const log: Array<{ event: string; data: unknown }> = [];
  for (const event of ALL_EVENTS) {
    app.on(event as CherryMiniAppEvent, (data: unknown) => log.push({ event, data: plain(data) }));
  }
  return log;
}

/** The 0.1.21 public state of a client. */
async function snapshot(app: CherryMiniApp): Promise<Record<string, unknown>> {
  return {
    isReady: app.isReady,
    user: await outcome(() => app.user),
    room: await outcome(() => app.room),
    launchToken: await outcome(() => app.launchToken),
    blink: plain(app.blink),
    getPublicKey: plain(app.getPublicKey()),
    walletPublicKey: plain(app.wallet.publicKey),
    walletMethods: ['signTransaction', 'signAllTransactions', 'signAndSendTransaction', 'signMessage'].map(
      (m) => [m, typeof (app.wallet as unknown as Record<string, unknown>)[m]],
    ),
  };
}

async function initFullscreen(host: FakeHost, app: CherryMiniApp, extra: Record<string, unknown> = {}): Promise<void> {
  const ready = app.init();
  host.post({ type: 'cherry:init', version: 2, token: unsignedJwt({ ...LEGACY_EMBED_CLAIMS }), ...extra });
  await ready;
}

/** Every 0.1.21 wallet / navigate / share call with the answer shapes hosts send today. */
async function exerciseMethods(host: FakeHost, app: CherryMiniApp): Promise<Record<string, unknown>> {
  const calls: Record<string, unknown> = {};
  const w = app.wallet;

  host.answerNext('wallet.signTransaction', { result: { transaction: b64([4, 5, 6]) } });
  calls['signTransaction.bytes'] = await outcome(() => w.signTransaction(new Uint8Array([1, 2, 3])));

  host.answerNext('wallet.signTransaction', { result: b64([6, 6]) });
  calls['signTransaction.base64In.rawOut'] = await outcome(() => w.signTransaction(b64([1, 2])));

  const serializeCalls: unknown[] = [];
  host.answerNext('wallet.signTransaction', { result: { transaction: b64([7]) } });
  calls['signTransaction.serializable'] = await outcome(() =>
    w.signTransaction({
      serialize(opts: unknown) {
        serializeCalls.push(opts);
        return new Uint8Array([7, 8]);
      },
    }),
  );
  calls['signTransaction.serializable.opts'] = plain(serializeCalls);
  calls['signTransaction.invalid'] = await outcome(() => w.signTransaction(123));

  host.answerNext('wallet.signTransactions', { result: { transactions: [b64([1]), b64([2])] } });
  calls['signAllTransactions'] = await outcome(() => w.signAllTransactions([new Uint8Array([9]), b64([8])]));
  host.answerNext('wallet.signTransactions', { result: [b64([3])] });
  calls['signAllTransactions.rawOut'] = await outcome(() => w.signAllTransactions([new Uint8Array([9])]));

  host.answerNext('wallet.signAndSendTransaction', { result: { signature: 'sig-object' } });
  calls['signAndSendTransaction'] = await outcome(() => w.signAndSendTransaction(new Uint8Array([5])));
  host.answerNext('wallet.signAndSendTransaction', { result: 'sig-raw' });
  calls['signAndSendTransaction.rawOut'] = await outcome(() => w.signAndSendTransaction(new Uint8Array([5])));

  host.answerNext('wallet.signMessage', { result: { signature: b64([11, 12]) } });
  calls['signMessage'] = await outcome(() => w.signMessage(new TextEncoder().encode('hello')));
  host.answerNext('wallet.signMessage', { result: b64([13]) });
  calls['signMessage.rawOut'] = await outcome(() => w.signMessage(new Uint8Array([1])));

  host.answerNext('navigate.userProfile', { result: null });
  calls['navigate.userProfile'] = await outcome(() => app.navigate.userProfile('alice.sol'));
  host.answerNext('navigate.openRoom', { result: { ok: true } });
  calls['navigate.openRoom'] = await outcome(() => app.navigate.openRoom('@grp'));

  host.answerNext('host.share', { result: { shared: true, roomId: 'room_9', messageId: 'msg_9' } });
  calls['share.full'] = await outcome(() =>
    app.share({
      route: '/result',
      params: { score: 9000 },
      height: 'compact',
      initialHeight: 80,
      caption: 'gg',
      previewable: true,
    }),
  );
  host.answerNext('host.share', { result: { shared: false } });
  calls['share.empty'] = await outcome(() => app.share());

  // Error shapes: `{ code, message }`, bare string, and missing code.
  host.answerNext('wallet.signTransaction', { error: { code: 'USER_REJECTED', message: 'User rejected the request' } });
  calls['error.userRejected'] = await outcome(() => w.signTransaction(new Uint8Array([1])));
  host.answerNext('wallet.signMessage', { error: 'boom' });
  calls['error.string'] = await outcome(() => w.signMessage(new Uint8Array([1])));
  host.answerNext('wallet.signTransactions', { error: { message: 'no code' } });
  calls['error.noCode'] = await outcome(() => w.signAllTransactions([new Uint8Array([1])]));
  // A host that validates feePayer answers WALLET_CHANGED; 0.1.21 already
  // surfaces the host's code unchanged.
  host.answerNext('wallet.signAndSendTransaction', {
    error: { code: 'WALLET_CHANGED', message: 'The selected wallet changed' },
  });
  calls['error.walletChanged'] = await outcome(() => w.signAndSendTransaction(new Uint8Array([1])));

  return calls;
}

/** Host → app events in every shape hosts use today. */
async function exerciseEvents(host: FakeHost, app: CherryMiniApp): Promise<unknown> {
  const throwing = (): void => {
    throw new Error('listener failure must not break the SDK');
  };
  app.on('suspended', throwing);
  host.post({ type: 'cherry:event', event: 'suspended' });
  host.post({ type: 'cherry:event', event: 'resumed', data: { at: 1 } });
  host.post({ type: 'cherry:event', event: 'walletDisconnected' });
  host.post({ type: 'cherry:event', event: 'blink:update', payload: { params: { x: 1 }, blink_params_version: 2 } });
  // WebView hosts sometimes deliver serialized strings.
  host.post(JSON.stringify({ type: 'cherry:event', event: 'resumed', data: 'from-string' }));
  host.post('not json');
  host.post(['not', 'an', 'object']);
  host.post({ type: 'cherry:response', id: 'unknown-id', result: 1 });
  app.off('suspended', throwing);
  await flush();
  return { listenerCount: host.listenerCount };
}

export const scenarios: Record<string, () => Promise<unknown>> = {
  async 'fullscreen: old host, webview transport'() {
    const host = installHost({ transport: 'webview' });
    const app = new CherryMiniApp();
    const events = recordEvents(app);
    const beforeInit = {
      ...(await snapshot(app)),
      signBeforeReady: await outcome(() => app.wallet.signMessage(new Uint8Array([1]))),
      shareBeforeReady: await outcome(() => app.share()),
    };
    await initFullscreen(host, app);
    const afterInit = await snapshot(app);
    const calls = await exerciseMethods(host, app);
    const eventsInfo = await exerciseEvents(host, app);
    const afterCalls = await snapshot(app);

    // A request still pending when the app is destroyed is rejected.
    const pending = outcome(() => app.wallet.signMessage(new Uint8Array([2])));
    await flush();
    app.destroy();
    const pendingOutcome = await pending;
    const afterDestroy = await snapshot(app);

    return {
      beforeInit,
      afterInit,
      calls,
      eventsInfo,
      events,
      afterCalls,
      pendingOutcome,
      afterDestroy,
      sent: host.sent,
    };
  },

  async 'fullscreen: cherry:init buffered before init()'() {
    const host = installHost({ transport: 'webview' });
    const app = new CherryMiniApp();
    host.post({ type: 'cherry:init', version: 2, token: unsignedJwt({ ...LEGACY_EMBED_CLAIMS }) });
    await app.init();
    // A second init() is a no-op.
    await app.init();
    const state = await snapshot(app);
    app.destroy();
    return { state, sent: host.sent };
  },

  async 'fullscreen: init timeout'() {
    const host = installHost({ transport: 'webview' });
    const app = new CherryMiniApp({ initTimeout: 20 });
    const result = await outcome(() => app.init());
    const state = await snapshot(app);
    app.destroy();
    return { result, state, sent: host.sent };
  },

  async 'fullscreen: old host, iframe transport'() {
    const host = installHost({ transport: 'iframe' });
    const app = new CherryMiniApp();
    const events = recordEvents(app);
    await initFullscreen(host, app);
    host.answerNext('wallet.signMessage', { result: { signature: b64([1]) } });
    const sign = await outcome(() => app.wallet.signMessage(new Uint8Array([3])));
    const state = await snapshot(app);
    app.destroy();
    return { sign, state, events, sent: host.sent };
  },

  async 'inline: old host.init fields'() {
    const token = unsignedJwt({ ...LEGACY_INLINE_CLAIMS });
    const host = installHost({ transport: 'iframe', hash: `token=${token}&mode=inline&route=/card` });
    host.answerNext('host.init', {
      result: {
        viewerWallet: SUB,
        roomId: 'room_ctx',
        messageId: 'msg_ctx',
        route: '/card',
        params: { score: 5 },
        height: 'tall',
        initialHeight: 180,
        blink_params_version: 1,
      },
    });
    const app = new CherryMiniApp();
    const events = recordEvents(app);
    await app.init();
    const afterInit = await snapshot(app);
    const calls = await exerciseMethods(host, app);
    const eventsInfo = await exerciseEvents(host, app);
    const afterCalls = await snapshot(app);
    app.destroy();
    return { afterInit, calls, eventsInfo, events, afterCalls, sent: host.sent };
  },

  async 'inline: host.init rejected → token claims only'() {
    const token = unsignedJwt({ ...LEGACY_INLINE_CLAIMS });
    const host = installHost({ transport: 'webview', search: `mode=inline&token=${token}` });
    host.answerNext('host.init', { error: { code: 'UNKNOWN_METHOD', message: 'nope' } });
    const app = new CherryMiniApp();
    const events = recordEvents(app);
    await app.init();
    const state = await snapshot(app);
    app.destroy();
    return { state, events, sent: host.sent };
  },

  async 'inline: empty host.init, no token'() {
    const host = installHost({ transport: 'webview', hash: 'mode=inline' });
    host.answerNext('host.init', { result: {} });
    const app = new CherryMiniApp();
    await app.init();
    const state = await snapshot(app);
    app.destroy();
    return { state, sent: host.sent };
  },

  async 'inline: non-string host.init fields are ignored'() {
    const token = unsignedJwt({ ...LEGACY_INLINE_CLAIMS, interactive: false, source: 'user_share' });
    const host = installHost({ transport: 'webview', hash: `mode=inline&token=${token}` });
    host.answerNext('host.init', {
      result: { viewerWallet: 42, roomId: null, params: 'x', height: 3, initialHeight: '100', blink_params_version: '2' },
    });
    const app = new CherryMiniApp();
    await app.init();
    const state = await snapshot(app);
    app.destroy();
    return { state, sent: host.sent };
  },

  async 'preview: share-picker render'() {
    const token = unsignedJwt({ ...LEGACY_INLINE_CLAIMS });
    const host = installHost({ transport: 'iframe', search: `mode=preview&token=${token}` });
    host.answerNext('host.init', { result: { viewerWallet: SUB, route: '/result', params: { score: 1 } } });
    const app = new CherryMiniApp();
    await app.init();
    const state = await snapshot(app);
    app.destroy();
    return { state, sent: host.sent };
  },

  async 'kit: createCherrySigner'() {
    const host = installHost({ transport: 'webview' });
    const app = new CherryMiniApp();
    const beforeReady = await outcome(() => createCherrySigner(app));
    await initFullscreen(host, app);
    const signer = createCherrySigner(app);

    // Legacy message, two required signers: [OTHER, SUB]; OTHER already signed.
    const message = legacyMessage([OTHER, SUB]);
    const otherSig = new Uint8Array(64).fill(7);
    let wireSummary: unknown = null;
    host.answerNext('wallet.signTransactions', (params) => {
      const [wire] = (params?.['transactions'] as string[]).map((t) => Buffer.from(t, 'base64'));
      const bytes = new Uint8Array(wire!);
      wireSummary = {
        sigCount: bytes[0],
        slot0: Array.from(bytes.slice(1, 65)).every((b) => b === 7),
        slot1NonZero: Array.from(bytes.slice(65, 129)).some((b) => b !== 0),
        messageIntact: Buffer.from(bytes.slice(129)).equals(Buffer.from(message)),
      };
      bytes.set(new Uint8Array(64).fill(0xab), 65);
      return { result: { transactions: [Buffer.from(bytes).toString('base64')] } };
    });
    const signed = await outcome(() =>
      signer.signTransactions([{ messageBytes: message, signatures: { [OTHER]: otherSig, [SUB]: null } }]),
    );

    const notSigner = await outcome(() =>
      signer.signTransactions([{ messageBytes: legacyMessage([OTHER]), signatures: {} }]),
    );

    host.answerNext('wallet.signMessage', { result: { signature: b64([1, 2]) } });
    host.answerNext('wallet.signMessage', { result: b64([3]) });
    const messages = await outcome(() => signer.signMessages!([new Uint8Array([1]), new Uint8Array([2])]));

    app.destroy();
    // The signer fills its own slot with random bytes, so the raw wire is not
    // stable; `wireSummary` pins its structure instead.
    const sent = host.sent.map((r) =>
      r.message['method'] === 'wallet.signTransactions'
        ? { ...r, message: { ...r.message, params: '[random placeholder: see wireSummary]' } }
        : r,
    );
    return { beforeReady, address: signer.address, wireSummary, signed, notSigner, messages, sent };
  },

  async 'solana: CherryWalletAdapter'() {
    const host = installHost({ transport: 'webview' });
    const adapter = new CherryWalletAdapter();
    const readyState = adapter.readyState;
    const signBeforeConnect = await outcome(() => adapter.signMessage(new Uint8Array([1])));

    host.answerNext('wallet.connect', { result: { publicKey: SUB } });
    const connectEvents: unknown[] = [];
    adapter.on('connect', (pk) => connectEvents.push(pk.toBase58()));
    const connect = await outcome(() => adapter.connect());
    const publicKey = adapter.publicKey?.toBase58() ?? null;

    const tx = new Transaction({ feePayer: new PublicKey(SUB), recentBlockhash: OTHER }).add(
      SystemProgram.transfer({ fromPubkey: new PublicKey(SUB), toPubkey: new PublicKey(OTHER), lamports: 1 }),
    );
    const txBase64 = tx.serialize({ requireAllSignatures: false }).toString('base64');
    host.answerNext('wallet.signTransaction', { result: { transaction: txBase64 } });
    const signTx = await outcome(() =>
      adapter.signTransaction(tx).then((t) => ({ feePayer: t.feePayer?.toBase58(), sigs: t.signatures.length })),
    );

    host.answerNext('wallet.signMessage', { result: { signature: b64([1, 2, 3]) } });
    const signMessage = await outcome(() => adapter.signMessage(new Uint8Array([9])));
    host.answerNext('wallet.signMessage', { error: { code: 'WALLET_CHANGED', message: 'The selected wallet changed' } });
    const signMessageWalletChanged = await outcome(() => adapter.signMessage(new Uint8Array([9])));

    host.answerNext('wallet.signAndSendTransaction', { result: { signature: 'sig-adapter' } });
    const send = await outcome(() => adapter.sendTransaction(tx, {} as never));

    const disconnectEvents: unknown[] = [];
    adapter.on('disconnect', () => disconnectEvents.push('disconnect'));
    await adapter.disconnect();
    return {
      readyState,
      signBeforeConnect,
      connect,
      publicKey,
      connectEvents,
      signTx,
      signMessage,
      signMessageWalletChanged,
      send,
      afterDisconnect: adapter.publicKey,
      disconnectEvents,
      sent: host.sent,
    };
  },
};

/** Minimal legacy message: header, static keys, blockhash, zero instructions. */
function legacyMessage(signers: string[]): Uint8Array {
  const keys = signers.map((s) => new PublicKey(s).toBytes());
  const bytes = [signers.length, 0, 0, keys.length];
  for (const k of keys) bytes.push(...k);
  bytes.push(...new Uint8Array(32).fill(1), 0);
  return new Uint8Array(bytes);
}
