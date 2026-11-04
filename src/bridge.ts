import { detectPlatform } from './env';
import type {
  BridgeMessage,
  BridgeRequest,
  BridgeResponse,
  BridgeEvent,
} from './types';

const REQUEST_TIMEOUT_MS = 120_000;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type MessageHandler = (message: BridgeMessage) => void;

export class Bridge {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly handlers: MessageHandler[] = [];
  private readonly listener: (event: MessageEvent) => void;

  /**
   * Buffer for cherry:init — if the host sends it before cherry.init() is
   * called, we keep it here so waitForInit() can resolve immediately instead
   * of timing out.
   */
  private _bufferedInit: BridgeMessage | null = null;

  constructor() {
    this.listener = (event: MessageEvent) => {
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

      // Resolve pending request if this is a response
      if (message['type'] === 'cherry:response') {
        const response = message as unknown as BridgeResponse;
        const pending = this.pending.get(response.id);
        if (pending) {
          this.pending.delete(response.id);
          clearTimeout(pending.timer);
          if (response.error) {
            const err = response.error;
            // Handle both string and { code, message } error formats
            if (typeof err === 'string') {
              pending.reject(new BridgeError(err, 'UNKNOWN'));
            } else {
              pending.reject(new BridgeError(err.message ?? 'Unknown error', err.code ?? 'UNKNOWN'));
            }
          } else {
            pending.resolve(response.result);
          }
          return;
        }
      }

      // Buffer cherry:init so it is not lost: it can arrive before init()
      // registers its handler, or while only handlers that ignore it are
      // registered (the wallet adapter's 'wallet.changed' listener).
      // waitForInit() drops the copy when it takes the live message.
      if (message['type'] === 'cherry:init') {
        this._bufferedInit = message;
        if (this.handlers.length === 0) return;
      }

      for (const handler of this.handlers) {
        handler(message);
      }
    };

    window.addEventListener('message', this.listener);
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
    const platform = detectPlatform();
    if (platform === 'webview') {
      const rnw = (window as unknown as { ReactNativeWebView?: { postMessage(data: string): void } })
        .ReactNativeWebView;
      rnw?.postMessage(JSON.stringify(message));
      return;
    }
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
          targetOrigin: '*',
          transferUserActivation: true,
        } as WindowPostMessageOptions);
        return;
      } catch {
        // Old browsers don't support the options bag — fall through.
      }
    }
    window.parent.postMessage(message, '*');
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
    window.removeEventListener('message', this.listener);
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new BridgeError('Bridge destroyed', 'DESTROYED'));
      this.pending.delete(id);
    }
    this.handlers.length = 0;
  }
}

/**
 * Error codes apps are expected to branch on.
 *
 * - `USER_REJECTED` — the person declined (a signature, a wallet switch).
 * - `WALLET_CHANGED` — the host refused to sign because the transaction's fee
 *   payer is not the currently selected wallet; a `'wallet.changed'` event
 *   carries the new one. Rebuild the transaction and retry.
 * - `TIMEOUT` / `DESTROYED` — raised by the SDK itself.
 * - `INVALID_RESPONSE` — raised by the SDK when a host answer is malformed.
 * - `METHOD_NOT_SUPPORTED` — raised by the SDK for a method in a reserved
 *   namespace (e.g. `wallet.eth.*`); nothing was sent to the host. A host that
 *   does not know a method answers `UNKNOWN_METHOD` / `METHOD_NOT_FOUND` instead.
 * - `CHAIN_NOT_SUPPORTED` — raised by the SDK for a `chain` it cannot serve;
 *   nothing was sent to the host.
 * - `UNKNOWN` — the host sent an error without a code.
 *
 * Hosts may send other codes; `BridgeError.code` stays an open string.
 */
export type BridgeErrorCode =
  | 'USER_REJECTED'
  | 'WALLET_CHANGED'
  | 'TIMEOUT'
  | 'DESTROYED'
  | 'INVALID_RESPONSE'
  | 'METHOD_NOT_SUPPORTED'
  | 'CHAIN_NOT_SUPPORTED'
  | 'UNKNOWN';

export class BridgeError extends Error {
  constructor(
    message: string,
    // `string & {}` keeps editor completion for the known codes while still
    // accepting any code a newer host sends.
    public readonly code: BridgeErrorCode | (string & {}),
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

// Module-level singleton — shared between CherryMiniApp and CherryWalletAdapter
let _sharedBridge: Bridge | null = null;

export function getSharedBridge(): Bridge {
  if (!_sharedBridge) {
    _sharedBridge = new Bridge();
  }
  return _sharedBridge;
}

export function destroySharedBridge(): void {
  _sharedBridge?.destroy();
  _sharedBridge = null;
}

// ---- helpers ----

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
