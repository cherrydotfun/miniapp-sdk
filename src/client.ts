import { decodeJwt } from 'jose';
import { Bridge, BridgeError, getSharedBridge, destroySharedBridge } from './bridge';
import type { CherryTransactionOptions } from './label';
import type { BridgeEvent } from './bridge';
import {
  CHERRY_LANG_PARAM,
  CHERRY_THEME_PARAM,
  normaliseProfile,
  resolveDisplayContext,
  sameDisplay,
} from './context';
import { createCherryUsersApi, type CherryUsersApi } from './users';
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
  type CherryContext,
  type CherryDisplayContext,
  type CherryAppTier,
  type CherryReach,
  type CherryLaunchMode,
  type PaymentWalletKind,
  type PaymentWalletSetBy,
  type ShareBlinkOptions,
  type ShareBlinkResult,
} from './types';

/** The `label` param of a sign request, when the caller gave one. */
const labelParam = (options?: CherryTransactionOptions): { label?: string } =>
  options?.label !== undefined ? { label: options.label } : {};

export type CherryMiniAppEvent =
  | 'suspended'
  | 'resumed'
  | 'walletDisconnected'
  /** Inline blink params were updated by the bot (`answerCallback.updateBlink`). */
  | 'blink:update';

type EventListener<T = unknown> = (data: T) => void;

/** Called with the new context every time it changes (see `CherryMiniApp#onContextChange`). */
export type CherryContextListener = (context: CherryContext) => void;

