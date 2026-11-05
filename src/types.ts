export const BRIDGE_VERSION = 2;

export interface BridgeMessage {
  type: string;
  [key: string]: unknown;
}

export interface BridgeInitMessage extends BridgeMessage {
  type: 'cherry:init';
  version: number;
  token: string;
  /**
   * Features this host supports beyond the base protocol (e.g.
   * `'wallet-switch'`). Hosts released before capability negotiation omit it;
   * read it through `CherryMiniApp.hostCapabilities`, which defaults to `[]`.
   */
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
  /**
   * The person's identity: their account's primary wallet. It does not change
   * when they pick another wallet to pay with — see `payment_wallet`.
   */
  sub: string;
  /** Token issuer — `https://chat.cherry.fun` for tokens minted by Cherry. */
  iss?: string;
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

  // ── Inline / blink claims ─────────────────────────────────────────────────
  // Present on inline-blink and fullscreen launch tokens (NOT on the legacy
  // embed `cherry:init` token, where `user`/`room`/`origin` are populated
  // instead). A miniapp can read these from the verified token — including
  // **server-side (SSR)**, since the token rides in the launch URL's query
  // string (`/inline?token=...`). This lets the miniapp render the blink and
  // bind data to `message_id` *before* the client mounts.

  /** Token scope — `'inline'` (blink card) or `'fullscreen'` (runner). */
  scope?: 'inline' | 'fullscreen' | string;
  /** Render mode — mirrors `scope` for the host bridge. */
  mode?: 'inline' | 'fullscreen' | string;
  /** Mini-app this token renders (absent on bot-hosted `url` blinks). */
  mini_app_id?: string;
  /**
   * Unique id of the blink message this token is bound to. Use it as the
   * stable key to look up / bind per-message state at (or before) render.
   */
  message_id?: string;
  /** Route within the miniapp the blink should open. */
  route?: string;
  /** Snapshot payload baked into the token at send time (tamper-proof). */
  params?: Record<string, unknown>;
  /** Inline render height bucket. */
  height?: 'compact' | 'medium' | 'tall' | string;
  /**
   * Explicit initial render height (CSS px) the host opens the card at, so it
   * doesn't jump before the first `host.resize`. Bounded by the `height`
   * bucket. Read it to render the blink at exactly the declared height.
   */
  initial_height?: number;
  /** Whether the blink is interactive (false for read-only snapshots). */
  interactive?: boolean;
  /** `'user_share'` for user-shared read-only snapshots (no bot behind it). */
  source?: string;
  /** Wallet that sent the blink (message author — bot wallet or sharer). */
  sender?: string;
  /** Bot-hosted blink URL (only on `type: 'url'` blinks). */
  blink_url?: string;
  /** Viewer wallet, for fullscreen `launch-as-viewer` tokens. */
  viewer_wallet?: string;

  // ── CherryID claims ───────────────────────────────────────────────────────
  // Added by hosts that support CherryID wallets; absent on older tokens.

  /** The person's Cherry ID — stable across every wallet linked to the account. */
  cherry_id?: string;
  /**
   * The wallet the person chose to pay with in this app. Transactions must use
   * it as fee payer / signer. Absent → the payer is `sub`.
   */
  payment_wallet?: string;
  /** Chain of the payment wallet, when specified; legacy wallet is Solana-only. */
  payment_wallet_chain?: string;
  /**
   * Who holds `payment_wallet`'s key: `'app_held'` — the Cherry ID wallet,
   * custodied by Cherry; `'external'` — a wallet app the person connected.
   */
  payment_wallet_kind?: PaymentWalletKind;
}

/** See `LaunchTokenPayload.payment_wallet_kind`. */
export type PaymentWalletKind = 'app_held' | 'external';

/**
 * Settlement chain a wallet operation runs on.
 *
 * Cherry signs on **Solana only** today, so this union has a single member — but
 * it is a union so that enabling another chain (EVM) is an additive
 * `| 'evm'`, not a breaking change for apps or hosts.
 *
 * Wire semantics: an ABSENT chain means `'solana'`. The SDK sends the `chain`
 * field only for a NON-Solana chain, which keeps every existing (0.1.x) call
 * byte-for-byte identical on the wire. A chain this SDK cannot serve is refused
 * locally with `BridgeError.code === 'CHAIN_NOT_SUPPORTED'` and never reaches
 * the host.
 */
export type CherryChain = 'solana';

/** Options for `CherryMiniApp.wallet.signTransaction`. */
export interface CherrySignTransactionOptions {
  /**
   * Chain to sign on. Omit it for `'solana'` — the default and the only chain
   * supported today. An unsupported chain throws a `BridgeError` with
   * `code === 'CHAIN_NOT_SUPPORTED'` synchronously, without contacting the host.
   */
  chain?: CherryChain;
}

/**
 * Resolved context for an inline blink — the unique identity + payload of the
 * specific interactive message the mini-app is rendering. Available via
 * `CherryMiniApp.blink` / `useCherryBlink()` only when launched as an inline
 * blink (`mode=inline`); `null` otherwise.
 */
