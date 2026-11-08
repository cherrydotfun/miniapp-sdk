---
name: cherry-miniapp-integration
description: "Use when integrating @cherrydotfun/miniapp-sdk into a web app so it runs as a Cherry mini-app (inside Cherry's web iframe and mobile WebView) — seamless login via the launch token, backend token verification, Cherry wallet signing, framing headers, wallet-limit/policy error handling, matching Cherry's language/theme/safe area, reading the user's public profile, on-chain attribution (app reference key) and Cherry fee splits, and passing the automated listing test."
---

# Cherry Mini-App SDK Integration (v0.1.24)

## Overview

A Cherry mini-app is an existing website that Cherry opens inside the
app: an `<iframe>` in `https://chat.cherry.fun` on web, a React Native
WebView on mobile, or an inline "blink" card in a chat message. Inside Cherry
the person is **already signed in and has a wallet** — the app must not show a
wallet-connect button or ask for a login signature. Identity arrives as a
signed **launch token** that the app's **backend** verifies.

The authoritative reference is the package README
(`node_modules/@cherrydotfun/miniapp-sdk/README.md`) — read the sections named
in each step. Blinks: `BLINKS.md` in the same package.

## When to Use

- Making a Solana dApp, game or tool run inside Cherry (fullscreen or as a blink)
- Replacing an in-app login/connect flow with Cherry's seamless auth
- Verifying Cherry launch tokens on a backend (Node, Python, Go)
- Adding the app reference key / Cherry fee split to transactions
- Preparing an app for the self-serve listing test
- Following Cherry's language, colour scheme and safe area; showing the person's public profile
- Upgrading from SDK 0.1.21

## Non-negotiables (the listing test checks these)

1. HTTPS + `Content-Security-Policy: frame-ancestors https://chat.cherry.fun https://cherry.fun https://*.cherry.fun`, and no `X-Frame-Options: DENY/SAMEORIGIN`.
2. `cherry.init()` / `<CherryMiniAppProvider>` runs **immediately** on load (handshake must complete within 5 s).
3. **No** connect button, login screen, `signMessage` or `signTransaction` on load.
4. The backend verifies the launch token (signature, `iss`, `aud`, `exp`, app id) and rejects failures.
5. The app uses the context: the person is signed in, Cherry's wallet is the wallet.

## Integration Checklist

Follow IN ORDER; mark each step done before the next.

### Step 1: Discovery

