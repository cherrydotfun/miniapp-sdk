export const BRIDGE_VERSION = 2;

export interface BridgeMessage {
  type: string;
  [key: string]: unknown;
}

export interface BridgeInitMessage extends BridgeMessage {
  type: 'cherry:init';
  version: number;
  token: string;
  capabilities: string[];
}

export interface BridgeReadyMessage extends BridgeMessage {
  type: 'cherry:ready';
  version: number;
}

export interface BridgeRequest extends BridgeMessage {
  type: 'cherry:request';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface BridgeResponse extends BridgeMessage {
  type: 'cherry:response';
  id: string;
  result?: unknown;
  error?: { code: string; message: string };
}

export interface BridgeEvent extends BridgeMessage {
  type: 'cherry:event';
  event: string;
  data?: unknown;
}

export type CherryPlatform = 'webview' | 'iframe' | 'standalone';

export interface CherryEnvironment {
  isEmbedded: boolean;
  platform: CherryPlatform;
}

export interface LaunchTokenPayload {
  sub: string;
  app_id: string;
  room_id: string;
  origin: string;
  user: {
    display_name: string;
    avatar_url: string;
  };
  room: {
    title: string;
    member_count: number;
  };
  iat: number;
  exp: number;
  jti: string;
}

export interface CherryUser {
  publicKey: string;
  displayName: string;
  avatarUrl: string;
}

export interface CherryRoom {
  id: string;
  title: string;
  memberCount: number;
}

export interface CherryNavigate {
  /** Open user profile by wallet address, domain (e.g. "alice.sol"), or @handle */
  userProfile(identifier: string): Promise<void>;
  /** Open room by roomId or @handle (e.g. "@mygroup") */
  openRoom(identifier: string): Promise<void>;
}

export interface CherryWallet {
  publicKey: string;
  /** Signs a transaction. Accepts Transaction, VersionedTransaction, Uint8Array, or base64 string. Returns signed bytes. */
  signTransaction(transaction: unknown): Promise<Uint8Array>;
  /** Signs all transactions in a single batch request. Returns array of signed bytes. */
  signAllTransactions(transactions: unknown[]): Promise<Uint8Array[]>;
  /** Signs and sends a transaction. Returns signature string. */
  signAndSendTransaction(transaction: unknown): Promise<string>;
  /** Signs an arbitrary message. Returns signature bytes. */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}
