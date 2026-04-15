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
    if (platform === 'webview') {
      const rnw = (window as unknown as { ReactNativeWebView?: { postMessage(data: string): void } })
        .ReactNativeWebView;
      rnw?.postMessage(JSON.stringify(message));
    } else {
      window.parent.postMessage(message, '*');
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
