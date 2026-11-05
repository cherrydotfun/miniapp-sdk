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
  /** Context v2 — the host's language, theme, platform and safe area. Absent on older hosts. */
  context?: CherryHostContext;
}

/**
 * Host → app, whenever the language, the colour scheme or the safe area
 * changes while the app is open. Carries the FULL context object (a `user`
 * left out keeps the last one sent).
 */
export interface BridgeContextMessage extends BridgeMessage {
  type: 'cherry:context';
  context: CherryHostContext;
}

// ---- context v2 (language, theme, platform, safe area) ----

/** The languages Cherry ships. Hosts may add more — treat `locale` as an open string. */
export type CherryLocale = 'en' | 'ru' | 'de' | 'fr' | 'es' | 'id' | 'vi' | 'zh' | 'ja' | 'ko';

/** The colour scheme the Cherry host is painted in. */
export type CherryColorScheme = 'dark' | 'light';

/**
 * The device the Cherry HOST runs on. Not the bridge transport — that is
 * {@link CherryPlatform} (`webview` / `iframe` / `standalone`).
 */
export type CherryHostPlatform = 'ios' | 'android' | 'web';

/**
 * How far system UI (notch, home indicator, rounded corners) reaches into the
 * mini-app's view, per edge, in CSS px. Zero where the host's own chrome
 * already keeps the app clear of it.
 */
export interface CherrySafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * The person's public Cherry profile — what anyone can see on their Cherry
 * page. Never includes hidden wallets, email, phone, keys or any other
 * private data. **Display-only** on the client (it is not signed); a backend
 * reads it from the Cherry API with the verified launch token.
 */
export interface MiniAppPublicProfile {
  cherryId: string;
  handle: string | null;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  /** ISO 8601 timestamp of the account's creation. */
  createdAt: string | null;
  /** Cherry level and its points (CP). */
  level: { level: number; cp: number } | null;
  pet: { name: string; species: string | null; stage: string | null; imageUrl: string | null } | null;
  /** Linked social accounts the person shows publicly. */
  socials: Array<{ provider: string; handle: string; url: string | null; verified: boolean }>;
  /** Wallets the person shows publicly (hidden ones are never listed). */
  wallets: Array<{ address: string; chain: 'solana' | 'evm'; cherryWallet: boolean; domains: string[] }>;
  badges: Array<{ id: string; label: string; iconUrl: string | null }>;
  social: { followers: number; following: number };
  /** Trading figures over `window` (e.g. `'30d'`); `null` when not shown. */
  trading: { pnlUsd: number | null; volumeUsd: number | null; window: string } | null;
}

/** One person in a followers / following page. */
export interface MiniAppUserSummary {
  cherryId: string;
  handle: string | null;
  displayName: string;
  avatarUrl: string | null;
  level: number | null;
}

/** A page of `users.followers()` / `users.following()`. */
export interface MiniAppUserPage {
  items: MiniAppUserSummary[];
  /** Pass as `cursor` for the next page; `null` on the last one. */
  nextCursor: string | null;
}

/** How the launching person and another Cherry ID relate. */
export interface MiniAppRelationship {
  /** The launching person follows them. */
  following: boolean;
  /** They follow the launching person. */
  followedBy: boolean;
}

/**
 * Context v2 as it travels on the wire: `cherry:init.context`,
 * `cherry:context.context` and the inline `host.init` answer's `context`.
 * Read it through `CherryContext` — the SDK validates every field.
 */
export interface CherryHostContext {
  v: 2;
  locale: string;
  colorScheme: CherryColorScheme;
  /** The host's palette / brand name, e.g. `'cherry'`. Informational. */
  brand: string;
  platform: CherryHostPlatform;
  /** The Cherry app's version, when the host reports it (mobile). */
  appVersion?: string;
  safeArea: CherrySafeArea;
  /** The person's public profile, on hosts and servers that provide it. */
  user?: MiniAppPublicProfile;
}

/**
 * How the host wants the app to look: language, colour scheme, safe area.
 * Part of {@link CherryContext}; also readable BEFORE `init()` with
 * `readCherryDisplayContext()` (from the launch URL), so the first paint can
 * already be right.
 *
 * Each field resolves, in priority order, from: the latest host context
 * (`cherry:context`, else the init / `host.init` one), then the launch URL's
 * `cherry_lang` / `cherry_theme`, then the launch token's `locale` claim.
 * `null` = nobody said.
 */
