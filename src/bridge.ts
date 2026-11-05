import { DEFAULT_TRUSTED_HOST_ORIGINS } from './constants';
import { detectPlatform } from './env';
import type {
  BridgeMessage,
  BridgeRequest,
  BridgeResponse,
  BridgeEvent,
} from './types';

const REQUEST_TIMEOUT_MS = 120_000;

/**
 * Requests the SDK must post BEFORE it knows the host's origin. In inline
 * (blink) mode the host never pushes `cherry:init`; the SDK opens the
 * conversation with `host.init`, so it goes out with targetOrigin `'*'`. It
 * carries no data — and its answer is still filtered by source and origin
 * like every other inbound message, which is what locks the origin.
 */
const HANDSHAKE_METHODS: ReadonlySet<string> = new Set(['host.init']);

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type MessageHandler = (message: BridgeMessage) => void;

/**
 * How the bridge reaches the host:
 *  - `webview` — Cherry mobile (React Native WebView): `ReactNativeWebView.postMessage`
 *    out, host-injected `MessageEvent`s in. There is no meaningful origin.
 *  - `iframe`  — Cherry web: `window.parent.postMessage` with a locked
 *    `targetOrigin` out, origin- and source-checked messages in.
 *  - `none`    — not embedded (top-level page outside a WebView): nothing is
 *    sent and nothing is accepted.
 */
export type BridgeTransport = 'webview' | 'iframe' | 'none';

export interface BridgeOptions {
  /**
   * Extra host origins to trust in iframe mode, on top of
   * `https://chat.cherry.fun`, `https://cherry.fun` and `https://*.cherry.fun`
   * — e.g. a staging host. Exact origins (`https://stage.example.com`,
   * `http://localhost:3000`) or a leading-label wildcard
   * (`https://*.example.com`). `'*'` is refused.
   */
  trustedOrigins?: readonly string[];
  /**
   * Use only Cherry-injected signals to detect the WebView transport (see
   * `detectPlatform({ strict })`). Default `false`.
   */
  strict?: boolean;
}

export class Bridge {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly handlers: MessageHandler[] = [];
  private readonly listener: (event: MessageEvent) => void;
  private readonly extraOrigins = new Set<string>();
  private readonly droppedOrigins = new Set<string>();
  /** Messages for the host sent before its origin was known (iframe mode). */
  private readonly outbox: BridgeMessage[] = [];
  private strict = false;
  private _hostOrigin: string | null = null;

  /**
   * Buffer for cherry:init — if the host sends it before any handler is
   * registered (i.e. before cherry.init() is called), we keep it here so
   * waitForInit() can resolve immediately instead of timing out.
   */
  private _bufferedInit: BridgeMessage | null = null;

