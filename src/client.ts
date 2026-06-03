import { decodeJwt } from 'jose';
import { Bridge, getSharedBridge, destroySharedBridge } from './bridge';
import type { BridgeEvent } from './bridge';
import {
  BRIDGE_VERSION,
  type BridgeMessage,
  type BridgeInitMessage,
  type BridgeReadyMessage,
  type CherryUser,
  type CherryRoom,
  type CherryNavigate,
  type LaunchTokenPayload,
  type CherryBlinkContext,
  type ShareBlinkOptions,
  type ShareBlinkResult,
} from './types';

export type CherryMiniAppEvent =
  | 'suspended'
  | 'resumed'
  | 'walletDisconnected'
  /** Inline blink params were updated by the bot (`answerCallback.updateBlink`). */
  | 'blink:update';

type EventListener<T = unknown> = (data: T) => void;

export interface CherryMiniAppOptions {
  /** Milliseconds to wait for cherry:init from the host. Default: 10_000 */
  initTimeout?: number;
  /**
   * When `true`, only Cherry-injected signals are used for environment
   * detection (`window.__cherry` / `cherry_embed=1`). Fallbacks such as
   * `ReactNativeWebView` or `window.parent !== window` are disabled.
   *
   * Use once all Cherry hosts you target have been updated to inject the
   * new signals, to prevent false positives in wallet in-app browsers.
   * Default: `false`.
   */
  strict?: boolean;
}

export class CherryMiniApp {
  private readonly bridge: Bridge;
  private readonly eventListeners = new Map<string, Set<EventListener>>();
  private removeHostListener: (() => void) | null = null;
  private _isReady = false;
  private _user: CherryUser | null = null;
  private _room: CherryRoom | null = null;
  private _launchToken: string | null = null;
  private _publicKey: string | null = null;
  private _blink: CherryBlinkContext | null = null;
  private readonly initTimeout: number;

  constructor(options: CherryMiniAppOptions = {}) {
    this.bridge = getSharedBridge();
    this.initTimeout = options.initTimeout ?? 10_000;
  }

  // ---- public state ----

  get isReady(): boolean {
    return this._isReady;
  }

  get user(): CherryUser {
    this.assertReady();
    return this._user!;
  }

  get room(): CherryRoom {
    this.assertReady();
    return this._room!;
  }

  get launchToken(): string {
    this.assertReady();
    return this._launchToken!;
  }

  /**
   * Inline blink context (messageId, sender, viewer, params, …) — populated
   * only when launched as an inline blink. `null` for fullscreen/embed.
   */
  get blink(): CherryBlinkContext | null {
    return this._blink;
  }

  // ---- init ----

  async init(): Promise<void> {
    if (this._isReady) return;

    // Inline blink bootstrap. The inline host (a chat-bubble card) does NOT
    // push `cherry:init`; it answers a `host.init` request and supplies the
    // viewer wallet + room/message context. Detected via `mode=inline` in the
    // launch URL (query or fragment). Fullscreen / embed keep the cherry:init
    // handshake below.
    const mode = readLaunchParam('mode');
    if (mode === 'inline' || mode === 'preview') {
      // `preview` is a non-interactive render shown in the share picker before
      // the message exists — same bootstrap as inline, but read-only and
      // without a real messageId/room.
      await this.initInline(mode === 'preview');
      return;
    }

    const initMessage = await this.waitForInit();

    // Decode JWT without verification (verification is server-side)
    const payload = decodeJwt(initMessage.token) as unknown as LaunchTokenPayload;

    this._launchToken = initMessage.token;
    this._publicKey = payload.sub;

    this._user = {
      publicKey: payload.sub,
      displayName: payload.user.display_name,
      avatarUrl: payload.user.avatar_url,
    };

    this._room = {
      id: payload.room_id,
      title: payload.room.title,
      memberCount: payload.room.member_count,
    };

    // Send ready acknowledgement
    const readyMsg: BridgeReadyMessage = {
      type: 'cherry:ready',
      version: BRIDGE_VERSION,
    };
    this.bridge.sendToHost(readyMsg);

    // Subscribe to host events (suspended, resumed, walletDisconnected, etc.)
    this.removeHostListener = this.bridge.startListening((message: BridgeMessage) => {
      if (message['type'] === 'cherry:event') {
        const evt = message as unknown as BridgeEvent;
        // Host events carry their payload under `payload` (e.g. blink:update);
        // fall back to `data` for older/host-agnostic shapes.
        this.emit(
          evt.event as CherryMiniAppEvent,
          (evt as { payload?: unknown }).payload ?? evt.data,
        );
      }
    });

    this._isReady = true;
  }

