import { decodeJwt } from 'jose';
import { Bridge, BridgeError, getSharedBridge, destroySharedBridge } from './bridge';
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
  type TradePreviewRequest,
  type TradePreview,
  type TradeOperation,
  type TradeCapabilities,
  type TradeAsset,
  type TradeHolding,
  type CherryAccount,
  type CherryEvmRequest,
  type CherryChain,
  type CherrySignTransactionOptions,
  type CherryWalletChangedEvent,
  type CherryWalletSwitchResult,
  type ShareBlinkOptions,
  type ShareBlinkResult,
} from './types';

export type CherryMiniAppEvent =
  | 'suspended'
  | 'resumed'
  | 'walletDisconnected'
  /** Inline blink params were updated by the bot (`answerCallback.updateBlink`). */
  | 'blink:update'
  /**
   * The person switched the wallet they pay with ({@link CherryWalletChangedEvent}).
   * `wallet.publicKey` / `wallet.custodial` (and `launchToken`, when the host
   * re-minted it) are already updated when listeners run. Rebuild any
   * transaction prepared for the previous wallet.
   */
  | 'wallet.changed';

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
  private bridge: Bridge;
  private bridgeDestroyed = false;
  private initGeneration = 0;
  private cancelPendingInit: (() => void) | null = null;
  private readonly eventListeners = new Map<string, Set<EventListener>>();
  private removeHostListener: (() => void) | null = null;
  private _isReady = false;
  private _user: CherryUser | null = null;
  private _room: CherryRoom | null = null;
  private _launchToken: string | null = null;
  /** The payment wallet — what `wallet.publicKey` reports and the host signs with. */
  private _publicKey: string | null = null;
  private _custodial = false;
  private _hostCapabilities: string[] = [];
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

  /**
   * Features the host advertised (`cherry:init` `capabilities`, or the inline
   * `host.init` answer's `capabilities`). `[]` for hosts that predate
   * capability negotiation and before `init()` resolves. Feature-detect
   * rather than assuming: e.g. `'wallet-switch'` → `wallet.requestSwitch()`.
   */
  get hostCapabilities(): string[] {
    return [...this._hostCapabilities];
  }

  /** Accounts explicitly authorized by the viewer, never the full linked-wallet list. */
  get accounts(): { list(): Promise<CherryAccount[]> } {
    return { list: async () => {
      this.requireCapability('accounts-v1');
      const result = await this.bridge.request('wallet.accounts', {});
      const accounts = (result as { accounts?: unknown })?.accounts;
      if (!Array.isArray(accounts) || accounts.length > 1000 || !accounts.every(isCherryAccount)) {
        throw new BridgeError('Invalid wallet.accounts response', 'INVALID_RESPONSE');
      }
      return accounts.map((account) => ({ ...account, capabilities: [...account.capabilities] }));
    } };
  }

  /** EIP-1193-style bridge; unsupported methods fail locally. */
  get evm(): { request(args: CherryEvmRequest): Promise<unknown> } {
    return { request: async ({ method, params }) => {
      this.requireCapability('evm');
      if (!['eth_chainId', 'eth_accounts', 'eth_requestAccounts', 'eth_sendTransaction'].includes(method)) {
        throw new BridgeError(`Unsupported EVM method: ${method}`, 'METHOD_NOT_SUPPORTED');
      }
      return this.bridge.request(`wallet.eth.${method}`, params === undefined ? {} : { params });
    } };
  }

  /** Host-owned trading. Amounts are exact base-unit integer strings. */
  get trade() {
    const call = async <T>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
      this.requireCapability('trading-v1');
      const result = await this.bridge.request(`trade.${method}`, params);
      if (!validTradeResponse(method, result)) throw new BridgeError(`Invalid trade.${method} response`, 'INVALID_RESPONSE');
      // Host execution data, prepared transactions and credentials are never
      // part of the app-facing operation envelope.
      if (method === 'request' || method === 'get' || method === 'resume' || method === 'lookup' || method === 'discard') {
        const operation = result as TradeOperation;
        return publicTradeOperation(operation) as T;
      }
      if (method === 'list') {
        const list = result as { operations: TradeOperation[] };
        return { operations: list.operations.map(publicTradeOperation) } as T;
      }
      return result as T;
    };
    return {
      capabilities: () => call<TradeCapabilities>('capabilities'),
      assets: (filter: { q?: string; chainId?: string; limit?: number } = {}) => call<{ assets: TradeAsset[] }>('assets', { ...filter }),
      holdings: () => call<{ holdings: TradeHolding[]; unavailableChains?: string[] }>('holdings'),
      preview: async (request: TradePreviewRequest) => {
        if (!/^(0|[1-9][0-9]*)$/.test(request.amount)) throw new BridgeError('amount must be a base-unit integer string', 'INVALID_ARGUMENT');
        const result = await call<TradePreview>('preview', { ...request });
        const same = (a: { chainId: string; address: string }, b: { chainId: string; address: string }) => a.chainId === b.chainId && a.address === b.address;
        if (!same(result.input, request.input) || !same(result.output, request.output) || !same(result.account, request.account) || result.inputAmount !== request.amount || result.constraints.kind !== request.kind || result.constraints.slippageBps !== request.slippageBps || (request.provider !== undefined && result.provider !== request.provider)) {
          throw new BridgeError('Trade preview does not match the request', 'INVALID_RESPONSE');
        }
        return result;
      },
      request: (request: { reviewId: string; idempotencyKey: string }) => {
        if (!request.reviewId || !request.idempotencyKey) return Promise.reject(new BridgeError('reviewId and idempotencyKey are required', 'INVALID_ARGUMENT'));
        return call<TradeOperation>('request', { ...request });
      },
      get: (operationId: string) => call<TradeOperation>('get', { operationId }),
      list: () => call<{ operations: TradeOperation[] }>('list'),
      lookup: (request: { reviewId: string; idempotencyKey: string }) => call<TradeOperation>('lookup', { ...request }),
      resume: (operationId: string) => call<TradeOperation>('resume', { operationId }),
      discard: async (operationId: string) => {
        if (!operationId) throw new BridgeError('operationId is required', 'INVALID_ARGUMENT');
        const result = await call<TradeOperation>('discard', { operationId });
        if (result.operationId !== operationId) throw new BridgeError('Trade operation does not match', 'INVALID_RESPONSE');
        return result;
      },
    };
  }

  private requireCapability(capability: string): void {
    this.assertReady();
    if (!this._hostCapabilities.includes(capability)) {
      throw new BridgeError(`Host does not support ${capability}`, 'METHOD_NOT_SUPPORTED');
    }
  }

  // ---- init ----

  async init(): Promise<void> {
    if (this._isReady) return;
    this.cancelPendingInit?.();
    const generation = ++this.initGeneration;
    if (this.bridgeDestroyed) {
      this.bridge = getSharedBridge();
      this.bridgeDestroyed = false;
    }

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
      await this.initInline(mode === 'preview', generation);
      return;
    }

    const initMessage = await this.waitForInit();
    this.assertInitGeneration(generation);

    // Decode JWT without verification (verification is server-side)
    const payload = decodeJwt(initMessage.token) as unknown as LaunchTokenPayload;

    this._launchToken = initMessage.token;
    // `sub` is the identity and never moves; the payer is a separate claim.
    // Tokens without it (older hosts) keep the 0.1.x behaviour: payer = sub.
    const paymentWallet = solanaAddress(payload.payment_wallet, payload.payment_wallet_chain);
    this._publicKey = paymentWallet ?? solanaAddress(payload.sub);
    this._custodial = paymentWallet !== null && payload.payment_wallet_kind === 'app_held';
    this._hostCapabilities = parseCapabilities(initMessage.capabilities);

    const cherryId = nonEmptyString(payload.cherry_id);
    this._user = {
      publicKey: payload.sub,
      displayName: payload.user.display_name,
      avatarUrl: payload.user.avatar_url,
      // Omitted rather than `undefined` so the object keeps its 0.1.x shape.
      ...(cherryId !== undefined ? { cherryId } : {}),
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
    this.removeHostListener = this.bridge.startListening((message) =>
      this.handleHostMessage(message),
    );

    this._isReady = true;
  }

  /**
   * Inline-mode bootstrap. Reads the launch token from the URL and pulls the
   * viewer/room context from the host via a `host.init` bridge request (the
   * inline host has no user-bearing token to push, so identity comes from the
   * host, not the token). The blink's `params`/`messageId`/`route` are also
   * available on the host.init response and via the launch token claims.
   */
  private async initInline(isPreview: boolean, generation: number): Promise<void> {
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
    this.assertInitGeneration(generation);

    // `viewerWallet` is the viewer's identity; CherryID-aware hosts add the
    // payer separately (`viewerPaymentWallet` / `viewerPaymentWalletKind`) and
    // `viewerCherryId`. Older hosts send none of them → payer = viewerWallet.
    const viewerWallet =
      typeof ctx['viewerWallet'] === 'string' ? (ctx['viewerWallet'] as string) : '';
    const viewerPaymentWallet = nonEmptyString(ctx['viewerPaymentWallet']);
    const viewerCherryId = nonEmptyString(ctx['viewerCherryId']);
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
    const paymentWallet = solanaAddress(viewerPaymentWallet, ctx['viewerPaymentWalletChain']);
    this._publicKey = paymentWallet ?? solanaAddress(viewerWallet);
    this._custodial = paymentWallet !== null && ctx['viewerPaymentWalletKind'] === 'app_held';
    this._hostCapabilities = parseCapabilities(ctx['capabilities']);

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

    const cherryId = viewerCherryId;
    this._user = {
      publicKey: viewerWallet,
      displayName: '',
      avatarUrl: '',
      ...(cherryId !== undefined ? { cherryId } : {}),
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

    // Subscribe to host events (blink:update, wallet.changed, suspended, etc.).
    this.removeHostListener = this.bridge.startListening((message) =>
      this.handleHostMessage(message),
    );

    this._isReady = true;
  }

  /** Host → app events, shared by the fullscreen and inline bootstraps. */
  private handleHostMessage(message: BridgeMessage): void {
    if (message['type'] !== 'cherry:event') return;
    const evt = message as unknown as BridgeEvent;
    // Host events carry their payload under `payload` (e.g. blink:update);
    // fall back to `data` for older/host-agnostic shapes.
    const data = (evt as { payload?: unknown }).payload ?? evt.data;
    if (evt.event === 'wallet.changed') {
      this.applyWalletChanged(data);
      return;
    }
    this.emit(evt.event as CherryMiniAppEvent, data);
  }

  private applyWalletChanged(data: unknown): void {
    const change = parseWalletChange(data);
    // A malformed payload is dropped: adopting it would point signing at a
    // wallet nobody selected, and listeners would rebuild for nothing.
    if (!change) return;
    this._publicKey = change.publicKey;
    this._custodial = change.custodial;
    if (change.token !== undefined) this._launchToken = change.token;
    this.emit('wallet.changed', change);
  }

  private waitForInit(): Promise<BridgeInitMessage> {
    // Check if cherry:init was already received before init() was called
    const buffered = this.bridge.consumeBufferedInit();
    if (buffered && buffered['type'] === 'cherry:init') {
      return Promise.resolve(buffered as unknown as BridgeInitMessage);
    }

    return new Promise<BridgeInitMessage>((resolve, reject) => {
      const bridge = this.bridge;
      const timer = setTimeout(() => {
        cleanup();
        if (this.cancelPendingInit === cancel) this.cancelPendingInit = null;
        reject(new Error(`cherry:init not received within ${this.initTimeout}ms`));
      }, this.initTimeout);

      const cancel = () => {
        clearTimeout(timer);
        cleanup();
        if (this.cancelPendingInit === cancel) this.cancelPendingInit = null;
        reject(new BridgeError('Initialization cancelled', 'DESTROYED'));
      };
      const cleanup = bridge.startListening((message: BridgeMessage) => {
        if (message['type'] === 'cherry:init') {
          clearTimeout(timer);
          cleanup();
          if (this.cancelPendingInit === cancel) this.cancelPendingInit = null;
          // The bridge also buffered this message; drop that copy so it can't
          // be replayed to a later init().
          bridge.consumeBufferedInit();
          resolve(message as unknown as BridgeInitMessage);
        }
      });
      this.cancelPendingInit = cancel;
    });
  }

  // ---- wallet ----

  /**
   * Returns a stable wallet facade. Methods are arrow functions bound to the
   * outer CherryMiniApp instance so `this` always resolves correctly.
   * `publicKey` / `custodial` are getters that read the live fields.
   *
   * `publicKey` is the person's PAYMENT wallet — the launch token's
   * `payment_wallet`, else `sub` — which is what the host signs with. Build
   * transactions with it as fee payer. It can differ from `user.publicKey`
   * (the identity) and can change while the app runs: on `'wallet.changed'`
   * rebuild prepared transactions — the host refuses one whose fee payer is
   * not the selected wallet, and the sign call rejects with a `BridgeError`
   * whose `code` is `'WALLET_CHANGED'`.
   *
   * `signTransaction` accepts an optional `{ chain }` — see
   * {@link CherrySignTransactionOptions}: Solana (the default) is never put on
   * the wire, and a chain the SDK cannot serve is refused locally with
   * `'CHAIN_NOT_SUPPORTED'`.
   */
  get wallet(): {
    readonly publicKey: string | null;
    /** True when `publicKey` is the Cherry ID wallet (key custodied by Cherry). */
    readonly custodial: boolean;
    signTransaction(
      transaction: unknown,
      options?: CherrySignTransactionOptions,
    ): Promise<unknown>;
    signAllTransactions(transactions: unknown[]): Promise<Uint8Array[]>;
    signAndSendTransaction(transaction: unknown): Promise<string>;
    signMessage(message: Uint8Array): Promise<Uint8Array>;
    requestSwitch(): Promise<CherryWalletSwitchResult>;
  } {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      get publicKey(): string | null {
        return self._publicKey;
      },
      get custodial(): boolean {
        return self._custodial;
      },
      signTransaction(
        transaction: unknown,
        options?: CherrySignTransactionOptions,
      ): Promise<Uint8Array> {
        self.assertReady();
        // Absent (or explicit `'solana'`) means Solana, and Solana is not sent:
        // the payload stays byte-identical to 0.1.x, which the regression
        // fixture pins. An unsupported chain throws before any serialization.
        const chain = requireSupportedChain(options?.chain);
        return self.bridge
          .request('wallet.signTransaction', {
            transaction: serializeTxToBase64(transaction),
            ...(chain !== undefined ? { chain } : {}),
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
      /**
       * Ask the host to let the person pick another wallet to pay with.
       * Resolves with the wallet they picked (possibly the current one) and,
       * when the host reports one, its `chain` (absent = `'solana'`);
       * rejects with a `BridgeError` whose `code` is `'USER_REJECTED'` when
       * they dismiss the picker.
       *
       * Allowed in inline blinks as well as fullscreen. The host rate-limits
       * it, so call it from a user gesture, never in a loop or on a timer.
       * Feature-detect with `hostCapabilities.includes('wallet-switch')`:
       * older hosts reject the method (`UNKNOWN_METHOD` / `METHOD_NOT_FOUND`).
       *
       * The host also fires `'wallet.changed'` (with a re-minted token in
       * fullscreen) — rebuild prepared transactions there.
       */
      requestSwitch(): Promise<CherryWalletSwitchResult> {
        self.assertReady();
        return self.bridge.request('wallet.requestSwitch', {}).then((result) => {
          const picked = parseWalletChange(result);
          if (!picked) {
            throw new BridgeError(
              'Host answered wallet.requestSwitch without a publicKey',
              'INVALID_RESPONSE',
            );
          }
          // Listeners are notified by the host's 'wallet.changed' event; the
          // state is also applied here so `wallet.publicKey` is current the
          // moment this promise resolves, whichever of the two arrives first.
          self._publicKey = picked.publicKey;
          self._custodial = picked.custodial;
          return {
            publicKey: picked.publicKey,
            custodial: picked.custodial,
            ...(picked.chain !== undefined ? { chain: picked.chain } : {}),
          };
        });
      },
    };
  }

  /** Same as `wallet.publicKey`: the payment wallet. */
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

  /** Open fullscreen as the viewer. Route/params require a supporting host. */
  requestExpand(options?: { route?: string; params?: Record<string, unknown> }): Promise<void> {
    this.assertReady();
    if (options && (options.route !== undefined || options.params !== undefined)) this.requireCapability('viewer-expand-v1');
    return this.bridge.request('host.requestExpand', options ? { ...options } : {}) as Promise<void>;
  }

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

  on(event: 'wallet.changed', listener: EventListener<CherryWalletChangedEvent>): void;
  on(event: CherryMiniAppEvent, listener: EventListener): void;
  on(event: CherryMiniAppEvent, listener: EventListener<never>): void {
    let set = this.eventListeners.get(event);
    if (!set) {
      set = new Set();
      this.eventListeners.set(event, set);
    }
    set.add(listener as EventListener);
  }

  off(event: 'wallet.changed', listener: EventListener<CherryWalletChangedEvent>): void;
  off(event: CherryMiniAppEvent, listener: EventListener): void;
  off(event: CherryMiniAppEvent, listener: EventListener<never>): void {
    this.eventListeners.get(event)?.delete(listener as EventListener);
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
    this.initGeneration++;
    this.cancelPendingInit?.();
    this.removeHostListener?.();
    this.removeHostListener = null;
    this.eventListeners.clear();
    this._isReady = false;
    this._blink = null;
    this._hostCapabilities = [];
    destroySharedBridge();
    this.bridgeDestroyed = true;
  }

  // ---- private helpers ----

  private assertInitGeneration(generation: number): void {
    if (generation !== this.initGeneration) throw new BridgeError('Initialization cancelled', 'DESTROYED');
  }

  private assertReady(): void {
    if (!this._isReady) {
      throw new Error('CherryMiniApp is not ready. Call init() first.');
    }
  }
}

// ---- host payload helpers ----

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseCapabilities(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((c): c is string => typeof c === 'string') : [];
}

/**
 * Validate a `wallet.changed` payload / `wallet.requestSwitch` result:
 * `{ publicKey, custodial, chain?, token? }`. `null` when there is no usable
 * wallet.
 */
function parseWalletChange(value: unknown): CherryWalletChangedEvent | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const publicKey = nonEmptyString(v['publicKey']);
  // This legacy facade is Solana-only, including wallet-switch events.
  if (publicKey === undefined || !solanaAddress(publicKey, v['chain'])) return null;
  const token = nonEmptyString(v['token']);
  const chain = parseChain(v['chain']);
  return {
    publicKey,
    custodial: v['custodial'] === true,
    // Keys are only added when the host sent them, so the object keeps its
    // 0.1.x shape for a host that knows nothing about chains.
    ...(chain !== undefined ? { chain } : {}),
    ...(token !== undefined ? { token } : {}),
  };
}

/**
 * A chain reported by the host. Only values this SDK can describe are adopted
 * (see {@link CherryChain}); an unknown one is dropped rather than surfaced
 * under a type that does not cover it.
 */
function parseChain(value: unknown): CherryChain | undefined {
  const chain = nonEmptyString(value);
  return chain === 'solana' ? chain : undefined;
}

/**
 * Resolve the `chain` option of a signing call to what goes on the wire.
 * `undefined` for Solana (explicit or implied) — an absent chain IS `'solana'`,
 * so nothing is sent. Anything else is refused synchronously: the SDK cannot
 * serve it, and a request would only fail at the host (or hang it).
 */
function requireSupportedChain(
  chain: CherryChain | undefined,
): CherryChain | undefined {
  // Typed as `CherryChain`, but callers may be plain JS past a type boundary —
  // compare as a string so they get the local refusal too.
  const value: string | undefined = chain;
  if (value === undefined || value === 'solana') return undefined;
  throw new BridgeError(`Chain not supported: ${value}`, 'CHAIN_NOT_SUPPORTED');
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

function isCherryAccount(value: unknown): value is CherryAccount {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const chain = v['chainId'];
  const address = v['address'];
  const evm = typeof chain === 'string' && /^eip155:[1-9][0-9]*$/.test(chain) && Number.isSafeInteger(Number(chain.slice(7))) && typeof address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(address);
  const solana = typeof chain === 'string' && /^solana:[a-zA-Z0-9_-]+$/.test(chain) && solanaAddress(address, chain) !== null;
  return (evm || solana) &&
    (v['kind'] === 'app_held' || v['kind'] === 'external') &&
    Array.isArray(v['capabilities']) && v['capabilities'].every((c) => typeof c === 'string');
}

/** Only 32-byte base58 addresses are admitted to the legacy Solana facade. */
function solanaAddress(value: unknown, chain?: unknown): string | null {
  if (chain !== undefined && chain !== 'solana' && !(typeof chain === 'string' && chain.startsWith('solana:'))) return null;
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return null;
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const c of value) {
    const digit = alphabet.indexOf(c);
    if (digit < 0) return null;
    n = n * 58n + BigInt(digit);
  }
  let size = 0;
  while (n > 0n) { size++; n >>= 8n; }
  for (const c of value) { if (c !== '1') break; size++; }
  return size === 32 ? value : null;
}

function validTradeResponse(method: string, value: unknown): boolean {
  const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
  const str = (x: unknown) => typeof x === 'string' && x.length > 0 && x.length <= 4096;
  const atomic = (x: unknown) => typeof x === 'string' && /^(0|[1-9][0-9]*)$/.test(x) && x.length <= 256;
  const assetId = (x: Record<string, unknown>) => str(x['chainId']) && str(x['address']);
  const operation = (x: unknown) => object(x) && str(x['operationId']) && str(x['stage']) && (x['recoveryReview'] === undefined || x['recoveryReview'] === 'manual_review') && (x['createdAt'] === undefined || (str(x['createdAt']) && Number.isFinite(Date.parse(x['createdAt'] as string)))) && (x['kind'] === undefined || ['buy','swap','cross-chain'].includes(String(x['kind']))) && (x['input'] === undefined || (object(x['input']) && assetId(x['input']))) && (x['output'] === undefined || (object(x['output']) && assetId(x['output']))) && (x['inputAmount'] === undefined || atomic(x['inputAmount'])) && (x['outputAmount'] === undefined || atomic(x['outputAmount']));
  const optionalString = (x: unknown) => x === undefined || str(x);
  const optionalUrl = (x: unknown) => { if (x === undefined) return true; if (typeof x !== 'string' || x.length > 4096) return false; try { return new URL(x).protocol === 'https:'; } catch { return false; } };
  const optionalFinite = (x: unknown) => x === undefined || (typeof x === 'number' && Number.isFinite(x));
  const optionalNumber = (x: unknown) => x === undefined || (typeof x === 'number' && Number.isInteger(x) && x >= 0);
  const fee = (x: unknown) => object(x) && str(x['label']) && optionalNumber(x['bps']) && (x['amount'] === undefined || atomic(x['amount'])) && (x['note'] === undefined || str(x['note']));
  const budget = (x: unknown) => x === null || (object(x) && str(x['chainId']) && str(x['payer']) && str(x['nativeSymbol']) && typeof x['nativeDecimals'] === 'number' && Number.isInteger(x['nativeDecimals']) && x['nativeDecimals'] >= 0 && x['nativeDecimals'] <= 255 && (x['inputToken'] === 'native' || (object(x['inputToken']) && str(x['inputToken']['contract']))) && str(x['rail']) && optionalNumber(x['slippageBps']) && ['inputAmount', 'sourceNativeAmount', 'minimumRequired'].every(k => atomic(x[k])) && ['networkFee', 'accountRent', 'routeFee', 'approvalFee', 'otherNative', 'totalRequired', 'balance', 'shortfall'].every(k => x[k] === undefined || atomic(x[k])) && typeof x['complete'] === 'boolean' && typeof x['estimated'] === 'boolean' && str(x['quotedAt']) && ['simulationChecked', 'canPay'].every(k => x[k] === undefined || typeof x[k] === 'boolean'));
  if (!object(value)) return false;
  switch (method) {
    case 'preview': return (value['executionSupported'] === undefined || typeof value['executionSupported'] === 'boolean') && (value['budgetPolicy'] === undefined || value['budgetPolicy'] === 'complete-required' || value['budgetPolicy'] === 'reviewed-partial') && str(value['destinationOwner']) && str(value['inputSymbol']) && str(value['outputSymbol']) && typeof value['inputDecimals'] === 'number' && Number.isInteger(value['inputDecimals']) && value['inputDecimals'] >= 0 && value['inputDecimals'] <= 30 && typeof value['outputDecimals'] === 'number' && Number.isInteger(value['outputDecimals']) && value['outputDecimals'] >= 0 && value['outputDecimals'] <= 30 && str(value['reviewId']) && atomic(value['inputAmount']) && atomic(value['outputAmount']) && atomic(value['minOutputAmount']) && str(value['provider']) && str(value['expiresAt']) && Number.isFinite(Date.parse(value['expiresAt'] as string)) && object(value['input']) && assetId(value['input']) && object(value['output']) && assetId(value['output']) && object(value['account']) && assetId(value['account']) && Array.isArray(value['fees']) && value['fees'].length <= 100 && value['fees'].every(fee) && budget(value['nativeBudget']) && object(value['constraints']) && ['buy', 'swap', 'cross-chain'].includes(String(value['constraints']['kind'])) && typeof value['constraints']['slippageBps'] === 'number' && Number.isInteger(value['constraints']['slippageBps']) && value['constraints']['slippageBps'] >= 0 && value['constraints']['slippageBps'] <= 10000;
    case 'request': case 'get': case 'resume': case 'lookup': return operation(value);
    case 'discard': return operation(value) && value['stage'] === 'cancelled';
    case 'list': return Array.isArray(value['operations']) && value['operations'].length <= 1000 && value['operations'].every(operation);
    case 'assets': return Array.isArray(value['assets']) && value['assets'].length <= 10000 && value['assets'].every((a: unknown) => object(a) && assetId(a) && str(a['symbol']) && Number.isInteger(a['decimals']) && (a['decimals'] as number) >= 0 && (a['decimals'] as number) <= 255 && optionalString(a['name']) && optionalUrl(a['iconUrl']) && ['usdPrice','priceChange24h','marketCap','liquidity'].every(k => optionalFinite(a[k])));
    case 'holdings': return (value['unavailableChains'] === undefined || (Array.isArray(value['unavailableChains']) && value['unavailableChains'].length <= 1000 && value['unavailableChains'].every(str))) && Array.isArray(value['holdings']) && value['holdings'].length <= 10000 && value['holdings'].every((a: unknown) => object(a) && assetId(a) && atomic(a['amount']) && (a['account'] === undefined || (object(a['account']) && assetId(a['account']) && a['account']['chainId'] === a['chainId'])));
    case 'capabilities': return value['version'] === 1 && (value['budgetPolicy'] === undefined || value['budgetPolicy'] === 'complete-required' || value['budgetPolicy'] === 'reviewed-partial') && Array.isArray(value['chains']) && value['chains'].length <= 1000 && value['chains'].every((c: unknown) => object(c) && str(c['chainId']) && (c['budgetPolicy'] === undefined || c['budgetPolicy'] === 'complete-required' || c['budgetPolicy'] === 'reviewed-partial') && ['enabled','assets','holdings','trade'].every(k => typeof c[k] === 'boolean') && ['active','routeAvailable'].every(k => c[k] === undefined || typeof c[k] === 'boolean') && optionalString(c['displayName']) && optionalString(c['nativeSymbol']) && optionalString(c['unavailableReason']) && (c['nativeDecimals'] === undefined || (typeof c['nativeDecimals'] === 'number' && Number.isInteger(c['nativeDecimals']) && c['nativeDecimals'] >= 0 && c['nativeDecimals'] <= 30)) && optionalUrl(c['iconUrl']) && optionalUrl(c['explorerUrl'])) && Array.isArray(value['providers']) && value['providers'].length <= 1000 && value['providers'].every((p: unknown) => object(p) && str(p['id']) && typeof p['enabled'] === 'boolean' && (p['corridors'] === undefined || (Array.isArray(p['corridors']) && p['corridors'].length <= 10000 && p['corridors'].every((c: unknown) => object(c) && str(c['originChainId']) && str(c['destChainId'])))));
    default: return false;
  }
}

function publicTradeOperation(operation: TradeOperation): TradeOperation {
  return {
    operationId: operation.operationId, stage: operation.stage,
    ...(operation.recoveryReview !== undefined ? { recoveryReview: operation.recoveryReview } : {}),
    ...(operation.createdAt !== undefined ? { createdAt: operation.createdAt } : {}),
    ...(operation.kind !== undefined ? { kind: operation.kind } : {}),
    ...(operation.input !== undefined ? { input: { chainId: operation.input.chainId, address: operation.input.address } } : {}),
    ...(operation.output !== undefined ? { output: { chainId: operation.output.chainId, address: operation.output.address } } : {}),
    ...(operation.inputAmount !== undefined ? { inputAmount: operation.inputAmount } : {}),
    ...(operation.outputAmount !== undefined ? { outputAmount: operation.outputAmount } : {}),
  };
}