export interface CherryDisplayContext {
  /** BCP 47 language tag the person uses Cherry in (one of {@link CherryLocale} today). */
  locale: CherryLocale | (string & {}) | null;
  colorScheme: CherryColorScheme | null;
  brand: string | null;
  platform: CherryHostPlatform | null;
  appVersion: string | null;
  /** `null` until a host reports it — then fall back to CSS `env(safe-area-inset-*)`. */
  safeArea: CherrySafeArea | null;
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

/**
 * Trust tier of a mini-app, set by Cherry. It decides the wallet limits the
 * host enforces (see the README, "Wallet limits & policy errors"):
 * `unverified` — self-serve listing, $50 per transaction and per wallet per
 * day, risky instructions refused; `verified` — $5,000 per transaction,
 * $25,000 per day; `partner` — no SDK-side limits.
 */
export type CherryAppTier = 'unverified' | 'verified' | 'partner';

/**
 * Where this launch happened relative to the mini-app's own project:
 * `project` — a room of the project that owns the mini-app; `external` — any
 * other room. The granted `permissions` can differ between the two.
 */
export type CherryReach = 'project' | 'external';

/**
 * Who holds the keys of the payment wallet: `app_held` — Cherry's custody
 * (the Cherry Wallet), `external` — the person's own wallet software.
 */
export type PaymentWalletKind = 'app_held' | 'external';

/**
 * Why the payment wallet is the one it is, when a stored choice decided it:
 * `user` — the person picked it in this mini-app; `signature` — the host saw
 * them sign with it here; `history` — back-filled from past signatures.
 */
export type PaymentWalletSetBy = 'history' | 'signature' | 'user';

/**
 * Claims of a Cherry launch token (RS256 JWT, issuer `https://chat.cherry.fun`).
 *
 * Three token shapes share this type:
 *  - **Room launch** (`cherry:init` handshake, `POST /api/miniapp/launch-token`):
 *    `sub`, `app_id` (= your mini-app id), `room_id`, `user`, `room`, `origin`,
 *    plus the identity claims (`cherry_id`, `payment_wallet*`), `permissions`,
 *    `reach`, `aud`, `tier`. No `scope` claim.
 *  - **Inline blink** (`scope: 'inline'`): `mini_app_id`, `message_id`,
 *    `params`, `route`, `height`, … — minted once per message for the whole
 *    room, so there is NO `sub`/`user` (the viewer comes from `host.init`).
 *    `app_id`, when present, is the bot/app that sent the blink.
 *  - **Bot fullscreen launch** (`scope: 'fullscreen'`): `mini_app_id`,
 *    `viewer_wallet`, `route`, `params`, identity claims.
 *
 * `user`, `room`, `origin` and `sub` are typed as always present for backward
 * compatibility, but only room-launch tokens carry them.
 */
export interface LaunchTokenPayload {
  /** Issuer — always `https://chat.cherry.fun` for production tokens. */
  iss?: string;
  /**
   * Audience — the mini-app id the token was minted for. Being rolled out:
   * absent on older tokens. `verifyLaunchToken` rejects a token whose `aud`
   * is present and is not your app id.
   */
  aud?: string | string[];
  /** Wallet address the person is using in the app (their identity to you). */
  sub: string;
  /** Room launch: your mini-app id. Inline/bot tokens: the sending app's id. */
  app_id: string;
  room_id: string;
  /** First allowed origin registered for the mini-app (room launches). */
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
  /** Not-before (unix seconds), if the issuer set one. */
  nbf?: number;
  jti: string;

  // ── Identity & trust claims ───────────────────────────────────────────────

  /**
   * Stable id of the PERSON behind `sub` (a Cherry ID). One person can use
   * several wallets; key long-lived user records by `cherry_id` when present,
   * falling back to `sub`. Absent when the wallet has no Cherry ID, and on
   * room-wide tokens (inline blinks).
   */
  cherry_id?: string;
  /**
   * The wallet Cherry will sign with in this app — build transactions with it
   * as the fee payer / signer. May differ from `sub` when the person picked
   * another wallet for this app. Absent on hosts/sessions that don't support
   * switching wallets (then it is `sub`).
   */
  payment_wallet?: string;
  /** Custody of `payment_wallet`. Present iff `payment_wallet` is. */
  payment_wallet_kind?: PaymentWalletKind;
  /** Present only when a stored choice decided `payment_wallet`. */
  payment_wallet_set_by?: PaymentWalletSetBy;
  /**
   * Bridge permissions granted for THIS launch (e.g. `wallet:sign`,
   * `wallet:send`, `navigate:profile`). Resolved per launch — it can depend on
   * `reach` — so read it from the token, not from your manifest.
   */
  permissions?: string[];
  /** Whether the launch room belongs to the mini-app's own project. */
  reach?: CherryReach;
  /** Trust tier of the mini-app — decides the host's wallet limits. */
  tier?: CherryAppTier;
  /** The language the person uses Cherry in (`en`, `ru`, `de`, …), when the server knows it. */
  locale?: CherryLocale | (string & {});

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

/** How the mini-app was launched: a full screen, an inline blink card, or a share-picker preview. */
export type CherryLaunchMode = 'fullscreen' | 'inline' | 'preview';

/**
 * Launch context the SDK resolved from the host handshake. **Display-only**:
 * it comes from the client and is not verified — authorize nothing with it.
 * Send `cherry.launchToken` to your backend and use `verifyLaunchToken` there.
 *
 * The display fields ({@link CherryDisplayContext}: `locale`, `colorScheme`,
 * `safeArea`, …) and `user` follow the host live — subscribe with
 * `cherry.onContextChange()` (React hooks re-render on their own).
 */
export interface CherryContext extends CherryDisplayContext {
  /** Your mini-app id — `aud`, else `mini_app_id`, else `app_id` of the launch token. */
  appId: string | null;
  /** The person's Cherry ID (stable across their wallets), when known. */
  cherryId: string | null;
  /**
   * The wallet Cherry signs with in this app, when the host reports one.
   * `null` → it is `user.publicKey` / `wallet.publicKey`.
   */
  paymentWallet: string | null;
  paymentWalletKind: PaymentWalletKind | null;
  paymentWalletSetBy: PaymentWalletSetBy | null;
  /** Bridge permissions granted for this launch (may be empty in inline blinks). */
  permissions: readonly string[];
  reach: CherryReach | null;
  /** Trust tier — decides the host's wallet limits. `null` on tokens that predate it. */
  tier: CherryAppTier | null;
  mode: CherryLaunchMode;
  /** Host features beyond permissions (e.g. `'wallet-switch'`). */
  hostCapabilities: readonly string[];
  /**
   * The person's public Cherry profile, when the host sent one (`null` on
   * older hosts / servers — use `cherry.users.me()` then). Not to be
   * confused with `cherry.user` (identity wallet + display name). For UI only.
   */
  user: MiniAppPublicProfile | null;
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