  /**
   * Inline-mode bootstrap. Reads the launch token from the URL and pulls the
   * viewer/room context from the host via a `host.init` bridge request (the
   * inline host has no user-bearing token to push, so identity comes from the
   * host, not the token). The blink's `params`/`messageId`/`route` are also
   * available on the host.init response and via the launch token claims.
   */
  private async initInline(isPreview = false): Promise<void> {
    const token = readLaunchParam('token');

    let ctx: Record<string, unknown> = {};
    try {
      ctx = (await this.bridge.request('host.init', {})) as Record<
        string,
        unknown
      >;
    } catch {
      // Host didn't answer host.init — leave ctx empty; we still expose
      // whatever the token carries so the app can render in a degraded state.
    }

    const viewerWallet =
      typeof ctx['viewerWallet'] === 'string' ? (ctx['viewerWallet'] as string) : '';
    let roomId = typeof ctx['roomId'] === 'string' ? (ctx['roomId'] as string) : '';
    const ctxMessageId =
      typeof ctx['messageId'] === 'string' ? (ctx['messageId'] as string) : '';
    const ctxRoute = typeof ctx['route'] === 'string' ? (ctx['route'] as string) : '';
    const ctxParams =
      ctx['params'] && typeof ctx['params'] === 'object'
        ? (ctx['params'] as Record<string, unknown>)
        : {};
    const ctxHeight =
      typeof ctx['height'] === 'string' ? (ctx['height'] as string) : 'medium';
    const ctxParamsVersion =
      typeof ctx['blink_params_version'] === 'number'
        ? (ctx['blink_params_version'] as number)
        : null;

    this._launchToken = token ?? null;
    this._publicKey = viewerWallet || null;

    // Decode the launch token for claims the host.init response doesn't carry
    // (sender, miniAppId/appId, source, interactive, token timing).
    let claims: Partial<LaunchTokenPayload> = {};
    if (token) {
      try {
        claims = decodeJwt(token) as unknown as LaunchTokenPayload;
        if (!roomId) roomId = String(claims.room_id ?? '');
      } catch {
        // opaque token — ignore
      }
    }

    this._user = {
      publicKey: viewerWallet,
      displayName: '',
      avatarUrl: '',
    };
    this._room = {
      id: roomId,
      title: '',
      memberCount: 0,
    };

    this._blink = {
      messageId: ctxMessageId || String(claims.message_id ?? ''),
      roomId,
      viewerWallet,
      sender: isPreview
        ? viewerWallet || null
        : claims.sender
          ? String(claims.sender)
          : null,
      miniAppId: claims.mini_app_id ? String(claims.mini_app_id) : null,
      appId: claims.app_id ? String(claims.app_id) : null,
      route: ctxRoute || String(claims.route ?? '/'),
      params: ctxParams,
      height: ctxHeight,
      // Preview is always read-only; the eventual shared blink's author is the
      // viewer doing the sharing, so report them as `sender` in preview.
      interactive: isPreview ? false : claims.interactive !== false,
      source: isPreview ? 'preview' : claims.source ? String(claims.source) : null,
      isPreview,
      blinkParamsVersion: ctxParamsVersion,
      issuedAt: typeof claims.iat === 'number' ? claims.iat : null,
      expiresAt: typeof claims.exp === 'number' ? claims.exp : null,
      jti: claims.jti ? String(claims.jti) : null,
    };

    // Subscribe to host events (blink:update, suspended, etc.).
    this.removeHostListener = this.bridge.startListening(
      (message: BridgeMessage) => {
        if (message['type'] === 'cherry:event') {
          const evt = message as unknown as BridgeEvent;
          this.emit(
            evt.event as CherryMiniAppEvent,
            (evt as { payload?: unknown }).payload ?? evt.data,
          );
        }
      },
    );

    this._isReady = true;
  }