  constructor(options: BridgeOptions = {}) {
    this.configure(options);

    this.listener = (event: MessageEvent) => {
      const transport = this.transport;
      if (!acceptsSource(event, transport)) return;

      let data: unknown = event.data;

      // WebView sometimes delivers a serialized string
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data) as unknown;
        } catch {
          return;
        }
      }

      if (!isObject(data) || typeof data['type'] !== 'string') return;
      const message = data as BridgeMessage;
      if (!message.type.startsWith('cherry:')) return;

      if (transport === 'iframe' && !this.acceptOrigin(event.origin)) return;

      // Resolve pending request if this is a response
      if (message['type'] === 'cherry:response') {
        const response = message as unknown as BridgeResponse;
        const pending = this.pending.get(response.id);
        if (pending) {
          this.pending.delete(response.id);
          clearTimeout(pending.timer);
          if (response.error) {
            pending.reject(toBridgeError(response.error as unknown, message));
          } else {
            pending.resolve(response.result);
          }
          return;
        }
      }

      // Buffer cherry:init if no handlers are registered yet, so it is not lost
      if (message['type'] === 'cherry:init' && this.handlers.length === 0) {
        this._bufferedInit = message;
        return;
      }

      for (const handler of [...this.handlers]) {
        handler(message);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.listener);
    }
  }

  /**
   * Add trusted origins / set strict detection after construction. The shared
   * bridge may be created by whichever SDK piece runs first, so options are
   * merged rather than fixed at construction: `trustedOrigins` accumulate,
   * `strict` takes the latest value given.
   */
  configure(options: BridgeOptions): void {
    if (options.strict !== undefined) this.strict = options.strict;
    for (const origin of options.trustedOrigins ?? []) {
      this.extraOrigins.add(normaliseOriginPattern(origin));
    }
  }

  /** The transport this page uses to reach the host. */
  get transport(): BridgeTransport {
    if (typeof window === 'undefined') return 'none';
    if (detectPlatform({ strict: this.strict }) === 'webview') return 'webview';
    if (window.parent !== window) return 'iframe';
    return 'none';
  }

  /**
   * The Cherry host origin this bridge is locked to (iframe mode), or `null`
   * before the host's first valid message. Everything sent to the host uses it
   * as `targetOrigin`; everything received must come from it.
   */
  get hostOrigin(): string | null {
    return this._hostOrigin;
  }

  /**
   * Origins whose Cherry protocol messages were dropped because they are not
   * trusted — the first thing to check when `init()` times out on a staging
   * or self-hosted Cherry build.
   */
  get ignoredOrigins(): readonly string[] {
    return [...this.droppedOrigins];
  }

  /** Whether `origin` is a trusted Cherry host origin for this bridge. */
  isTrustedOrigin(origin: string): boolean {
    return isTrustedHostOrigin(origin, [...this.extraOrigins]);
  }

  /**
   * Returns a previously buffered cherry:init message (if any) and clears the
   * buffer. Called by waitForInit() to handle the case where the host sent
   * cherry:init before the SDK called init().
   */
  consumeBufferedInit(): BridgeMessage | null {
    const msg = this._bufferedInit;
    this._bufferedInit = null;
    return msg;
  }

  sendToHost(message: BridgeMessage): void {
    const transport = this.transport;
    if (transport === 'webview') {
      const rnw = (window as unknown as { ReactNativeWebView?: { postMessage(data: string): void } })
        .ReactNativeWebView;
      rnw?.postMessage(JSON.stringify(message));
      return;
    }
    if (transport === 'none') return;

    if (this._hostOrigin !== null) {
      postToParent(message, this._hostOrigin);
    } else if (isHandshake(message)) {
      postToParent(message, '*');
    } else {
      // Never broadcast to an unknown parent: hold it until the host's first
      // valid message tells us who the host is (see acceptOrigin).
      this.outbox.push(message);
    }
  }

  startListening(handler: MessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx !== -1) this.handlers.splice(idx, 1);
    };
  }

  request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const id = generateId();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError(`Request timed out: ${method}`, 'TIMEOUT'));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });

      const msg: BridgeRequest = {
        type: 'cherry:request',
        id,
        method,
        ...(params !== undefined ? { params } : {}),
      };
      this.sendToHost(msg);
    });
  }

  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', this.listener);
    }
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new BridgeError('Bridge destroyed', 'DESTROYED'));
      this.pending.delete(id);
    }
    this.handlers.length = 0;
    this.outbox.length = 0;
  }

  /**
   * Iframe mode: accept a message only from a trusted Cherry origin, and —
   * once the first one arrived — only from that same origin. The first valid
   * message (the host's `cherry:init`, or its answer to the inline
   * `host.init`) locks the origin and flushes the outbox to it.
   */
  private acceptOrigin(origin: string): boolean {
    if (this._hostOrigin !== null) {
      if (origin === this._hostOrigin) return true;
      this.noteDropped(origin);
      return false;
    }
    if (!this.isTrustedOrigin(origin)) {
      this.noteDropped(origin);
      return false;
    }
    this._hostOrigin = origin;
    const queued = this.outbox.splice(0, this.outbox.length);
    for (const message of queued) postToParent(message, origin);
    return true;
  }

  private noteDropped(origin: string): void {
    if (this.droppedOrigins.has(origin)) return;
    this.droppedOrigins.add(origin);
    if (typeof console !== 'undefined') {
      console.warn(
        `[cherry-miniapp-sdk] Ignored a Cherry bridge message from untrusted origin ${origin || '(none)'}. ` +
          'If this is a Cherry host you use (e.g. staging), pass it in `trustedOrigins`.',
      );
    }
  }
}