export interface CherryBlinkContext {
  /** Unique id of this blink message — distinct per sent blink. */
  messageId: string;
  /** Room the blink lives in. */
  roomId: string;
  /**
   * Wallet currently viewing the blink. Note this is whoever has the chat open
   * — it equals `sender` when the author views their own shared message, and
   * the other participant when they view it.
   */
  viewerWallet: string;
  /** Wallet that sent the blink (message author), if known. */
  sender: string | null;
  /** Mini-app being rendered (absent on bot-hosted `url` blinks). */
  miniAppId: string | null;
  /** Owning embed app id, if any. */
  appId: string | null;
  /** Route opened within the mini-app. */
  route: string;
  /** Snapshot payload baked into this blink (read-only). */
  params: Record<string, unknown>;
  /** Inline render height bucket. */
  height: 'compact' | 'medium' | 'tall' | string;
  /**
   * Explicit initial render height (CSS px) the host opens the card at, or
   * `null` when the sender didn't pin one (the host then uses the bucket
   * height). Render the blink at this height to avoid a layout jump.
   */
  initialHeight: number | null;
  /** False for read-only shared snapshots. */
  interactive: boolean;
  /** `'user_share'` for user-shared snapshots, otherwise the bot source. */
  source: string | null;
  /**
   * True when this is a non-interactive PREVIEW render shown in the share
   * picker, before the message exists. In preview mode `messageId`/`roomId`
   * are empty — render purely from `params` (don't rely on per-message state);
   * that's what keeps the preview consistent with the eventual shared blink.
   */
  isPreview: boolean;
  /** Monotonic version of `params` (bumped by `bot:blink_update`). */
  blinkParamsVersion: number | null;
  /** Launch-token unix timestamps. */
  issuedAt: number | null;
  expiresAt: number | null;
  /** Launch-token unique id. */
  jti: string | null;
}

