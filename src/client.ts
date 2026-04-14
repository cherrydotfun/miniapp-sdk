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
} from './types';

export type CherryMiniAppEvent = 'suspended' | 'resumed' | 'walletDisconnected';

type EventListener<T = unknown> = (data: T) => void;

export interface CherryMiniAppOptions {
  /** Milliseconds to wait for cherry:init from the host. Default: 10_000 */
  initTimeout?: number;
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

  // ---- init ----

  async init(): Promise<void> {
    if (this._isReady) return;

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
        this.emit(evt.event as CherryMiniAppEvent, evt.data);
      }
    });

    this._isReady = true;
  }

  private waitForInit(): Promise<BridgeInitMessage> {
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
    destroySharedBridge();
  }

  // ---- private helpers ----

  private assertReady(): void {
    if (!this._isReady) {
      throw new Error('CherryMiniApp is not ready. Call init() first.');
    }
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