/**
 * Why the host refused a wallet request under `POLICY_DENIED`:
 *  - `TX_LIMIT`              — this transaction moves more value than the app's tier allows per transaction.
 *  - `DAILY_LIMIT`           — this wallet's outflow in this app today would exceed the tier's daily limit.
 *  - `FORBIDDEN_INSTRUCTION` — the transaction contains an instruction the tier may not use
 *                              (token Approve/delegation, SetAuthority, Assign, durable nonce, subscriptions).
 *  - `APP_PAUSED`            — Cherry paused wallet access for this app.
 *  - `SIMULATION_FAILED`     — the transaction fails in simulation (it would fail on chain).
 *  - `PRICE_UNAVAILABLE`     — the host could not price an asset to check the limits.
 */
export type CherryPolicyCode =
  | 'TX_LIMIT'
  | 'DAILY_LIMIT'
  | 'FORBIDDEN_INSTRUCTION'
  | 'APP_PAUSED'
  | 'SIMULATION_FAILED'
  | 'PRICE_UNAVAILABLE';

/**
 * Codes a `BridgeError` can carry. Hosts may add codes; unknown ones arrive
 * as-is (the type stays open), so always keep a default branch.
 */
export type BridgeErrorCode =
  // Wallet policy (self-serve listing)
  | 'POLICY_DENIED'
  | 'PRECHECK_UNAVAILABLE'
  // The person / their wallet
  | 'USER_REJECTED'
  | 'WALLET_CHANGED'
  | 'WALLET_NOT_CONNECTED'
  | 'WALLET_NOT_IN_ACCOUNT'
  | 'WALLET_UNAVAILABLE'
  | 'RATE_LIMITED'
  // What the transaction / message contains
  | 'NOT_A_SIGNER'
  | 'DANGEROUS_INSTRUCTION'
  | 'UNSTATED_ROLE'
  | 'RESERVED_PAYLOAD'
  | 'CHAIN_NOT_SUPPORTED'
  // The method itself
  | 'METHOD_NOT_ALLOWED_IN_INLINE'
  | 'METHOD_NOT_FOUND'
  | 'UNKNOWN_METHOD'
  | 'METHOD_NOT_SUPPORTED'
  | 'CALLBACK_NOT_SUPPORTED'
  // Transport / generic
  | 'BRIDGE_ERROR'
  | 'TIMEOUT'
  | 'DESTROYED'
  | 'UNKNOWN';

/**
 * The `data` of a `POLICY_DENIED` refusal, as the hosts send it:
 * `{ code: 'POLICY_DENIED', message, data: { code: <CherryPolicyCode>, reason, tier, … } }`.
 * USD figures are present when the rule is a limit (`TX_LIMIT`, `DAILY_LIMIT`).
 */
export interface CherryPolicyDenial {
  /** Which rule refused the request (`data.code` on the wire). */
  policyCode: CherryPolicyCode | (string & {});
  /** Human-readable reason from the host (English). */
  reason: string | null;
  /** The app's tier the limits were taken from. */
  tier: string | null;
  /** USD value this transaction would move out of the wallet. */
  outflowUsd: number | null;
  /** The tier's per-transaction limit, in USD. */
  perTxLimitUsd: number | null;
  /** What this wallet already moved out through this app today, in USD. */
  dailyUsedUsd: number | null;
  /** The tier's per-wallet daily limit for this app, in USD. */
  dailyLimitUsd: number | null;
}

