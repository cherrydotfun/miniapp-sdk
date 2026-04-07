import {
  BaseWalletAdapter,
  WalletReadyState,
  WalletNotConnectedError,
  WalletConnectionError,
  WalletSignTransactionError,
  WalletSignMessageError,
  WalletSendTransactionError,
  type SendTransactionOptions,
  type WalletName,
} from '@solana/wallet-adapter-base';
import { PublicKey, Transaction, VersionedTransaction, type Connection } from '@solana/web3.js';
import { getSharedBridge } from './bridge';
import { isInsideCherry } from './env';

export const CherryWalletAdapterName = 'Cherry' as WalletName<'Cherry'>;

// Inline SVG cherry logo as a data URL (simple placeholder)
const CHERRY_ICON =
  'data:image/svg+xml;base64,' +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">' +
    '<circle cx="20" cy="44" r="12" fill="#e63946"/>' +
    '<circle cx="44" cy="44" r="12" fill="#e63946"/>' +
    '<path d="M20 32 Q32 8 44 32" stroke="#2d6a4f" stroke-width="3" fill="none"/>' +
    '<line x1="32" y1="8" x2="40" y2="2" stroke="#2d6a4f" stroke-width="2"/>' +
    '</svg>',
  );

export class CherryWalletAdapter extends BaseWalletAdapter {
  readonly name = CherryWalletAdapterName;
  readonly url = 'https://cherry.fun';
  readonly icon = CHERRY_ICON;
  readonly supportedTransactionVersions = new Set(['legacy' as const, 0 as const]);

  get readyState(): WalletReadyState {
    return isInsideCherry() ? WalletReadyState.Installed : WalletReadyState.NotDetected;
  }

  get publicKey(): PublicKey | null {
    return this._publicKey;
  }

  get connecting(): boolean {
    return this._connecting;
  }

  private _publicKey: PublicKey | null = null;
  private _connecting = false;

  // ---- connect / disconnect ----

  async connect(): Promise<void> {
    if (this.readyState !== WalletReadyState.Installed) {
      throw new WalletConnectionError('CherryWalletAdapter is not available outside Cherry');
    }
    if (this._publicKey || this._connecting) return;

    this._connecting = true;
    try {
      const bridge = getSharedBridge();
      const result = await bridge.request('wallet.connect');
      const { publicKey } = result as { publicKey: string };
      this._publicKey = new PublicKey(publicKey);
      this.emit('connect', this._publicKey);
    } catch (error) {
      throw new WalletConnectionError((error as Error).message, error as Error);
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    if (!this._publicKey) return;
    this._publicKey = null;
    this.emit('disconnect');
  }

  // ---- sign transaction ----

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (!this._publicKey) throw new WalletNotConnectedError();
    try {
      const bridge = getSharedBridge();
      const serialized = serializeTxToBase64(tx);
      const result = await bridge.request('wallet.signTransaction', { transaction: serialized });
      return deserializeTxFromBase64(result as string, tx) as T;
    } catch (error) {
      throw new WalletSignTransactionError((error as Error).message, error as Error);
    }
  }

  // ---- sign message ----

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!this._publicKey) throw new WalletNotConnectedError();
    try {
      const bridge = getSharedBridge();
      const base64 = uint8ArrayToBase64(message);
      const result = await bridge.request('wallet.signMessage', { message: base64 });
      return base64ToUint8Array(result as string);
    } catch (error) {
      throw new WalletSignMessageError((error as Error).message, error as Error);
    }
  }

  // ---- send transaction ----

  async sendTransaction(
    tx: Transaction | VersionedTransaction,
    _connection: Connection,
    _options?: SendTransactionOptions,
  ): Promise<string> {
    if (!this._publicKey) throw new WalletNotConnectedError();
    try {
      const bridge = getSharedBridge();
      const serialized = serializeTxToBase64(tx);
      const signature = await bridge.request('wallet.signAndSendTransaction', {
        transaction: serialized,
      });
      return signature as string;
    } catch (error) {
      throw new WalletSendTransactionError((error as Error).message, error as Error);
    }
  }
}

// ---- transaction helpers ----

function serializeTxToBase64(tx: Transaction | VersionedTransaction): string {
  return uint8ArrayToBase64(
    (tx as Transaction).serialize({ requireAllSignatures: false }),
  );
}

function deserializeTxFromBase64(
  base64: string,
  original: Transaction | VersionedTransaction,
): Transaction | VersionedTransaction {
  const bytes = base64ToUint8Array(base64);
  if (isVersionedTransaction(original)) {
    return VersionedTransaction.deserialize(bytes);
  }
  return Transaction.from(bytes);
}

function isVersionedTransaction(tx: Transaction | VersionedTransaction): boolean {
  const msg = (tx as unknown as Record<string, unknown>)['message'];
  return typeof msg === 'object' && msg !== null && 'staticAccountKeys' in (msg as object);
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
