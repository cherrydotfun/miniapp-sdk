import { detectPlatform } from './env';
import type {
  BridgeMessage,
  BridgeRequest,
  BridgeResponse,
  BridgeEvent,
} from './types';

const REQUEST_TIMEOUT_MS = 120_000;

// ==================== Debug surface ====================
// Mirrored on `window.__cherrySdkBridge` so the SDK side of the postMessage
// pair can be inspected from a remote DevTools attached to the iframe — even
// when Phantom WebView blocks cross-origin delivery to the parent.
interface SdkBridgeDebug {
  build: string;
  /** Counts of each transport path. */
  sentWebview: number;
  sentIframe: number;
  /** Whether the last iframe send used the options-bag signature successfully
   *  or had to fall back to the legacy string targetOrigin. */
  lastIframeMode: 'options' | 'legacy' | 'error' | null;
  /** Last error message thrown by postMessage (legacy or options). */
  lastSendError: string | null;
  /** Trail of last 20 outgoing messages: `{ ts, type, method?, transport, mode }`. */
  sent: Array<{
    ts: number;
    type: string;
    method?: string;
    transport: 'webview' | 'iframe';
    mode?: 'options' | 'legacy';
  }>;
  /** Trail of last 20 incoming messages received by the bridge listener. */
  received: Array<{ ts: number; type: string; isResponse: boolean }>;
}

const SDK_BRIDGE_BUILD = 'sdk-bridge-v5-wallet-ua-skip-2026-05-06';

function getSdkDebug(): SdkBridgeDebug | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { __cherrySdkBridge?: SdkBridgeDebug };
  if (!w.__cherrySdkBridge) {
    w.__cherrySdkBridge = {
      build: SDK_BRIDGE_BUILD,
      sentWebview: 0,
      sentIframe: 0,
      lastIframeMode: null,
      lastSendError: null,
      sent: [],
      received: [],
    };
  }
  return w.__cherrySdkBridge;
}

if (typeof window !== 'undefined') {
  // Force-initialise on module load.
  getSdkDebug();
  // eslint-disable-next-line no-console
  console.log('[cherry-sdk bridge] module loaded, build:', SDK_BRIDGE_BUILD);
}

function pushSent(entry: SdkBridgeDebug['sent'][number]): void {
  const d = getSdkDebug();
  if (!d) return;
  d.sent.push(entry);
  if (d.sent.length > 20) d.sent.splice(0, d.sent.length - 20);
}

function pushReceived(entry: SdkBridgeDebug['received'][number]): void {
  const d = getSdkDebug();
  if (!d) return;
  d.received.push(entry);
  if (d.received.length > 20) d.received.splice(0, d.received.length - 20);
}

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
   * Buffer for cherry:init — if the host sends it before any handler is
   * registered (i.e. before cherry.init() is called), we keep it here so
   * waitForInit() can resolve immediately instead of timing out.
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
      pushReceived({
        ts: Date.now(),
        type: message.type,
        isResponse: message.type === 'cherry:response',
      });

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

      // Buffer cherry:init if no handlers are registered yet, so it is not lost
      if (message['type'] === 'cherry:init' && this.handlers.length === 0) {
        this._bufferedInit = message;
        return;
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
    const dbg = getSdkDebug();
    const method = (message as { method?: unknown }).method;
    if (platform === 'webview') {
      const rnw = (window as unknown as { ReactNativeWebView?: { postMessage(data: string): void } })
        .ReactNativeWebView;
      rnw?.postMessage(JSON.stringify(message));
      if (dbg) {
        dbg.sentWebview += 1;
        pushSent({
          ts: Date.now(),
          type: message.type,
          ...(typeof method === 'string' ? { method } : {}),
          transport: 'webview',
        });
      }
      return;
    }
    // Forward transient user activation to the host so wallets that require
    // a user gesture actually display the approval prompt. The options bag
    // is the only way to do that, but several wallet in-app browsers run on
    // older or customised WebViews where options-bag postMessage either
    // throws synchronously or — worse — is silently dropped. We detect known
    // wallet WebViews by UA and use the legacy string-targetOrigin form for
    // them. Cherry-host renders an explicit confirmation overlay for these
    // wallets, so we don't rely on activation forwarding here anyway.
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
    const isWalletInApp = /\b(Phantom(Browser)?|Solflare(Wallet)?|Backpack|CoinbaseWallet|CipherBrowser|Trust(Wallet)?)\/\d/i.test(ua);
    let mode: 'options' | 'legacy' = isWalletInApp ? 'legacy' : 'options';
    if (mode === 'options') {
      try {
        window.parent.postMessage(message, {
          targetOrigin: '*',
          transferUserActivation: true,
        } as WindowPostMessageOptions);
      } catch (err) {
        mode = 'legacy';
        if (dbg) dbg.lastSendError = err instanceof Error ? err.message : String(err);
      }
    }
    if (mode === 'legacy') {
      try {
        window.parent.postMessage(message, '*');
      } catch (err2) {
        if (dbg) {
          dbg.lastIframeMode = 'error';
          dbg.lastSendError = err2 instanceof Error ? err2.message : String(err2);
        }
        // eslint-disable-next-line no-console
        console.error('[cherry-sdk bridge] postMessage failed in legacy mode:', err2);
        return;
      }
    }
    if (dbg) {
      dbg.sentIframe += 1;
      dbg.lastIframeMode = mode;
      pushSent({
        ts: Date.now(),
        type: message.type,
        ...(typeof method === 'string' ? { method } : {}),
        transport: 'iframe',
        mode,
      });
    }
    // Plain log so devtools see the call even if no breakpoint is set.
    // eslint-disable-next-line no-console
    console.log('[cherry-sdk bridge] → parent', message.type, method ?? '', 'mode=', mode);
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

export class BridgeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
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