/** A refusal or failure answered by the Cherry host (or the bridge itself). */
export class BridgeError extends Error {
  /**
   * The `data` object the host sent with the error, as sent (for
   * `POLICY_DENIED`: `{ code, reason, tier, outflowUsd, perTxLimitUsd,
   * dailyUsedUsd, dailyLimitUsd }`; for `PRECHECK_UNAVAILABLE`: `{ status }`).
   * Empty object when there was none.
   */
  readonly data: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    public readonly code: BridgeErrorCode | (string & {}),
    data: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'BridgeError';
    this.data = Object.freeze({ ...data });
  }

  /**
   * For `POLICY_DENIED`: which rule refused the request — `TX_LIMIT`,
   * `DAILY_LIMIT`, `FORBIDDEN_INSTRUCTION`, `APP_PAUSED`, `SIMULATION_FAILED`
   * or `PRICE_UNAVAILABLE` (the wire's `data.code`). `undefined` otherwise.
   *
   * ```ts
   * if (err.code === 'POLICY_DENIED' && err.policyCode === 'DAILY_LIMIT') { … }
   * ```
   */
  get policyCode(): CherryPolicyCode | (string & {}) | undefined {
    const explicit = this.data['policyCode'];
    if (typeof explicit === 'string') return explicit;
    const nested = this.data['code'];
    return this.code === 'POLICY_DENIED' && typeof nested === 'string' ? nested : undefined;
  }

  /** For `POLICY_DENIED`: the host's human-readable reason (`data.reason`, English). */
  get reason(): string | undefined {
    const value = this.data['reason'];
    return typeof value === 'string' ? value : undefined;
  }

  /** For `POLICY_DENIED`: the refusal's details, typed. `null` for any other error. */
  get policy(): CherryPolicyDenial | null {
    const policyCode = this.policyCode;
    if (this.code !== 'POLICY_DENIED' || policyCode === undefined) return null;
    const num = (key: string): number | null => {
      const value = this.data[key];
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    };
    const str = (key: string): string | null => {
      const value = this.data[key];
      return typeof value === 'string' ? value : null;
    };
    return {
      policyCode,
      reason: str('reason'),
      tier: str('tier'),
      outflowUsd: num('outflowUsd'),
      perTxLimitUsd: num('perTxLimitUsd'),
      dailyUsedUsd: num('dailyUsedUsd'),
      dailyLimitUsd: num('dailyLimitUsd'),
    };
  }
}

/**
 * The `BridgeError` behind `error`, or `null`. Unwraps the wallet-adapter
 * error classes (`WalletSignTransactionError#error`) and `Error#cause`, so it
 * works on whatever your signing call threw.
 */
export function getBridgeError(error: unknown): BridgeError | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof BridgeError) return current;
    const next =
      (current as { error?: unknown }).error ?? (current as { cause?: unknown }).cause;
    if (next === current) break;
    current = next;
  }
  return null;
}

/** True when the host refused a wallet request because of the app's tier policy. */
export function isPolicyDenied(error: unknown): boolean {
  return getBridgeError(error)?.code === 'POLICY_DENIED';
}

// Module-level singleton — shared between CherryMiniApp and CherryWalletAdapter
let _sharedBridge: Bridge | null = null;

/**
 * The bridge every SDK piece shares. `options` are merged into it (see
 * {@link Bridge.configure}) — so an app that only uses `CherryWalletAdapter`
 * can still call `getSharedBridge({ trustedOrigins: [...] })` once at startup.
 */
export function getSharedBridge(options?: BridgeOptions): Bridge {
  if (!_sharedBridge) {
    _sharedBridge = new Bridge(options);
  } else if (options) {
    _sharedBridge.configure(options);
  }
  return _sharedBridge;
}

export function destroySharedBridge(): void {
  _sharedBridge?.destroy();
  _sharedBridge = null;
}

// ---- origin helpers ----

/**
 * Whether `origin` (an `event.origin`) is a trusted Cherry host: one of
 * {@link DEFAULT_TRUSTED_HOST_ORIGINS} or of `extra`. A `scheme://*.domain`
 * pattern matches any subdomain of `domain` (not `domain` itself), on the
 * same scheme and port. `'null'` and malformed origins are never trusted.
 */
export function isTrustedHostOrigin(origin: string, extra: readonly string[] = []): boolean {
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return false;
  for (const pattern of [...DEFAULT_TRUSTED_HOST_ORIGINS, ...extra]) {
    if (originMatches(origin, pattern)) return true;
  }
  return false;
}