Find out (read the code; ask only what you can't determine):

1. Framework / bundler (React, Next.js, Vue, vanilla; Vite, webpack).
2. Solana library: `@solana/web3.js` (+ wallet-adapter) or `@solana/kit`.
3. Current auth: cookies? wallet-signature login? Privy? Where is the session checked?
4. Backend language (Node / Python / Go / none) and where requests are authorized.
5. Hosting (Vercel, Netlify, nginx, Express…) — where response headers are set.
6. UI to hide inside Cherry: wallet connect button/modal, login screen, header/nav, footer, landing page.
7. The mini-app id (developer portal) and, if monetizing, the declared revenue model and share, and the Cherry treasury address (portal). Never invent a treasury address.

### Step 2: Install

```bash
npm install @cherrydotfun/miniapp-sdk
npm install @solana/web3.js @solana/wallet-adapter-base   # web3.js apps
npm install @solana/kit                                    # kit apps
```

### Step 3: Hosting headers (README §9)

Add to every HTML response:

```
Content-Security-Policy: frame-ancestors https://chat.cherry.fun https://cherry.fun https://*.cherry.fun
```

- Merge into an existing CSP header instead of adding a second one.
- Remove `X-Frame-Options` (disable `helmet`'s `frameguard`, platform defaults).
- Next.js `headers()`, Express middleware, nginx `add_header … always`,
  `vercel.json` and `_headers` examples are in README §9.

### Step 4: Environment detection & conditional UI (README §4)

```tsx
import { isInsideCherry } from '@cherrydotfun/miniapp-sdk';
const embedded = isInsideCherry(); // synchronous; call at module load / before routing
```

- React: `useCherryEnvironment()` (no provider needed) → `{ isEmbedded, platform }`.
- Hide standalone-only UI (`if (isEmbedded) return null`) — especially wallet connect and login.
- Don't let the router strip `?cherry_embed=1`.
- `{ strict: true }` disables fallback heuristics (only Cherry-injected signals).

### Step 5: Provider / client (README §3)

React:

```tsx
import { CherryMiniAppProvider } from '@cherrydotfun/miniapp-sdk/react';
root.render(embedded ? <CherryMiniAppProvider><App /></CherryMiniAppProvider> : <StandaloneApp />);
```

Vanilla: `const cherry = new CherryMiniApp(); await cherry.init();` — first thing on load.

Staging / non-production Cherry hosts must be added explicitly:
`trustedOrigins: ['https://staging.example.com']` (provider prop, client option,
`CherryWalletAdapter` config). The SDK ignores bridge messages from any other
origin and posts only to the locked host origin.

### Step 6: Seamless auth (README §5)

Client — exchange the launch token once for the app's own session:

```ts
const { launchToken } = useCherryMiniApp();       // or cherry.launchToken after init()
const res = await fetch(`${API}/auth/cherry`, { method: 'POST', headers: { Authorization: `Bearer ${launchToken}` } });
const { session } = await res.json();             // keep in memory; send as Authorization header
```

- Do NOT rely on cookies set inside the iframe (third-party cookies are blocked). Use headers.
- Do NOT add a "sign message to log in" step inside Cherry.

Backend — verify (Node):

```ts
import { verifyLaunchToken, LaunchTokenError } from '@cherrydotfun/miniapp-sdk';

const claims = await verifyLaunchToken(token, { appId: process.env.CHERRY_APP_ID! });
// throws LaunchTokenError (code: TOKEN_EXPIRED | ISSUER_MISMATCH | AUDIENCE_MISMATCH | APP_ID_MISMATCH | SIGNATURE_INVALID | JWKS_UNAVAILABLE | …)
const userKey = claims.cherry_id ?? claims.sub;   // stable person id, else wallet
```

Options: `appId` (required; `expectedAppId` is the deprecated 0.1.21 name),
`issuer?` (default `https://chat.cherry.fun`), `jwksUrl?`, `jwks?`, `origin?`,
`requireAudience?` (default false during the `aud` rollout), `scope?`
(`'launch' | 'inline' | 'fullscreen'`), `clockTolerance?` (default 30 s).

Python (PyJWT), Go (golang-jwt + keyfunc) and plain `jose` versions are in
README §5 — copy them verbatim. Required checks in any language: RS256 via
the JWKS `https://chat.cherry.fun/.well-known/jwks.json`, `iss`, `exp`,
`aud` = app id when present, `app_id` or `mini_app_id` = app id.

Never authorize on client-provided context (`cherry.user`, `cherry.context`,
addresses in request bodies) — only on verified claims.

Privy apps: `loginWithCustomAccessToken(cherry.launchToken)` with Cherry
configured as a custom auth provider (README §5, "Privy").

### Step 7: Wallet (README §7)

**web3.js / wallet-adapter**: inside Cherry offer only `new CherryWalletAdapter()`,
`autoConnect`, auto-select it, hide `WalletMultiButton`:

```tsx
const wallets = useMemo(() => (embedded ? [new CherryWalletAdapter()] : [new PhantomWalletAdapter()]), []);
<WalletProvider wallets={wallets} autoConnect={embedded}>…</WalletProvider>
// + select(CherryWalletAdapterName) once (see README §3.2)
```

**kit**: `const signer = createCherrySigner(cherry)` after init; build with
`setTransactionMessageFeePayer(address(signer.address), m)`, then
`compileTransaction(message)` → `signer.signTransactions([compiled])` →
`getBase64EncodedWireTransaction(...)` (README §3.3). Don't route the Cherry
signer through `signTransactionMessageWithSigners`.

**Vanilla/React hooks**: `cherry.wallet.*` / `useCherryWallet()`.

Every transaction: fee payer = the Cherry wallet (`wallet.publicKey` /
adapter `publicKey` / `signer.address`), a fresh blockhash, real instructions.
Permissions: `wallet:sign` (sign), `wallet:send` (sign & send) — check
`cherry.hasPermission(...)`.

**Label every transaction** (README §7, "Say what the transaction does"):
`cherry.wallet.signAndSendTransaction(tx, { label: 'Buy 3 lives' })`, or wrap a
wallet-adapter / kit call in `withTransactionLabel('Buy 3 lives', () => …)`.
One line naming the action and the thing, ≤ 80 characters, never an amount
different from what the transaction moves.

### Step 8: Error & policy handling (README §8)

```ts
import { getBridgeError } from '@cherrydotfun/miniapp-sdk';

catch (err) {
  const e = getBridgeError(err);                       // unwraps wallet-adapter errors
  if (e?.code === 'USER_REJECTED') return;             // silent
  if (e?.code === 'POLICY_DENIED') return show(e.policyCode, e.policy, e.reason);
  if (e?.code === 'PRECHECK_UNAVAILABLE') return show('retry later');
  show(e?.message ?? String(err));
}
```

- `POLICY_DENIED` → `err.policyCode`: `TX_LIMIT`, `DAILY_LIMIT`,
  `FORBIDDEN_INSTRUCTION`, `APP_PAUSED`, `SIMULATION_FAILED`,
  `PRICE_UNAVAILABLE`; numbers in `err.policy` (`perTxLimitUsd`,
  `dailyUsedUsd`, `dailyLimitUsd`, `outflowUsd`, `tier`). Copy the
  user-facing messages from README §8.
- Tier limits: **unverified** $50 per transaction and $50 per wallet per app
  per day, no token Approve/delegation, SetAuthority, Assign, durable-nonce
  transactions or subscriptions; **verified** $1,000 / $5,000; **partner**
  none. Read `cherry.tier`. `signMessage` is not prechecked.
- Design unverified-tier flows so a single payment is ≤ $50.

### Step 9: Attribution & monetization (README §13)

Add the app reference key (`sha256("cherry:app:" + appId)`, read-only,
non-signer) to ONE instruction you control in every transaction:

```ts
import { withAppReference, buildCherryFeeSplit } from '@cherrydotfun/miniapp-sdk/solana'; // or '/kit'
tx.add(withAppReference(SystemProgram.transfer({ fromPubkey, toPubkey, lamports }), APP_ID));
```

- Never append it to DEX/aggregator instructions (they read trailing accounts).
- Cherry measures the app's volume itself and bills 10% of the revenue the
  developer declared in the portal (sales = everything users pay; commission /
  mixed = the declared share of what users move; free = nothing). Pay it inside
  the app's own transactions so nothing is invoiced:
  - sales: build each payment with
    `buildCherryFeeSplit({ payer, developer, treasury, amount /* bigint base units */, mint?, decimals?, appId })`
    (90% developer, 10% Cherry, same transaction);
  - commission / mixed: where the app takes its fee, take it 10% lower and add
    `buildCherryShareTransfer({ payer, treasury, amount: cherryShareOf(fee), mint?, decimals?, appId })`,
    so the user pays the same in total. Works with any protocol or provider.
  - Fees that accrue and are claimed later cannot be split per transaction:
    the weekly invoice covers them.
- Treasury from the portal (Monetization); never invent one. Every fee shown
  to the user before they sign; no hidden spreads.
- The reference key is attribution (Dune, the developer's own queries); the
  share legs carry it so Cherry credits them to the app.

### Step 10: Language, theme & safe area (README §6, "Language, theme, platform & safe area")

`cherry.context` carries `locale` (`en`, `ru`, `de`, `fr`, `es`, `id`, `vi`,
`zh`, `ja`, `ko` today — treat as an open tag), `colorScheme` (`dark` | `light`),
`brand`, `platform` (`ios` | `android` | `web`), `appVersion` and `safeArea`
(`{ top, right, bottom, left }` CSS px, or `null` → fall back to
`env(safe-area-inset-*)`). Per field: the host's latest context, then the URL's
`cherry_lang` / `cherry_theme`, then the token's `locale` claim.

- If the app has i18n / themes, wire them to it; don't invent languages it doesn't have (fall back to its default).
- First paint: `readCherryDisplayContext()` (sync, from the URL; SSR: pass the request URL) — React: `useCherryDisplayContext()` (never null).
- Live: `cherry.onContextChange(cb)` → unsubscribe; React hooks re-render by themselves.
- `applyCherryContextToDocument(ctx)` (opt-in) sets `<html lang>`, `data-cherry-theme`, `color-scheme`. The SDK never touches the document on its own.

```tsx
const { locale, colorScheme, safeArea } = useCherryDisplayContext();
useEffect(() => {
  applyCherryContextToDocument({ locale, colorScheme });
  if (locale) i18n.changeLanguage(locale.split('-')[0]);
}, [locale, colorScheme]);
// padding: safeArea ? safeArea.bottom : 'env(safe-area-inset-bottom)'
```

### Step 11: User profile (README §6, "User profile")

- UI: `context.user` / `useCherryUser()` — the PUBLIC profile (`cherryId`,
  `handle`, `displayName`, `avatarUrl`, `bio`, `level`, `pet`, `socials`,
  public `wallets`, `badges`, `social` counts, `trading`), or `null` on older
  hosts → `cherry.users.me()`.
- Never included: hidden wallets, email/phone, keys, any private data. Don't ask the person to re-enter what the profile already has.
- Graph: `cherry.users.get(id)`, `.followers(id, { cursor, limit ≤ 100 })`,
  `.following(…)`, `.relationship(id)` → `{ following, followedBy }`. Errors are
  `CherryApiError` (`UNAUTHORIZED` usually = the 5-min launch token expired —
  read early).
- Backend: NEVER accept a profile from the client. Verify the launch token,
  then `GET https://chat.cherry.fun/api/miniapp/me` with
  `Authorization: Bearer <launch token>` (same for `/users/:cherryId`,
  `/followers`, `/following`, `/relationship`) — once, at the token exchange.

### Step 12: Navigation, sharing, blinks (optional)

- `useCherryNavigate().userProfile('alice.sol')`, `.openRoom('@group')` (needs `navigate:profile` / `navigate:room`; the SDK handles host aliases).
- `useCherryShare()({ route, params, caption })` → share a read-only result card.
- Rendering as a blink (inline card): follow `BLINKS.md` — render from `cherry.blink.params`, no `wallet.connect`, no `signAndSendTransaction`, SSR with `verifyLaunchToken(token, { appId, scope: 'inline' })`.

### Step 13: Verify (README §14)

Standalone:
- [ ] App works as before with its own wallet connect/login.

Inside Cherry (web and mobile):
- [ ] Loads in the iframe (no `Refused to frame` in DevTools).
- [ ] No connect/login/sign prompt on load; handshake completes immediately.
- [ ] Backend accepts the real launch token and rejects a tampered/expired one.
- [ ] Transactions sign; fee payer is the Cherry wallet; reference key present.
- [ ] `POLICY_DENIED` shows a sensible message (try a > $50 payment on an unverified app).
- [ ] No auth cookies inside the iframe; API calls use the Authorization header.
- [ ] If the app is localized/themed: it opens in Cherry's language and scheme, and follows a switch.
- [ ] Nothing important sits under the home indicator / notch on mobile (`safeArea`).

## Common Mistakes

| Mistake | Fix |
|---|---|
| Wallet connect button / login screen inside Cherry | Hide when `isEmbedded`; use the launch token |
| "Sign this message to log in" | Remove inside Cherry — verify the launch token on the backend |
| Trusting `cherry.user.publicKey` sent from the client | Authorize only on `verifyLaunchToken` claims |
| `verifyLaunchToken(token, { appId })` with the wrong id | Use the mini-app id from the developer portal |
| Not checking `iss`/`aud`/`exp` in a non-Node backend | Copy the README §5 Python/Go code |
| Session cookie set inside the iframe | Third-party cookies are blocked — use an Authorization header |
| Two CSP headers, or `X-Frame-Options: SAMEORIGIN` | One CSP with `frame-ancestors …`; no XFO |
| `init()` deferred until assets load | Call it first; the listing test expects the handshake within 5 s |
| Hard-coded treasury address | Take it from the developer portal |
| Reference key appended to a Jupiter/DEX instruction | Append to your own transfer/fee instruction |
| `cherry:init not received` on a staging host | Add the host to `trustedOrigins` |
| `Buffer` in browser code | Use `Uint8Array` / `btoa` / `atob` |
| Backend trusts `context.user` / a profile posted by the client | Verify the token; read `GET /api/miniapp/me` server-side |
| Reading `cherry.context.locale` only once at startup | Subscribe with `onContextChange` (React hooks already re-render) |
| Assuming `context.locale` is always one of the ten | Fall back to your default for anything you don't ship |
| Importing `CherryWalletAdapter` from the root entry | `@cherrydotfun/miniapp-sdk/solana` |

## Lifecycle Events

```ts
cherry.on('suspended', () => { /* user left — pause */ });
cherry.on('resumed', () => { /* resume */ });
cherry.on('walletDisconnected', () => { /* read-only mode */ });
cherry.on('blink:update', ({ params }) => render(params)); // inline blinks
```