export interface CherryUser {
  /**
   * The person's identity wallet (the launch token's `sub`). Key your user
   * records on it. It is NOT necessarily the wallet that signs — that is
   * `CherryMiniApp.wallet.publicKey`.
   */
  publicKey: string;
  displayName: string;
  avatarUrl: string;
  /** The person's Cherry ID, when the host provides one. */
  cherryId?: string;
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

/**
 * Options for `CherryMiniApp.share` — hand a "result" snapshot to the Cherry
 * host so the user can share it into a DM or group as an interactive blink.
 *
 * The miniapp does NOT name itself: the host derives the miniapp identity from
 * the current session's launch token, so a miniapp can only ever share itself.
 * The shared blink is rendered read-only on the receiver side.
 */
export interface ShareBlinkOptions {
  /** Route within this miniapp the receiver opens (defaults to "/"). */
  route?: string;
  /** Snapshot payload the receiver's miniapp renders (<= 4 KB JSON, depth <= 8). */
  params?: Record<string, unknown>;
  /** Inline render height bucket. */
  height?: 'compact' | 'medium' | 'tall';
  /**
   * Explicit initial render height (CSS px) the receiver's card opens at, so it
   * doesn't jump. Must be <= the `height` bucket max (compact 96 / medium 220 /
   * tall 420). Omit to start at the bucket height.
   */
  initialHeight?: number;
  /** Optional caption shown alongside the blink card. */
  caption?: string;
  /**
   * Declare that this miniapp can render a live, read-only PREVIEW of the
   * shared result from `route` + `params` alone. When true, the Cherry host
   * shows a real preview in the share picker (launched with `mode=preview`,
   * `cherry.blink.isPreview === true`); when false/omitted it shows a generic
   * skeleton. Only set this if your `route` renders correctly from `params`
   * without a real `messageId`/room.
   */
  previewable?: boolean;
}

export interface ShareBlinkResult {
  /** True when the user picked a recipient and the share was sent. */
  shared: boolean;
  /** The room the blink was shared into (present only when `shared` is true). */
  roomId?: string;
  /**
   * Unique id of the created blink message (present only when `shared` is true).
   * Record it to correlate later callbacks / `bot:blink_update` events back to
   * what this miniapp sent.
   */
  messageId?: string;
}

/** Payload of the `'wallet.changed'` event. */
export interface CherryWalletChangedEvent {
  /** The wallet that now pays and signs. */
  publicKey: string;
  /** True when it is the Cherry ID wallet (key custodied by Cherry). */
  custodial: boolean;
  /**
   * Chain the new wallet signs on, when the host reports one. Absent means
   * `'solana'` (see {@link CherryChain}); an unknown value is dropped rather
   * than surfaced under a type that cannot describe it.
   */
  chain?: CherryChain;
  /**
   * Re-minted launch token carrying the new `payment_wallet`, when the host
   * re-mints (fullscreen). `CherryMiniApp.launchToken` already holds it; send
   * it to your backend if you verify the payer there.
   */
  token?: string;
}

/** Result of `CherryMiniApp.wallet.requestSwitch()`. */
export interface CherryWalletSwitchResult {
  publicKey: string;
  custodial: boolean;
  /** See `CherryWalletChangedEvent.chain`. */
  chain?: CherryChain;
}

/**
 * The wallet a mini-app signs with: the person's payment wallet, which may
 * differ from their identity (`CherryUser.publicKey`) and may change while the
 * app is open — the host lets the person switch.
 *
 * On `'wallet.changed'`, rebuild any transaction you have prepared: the host
 * checks that each transaction's fee payer is the currently selected wallet
 * and refuses a stale one with the `WALLET_CHANGED` error code.
 */
export interface CherryWallet {
  publicKey: string;
  /**
   * True when `publicKey` is the Cherry ID wallet (key custodied by Cherry),
   * false for a wallet app the person connected. Optional here so existing
   * implementations of this interface keep compiling; always present on
   * `CherryMiniApp.wallet`.
   */
  custodial?: boolean;
  /**
   * Ask the host to let the person pick another wallet. Optional for the same
   * reason as `custodial`; always present on `CherryMiniApp.wallet`.
   */
  requestSwitch?(): Promise<CherryWalletSwitchResult>;
  /**
   * Signs a transaction. Accepts Transaction, VersionedTransaction, Uint8Array, or base64 string. Returns signed bytes.
   * Pass `{ chain }` only to sign on a chain other than Solana; it is validated
   * locally (see {@link CherrySignTransactionOptions}).
   */
  signTransaction(
    transaction: unknown,
    options?: CherrySignTransactionOptions,
  ): Promise<Uint8Array>;
  /** Signs all transactions in a single batch request. Returns array of signed bytes. */
  signAllTransactions(transactions: unknown[]): Promise<Uint8Array[]>;
  /** Signs and sends a transaction. Returns signature string. */
  signAndSendTransaction(transaction: unknown): Promise<string>;
  /** Signs an arbitrary message. Returns signature bytes. */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

/** A host-authorized account; chainId is CAIP-shaped (for example eip155:8453). */
export interface CherryAccount {
  address: string;
  chainId: string;
  kind: PaymentWalletKind;
  capabilities: string[];
}

/** Only methods actually implemented by the host are exposed. */
export interface CherryEvmRequest {
  method: 'eth_chainId' | 'eth_accounts' | 'eth_requestAccounts' | 'eth_sendTransaction';
  params?: readonly unknown[];
}

/** Native assets use the explicit address supplied by discovery. */
export interface TradeAssetId { chainId: string; address: string }
export interface TradeAccountRef { chainId: string; address: string }
export interface TradePreviewRequest {
  kind: 'buy' | 'swap' | 'cross-chain'; input: TradeAssetId; output: TradeAssetId;
  amount: string; slippageBps: number; account: TradeAccountRef; provider?: string;
}
export interface TradePreview {
  executionSupported?: boolean;
  budgetPolicy?: TradeBudgetPolicy;
  reviewId: string; inputAmount: string; outputAmount: string; minOutputAmount: string;
  provider: string; expiresAt: string;
  inputSymbol: string; inputDecimals: number; outputSymbol: string; outputDecimals: number;
  destinationOwner: string;
  input: TradeAssetId; output: TradeAssetId; account: TradeAccountRef;
  fees: TradeFee[]; nativeBudget: TradeNativeBudget | null;
  constraints: { kind: TradePreviewRequest['kind']; slippageBps: number };
}
export interface TradeFee { label: string; bps?: number; amount?: string; note?: string }
export interface TradeNativeBudget {
  chainId: string; payer: string; nativeSymbol: string; nativeDecimals: number;
  inputToken: 'native' | { contract: string }; inputAmount: string; rail: string;
  slippageBps?: number; sourceNativeAmount: string; networkFee?: string;
  accountRent?: string; routeFee?: string; approvalFee?: string; otherNative?: string;
  minimumRequired: string; totalRequired?: string; balance?: string; shortfall?: string;
  complete: boolean; estimated: boolean; quotedAt: string; simulationChecked?: boolean; canPay?: boolean;
}
export interface TradeOperation {
  operationId: string; stage: string; createdAt?: string;
  recoveryReview?: 'manual_review';
  kind?: TradePreviewRequest['kind']; input?: TradeAssetId; output?: TradeAssetId;
  inputAmount?: string; outputAmount?: string;
}
export type TradeBudgetPolicy = 'complete-required' | 'reviewed-partial';
export interface TradeCapabilities {
  budgetPolicy?: TradeBudgetPolicy;
  version: 1; chains: Array<{ chainId: string; enabled: boolean; assets: boolean; holdings: boolean; trade: boolean; budgetPolicy?: TradeBudgetPolicy; active?: boolean; routeAvailable?: boolean; displayName?: string; nativeSymbol?: string; nativeDecimals?: number; iconUrl?: string; explorerUrl?: string; unavailableReason?: string }>;
  providers: Array<{ id: string; enabled: boolean; corridors?: Array<{ originChainId: string; destChainId: string }> }>;
}
export interface TradeAsset extends TradeAssetId {
  symbol: string; decimals: number; name?: string; iconUrl?: string;
  usdPrice?: number; priceChange24h?: number; marketCap?: number; liquidity?: number;
}
export interface TradeHolding extends TradeAssetId { amount: string; account?: TradeAccountRef }