const WILDCARD_ORIGIN = /^(https?):\/\/\*\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::(\d{1,5}))?$/;

function normaliseOriginPattern(input: string): string {
  if (typeof input !== 'string') throw new TypeError('trustedOrigins entries must be strings');
  const value = input.trim().toLowerCase().replace(/\/+$/, '');
  if (value === '*' || value === '') {
    throw new TypeError(`trustedOrigins: "${input}" is not allowed — list explicit Cherry host origins`);
  }
  if (WILDCARD_ORIGIN.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`trustedOrigins: "${input}" is not an origin (expected e.g. https://stage.example.com)`);
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin !== value) {
    throw new TypeError(`trustedOrigins: "${input}" is not an origin (expected e.g. https://stage.example.com)`);
  }
  return url.origin;
}

function originMatches(origin: string, pattern: string): boolean {
  if (origin === pattern) return true;
  const wildcard = WILDCARD_ORIGIN.exec(pattern);
  if (!wildcard) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  const [, scheme, domain, port] = wildcard;
  return (
    url.protocol === `${scheme}:` &&
    url.port === (port ?? '') &&
    url.hostname.length > (domain ?? '').length + 1 &&
    url.hostname.endsWith(`.${domain}`)
  );
}

// ---- transport helpers ----

function acceptsSource(event: MessageEvent, transport: BridgeTransport): boolean {
  if (transport === 'iframe') {
    // Only the frame that embeds us — never a child frame, opener or popup.
    return event.source === window.parent;
  }
  if (transport === 'webview') {
    // The RN host injects `new MessageEvent('message', { data })` (source
    // null). A message from a frame INSIDE the mini-app has that frame as
    // its source and is not the host.
    return event.source === null || event.source === undefined || event.source === window;
  }
  return false;
}

function isHandshake(message: BridgeMessage): boolean {
  return message['type'] === 'cherry:request' && HANDSHAKE_METHODS.has(String(message['method']));
}

function postToParent(message: BridgeMessage, targetOrigin: string): void {
  // Forward transient user activation to the host so wallets that require
  // a user gesture actually display the approval prompt. The options bag
  // is the only way to do that, but several wallet in-app browsers run on
  // customised WebViews where options-bag postMessage either throws
  // synchronously or — worse — is silently dropped. We detect known wallet
  // WebViews by UA and use the legacy string-targetOrigin form for them;
  // Cherry-host renders an explicit confirmation overlay for these wallets,
  // so activation forwarding is not required.
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const isWalletInApp =
    /\b(Phantom(Browser)?|Solflare(Wallet)?|Backpack|CoinbaseWallet|CipherBrowser|Trust(Wallet)?)\/\d/i.test(ua);
  if (!isWalletInApp) {
    try {
      window.parent.postMessage(message, {
        targetOrigin,
        transferUserActivation: true,
      } as WindowPostMessageOptions);
      return;
    } catch {
      // Old browsers don't support the options bag — fall through.
    }
  }
  window.parent.postMessage(message, targetOrigin);
}

// ---- helpers ----

/**
 * The wire error of a `cherry:response`: a plain string (old hosts) or
 * `{ code, message, data? }`. `data` is kept as sent; for robustness,
 * `policyCode` / `reason` placed on the error itself or beside it on the
 * response are copied in when `data` lacks them.
 */
function toBridgeError(error: unknown, response: BridgeMessage): BridgeError {
  if (typeof error === 'string') return new BridgeError(error, 'UNKNOWN');
  if (!isObject(error)) return new BridgeError('Unknown error', 'UNKNOWN');
  const { code, message, data } = error;
  const fields: Record<string, unknown> = isObject(data) ? { ...data } : {};
  for (const key of ['policyCode', 'reason'] as const) {
    if (fields[key] !== undefined) continue;
    if (error[key] !== undefined) fields[key] = error[key];
    else if (response[key] !== undefined) fields[key] = response[key];
  }
  return new BridgeError(
    typeof message === 'string' ? message : 'Unknown error',
    typeof code === 'string' ? code : 'UNKNOWN',
    fields,
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export type { BridgeEvent };