/** The launch half of the context — fixed for the launch. */
type LaunchContext = Omit<CherryContext, keyof CherryDisplayContext | 'user'>;

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
  /**
   * Extra Cherry host origins to accept in iframe mode, on top of
   * `https://chat.cherry.fun`, `https://cherry.fun` and `https://*.cherry.fun`
   * (e.g. a staging host). Messages from any other origin are ignored.
   */
  trustedOrigins?: readonly string[];
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
  private _claims: Partial<LaunchTokenPayload> | null = null;
  private _launchContext: LaunchContext | null = null;
  private _context: CherryContext | null = null;
  private readonly contextListeners = new Set<CherryContextListener>();
  private readonly initTimeout: number;

  constructor(options: CherryMiniAppOptions = {}) {
    this.bridge = getSharedBridge({
      ...(options.strict !== undefined ? { strict: options.strict } : {}),
      ...(options.trustedOrigins !== undefined ? { trustedOrigins: options.trustedOrigins } : {}),
    });
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

  /**
   * Everything the SDK resolved about this launch (app id, Cherry ID, payment
   * wallet, permissions, reach, tier, mode), how the host wants the app to
   * look (locale, colour scheme, platform, safe area) and the person's public
   * profile (`user`). `null` until `init()` resolves; the display fields and
   * `user` then follow the host — see {@link onContextChange}. Display-only —
   * verify `launchToken` on your backend before trusting any of it.
   */
  get context(): CherryContext | null {
    return this._context;
  }

  /**
   * Subscribe to context changes: called with the new `context` when `init()`
   * first resolves it and whenever the host reports a new language, colour
   * scheme, safe area or profile (`cherry:context`). Returns the unsubscribe
   * function. Not called for an update that changes nothing.
   *
   * ```ts
   * const off = cherry.onContextChange((ctx) => i18n.changeLanguage(ctx.locale ?? 'en'));
   * ```
   */
  onContextChange(listener: CherryContextListener): () => void {
    this.contextListeners.add(listener);
    return () => {
      this.contextListeners.delete(listener);
    };
  }

  /**
   * The person's public Cherry profile and social graph, read from the Cherry
   * API with the current launch token (`Authorization: Bearer`). The API's
   * origin is the token's issuer, and only when it is a trusted Cherry origin
   * — the token is never sent anywhere else. Failures are `CherryApiError`s.
   * For UI: a backend reads the same API with the token it verified.
   */
  readonly users: CherryUsersApi = createCherryUsersApi({
    getToken: () => this._launchToken,
    trustedOrigins: () => this.bridge.trustedOrigins,
  });

  /** Your mini-app id, from the launch token. */
  get appId(): string | null {
    return this._context?.appId ?? null;
  }

  /** The person's Cherry ID — stable across all their wallets. */
  get cherryId(): string | null {
    return this._context?.cherryId ?? null;
  }

  /**
   * The wallet Cherry signs with in this app, when the host reports one
   * (it can differ from `user.publicKey` if the person picked another wallet
   * for your app). `null` → use `wallet.publicKey`.
   */
  get paymentWallet(): string | null {
    return this._context?.paymentWallet ?? null;
  }

  get paymentWalletKind(): PaymentWalletKind | null {
    return this._context?.paymentWalletKind ?? null;
  }

  get paymentWalletSetBy(): PaymentWalletSetBy | null {
    return this._context?.paymentWalletSetBy ?? null;
  }

  /** Bridge permissions granted for this launch (e.g. `wallet:sign`). */
  get permissions(): readonly string[] {
    return this._context?.permissions ?? [];
  }

  /** Whether this launch was granted `permission` (e.g. `'wallet:send'`). */
  hasPermission(permission: string): boolean {
    return this.permissions.includes(permission);
  }

  get reach(): CherryReach | null {
    return this._context?.reach ?? null;
  }

  /** Trust tier of the app — decides the host's wallet limits. */
  get tier(): CherryAppTier | null {
    return this._context?.tier ?? null;
  }

  /** `'fullscreen'`, `'inline'` or `'preview'`; `null` until ready. */
  get mode(): CherryLaunchMode | null {
    return this._context?.mode ?? null;
  }

  /**
   * The raw launch-token claims, decoded but NOT verified. For display and
   * debugging; never for authorization (see `verifyLaunchToken`).
   */
  get claims(): Readonly<Partial<LaunchTokenPayload>> | null {
    return this._claims;
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
    this._claims = payload;
    this._launchContext = resolveContext({
      claims: payload,
      mode: 'fullscreen',
      capabilities: initMessage.capabilities,
    });

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
      if (message['type'] === 'cherry:init') {
        // The host re-sends cherry:init until it sees cherry:ready. A repeat
        // after we are ready means our ack was lost (e.g. the host's listener
        // was not up yet): ack again, idempotently. Its context is the
        // host's current one (the bridge recorded it).
        this.bridge.sendToHost(readyMsg);
        this.refreshContext();
        return;
      }
      if (message['type'] === 'cherry:context') {
        this.refreshContext();
        return;
      }
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
    this.refreshContext();
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
    const ctxInitialHeight =
      typeof ctx['initialHeight'] === 'number'
        ? (ctx['initialHeight'] as number)
        : null;
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
        this._claims = claims;
      } catch {
        // opaque token — ignore
      }
    }

    // Context v2 rides the host.init answer — newer than anything the host
    // posted before it answered.
    this.bridge.noteHostContext(ctx['context']);

    // The inline token is minted once per message for the whole room, so it
    // names no viewer: the viewer's Cherry ID and payment wallet come from the
    // host.init answer (hosts that support wallet switching), never the token.
    this._launchContext = resolveContext({
      claims,
      mode: isPreview ? 'preview' : 'inline',
      capabilities: ctx['capabilities'],
      viewer: {
        cherryId: ctx['viewerCherryId'],
        paymentWallet: ctx['viewerPaymentWallet'],
        paymentWalletKind: ctx['viewerPaymentWalletKind'],
      },
    });

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
      // Host.init carries the resolved initial height; fall back to the token
      // claim (`initial_height`) for SSR / before the bridge answers.
      initialHeight:
        ctxInitialHeight ??
        (typeof claims.initial_height === 'number'
          ? claims.initial_height
          : null),
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
        if (message['type'] === 'cherry:context') {
          this.refreshContext();
          return;
        }
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
    this.refreshContext();
  }

  /**
   * Re-resolve `context` from the launch half, the host's latest context
   * (`Bridge#hostContext`), the launch URL and the token's `locale` claim;
   * tell the listeners when anything they can see changed.
   */
  private refreshContext(): void {
    if (!this._launchContext) return;
    const host = this.bridge.hostContext;
    const next: CherryContext = {
      ...this._launchContext,
      ...resolveDisplayContext({
        host,
        urlLang: readLaunchParam(CHERRY_LANG_PARAM),
        urlTheme: readLaunchParam(CHERRY_THEME_PARAM),
        tokenLocale: this._claims?.locale,
      }),
      user: normaliseProfile(host?.['user']),
    };
    if (this._context && sameDisplay(this._context, next)) return;
    this._context = next;
    for (const listener of [...this.contextListeners]) {
      try {
        listener(next);
      } catch {
        // A listener's error must not disrupt the SDK or the other listeners
      }
    }
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
        const ignored = this.bridge.ignoredOrigins;
        const hint = ignored.length
          ? ` (ignored messages from untrusted origin(s) ${ignored.join(', ')} — add them to \`trustedOrigins\` if they are Cherry hosts)`
          : '';
        reject(new Error(`cherry:init not received within ${this.initTimeout}ms${hint}`));
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
    signTransaction(transaction: unknown, options?: CherryTransactionOptions): Promise<unknown>;
    signAllTransactions(transactions: unknown[], options?: CherryTransactionOptions): Promise<Uint8Array[]>;
    signAndSendTransaction(transaction: unknown, options?: CherryTransactionOptions): Promise<string>;
    signMessage(message: Uint8Array): Promise<Uint8Array>;
  } {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      get publicKey(): string | null {
        return self._publicKey;
      },
      signTransaction(transaction: unknown, options?: CherryTransactionOptions): Promise<Uint8Array> {
        self.assertReady();
        return self.bridge
          .request('wallet.signTransaction', {
            transaction: serializeTxToBase64(transaction),
            ...labelParam(options),
          })
          .then((result) => {
            const tx = (result as Record<string, unknown>)?.['transaction'] ?? result;
            return base64ToUint8Array(tx as string);
          });
      },
      signAllTransactions(transactions: unknown[], options?: CherryTransactionOptions): Promise<Uint8Array[]> {
        self.assertReady();
        const base64Txs = transactions.map(serializeTxToBase64);
        return self.bridge
          .request('wallet.signTransactions', { transactions: base64Txs, ...labelParam(options) })
          .then((result) => {
            const signedArray = (result as Record<string, unknown>)?.['transactions'] ?? result;
            return (signedArray as string[]).map((tx) => base64ToUint8Array(tx));
          });
      },
      signAndSendTransaction(transaction: unknown, options?: CherryTransactionOptions): Promise<string> {
        self.assertReady();
        return self.bridge.request('wallet.signAndSendTransaction', {
          transaction: serializeTxToBase64(transaction),
          ...labelParam(options),
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

  /**
   * Open Cherry screens. Sends the canonical method (`navigate.userProfile`,
   * `navigate.openRoom`) and, if the host rejects it as unknown — older inline
   * hosts only know `navigate.profile` / `navigate.room`, older fullscreen
   * hosts only the canonical names — retries once with the other name and
   * remembers which one this host speaks.
   */
  readonly navigate: CherryNavigate = {
    userProfile: (identifier: string): Promise<void> => {
      this.assertReady();
      return this.requestWithAlias('navigate.userProfile', { identifier });
    },

    openRoom: (identifier: string): Promise<void> => {
      this.assertReady();
      return this.requestWithAlias('navigate.openRoom', { identifier });
    },
  };

  /** Canonical navigate methods whose alias is what this host answered. */
  private readonly aliasPreferred = new Set<NavigateMethod>();

  private async requestWithAlias(method: NavigateMethod, params: Record<string, unknown>): Promise<void> {
    const alias = NAVIGATE_ALIASES[method];
    const preferAlias = this.aliasPreferred.has(method);
    const first = preferAlias ? alias : method;
    const second = preferAlias ? method : alias;
    try {
      await this.bridge.request(first, params);
      return;
    } catch (error) {
      if (!isMethodRejection(error)) throw error;
      try {
        await this.bridge.request(second, params);
      } catch (retryError) {
        // Both names unknown → report the first refusal; a real failure of
        // the method the host does know is the more useful error.
        throw isMethodRejection(retryError) ? error : retryError;
      }
      if (second === alias) this.aliasPreferred.add(method);
      else this.aliasPreferred.delete(method);
    }
  }

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
      ...(options.initialHeight !== undefined
        ? { initialHeight: options.initialHeight }
        : {}),
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
    this.contextListeners.clear();
    this._isReady = false;
    this._blink = null;
    this._claims = null;
    this._launchContext = null;
    this._context = null;
    destroySharedBridge();
  }

  // ---- private helpers ----

  private assertReady(): void {
    if (!this._isReady) {
      throw new Error('CherryMiniApp is not ready. Call init() first.');
    }
  }
}

// ---- navigation helpers ----

type NavigateMethod = 'navigate.userProfile' | 'navigate.openRoom';

/** Canonical navigate method → the name older inline hosts use. */
const NAVIGATE_ALIASES: Readonly<Record<NavigateMethod, string>> = Object.freeze({
  'navigate.userProfile': 'navigate.profile',
  'navigate.openRoom': 'navigate.room',
});

const METHOD_REJECTION_CODES: ReadonlySet<string> = new Set([
  'METHOD_NOT_FOUND',
  'UNKNOWN_METHOD',
  'METHOD_NOT_SUPPORTED',
  'METHOD_NOT_ALLOWED_IN_INLINE',
]);

/**
 * Whether the host refused the METHOD NAME (as opposed to failing it): a
 * method-rejection code, or the generic `Unknown method: X` text that older
 * hosts send under `BRIDGE_ERROR`.
 */
function isMethodRejection(error: unknown): boolean {
  if (!(error instanceof BridgeError)) return false;
  if (METHOD_REJECTION_CODES.has(error.code)) return true;
  return /^unknown method\b/i.test(error.message) || /not allowed inside an inline blink/i.test(error.message);
}

// ---- context helpers ----

const TIERS: readonly CherryAppTier[] = ['unverified', 'verified', 'partner'];
const REACHES: readonly CherryReach[] = ['project', 'external'];
const WALLET_KINDS: readonly PaymentWalletKind[] = ['app_held', 'external'];
const SET_BY: readonly PaymentWalletSetBy[] = ['history', 'signature', 'user'];

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : null;
}

/**
 * The launch context from (unverified) token claims, the handshake's
 * capability list and — inline — the host.init viewer fields, which win.
 */
function resolveContext(input: {
  claims: Partial<LaunchTokenPayload>;
  mode: CherryLaunchMode;
  capabilities: unknown;
  viewer?: { cherryId: unknown; paymentWallet: unknown; paymentWalletKind: unknown };
}): LaunchContext {
  const { claims, viewer } = input;
  const capabilities = stringList(input.capabilities) ?? [];
  // `permissions` is authoritative in the token; an older token lacks it, and
  // then the handshake's capability list (permissions + host features) is
  // the next best source — permissions are the `scope:action` entries.
  const permissions = stringList(claims.permissions) ?? capabilities.filter((c) => c.includes(':'));
  const aud = typeof claims.aud === 'string' ? claims.aud : null;

  const paymentWallet = nonEmptyString(viewer?.paymentWallet) ?? nonEmptyString(claims.payment_wallet);
  return {
    appId: nonEmptyString(aud) ?? nonEmptyString(claims.mini_app_id) ?? nonEmptyString(claims.app_id),
    cherryId: nonEmptyString(viewer?.cherryId) ?? nonEmptyString(claims.cherry_id),
    paymentWallet,
    paymentWalletKind: paymentWallet
      ? oneOf(viewer?.paymentWalletKind, WALLET_KINDS) ?? oneOf(claims.payment_wallet_kind, WALLET_KINDS)
      : null,
    paymentWalletSetBy: paymentWallet && !viewer?.paymentWallet ? oneOf(claims.payment_wallet_set_by, SET_BY) : null,
    permissions: Object.freeze([...permissions]),
    reach: oneOf(claims.reach, REACHES),
    tier: oneOf(claims.tier, TIERS),
    mode: input.mode,
    hostCapabilities: Object.freeze(capabilities.filter((c) => !permissions.includes(c))),
  };
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