  private waitForInit(): Promise<BridgeInitMessage> {
    // Check if cherry:init was already received before init() was called
    const buffered = this.bridge.consumeBufferedInit();
    if (buffered && buffered['type'] === 'cherry:init') {
      return Promise.resolve(buffered as unknown as BridgeInitMessage);
    }

    return new Promise<BridgeInitMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`cherry:init not received within ${this.initTimeout}ms`));
      }, this.initTimeout);

      const cleanup = this.bridge.startListening((message: BridgeMessage) => {
        if (message['type'] === 'cherry:init') {
          clearTimeout(timer);
          cleanup();
          resolve(message as unknown as BridgeInitMessage);
        }
      });
    });
  }

  // ---- wallet ----

  /**
   * Returns a stable wallet facade. Methods are arrow functions bound to the
   * outer CherryMiniApp instance so `this` always resolves correctly.
   * `publicKey` is a getter that reads the live `_publicKey` field.
   */
  get wallet(): {
    readonly publicKey: string | null;
    signTransaction(transaction: unknown): Promise<unknown>;
    signAllTransactions(transactions: unknown[]): Promise<Uint8Array[]>;
    signAndSendTransaction(transaction: unknown): Promise<string>;
    signMessage(message: Uint8Array): Promise<Uint8Array>;
  } {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      get publicKey(): string | null {
        return self._publicKey;
      },
      signTransaction(transaction: unknown): Promise<Uint8Array> {
        self.assertReady();
        return self.bridge
          .request('wallet.signTransaction', {
            transaction: serializeTxToBase64(transaction),
          })
          .then((result) => {
            const tx = (result as Record<string, unknown>)?.['transaction'] ?? result;
            return base64ToUint8Array(tx as string);
          });
      },
      signAllTransactions(transactions: unknown[]): Promise<Uint8Array[]> {
        self.assertReady();
        const base64Txs = transactions.map(serializeTxToBase64);
        return self.bridge
          .request('wallet.signTransactions', { transactions: base64Txs })
          .then((result) => {
            const signedArray = (result as Record<string, unknown>)?.['transactions'] ?? result;
            return (signedArray as string[]).map((tx) => base64ToUint8Array(tx));
          });
      },
      signAndSendTransaction(transaction: unknown): Promise<string> {
        self.assertReady();
        return self.bridge.request('wallet.signAndSendTransaction', {
          transaction: serializeTxToBase64(transaction),
        }).then((result) => {
          const sig = (result as Record<string, unknown>)?.['signature'] ?? result;
          return sig as string;
        });
      },
      signMessage(message: Uint8Array): Promise<Uint8Array> {
        self.assertReady();
        const base64 = uint8ArrayToBase64(message);
        return self.bridge
          .request('wallet.signMessage', { message: base64 })
          .then((result) => {
            const sig = (result as Record<string, unknown>)?.['signature'] ?? result;
            return base64ToUint8Array(sig as string);
          });
      },
    };
  }

  getPublicKey(): string | null {
    return this._publicKey;
  }

  // ---- navigate ----

  readonly navigate: CherryNavigate = {
    userProfile: (identifier: string): Promise<void> => {
      this.assertReady();
      return this.bridge.request('navigate.userProfile', { identifier }) as Promise<void>;
    },

    openRoom: (identifier: string): Promise<void> => {
      this.assertReady();
      return this.bridge.request('navigate.openRoom', { identifier }) as Promise<void>;
    },
  };

  // ---- share ----

  /**
   * Hand a "result" snapshot to the Cherry host so the user can share it into
   * a DM or group as an interactive blink. The host opens a recipient picker
   * with a preview; the returned promise resolves once the user picks a
   * recipient (or cancels). The miniapp identity is taken from the current
   * session — a miniapp can only share itself, read-only.
   */
  share(options: ShareBlinkOptions = {}): Promise<ShareBlinkResult> {
    this.assertReady();
    return this.bridge.request('host.share', {
      ...(options.route !== undefined ? { route: options.route } : {}),
      ...(options.params !== undefined ? { params: options.params } : {}),
      ...(options.height !== undefined ? { height: options.height } : {}),
      ...(options.caption !== undefined ? { caption: options.caption } : {}),
      ...(options.previewable !== undefined
        ? { previewable: options.previewable }
        : {}),
    }) as Promise<ShareBlinkResult>;
  }

  // ---- event emitter ----

  on(event: CherryMiniAppEvent, listener: EventListener): void {
    let set = this.eventListeners.get(event);
    if (!set) {
      set = new Set();
      this.eventListeners.set(event, set);
    }
    set.add(listener);
  }

  off(event: CherryMiniAppEvent, listener: EventListener): void {
    this.eventListeners.get(event)?.delete(listener);
  }

  private emit(event: string, data?: unknown): void {
    const set = this.eventListeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(data);
      } catch {
        // Swallow listener errors to avoid disrupting the SDK
      }
    }
  }

  // ---- cleanup ----

  destroy(): void {
    this.removeHostListener?.();
    this.removeHostListener = null;
    this.eventListeners.clear();
    this._isReady = false;
    this._blink = null;
    destroySharedBridge();
  }

  // ---- private helpers ----

  private assertReady(): void {
    if (!this._isReady) {
      throw new Error('CherryMiniApp is not ready. Call init() first.');
    }
  }
}

// ---- launch URL helpers ----

/**
 * Read a launch parameter from the current URL — checks the query string first,
 * then the fragment (`#...`). Inline blinks carry `token`/`mode`/`route` in the
 * fragment and `cherry_embed=1` in the query; this reads either location.
 */
function readLaunchParam(name: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const fromSearch = new URLSearchParams(window.location.search).get(name);
    if (fromSearch !== null) return fromSearch;
    const hash = window.location.hash.replace(/^#/, '');
    return new URLSearchParams(hash).get(name);
  } catch {
    return null;
  }
}

// ---- transaction helpers ----

function serializeTxToBase64(tx: unknown): string {
  if (typeof tx === 'string') return tx; // already base64
  if (tx instanceof Uint8Array) return uint8ArrayToBase64(tx); // raw bytes
  if (isSerializableTx(tx)) {
    return uint8ArrayToBase64((tx as { serialize(opts?: { requireAllSignatures?: boolean }): Uint8Array }).serialize({ requireAllSignatures: false }));
  }
  throw new TypeError('Transaction must be a Uint8Array, base64 string, or have a serialize() method');
}

function isSerializableTx(tx: unknown): boolean {
  if (typeof tx !== 'object' || tx === null) return false;
  return typeof (tx as Record<string, unknown>)['serialize'] === 'function';
}

function uint8ArrayToBase64(arr: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]!);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
