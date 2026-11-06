# Changelog

All notable changes to `@cherrydotfun/miniapp-sdk`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/) (0.x: minor = may break, patch = compatible).

## 0.1.23

### Fixed

- **`withTransactionLabel` works across entries.** Each entry (root, `/react`,
  `/solana`, `/kit`) is bundled with its own copy of the label code, so a
  label set through one entry was not seen by a signer imported from another
  (e.g. `withTransactionLabel` from the root around `CherryWalletAdapter`
  from `/solana`). The scope now lives on `globalThis`.
- **Stricter label cleaning.** Format characters (zero-width joiners, bidi
  marks, tag characters), Hangul fillers and piles of combining marks are
  removed, so a label cannot hide, reorder or overflow what it says.

## 0.1.22

Secure-by-default release for self-serve listing. No breaking API changes —
see the [migration notes](./README.md#19-migration-0121--0122) for behaviour
changes.

### Security

- **Bridge origin checks (iframe).** Host messages are accepted only from
  `window.parent` on a trusted Cherry origin (`https://chat.cherry.fun`,
  `https://cherry.fun`, `https://*.cherry.fun`, plus opt-in `trustedOrigins`;
  `'*'` is refused). The first valid host message locks the origin; it is the
  `targetOrigin` of everything the SDK posts afterwards (previously `'*'`).
  Requests sent before the lock are queued; only the data-free inline
  `host.init` handshake goes out with `'*'`.
- **Bridge source checks (WebView).** Only host-injected events are accepted,
  not messages from frames inside the mini-app.
- **`verifyLaunchToken` checks `iss`, `aud` and `exp`.** Adds issuer
  verification (default `https://chat.cherry.fun`), audience verification
  (`aud` must name your app when present; `requireAudience` to require it),
  a required `exp` with 30 s clock tolerance, and optional `scope` matching.

### Added

- `verifyLaunchToken(token, { appId, issuer?, jwksUrl?, jwks?, origin?, requireAudience?, scope?, clockTolerance? })`
  and `LaunchTokenError` with machine-readable `code`s.
- Launch-token claim types: `aud`, `iss`, `nbf`, `tier`, `cherry_id`,
  `payment_wallet`, `payment_wallet_kind`, `payment_wallet_set_by`,
  `permissions`, `reach`; types `CherryAppTier`, `CherryReach`,
  `PaymentWalletKind`, `PaymentWalletSetBy`, `LaunchTokenScope`.
- `CherryMiniApp#context` (`CherryContext`) and getters `appId`, `cherryId`,
  `paymentWallet`, `paymentWalletKind`, `paymentWalletSetBy`, `permissions`,
  `hasPermission()`, `reach`, `tier`, `mode`, `claims`. React:
  `useCherryContext()` and `context` on `useCherryMiniApp()`.
- `BridgeError#data` (the host's `data`, raw), `#policyCode` (from
  `data.code` on `POLICY_DENIED`), `#reason`, `#policy` (`CherryPolicyDenial`);
  `getBridgeError()`, `isPolicyDenied()`; types `BridgeErrorCode`,
  `CherryPolicyCode`.
- On-chain attribution: `getAppReferenceKeyBytes`, `getAppReferenceAddress`
  (core), `getAppReferenceKey`, `withAppReference` (`/solana`, `/kit`).
- Cherry fee split: `buildCherryFeeSplit` (`/solana`, `/kit`; SOL and
  SPL/Token-2022 with idempotent ATA creation), `splitCherryFee`, and
  `CHERRY_REVENUE_SHARE_BPS` (1000: Cherry's 10% of the revenue the developer
  declares; Cherry measures the volume itself). `buildCherryShareTransfer` /
  `cherryShareOf` add Cherry's share alone, for apps whose own fee is
  collected elsewhere (a protocol's integrator fee, their own program).
- `trustedOrigins` option on `CherryMiniApp`, `CherryMiniAppProvider`,
  `CherryWalletAdapter` and `getSharedBridge()`; `isTrustedHostOrigin()`,
  `DEFAULT_TRUSTED_HOST_ORIGINS`; `Bridge#hostOrigin`, `#transport`,
  `#ignoredOrigins`, `#configure()`.
- **Transaction labels.** `wallet.signTransaction` / `signAllTransactions` /
  `signAndSendTransaction` (and `useCherryWallet()`'s) take `{ label }`; one
  line in the app's words ("Buy 3 lives") that Cherry's wallet sheet shows
  under the app's name, beside the amount it decodes itself.
  `withTransactionLabel(label, fn)` (root, `/react`, `/solana`, `/kit`)
  labels every signature request made inside `fn`, for wallet-adapter and kit
  signers. `normalizeTransactionLabel`, `TRANSACTION_LABEL_MAX` (80),
  `CherryTransactionOptions`. On the wire: an optional `label` param; older
  hosts ignore it.
- Test suite (vitest) and `npm test`.
- Optional peer dependency `@solana/kit` (types only, for the `/kit` helpers).
- **Context v2 — language, theme, platform, safe area.** `CherryContext` gains
  `locale`, `colorScheme` (`'dark' | 'light'`), `brand`, `platform`
  (`'ios' | 'android' | 'web'`), `appVersion` and `safeArea`
  (`{ top, right, bottom, left }`, CSS px). Each resolves from the host's
  latest context (`cherry:context`, else `cherry:init.context` / the
  `host.init` answer's `context`), then the launch URL's `cherry_lang` /
  `cherry_theme`, then the token's `locale` claim; invalid values are dropped.
  Types `CherryDisplayContext`, `CherryLocale`, `CherryColorScheme`,
  `CherryHostPlatform`, `CherrySafeArea`, `CherryHostContext`,
  `BridgeContextMessage`; `CHERRY_LOCALES`; `LaunchTokenPayload.locale`.
- Live context updates: the host's `cherry:context` message (accepted only
  from the locked host origin, like every host message — it never locks one
  itself; one that arrives before `init()` is kept), and
  `CherryMiniApp#onContextChange(listener) → unsubscribe` (called on the first
  resolution and on every real change). The React provider follows it, so
  `useCherryContext()` / `useCherryMiniApp().context` re-render.
- `readCherryDisplayContext(url?)` — the display context from the launch URL,
  before `init()` and during SSR; React `useCherryDisplayContext()` (never
  `null`: the URL before the handshake, then the live context).
- `applyCherryContextToDocument(context, target?)` — opt-in: `<html lang>`,
  `data-cherry-theme` and the `color-scheme` property. Never called by the SDK.
- **Public user profile.** `MiniAppPublicProfile` (and `MiniAppUserSummary`,
  `MiniAppUserPage`, `MiniAppRelationship`); `CherryContext.user` from the
  host's context (`user`, kept when an update omits it), normalised field by
  field; React `useCherryUser()`.
- `CherryMiniApp#users` — `me()`, `get(cherryId)`,
  `followers(cherryId, { cursor?, limit? })`, `following(…)`,
  `relationship(cherryId)` over the Cherry API with the launch token, at the
  token issuer's origin only when it is a trusted Cherry origin
  (`cherryApiOrigin()`); failures are `CherryApiError` (`code`, `status`,
  `serverCode`).
- `Bridge#hostContext`, `Bridge#trustedOrigins`.

### Changed

- Navigation sends `navigate.userProfile` / `navigate.openRoom` and retries
  once with `navigate.profile` / `navigate.room` when a host rejects the
  method name (older inline hosts), remembering the name that worked.
- `verifyLaunchToken` accepts tokens whose `mini_app_id` is your app id
  (inline/bot launch tokens), not only `app_id`. `expectedAppId` /
  `expectedOrigin` are deprecated aliases of `appId` / `origin`.
- The remote JWKS is cached per URL instead of being re-created per call.
- The SDK re-sends `cherry:ready` when the host repeats `cherry:init`.
- `init()` timeout errors name any untrusted origin whose messages were ignored.
- `createCherrySigner().signTransactions` accepts kit's read-only compiled
  transactions (`compileTransaction` output) without casts.
- `BLINKS.md` and `CHANGELOG.md` ship in the npm package.

### Fixed

- `strict` passed to `CherryMiniApp` / `CherryMiniAppProvider` now reaches the
  bridge's transport detection (it was accepted but ignored).
- A top-level page outside Cherry no longer posts bridge messages to itself.
- The `Bridge` can be constructed during SSR (no `window`) without throwing.

## 0.1.21

- Blinks and `share()` accept `initialHeight` (exact first-paint height);
  exposed as `cherry.blink.initialHeight` and the `initial_height` claim.

Earlier versions: see the git history.
