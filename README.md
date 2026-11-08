# @cherrydotfun/miniapp-sdk

The SDK for building **Cherry mini-apps** — web apps that run inside
[Cherry](https://cherry.fun), the wallet and distribution platform for apps:
the Cherry Wallet, a mini-app marketplace and chats, in one app.

Inside Cherry the person is **already signed in and already has a wallet**.
Your app gets their identity and a signing wallet from the host — no connect
button, no "sign this message to log in", no seed phrase. This README is
written so that you (or your AI coding agent) can integrate end-to-end from it
alone.

> Version **0.1.24**. Upgrading from 0.1.21? See [Migration](#19-migration-0121--0124). (0.1.22 and 0.1.23 are no longer on npm; 0.1.24 is the same code.)
> Blink cards in chat have their own guide: [BLINKS.md](./BLINKS.md).

---

## Contents

1. [What a Cherry mini-app is](#1-what-a-cherry-mini-app-is)
2. [Install](#2-install)
3. [Quick starts](#3-quick-starts) — [React](#31-react) · [@solana/web3.js](#32-solanaweb3js-wallet-adapter) · [@solana/kit](#33-solanakit) · [Vanilla JS](#34-vanilla-js)
4. [Environment detection](#4-environment-detection)
5. [Seamless auth & backend token verification](#5-seamless-auth--backend-token-verification)
6. [Context reference](#6-context-reference) — [language, theme & safe area](#language-theme-platform--safe-area) · [user profile](#user-profile)
7. [Wallet](#7-wallet)
8. [Errors, wallet limits & policy codes](#8-errors-wallet-limits--policy-codes)
9. [Hosting & framing requirements](#9-hosting--framing-requirements)
10. [Bridge security & trusted origins](#10-bridge-security--trusted-origins)
11. [Navigation](#11-navigation)
12. [Sharing & blinks](#12-sharing--blinks)
13. [Monetization & on-chain attribution](#13-monetization--on-chain-attribution)
14. [Listing requirements & the automated listing test](#14-listing-requirements--the-automated-listing-test)
15. [Terms of Service & privacy expectations](#15-terms-of-service--privacy-expectations)
16. [Troubleshooting](#16-troubleshooting)
17. [API reference](#17-api-reference)
18. [Bridge protocol (advanced)](#18-bridge-protocol-advanced)
19. [Migration 0.1.21 → 0.1.24](#19-migration-0121--0124)
20. [AI-assisted integration](#20-ai-assisted-integration)

---

## 1. What a Cherry mini-app is

A mini-app is **your own website** (any framework) that Cherry opens inside the
app:

| Surface | Where | How it runs |
|---|---|---|
| **Fullscreen** | Opened from a room (group/DM) or the marketplace | Web: `<iframe>` inside `https://chat.cherry.fun`. Mobile: a React Native WebView. |
| **Inline blink** | A card inside a chat message | Small iframe/WebView in the message bubble — see [BLINKS.md](./BLINKS.md) |
| **Preview** | The share picker, before a blink is sent | Read-only inline render |

The same build serves all three; the SDK detects the surface.

**How it works**

```
 ┌──────────── Cherry host (web or mobile) ─────────────┐
 │  signed-in person · Cherry Wallet · room              │
 │                                                       │
 │   ① cherry:init { token }  ──────────────►  your app  │  (SDK: cherry.init())
 │   ② ◄──────────────  cherry:ready                     │
 │   ③ ◄──── cherry:request wallet.signTransaction ────  │  (SDK: wallet.*)
 │   ④ ── cherry:response { result | error } ───────►    │
 └───────────────────────────────────────────────────────┘
            │ launch token (RS256 JWT, 5 min)
            ▼
     your backend ── verifyLaunchToken() against https://chat.cherry.fun/.well-known/jwks.json
```

- **Launch token** — a short-lived JWT signed by Cherry naming the person
  (`sub`, `cherry_id`), your app (`aud`, `app_id`), the room, the granted
  permissions and your app's trust `tier`. Your **backend** verifies it; that
  is your login.
- **Bridge** — `postMessage` between your page and the Cherry host. The SDK
  speaks it for you: wallet signing, navigation, sharing, lifecycle events.
- **Policy** — the host checks every wallet request against your app's tier
  (per-transaction and daily limits, forbidden instructions) before the person
  sees it. See [§8](#8-errors-wallet-limits--policy-codes).

## 2. Install

```bash
npm install @cherrydotfun/miniapp-sdk
```

Peer dependencies — install only what you use:

```bash
npm install react                                           # React hooks
npm install @solana/web3.js @solana/wallet-adapter-base     # /solana entry (web3.js)
npm install @solana/kit                                     # /kit entry (types for helpers)
```

| Entry point | What's in it | Needs |
|---|---|---|
| `@cherrydotfun/miniapp-sdk` | `CherryMiniApp` client, env detection, `verifyLaunchToken` (server), bridge, errors, reference key & fee math | — (uses `jose`) |
| `@cherrydotfun/miniapp-sdk/react` | `CherryMiniAppProvider` + hooks | `react` ≥ 18 |
| `@cherrydotfun/miniapp-sdk/solana` | `CherryWalletAdapter`, `getAppReferenceKey`, `withAppReference`, `buildCherryFeeSplit` (web3.js types) | `@solana/web3.js` ≥ 1.90, `@solana/wallet-adapter-base` |
| `@cherrydotfun/miniapp-sdk/kit` | `createCherrySigner`, `getAppReferenceKey`, `withAppReference`, `buildCherryFeeSplit` (kit types) | `@solana/kit` (types only) |

Works in ESM and CJS. The core entry is safe to import on the server
(Node ≥ 18) — that's where `verifyLaunchToken` runs.

## 3. Quick starts

Every quick start does the same three things: **(1)** complete the handshake,
**(2)** send the launch token to your backend and verify it there, **(3)** use
the Cherry wallet. None of them shows a connect button or asks for a login
signature.

### 3.1 React

```tsx
// main.tsx
import { createRoot } from 'react-dom/client';
import { isInsideCherry } from '@cherrydotfun/miniapp-sdk';
import { CherryMiniAppProvider } from '@cherrydotfun/miniapp-sdk/react';
import { App } from './App';
import { StandaloneApp } from './StandaloneApp'; // your normal site (own wallet connect)

createRoot(document.getElementById('root')!).render(
  isInsideCherry() ? (
    <CherryMiniAppProvider>
      <App />
    </CherryMiniAppProvider>
  ) : (
    <StandaloneApp />
  ),
);
```

```tsx
// App.tsx
import { useEffect, useState } from 'react';
import { useCherryMiniApp, useCherryWallet, isPolicyDenied, getBridgeError } from '@cherrydotfun/miniapp-sdk/react';

export function App() {
  const { isReady, error, user, launchToken, context } = useCherryMiniApp();
  const { publicKey, signAndSendTransaction } = useCherryWallet();
  const [session, setSession] = useState<string | null>(null);

  // Seamless login: exchange the launch token for YOUR session.
  useEffect(() => {
    if (!launchToken) return;
    fetch('https://api.yourgame.example/auth/cherry', {
      method: 'POST',
      headers: { Authorization: `Bearer ${launchToken}` },
    })
      .then((r) => r.json())
      .then((r: { session: string }) => setSession(r.session));
  }, [launchToken]);

  if (error) return <p>Couldn't connect to Cherry: {error.message}</p>;
  if (!isReady || !session) return <p>Loading…</p>;

  return (
    <div>
      <p>gm {user!.displayName}</p>
      {context?.tier === 'unverified' && <small>Payments up to $50 per transaction</small>}
      <button onClick={() => buy(publicKey!).then(signAndSendTransaction).catch(showWalletError)}>Buy</button>
    </div>
  );
}

function showWalletError(err: unknown) {
  const e = getBridgeError(err);
  if (e?.code === 'USER_REJECTED') return; // they said no — not an error
  if (isPolicyDenied(err)) return alert(e!.reason ?? 'This payment is above this app\'s limit.');
  alert(e?.message ?? 'Something went wrong');
}
// buy(payer) builds a Transaction with `payer` as fee payer and a fresh blockhash — see §7.
```

### 3.2 @solana/web3.js (wallet-adapter)

`CherryWalletAdapter` is a drop-in `BaseWalletAdapter`. Inside Cherry, offer
**only** it and auto-connect — `connect()` returns the Cherry wallet without
any prompt.

```tsx
import { useEffect, useMemo, type ReactNode } from 'react';
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { isInsideCherry } from '@cherrydotfun/miniapp-sdk';
import { CherryMiniAppProvider } from '@cherrydotfun/miniapp-sdk/react';
import { CherryWalletAdapter, CherryWalletAdapterName } from '@cherrydotfun/miniapp-sdk/solana';

const embedded = isInsideCherry();

function SelectCherry({ children }: { children: ReactNode }) {
  const { select, wallet } = useWallet();
  useEffect(() => {
    if (embedded && wallet?.adapter.name !== CherryWalletAdapterName) select(CherryWalletAdapterName);
  }, [wallet, select]);
  return <>{children}</>;
}

export function Root({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => (embedded ? [new CherryWalletAdapter()] : [new PhantomWalletAdapter()]), []);
  const tree = (
    <ConnectionProvider endpoint="https://api.mainnet-beta.solana.com">
      <WalletProvider wallets={wallets} autoConnect={embedded}>
        <SelectCherry>{children}</SelectCherry>
      </WalletProvider>
    </ConnectionProvider>
  );
  return embedded ? <CherryMiniAppProvider>{tree}</CherryMiniAppProvider> : tree;
}
```

Then use `useWallet()` as usual (`publicKey`, `sendTransaction`,
`signTransaction`, `signMessage`) and hide your `WalletMultiButton` when
`embedded`. Get the launch token for your backend from `useCherryMiniApp()`.

### 3.3 @solana/kit

```ts
import { CherryMiniApp } from '@cherrydotfun/miniapp-sdk';
import { createCherrySigner, buildCherryFeeSplit } from '@cherrydotfun/miniapp-sdk/kit';
import {
  address, appendTransactionMessageInstructions, compileTransaction, createSolanaRpc,
  createTransactionMessage, getBase64EncodedWireTransaction, pipe,
  setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';

const cherry = new CherryMiniApp();
await cherry.init();
await fetch('/auth/cherry', { method: 'POST', headers: { Authorization: `Bearer ${cherry.launchToken}` } });

const signer = createCherrySigner(cherry);            // signer.address = the Cherry wallet
const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');
const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

const message = pipe(
  createTransactionMessage({ version: 0 }),
  (m) => setTransactionMessageFeePayer(address(signer.address), m),
  (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
  (m) => appendTransactionMessageInstructions(
    buildCherryFeeSplit({ payer: signer.address, developer: DEV_WALLET, treasury: CHERRY_TREASURY, amount: 10_000_000n, appId: cherry.appId! }),
    m,
  ),
);
const compiled = compileTransaction(message);
const [signed] = await signer.signTransactions([compiled]);   // Cherry fills its signature slot
const wire = getBase64EncodedWireTransaction(signed as unknown as typeof compiled);
await rpc.sendTransaction(wire, { encoding: 'base64' }).send();
```

`createCherrySigner` signs **compiled** transactions (`signTransactions([{ messageBytes, signatures }])`
returns them with Cherry's signature added); call it directly as above rather
than through `signTransactionMessageWithSigners`.

React + kit: `const app = useCherryApp(); const { isReady } = useCherryMiniApp();`
then `createCherrySigner(app)` once `isReady`.

### 3.4 Vanilla JS

```ts
import { CherryMiniApp, isInsideCherry, getBridgeError } from '@cherrydotfun/miniapp-sdk';

if (!isInsideCherry()) {
  startStandalone();                       // your normal site
} else {
  const cherry = new CherryMiniApp();
  await cherry.init();                     // handshake — call it right away on load

  await fetch('/auth/cherry', { method: 'POST', headers: { Authorization: `Bearer ${cherry.launchToken}` } });

  cherry.user.displayName;                 // "alice.sol"
  cherry.room.title;                       // room the app was opened in
  cherry.context;                          // { appId, cherryId, paymentWallet, permissions, tier, locale, colorScheme, safeArea, user, … }
  cherry.onContextChange((ctx) => applyTheme(ctx.colorScheme, ctx.locale)); // live: language / theme / insets

  try {
    const signature = await cherry.wallet.signAndSendTransaction(tx); // Transaction | VersionedTransaction | bytes | base64
  } catch (err) {
    const e = getBridgeError(err);
    if (e?.code === 'POLICY_DENIED') console.log(e.policyCode, e.policy);
  }

  cherry.on('suspended', pause);
  cherry.on('resumed', resume);
}
```

## 4. Environment detection

Synchronous; call it at startup, before rendering:

```ts
import { isInsideCherry, getCherryEnvironment } from '@cherrydotfun/miniapp-sdk';

isInsideCherry();            // true inside Cherry (web iframe or mobile WebView)
getCherryEnvironment();      // { isEmbedded: boolean, platform: 'iframe' | 'webview' | 'standalone' }
```

React (no provider needed): `const { isEmbedded, platform } = useCherryEnvironment();`

Signals Cherry provides: mobile injects `window.__cherry = true` before your
page loads; web appends `cherry_embed=1` (plus `theme` and `session_id`) to
your URL. **Don't strip these query parameters in your router.**

**Strict mode.** By default the SDK also accepts two fallbacks for old Cherry
builds: any `ReactNativeWebView` and any `window.parent !== window`. Those can
misfire (e.g. a wallet's in-app browser). Pass `{ strict: true }` to accept only
the Cherry-injected signals — it applies to `isInsideCherry`,
`getCherryEnvironment`, `detectPlatform`, `useCherryEnvironment`,
`new CherryMiniApp({ strict: true })`, `<CherryMiniAppProvider strict>` and
`new CherryWalletAdapter({ strict: true })` (the last three also make the
bridge use only those signals).

## 5. Seamless auth & backend token verification

### The rule

**Inside Cherry the person is already authenticated.** Do not show a wallet
connect button, a login screen or a "sign this message to log in" prompt.
Instead:

1. `cherry.init()` (or `<CherryMiniAppProvider>`) — the host delivers the launch token.
2. Send `cherry.launchToken` to **your backend** (`Authorization: Bearer <token>`).
3. Your backend **verifies** it (below) and creates your own session for the
   person (e.g. your own short-lived JWT or session id). Return it in the
   response body and send it as a header on later calls.
4. Key your user records by `cherry_id` when present (one person, many
   wallets), else `sub`.

The launch token lives **5 minutes** (inline blink tokens ~15). Exchange it once
at startup; don't keep re-sending it for hours.

### Why never trust unsigned context

Everything the client knows — `cherry.user`, `cherry.context`,
`cherry.claims`, a wallet address in a request body — can be forged by anyone
who opens your site outside Cherry or edits requests. The launch token is the
only thing signed by Cherry. **Authorize on the verified claims only.**

### Required checks

| Check | Why |
|---|---|
| Signature **RS256** against `https://chat.cherry.fun/.well-known/jwks.json` (pick the key by the header `kid`; cache the JWKS) | Proves Cherry issued it. Never accept `alg: none`/HS256. |
| `iss` = `https://chat.cherry.fun` | Rejects tokens from other issuers. |
| `exp` (required) / `nbf`, ±30 s leeway | Rejects stale/replayed tokens. |
| `aud` = **your app id** when present (being rolled out; will become mandatory — then require it) | Stops another app's token from logging into yours. |
| `app_id` **or** `mini_app_id` = your app id | Same, for tokens that predate `aud`. Inline/bot tokens name your mini-app in `mini_app_id`; `app_id` there is the sending app. |
| optional: `scope` (`inline` / `fullscreen`; absent on room launches) | Accept only the surface an endpoint serves. |

### Node — with this SDK

```ts
import { verifyLaunchToken, LaunchTokenError } from '@cherrydotfun/miniapp-sdk';

const APP_ID = process.env.CHERRY_APP_ID!; // your mini-app id from the developer portal

app.post('/auth/cherry', async (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
  try {
    const claims = await verifyLaunchToken(token, { appId: APP_ID });
    const userKey = claims.cherry_id ?? claims.sub;
    res.json({ session: await createSessionFor(userKey, claims) });
  } catch (err) {
    if (err instanceof LaunchTokenError && err.code === 'JWKS_UNAVAILABLE') return res.status(503).end();
    res.status(401).json({ error: err instanceof LaunchTokenError ? err.code : 'INVALID_TOKEN' });
  }
});
```

Options (all but `appId` optional): `issuer` (string or list; default
`https://chat.cherry.fun`), `jwksUrl`, `jwks` (a local key set, for tests),
`requireAudience` (default `false` during the `aud` rollout), `scope`,
`origin`, `clockTolerance` (seconds, default 30). Errors are
`LaunchTokenError` with `code`: `TOKEN_INVALID`, `SIGNATURE_INVALID`,
`TOKEN_EXPIRED`, `TOKEN_NOT_YET_VALID`, `ISSUER_MISMATCH`, `AUDIENCE_MISMATCH`,
`AUDIENCE_MISSING`, `APP_ID_MISMATCH`, `ORIGIN_MISMATCH`, `SCOPE_MISMATCH`,
`JWKS_UNAVAILABLE`, `INVALID_OPTIONS`. The JWKS is cached per URL and refetched
on key rotation.

### Node — `jose` directly

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose';

const APP_ID = process.env.CHERRY_APP_ID!;
const JWKS = createRemoteJWKSet(new URL('https://chat.cherry.fun/.well-known/jwks.json')); // create ONCE

export async function verifyCherryToken(token: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    algorithms: ['RS256'],
    issuer: 'https://chat.cherry.fun',
    requiredClaims: ['exp'],
    clockTolerance: 30,
  });
  const aud = payload.aud === undefined ? [] : [payload.aud].flat();
  if (aud.length > 0 && !aud.includes(APP_ID)) throw new Error('aud mismatch');
  if (payload.app_id !== APP_ID && payload.mini_app_id !== APP_ID) throw new Error('app_id mismatch');
  return payload;
}
```

### Python — PyJWT

```python
import os
import jwt  # pip install "pyjwt[crypto]"
from jwt import PyJWKClient

CHERRY_ISSUER = "https://chat.cherry.fun"
CHERRY_JWKS_URL = "https://chat.cherry.fun/.well-known/jwks.json"
APP_ID = os.environ["CHERRY_APP_ID"]  # your mini-app id from the developer portal

_jwks = PyJWKClient(CHERRY_JWKS_URL, cache_keys=True)  # create once; refetches on a new kid


def verify_launch_token(token: str) -> dict:
    """Return the verified claims, or raise jwt.InvalidTokenError."""
    signing_key = _jwks.get_signing_key_from_jwt(token)
    claims = jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        issuer=CHERRY_ISSUER,
        leeway=30,
        # `aud` is checked by hand below while Cherry rolls it out; once every
        # token carries it, pass audience=APP_ID and require "aud" instead.
        options={"require": ["exp", "iss"], "verify_aud": False},
    )
    aud = claims.get("aud")
    if aud is not None and APP_ID not in (aud if isinstance(aud, list) else [aud]):
        raise jwt.InvalidAudienceError("launch token is for another app")
    if APP_ID not in (claims.get("app_id"), claims.get("mini_app_id")):
        raise jwt.InvalidTokenError("launch token app_id mismatch")
    return claims
```

### Go — golang-jwt + keyfunc

```go
package cherryauth

import (
	"errors"
	"slices"
	"time"

	"github.com/MicahParks/keyfunc/v3" // go get github.com/MicahParks/keyfunc/v3
	"github.com/golang-jwt/jwt/v5"      // go get github.com/golang-jwt/jwt/v5
)

const (
	cherryIssuer  = "https://chat.cherry.fun"
	cherryJWKSURL = "https://chat.cherry.fun/.well-known/jwks.json"
)

type Verifier struct {
	appID string
	jwks  keyfunc.Keyfunc
}

// NewVerifier fetches Cherry's JWKS and keeps it fresh in the background. Create one per process.
func NewVerifier(appID string) (*Verifier, error) {
	k, err := keyfunc.NewDefault([]string{cherryJWKSURL})
	if err != nil {
		return nil, err
	}
	return &Verifier{appID: appID, jwks: k}, nil
}

func (v *Verifier) Verify(tokenString string) (jwt.MapClaims, error) {
	claims := jwt.MapClaims{}
	if _, err := jwt.ParseWithClaims(tokenString, claims, v.jwks.Keyfunc,
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithIssuer(cherryIssuer),
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(30*time.Second),
	); err != nil {
		return nil, err
	}
	// aud: checked when present (add jwt.WithAudience(v.appID) once every token carries it)
	if aud, _ := claims.GetAudience(); len(aud) > 0 && !slices.Contains(aud, v.appID) {
		return nil, errors.New("launch token: aud mismatch")
	}
	appID, _ := claims["app_id"].(string)
	miniAppID, _ := claims["mini_app_id"].(string)
	if appID != v.appID && miniAppID != v.appID {
		return nil, errors.New("launch token: app_id mismatch")
	}
	return claims, nil
}
```

### Privy (custom auth)

If you use [Privy](https://privy.io), Cherry can be a custom auth provider —
zero-click login inside Cherry, normal Privy login outside.

1. Privy Dashboard → Settings → Custom Auth → Add provider: JWKS URL
   `https://chat.cherry.fun/.well-known/jwks.json`, issuer
   `https://chat.cherry.fun`, user id field `sub`.
2. Inside Cherry call `loginWithCustomAccessToken(cherry.launchToken)` once the
   provider is ready (`getCherryCustomAuthConfig(cherry)` returns
   `{ token, jwksUrl, issuer }`). Outside Cherry show Privy's login UI.
3. Your backend still verifies Privy's session as usual. The launch token TTL
   is 5 minutes — log in promptly after init.

## 6. Context reference

After `init()` resolves, `cherry.context` (React: `useCherryContext()` or
`useCherryMiniApp().context`) is a `CherryContext`. The launch fields also
have their own getter (`cherry.cherryId`, `cherry.tier`, …); all are
`null`/empty before init and never throw. **Display-only** — see [§5](#why-never-trust-unsigned-context).

| `CherryContext` field | Type | Meaning |
|---|---|---|
| `appId` | `string \| null` | Your mini-app id (token `aud` → `mini_app_id` → `app_id`). Use it for `withAppReference` / `buildCherryFeeSplit`. |
| `cherryId` | `string \| null` | The person's Cherry ID — stable across all their wallets. |
| `paymentWallet` | `string \| null` | The wallet Cherry routes signing to in your app, on hosts that support wallet switching. `null` → the identity wallet. See [§7](#which-address-to-build-for). |
| `paymentWalletKind` | `'app_held' \| 'external' \| null` | `app_held` = Cherry Wallet custody; `external` = the person's own wallet app. |
| `paymentWalletSetBy` | `'user' \| 'signature' \| 'history' \| null` | Present when a stored choice decided `paymentWallet`. |
| `permissions` | `readonly string[]` | Bridge permissions granted for **this** launch, e.g. `wallet:connect`, `wallet:sign`, `wallet:send`, `navigate:profile`, `navigate:room`. Check with `cherry.hasPermission('wallet:send')`. May be empty in inline blinks (the host still enforces). |
| `reach` | `'project' \| 'external' \| null` | `project` = a room of your own project (everything allowed); `external` = someone else's room (only approved permissions). |
| `tier` | `'unverified' \| 'verified' \| 'partner' \| null` | Decides the wallet limits ([§8](#8-errors-wallet-limits--policy-codes)). `null` on tokens that predate it. |
| `mode` | `'fullscreen' \| 'inline' \| 'preview'` | The surface. |
| `hostCapabilities` | `readonly string[]` | Host features beyond permissions (e.g. `wallet-switch`). |
| `locale` | `CherryLocale \| string \| null` | The language the person uses Cherry in — `en`, `ru`, `de`, `fr`, `es`, `id`, `vi`, `zh`, `ja`, `ko` today (`CHERRY_LOCALES`); treat it as an open BCP 47 tag. [Below](#language-theme-platform--safe-area). |
| `colorScheme` | `'dark' \| 'light' \| null` | The scheme the host is painted in. |
| `brand` | `string \| null` | The host's palette name (e.g. `cherry`). Informational. |
| `platform` | `'ios' \| 'android' \| 'web' \| null` | The device the host runs on (not the bridge transport — that's `getCherryEnvironment().platform`). |
| `appVersion` | `string \| null` | The Cherry app's version (mobile hosts). |
| `safeArea` | `{ top, right, bottom, left } \| null` | CSS px of system UI (notch, home indicator) over your view; `null` until a host reports it. |
| `user` | `MiniAppPublicProfile \| null` | The person's public Cherry profile, when the host sends it. [Below](#user-profile). |

Also available:

| API | Value |
|---|---|
| `cherry.user` | `{ publicKey, displayName, avatarUrl }` — `publicKey` is the identity wallet (`sub`). Throws before init. Inline: only `publicKey` (the viewer). |
| `cherry.room` | `{ id, title, memberCount }`. Throws before init. Inline: only `id`. |
| `cherry.launchToken` | The raw JWT to send to your backend. |
| `cherry.blink` | Inline blink context (`messageId`, `params`, `viewerWallet`, …) or `null` — [BLINKS.md §5](./BLINKS.md#5-the-blink-context). |
| `cherry.claims` | The decoded, **unverified** token claims. Debugging only. |
| `cherry.users` | The public profile API — `me()`, `get()`, `followers()`, `following()`, `relationship()`. [Below](#user-profile). |

**Launch token claims** (what `verifyLaunchToken` returns, `LaunchTokenPayload`):

| Claim | Room launch | Inline blink | Notes |
|---|---|---|---|
| `iss` | ✓ | ✓ | `https://chat.cherry.fun` |
| `aud` | ✓ (rolling out) | ✓ (rolling out) | your mini-app id |
| `sub` | ✓ | — | identity wallet (base58) |
| `cherry_id` | when the wallet has one | — | person id |
| `payment_wallet`, `payment_wallet_kind`, `payment_wallet_set_by` | switch-aware sessions | — | inline: from `host.init` instead |
| `app_id` | your app id | sending app (bot), if any | |
| `mini_app_id` | — | your app id | |
| `tier` | ✓ (rolling out) | ✓ (rolling out) | `unverified` \| `verified` \| `partner` |
| `permissions`, `reach` | ✓ | — | |
| `locale` | when known | when known | the person's Cherry language; a fallback for `context.locale` |
| `room_id` | ✓ | ✓ | |
| `user { display_name, avatar_url }`, `room { title, member_count }`, `origin` | ✓ | — | |
| `scope`, `mode` | — | `inline` | `fullscreen` on bot fullscreen launches |
| `message_id`, `route`, `params`, `height`, `initial_height`, `interactive`, `source`, `sender` | — | ✓ | see BLINKS.md |
| `iat`, `exp`, `jti` | ✓ | ✓ | room launch: 5 min; inline: ~15 min |

### Language, theme, platform & safe area

Cherry tells your app how to look, so it can match the person's Cherry: the
language, the colour scheme, the platform and how far system UI (the notch,
the home indicator) reaches into your view.

**Where each field comes from** — per field, the first source that has a valid
value wins:

1. the host's latest context — `cherry:context`, else the one in `cherry:init`
   (fullscreen) or in the `host.init` answer (blinks);
2. the launch URL: the hosts append `cherry_lang=<locale>&cherry_theme=<dark|light>`
   to your URL's query string, so these two are known **before** the handshake
   — and on your server (SSR);
3. the launch token's `locale` claim (language only).

`brand`, `platform`, `appVersion` and `safeArea` only come from the host's
context; `null` means nobody said. Values that aren't what the contract says
are ignored, never passed through.

**First paint.** `cherry.context` is `null` until `init()`; for the first frame
read the URL synchronously with `readCherryDisplayContext()` (pass the request
URL during SSR). In React, `useCherryDisplayContext()` does this for you — it
is never `null`.

**Live updates.** The host sends `cherry:context` whenever the language, the
scheme or the safe area changes while your app is open (a language switch,
rotating the phone). `cherry.onContextChange(cb)` calls `cb(context)` on the
first resolution and on every real change, and returns the unsubscribe
function; the React hooks re-render on their own. The SDK accepts
`cherry:context` only from the locked Cherry host (the origin rules of
[§10](#10-bridge-security--trusted-origins)).

**Applying it** is up to you. `applyCherryContextToDocument(context)` is an
opt-in helper that sets `<html lang>`, a `data-cherry-theme="dark|light"`
attribute and the `color-scheme` CSS property; the SDK never touches your
document by itself.

```tsx
import {
  applyCherryContextToDocument,
  useCherryDisplayContext,
} from '@cherrydotfun/miniapp-sdk/react';
import { useEffect, type ReactNode } from 'react';
import { i18n } from './i18n'; // your i18n library (i18next, lingui, …)

export function CherryLook({ children }: { children: ReactNode }) {
  // URL values before the handshake, then the live context — never null.
  const { locale, colorScheme, safeArea } = useCherryDisplayContext();

  useEffect(() => {
    applyCherryContextToDocument({ locale, colorScheme }); // <html lang> + data-cherry-theme
    if (locale) void i18n.changeLanguage(locale.split('-')[0]);
  }, [locale, colorScheme]);

  return (
    <div
      className={colorScheme === 'light' ? 'theme-light' : 'theme-dark'}
      style={{
        // Cherry's insets when it reports them, else the browser's own.
        paddingTop: safeArea ? safeArea.top : 'env(safe-area-inset-top)',
        paddingBottom: safeArea ? safeArea.bottom : 'env(safe-area-inset-bottom)',
        paddingLeft: safeArea ? safeArea.left : 'env(safe-area-inset-left)',
        paddingRight: safeArea ? safeArea.right : 'env(safe-area-inset-right)',
      }}
    >
      {children}
    </div>
  );
}
// <CherryMiniAppProvider><CherryLook><App /></CherryLook></CherryMiniAppProvider>
```

```css
/* With applyCherryContextToDocument, CSS can key off the attribute: */
:root[data-cherry-theme='light'] { --bg: #fff; --fg: #111; }
:root[data-cherry-theme='dark']  { --bg: #0a0a0f; --fg: #fff; }
```

Vanilla:

```ts
applyCherryContextToDocument(readCherryDisplayContext()); // before init — from the URL
const cherry = new CherryMiniApp();
cherry.onContextChange(applyCherryContextToDocument);      // init's context, then every change
await cherry.init();
```

### User profile

`context.user` (React: `useCherryUser()`) is the person's **public** Cherry
profile — what anyone sees on their Cherry page — when the host sends it
(`null` on older hosts; then call `cherry.users.me()`). It follows the host
like the rest of the context.

| `MiniAppPublicProfile` field | Type | |
|---|---|---|
| `cherryId` | `string` | Stable person id (= `context.cherryId`) |
| `handle` | `string \| null` | `@handle` without the `@` |
| `displayName` | `string` | |
| `avatarUrl`, `bio`, `createdAt` | `string \| null` | `createdAt` is ISO 8601 |
| `level` | `{ level, cp } \| null` | Cherry level and points |
| `pet` | `{ name, species, stage, imageUrl } \| null` | |
| `socials` | `{ provider, handle, url, verified }[]` | Linked socials the person shows |
| `wallets` | `{ address, chain: 'solana' \| 'evm', cherryWallet, domains }[]` | **Public** wallets only |
| `badges` | `{ id, label, iconUrl }[]` | |
| `social` | `{ followers, following }` | Counts |
| `trading` | `{ pnlUsd, volumeUsd, window } \| null` | `null` when not shown |

**Never included:** wallets the person hid, email, phone, keys, sessions,
balances beyond the public trading figures, or anything else that is not on
their public page. The SDK normalises every field (lists default to `[]`,
counts to `0`, the rest to `null`) and drops anything unknown.

**The API.** `cherry.users` reads the Cherry profile API with the current
launch token (`Authorization: Bearer`, no cookies):

```ts
const me = await cherry.users.me();                                   // GET /api/miniapp/me
const bob = await cherry.users.get('cid_…');                          // GET /api/miniapp/users/:cherryId
const page = await cherry.users.followers(me.cherryId, { limit: 50 }); // { items, nextCursor }
const next = await cherry.users.following(me.cherryId, { cursor: page.nextCursor ?? undefined });
const { following, followedBy } = await cherry.users.relationship(bob.cherryId);
```

- `followers` / `following` items are `{ cherryId, handle, displayName, avatarUrl, level }`;
  `limit` is clamped to 1–100; pass `nextCursor` back as `cursor` until it is `null`.
- The API origin is the token's `iss` (`https://chat.cherry.fun`), and only if
  it is a trusted Cherry origin (the defaults or your `trustedOrigins`) — the
  token is never sent to any other host.
- Failures are `CherryApiError` with `code`: `NOT_READY` (before `init()`),
  `UNTRUSTED_ISSUER`, `UNAUTHORIZED` (401 — typically an **expired** launch
  token: 5 min for room launches, ~15 for blinks; read what you need early, or
  rely on `context.user`), `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`,
  `HTTP_ERROR`, `NETWORK_ERROR`, `INVALID_RESPONSE`; plus `status` and the
  server's `serverCode`.

**Frontend vs backend.** `context.user` and `cherry.users` are for **UI**: the
client can be tampered with. A backend never takes a profile from the client —
it verifies the launch token ([§5](#5-seamless-auth--backend-token-verification))
and reads the same API itself, typically once, at the token exchange:

```bash
curl -H "Authorization: Bearer $LAUNCH_TOKEN" https://chat.cherry.fun/api/miniapp/me
curl -H "Authorization: Bearer $LAUNCH_TOKEN" https://chat.cherry.fun/api/miniapp/users/$CHERRY_ID
curl -H "Authorization: Bearer $LAUNCH_TOKEN" "https://chat.cherry.fun/api/miniapp/users/$CHERRY_ID/followers?limit=100&cursor=$CURSOR"
curl -H "Authorization: Bearer $LAUNCH_TOKEN" https://chat.cherry.fun/api/miniapp/users/$CHERRY_ID/relationship
```

```ts
// Node, inside your /auth/cherry handler, after verifyLaunchToken(token, { appId })
const res = await fetch('https://chat.cherry.fun/api/miniapp/me', { headers: { Authorization: `Bearer ${token}` } });
const profile = res.ok ? ((await res.json()) as MiniAppPublicProfile) : null; // type from the SDK
```

## 7. Wallet

| Method | Returns | Permission | Notes |
|---|---|---|---|
| `wallet.signTransaction(tx, { label? })` | `Promise<Uint8Array>` (signed wire bytes) | `wallet:sign` | `tx`: `Transaction`, `VersionedTransaction`, `Uint8Array` or base64 |
| `wallet.signAllTransactions(txs, { label? })` | `Promise<Uint8Array[]>` | `wallet:sign` | one approval for the batch |
| `wallet.signAndSendTransaction(tx, { label? })` | `Promise<string>` (signature) | `wallet:send` | fullscreen only (not inline) |
| `wallet.signMessage(bytes)` | `Promise<Uint8Array>` (64-byte signature) | `wallet:sign` | **not** for login. Not policy-checked. |
| `wallet.publicKey` / `getPublicKey()` | `string \| null` | — | |

The same through `useCherryWallet()`, `CherryWalletAdapter` (`signTransaction`,
`signAllTransactions`, `sendTransaction`, `signMessage`) and
`createCherrySigner(cherry)` (`signTransactions`, `signMessages`). The person
confirms wallet requests in Cherry, after the host's policy check (§8).

### Building transactions that sign

1. **Fee payer and signer = the Cherry wallet** (see below).
2. **A fresh `recentBlockhash`** from your RPC, fetched right before signing.
3. **Real instructions** — wallets simulate; placeholder transactions fail.
4. Add your [app reference key](#13-monetization--on-chain-attribution) to one instruction.
5. Keep every outflow within your tier's limits, and avoid the forbidden
   instructions for unverified apps (§8).

```ts
const { blockhash } = await connection.getLatestBlockhash();
const tx = new Transaction({ feePayer: new PublicKey(cherry.wallet.publicKey!), recentBlockhash: blockhash })
  .add(withAppReference(SystemProgram.transfer({ fromPubkey, toPubkey, lamports }), cherry.appId!));
const signature = await cherry.wallet.signAndSendTransaction(tx);
```

### Say what the transaction does (labels)

Cherry's wallet sheet shows your app's name, the amount and the fee it decodes
from the transaction itself. Add a **label** — one line in your words — so the
person also reads what they are paying for:

```ts
await cherry.wallet.signAndSendTransaction(tx, { label: 'Buy 3 lives' });

// Standard interfaces (wallet-adapter sendTransaction, a kit signer) have no
// room for an extra argument: wrap the call instead.
import { withTransactionLabel } from '@cherrydotfun/miniapp-sdk/solana';
await withTransactionLabel('Enter the weekly tournament', () => sendTransaction(tx, connection));
```

- Name the action and the thing: "Buy 3 lives", "Swap 1 SOL to USDC",
  "Claim winnings". Not "Transaction", not the app's name (Cherry shows it).
- Plain text, one line, at most 80 characters (`TRANSACTION_LABEL_MAX`);
  line breaks and control characters are folded, longer text is cut.
- Never state a different amount than the transaction moves: Cherry shows the
  decoded amount next to your words, and a mismatch reads as a scam.
- An explicit `{ label }` wins over a surrounding `withTransactionLabel`; a
  host that predates labels ignores them.

### Which address to build for

- **`CherryWalletAdapter`**: its `publicKey` (from `connect()`) — on
  switch-aware hosts this already *is* the payment wallet.
- **`cherry.wallet` / `useCherryWallet()` / `createCherrySigner`**: `wallet.publicKey`
  (= `user.publicKey`; in a blink, the viewer). Cherry signs transactions built
  for it.
- `cherry.paymentWallet` tells you when the person picked a **different** wallet
  to pay with in your app. If a request then fails with `WALLET_CHANGED` or
  `NOT_A_SIGNER`, rebuild the transaction for `paymentWallet` (with the adapter,
  reconnect) — never retry the same bytes.

### Lifecycle events

```ts
cherry.on('suspended', () => pauseGame());     // user left the app view
cherry.on('resumed', () => resumeGame());
cherry.on('walletDisconnected', () => showReadOnly());
cherry.on('blink:update', ({ params }) => render(params)); // inline blinks
```

## 8. Errors, wallet limits & policy codes

Every bridge failure is a `BridgeError` (`code`, `message`, `data`). Wallet
adapters wrap it — use `getBridgeError(err)` to get it back from anything your
call threw.

```ts
import { getBridgeError } from '@cherrydotfun/miniapp-sdk';

try {
  await cherry.wallet.signAndSendTransaction(tx);
} catch (err) {
  const e = getBridgeError(err);
  if (!e) throw err;
  if (e.code === 'USER_REJECTED') return;                         // declined — stay quiet
  if (e.code === 'POLICY_DENIED' && e.policyCode === 'DAILY_LIMIT') {
    const left = (e.policy!.dailyLimitUsd ?? 0) - (e.policy!.dailyUsedUsd ?? 0);
    return toast(`Daily limit reached — $${left.toFixed(2)} left today.`);
  }
  if (e.code === 'POLICY_DENIED') return toast(e.reason ?? 'Not allowed for this app.');
  if (e.code === 'PRECHECK_UNAVAILABLE') return toast('Couldn\'t check this payment. Try again in a moment.');
  toast(e.message);
}
```

### Tiers and limits

The host checks every **transaction** request (`signTransaction`,
`signAllTransactions`, `signAndSendTransaction`) against your app's tier
**before** showing it to the person. `signMessage` is not prechecked.

| Tier | Per transaction | Per wallet, per app, per day | Forbidden instructions |
|---|---|---|---|
| `unverified` (self-serve listing) | **$50** outflow | **$50** outflow | token `Approve` / delegation, `SetAuthority`, `Assign`, durable-nonce transactions, subscriptions |
| `verified` | $1,000 | $5,000 | the same as `unverified` |
| `partner` | no limit | no limit | — |

Read your tier from `cherry.tier` (display) or the verified `tier` claim
(server). Design unverified flows around ≤ $50 payments; apply for
verification in the developer portal for more.

### `POLICY_DENIED`

Wire shape: `{ code: 'POLICY_DENIED', message, data: { code, reason, tier, outflowUsd, perTxLimitUsd, dailyUsedUsd, dailyLimitUsd } }`.
In the SDK: `err.code === 'POLICY_DENIED'`, `err.policyCode` (= `data.code`),
`err.reason`, `err.policy` (typed `CherryPolicyDenial`), `err.data` (raw).
`isPolicyDenied(err)` is a shortcut.

| `policyCode` | Meaning | What your app should show / do |
|---|---|---|
| `TX_LIMIT` | This transaction's outflow exceeds the per-transaction limit | "This app can move at most $`perTxLimitUsd` per transaction." Offer a smaller amount or split the purchase. |
| `DAILY_LIMIT` | This wallet's outflow through your app today would exceed the daily limit | "Daily limit reached — $`dailyLimitUsd − dailyUsedUsd` left today." Let them come back tomorrow. |
| `FORBIDDEN_INSTRUCTION` | The transaction contains an instruction your tier may not use | A bug on your side — don't show users a retry. Remove the instruction (e.g. use `TransferChecked` instead of `Approve`) or get verified. |
| `APP_PAUSED` | Cherry paused wallet access for your app | "Payments are temporarily unavailable." Check the developer portal. |
| `SIMULATION_FAILED` | The transaction fails in simulation | "This transaction would fail." Rebuild with a fresh blockhash and current balances; check accounts. |
| `PRICE_UNAVAILABLE` | The host couldn't price an asset to enforce the limits | "Can't price this asset right now — try again later." Prefer assets with liquid prices. |

### Other codes

| `code` | Meaning | What to do |
|---|---|---|
| `PRECHECK_UNAVAILABLE` | The host couldn't run the policy check (`data.status`) | Retryable: "Try again in a moment." |
| `USER_REJECTED` | The person declined | Return to the previous state silently. |
| `WALLET_CHANGED` | Built for a wallet that is no longer the selected one | Rebuild for the current wallet ([§7](#which-address-to-build-for)). |
| `NOT_A_SIGNER` | The Cherry wallet isn't a required signer of the transaction | Fix fee payer / signer. |
| `DANGEROUS_INSTRUCTION`, `UNSTATED_ROLE` | Cherry Wallet refused the transaction's content | Fix the transaction. |
| `RESERVED_PAYLOAD` | `signMessage` content uses Cherry's reserved format | Sign a different message. |
| `WALLET_NOT_CONNECTED`, `WALLET_UNAVAILABLE`, `WALLET_NOT_IN_ACCOUNT` | Signing isn't possible right now | "Open Cherry and try again." |
| `RATE_LIMITED` | Too many requests | Back off. |
| `METHOD_NOT_ALLOWED_IN_INLINE` | Not available in a blink (e.g. `wallet.connect`, `signAndSendTransaction`) | Use the fullscreen app (`host.requestExpand`). |
| `TIMEOUT` | No answer within 120 s | Offer a retry. |
| `BRIDGE_ERROR` | Generic host error; read `message` (e.g. `Permission denied: wallet:send not granted for this mini-app`) | Grant the permission in the portal, or show the message. |

Codes are strings and hosts may add new ones — always keep a default branch.

## 9. Hosting & framing requirements

- **HTTPS** on a stable origin registered in the developer portal (http only
  for `localhost` during development).
- **Allow Cherry to frame you** — on every HTML response:

  ```
  Content-Security-Policy: frame-ancestors https://chat.cherry.fun https://cherry.fun https://*.cherry.fun
  ```

  Add `'self'` if you also frame yourself. If you already send a CSP, **add the
  directive to it** — two CSP headers are both enforced (their intersection).
- **No `X-Frame-Options: DENY` or `SAMEORIGIN`** (hosting platforms and
  security middleware such as `helmet` add it by default — turn it off).
- **No third-party cookies for auth.** In the web host your page is a
  third-party iframe: Safari and Firefox block third-party cookies by default
  and Chrome users can block them, so a cookie session set inside the iframe
  silently disappears. Use the launch token → your own session token, kept in memory and
  sent as `Authorization: Bearer …`. If you must use a cookie, it needs
  `SameSite=None; Secure; Partitioned` and still isn't reliable everywhere.
  `localStorage` inside the iframe is partitioned too — don't count on it
  matching your standalone site.
- **CORS**: your page calls your API from your own origin, same as standalone.
  Allow `Authorization` in `Access-Control-Allow-Headers` if the API is on
  another origin. Don't rely on `Referer` checks.

```ts
// Next.js — next.config.ts
const nextConfig = {
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'Content-Security-Policy', value: 'frame-ancestors https://chat.cherry.fun https://cherry.fun https://*.cherry.fun' },
    ] }];
  },
};
export default nextConfig;
```

```ts
// Express (if you use helmet: helmet({ frameguard: false, contentSecurityPolicy: { directives: { frameAncestors: [...] } } }))
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', 'frame-ancestors https://chat.cherry.fun https://cherry.fun https://*.cherry.fun');
  res.removeHeader('X-Frame-Options');
  next();
});
```

```nginx
add_header Content-Security-Policy "frame-ancestors https://chat.cherry.fun https://cherry.fun https://*.cherry.fun" always;
```

```json
// vercel.json
{ "headers": [{ "source": "/(.*)", "headers": [
  { "key": "Content-Security-Policy", "value": "frame-ancestors https://chat.cherry.fun https://cherry.fun https://*.cherry.fun" }
] }] }
```

```
# Netlify / Cloudflare Pages — _headers
/*
  Content-Security-Policy: frame-ancestors https://chat.cherry.fun https://cherry.fun https://*.cherry.fun
```

The mobile host loads you as a top-level page in a WebView: framing headers
don't matter there, HTTPS does.

## 10. Bridge security & trusted origins

The SDK is secure by default:

- **Web (iframe)**: it accepts bridge messages **only from `window.parent`**
  on a trusted Cherry origin — `https://chat.cherry.fun`, `https://cherry.fun`,
  `https://*.cherry.fun` (`DEFAULT_TRUSTED_HOST_ORIGINS`). The first valid host
  message locks the origin: from then on only that origin is accepted and it
  is the `targetOrigin` of everything the SDK posts. Requests made before that
  are queued (only the data-free inline `host.init` handshake is posted with
  `'*'`). Messages from other origins, child frames or popups are dropped and
  logged once (`[cherry-miniapp-sdk] Ignored a Cherry bridge message from untrusted origin …`).
- **Mobile (WebView)**: messages go through `ReactNativeWebView.postMessage`;
  only host-injected events are accepted, not messages from frames inside
  your page.
- **Not embedded**: nothing is sent or accepted.

Testing against a non-production Cherry host (staging, a local build)? Add it
explicitly — `'*'` is refused:

```ts
new CherryMiniApp({ trustedOrigins: ['https://staging.example.com'] });
<CherryMiniAppProvider trustedOrigins={['https://staging.example.com']}>
new CherryWalletAdapter({ trustedOrigins: ['https://staging.example.com'] });
getSharedBridge({ trustedOrigins: ['https://*.preview.example.com'] });   // adapter-only apps
```

Pair it with `verifyLaunchToken(token, { appId, issuer: [...], jwksUrl })`
on your backend for that environment.

## 11. Navigation

```ts
const navigate = useCherryNavigate();          // or cherry.navigate
await navigate.userProfile('alice.sol');        // wallet address, domain or @handle  (needs navigate:profile)
await navigate.openRoom('@solminer');           // roomId or @handle                  (needs navigate:room)
```

The SDK sends `navigate.userProfile` / `navigate.openRoom` and, if an older
host rejects that name (older inline hosts only know `navigate.profile` /
`navigate.room`), retries once with the alias and remembers which one worked.

## 12. Sharing & blinks

Let the person share a read-only **result** card into a chat:

```ts
const share = useCherryShare();                 // or cherry.share(...)
const res = await share({
  route: '/result',                // route the receiver's card opens (default '/')
  params: { score: 9000 },         // ≤ 4 KB JSON, depth ≤ 8 — signed into the card's token
  height: 'medium',                // 'compact' | 'medium' | 'tall'
  initialHeight: 180,              // optional exact first-paint px (≤ bucket max)
  caption: 'I scored 9000!',
  previewable: true,               // your route renders from params alone → live preview in the picker
});
if (res.shared) record(res.messageId, res.roomId);
```

A mini-app can only share **itself** (the host takes the identity from your
session); shared cards are read-only (`interactive: false`,
`source: 'user_share'`) and need the `inline:render` permission. Blinks —
inline cards, params, resizing, callbacks, live updates, SSR, limits — are
covered in **[BLINKS.md](./BLINKS.md)**.

## 13. Monetization & on-chain attribution

**Cherry measures, you declare, Cherry takes 10% of your revenue.** In the
developer portal you say how your app makes money: **sales** (users pay you:
items, entry, subscriptions, tips: all of it is revenue), **commission** (you
keep a share of what users move: swaps, trading, marketplaces, betting,
resale; you state the share), **mixed** (state the effective share), or
**free**. Cherry measures the app's volume itself: what leaves users' wallets
in transactions they sign in Cherry. Each week it bills
`volume × your declared share × 10%` (`CHERRY_REVENUE_SHARE_BPS = 1000`).

You pay it either way, and the two add up:

1. **Inside your own transactions (preferred).** Wherever you take your money,
   add Cherry's 10% of it in the same transaction, tagged with your app id.
   Works with any provider: you know your fee, so you add Cherry's part next to it.
   Every leg Cherry sees is credited to your app.
2. **Weekly invoice** for whatever was not paid that way, payable in USDC from
   the portal (one click with a wallet, Solana Pay, or a transfer from your
   owner wallet).

Your declared share is part of the Developer Agreement; Cherry compares it
with what it measures and re-bills differences.

### The app reference key (all models)

Every transaction your app produces should carry your **reference key**:
`sha256("cherry:app:" + appId)` (UTF-8, 32 bytes) as a **read-only, non-signer**
account appended to **one** instruction (Solana Pay "reference" style). It is
how anyone on Dune attributes revenue and volume to your app: query
transactions whose account keys include your reference address. It is
attribution only: Cherry does not bill from it, so leaving it out never
lowers a fee (volume is metered by the host's own transaction check).

```ts
import { getAppReferenceKey, withAppReference } from '@cherrydotfun/miniapp-sdk/solana'; // or '/kit'
import { getAppReferenceAddress } from '@cherrydotfun/miniapp-sdk';                        // base58, no Solana lib

getAppReferenceAddress('example-app'); // '3EY8K5SVayw9Rx7sSKf1p4Q5cDeVoga6T6BRyLZZ2wZV'

const ix = withAppReference(SystemProgram.transfer({ fromPubkey, toPubkey, lamports }), cherry.appId!);
```

- Append it to an instruction **you** control that ignores trailing accounts:
  a System transfer, or an SPL `TransferChecked` from a normal wallet (not a
  multisig). **Never** append it to DEX/aggregator/program instructions —
  they may read trailing accounts. For swaps, build from the protocol's
  instructions endpoint (e.g. Jupiter `/swap-instructions`) and put the key on
  your own transfer/fee instruction in the same transaction.
- Keep it a static account (not in an address lookup table).
- Other languages: `base58(sha256(b"cherry:app:" + app_id.encode()))`.
- Use the **verified** `app_id`/`aud` on your server, or `cherry.appId` in the client.

### Sales — `buildCherryFeeSplit`

The user pays you; split the payment in the same transaction: 90% to you, 10% to Cherry.
Synchronous; returns the instructions to add to your transaction.

```ts
import { buildCherryFeeSplit } from '@cherrydotfun/miniapp-sdk/solana';

// SOL: 0.1 SOL → developer 0.07, Cherry 0.03
const ixs = buildCherryFeeSplit({
  payer: cherry.wallet.publicKey!,     // who pays and signs
  developer: DEV_WALLET,               // your receiving wallet
  treasury: CHERRY_TREASURY,           // from the developer portal — never hard-code a guess
  amount: 100_000_000n,                // bigint, base units (lamports)
  appId: cherry.appId!,                // attaches the reference key
});
const tx = new Transaction({ feePayer: new PublicKey(cherry.wallet.publicKey!), recentBlockhash }).add(...ixs);

// SPL (e.g. USDC, 6 decimals): TransferChecked between associated token accounts,
// preceded by idempotent ATA creation for developer and treasury
buildCherryFeeSplit({ payer, developer: DEV_WALLET, treasury: CHERRY_TREASURY,
  amount: 10_000_000n, mint: USDC_MINT, decimals: 6, appId });
```

| Param | Type | Default | |
|---|---|---|---|
| `payer` | `PublicKey \| string` (kit: address or a kit `TransactionSigner`) | — | pays and signs; for SPL, owns the source ATA and funds missing ATAs |
| `developer` | `PublicKey \| string` | — | wallet (owner) address, not a token account |
| `treasury` | `PublicKey \| string` | — | Cherry treasury from the portal |
| `amount` | `bigint` | — | total, base units, > 0, fits u64 |
| `mint` | `PublicKey \| string` | SOL | omit for native SOL |
| `decimals` | `number` | — | required with `mint` |
| `cherryBps` | `number` | `1000` | 0–10000 |
| `tokenProgram` | `PublicKey \| string` | SPL Token | pass Token-2022's id for Token-2022 mints |
| `createAssociatedTokenAccounts` | `boolean` | `true` | prepend `CreateIdempotent` for developer & treasury ATAs |
| `appId` | `string` | — | attach the reference key to the first transfer |

Math is exact: Cherry gets `floor(amount × cherryBps / 10000)`, the developer
gets the remainder (`splitCherryFee(amount, bps)` returns both, for display).
A leg that rounds to zero is omitted. SOL sent to a brand-new account must be
at least rent-exempt (~0.00089 SOL). The kit entry has the same function with
kit types (`payer` is an address, or a kit `TransactionSigner`, which is then
attached to the instructions).

### Commission — `buildCherryShareTransfer`

Your fee is collected somewhere else: a protocol's integrator or referral
parameter, your own program, a spread. Take your usual fee 10% lower there
and add Cherry's share as one transfer from the user in the same transaction,
so the user pays the same in total:

```ts
import { buildCherryShareTransfer, cherryShareOf } from '@cherrydotfun/miniapp-sdk/solana'; // or '/kit'

const yourFee = (amountIn * 100n) / 10_000n;   // your 1% of this trade
const cherry = cherryShareOf(yourFee);          // Cherry's 10% of it
// charge (yourFee - cherry) through your usual mechanism, and add:
tx.add(...buildCherryShareTransfer({
  payer: cherry.wallet.publicKey!,
  treasury: CHERRY_TREASURY,
  amount: cherry,                               // Cherry's share itself, base units
  mint: USDC_MINT, decimals: 6,                 // omit both for SOL
  appId: cherry.appId!,                          // how Cherry credits it to your app
}));
```

Same parameters as `buildCherryFeeSplit` minus `developer` and `cherryBps`;
`amount` is Cherry's share itself. Where a fee accrues and is claimed later
(so it cannot be split per transaction), skip this: the weekly invoice covers it.

### Free

Nothing to build. If you start charging users, change the revenue model in
the portal first.

## 14. Listing requirements & the automated listing test

Listing is self-serve: an automated test runs against your URL instead of a
manual review. It checks:

| Check | How to pass |
|---|---|
| **HTTPS** | Serve the registered origin over HTTPS with a valid certificate. |
| **Framing** | `Content-Security-Policy: frame-ancestors https://chat.cherry.fun https://cherry.fun https://*.cherry.fun`; no `X-Frame-Options: DENY/SAMEORIGIN` ([§9](#9-hosting--framing-requirements)). |
| **Handshake within 5 s** | Call `cherry.init()` (or mount `<CherryMiniAppProvider>`) immediately on load — the SDK answers `cherry:init` with `cherry:ready`. Don't gate it behind splash screens, asset loading, a login or a wallet check. |
| **No connect / sign prompt on load** | No wallet-connect UI, no `signMessage`/`signTransaction` on startup. The person is signed in already ([§5](#5-seamless-auth--backend-token-verification)). Ask for a signature only when they act. |
| **Backend verifies the token** | Your backend verifies the launch token with all the [required checks](#required-checks) and rejects anything that fails (bad signature, wrong `aud`/`app_id`, expired). |
| **Context applied** | The app uses what the host gives it: the person is treated as signed in, Cherry's wallet is the wallet (not your standalone connect flow), and room/user context shows where relevant. |

Also expected: transactions within your tier's limits, the reference key on
every transaction, a privacy policy and terms (below), and an app that works
in both the web iframe and the mobile WebView.

## 15. Terms of Service & privacy expectations

Your listing links your own Terms and Privacy Policy; Cherry's developer terms
in the portal govern. In short (not legal advice):

- **Data you receive**: wallet addresses, Cherry ID, display name, avatar,
  room id/title/member count. Use it only to run your app; say so in your
  privacy policy. Don't sell it, don't use it to track people across apps,
  and delete it on request.
- **Tokens are credentials**: never log launch tokens, never put them in URLs
  you generate, never forward them to third parties; don't store them beyond
  verification.
- **Be honest about money**: show prices and fees (including Cherry's share
  if you pass it on) before the person signs. Build exactly the transaction you
  describe; no hidden transfers, approvals or authority changes.
- **No impersonation** of Cherry or other brands; no prompts that imitate
  Cherry's own wallet UI.
- **Security contact**: publish one, and fix reported issues promptly.

## 16. Troubleshooting

| Symptom | Cause & fix |
|---|---|
| `cherry:init not received within 10000ms` | `init()` called outside Cherry, or the host is not trusted. The error names any ignored origin — add staging hosts via `trustedOrigins` ([§10](#10-bridge-security--trusted-origins)). |
| Console: `Ignored a Cherry bridge message from untrusted origin …` | You're running inside a Cherry build on a non-default origin. Pass it in `trustedOrigins`. |
| Blank iframe / `Refused to frame … frame-ancestors` | Missing/incorrect CSP `frame-ancestors`, or `X-Frame-Options` present ([§9](#9-hosting--framing-requirements)). |
| Logged in standalone but not inside Cherry web | Third-party cookies are blocked in the iframe — use the launch token + `Authorization` header. |
| `isInsideCherry()` false inside Cherry web | Your router stripped `?cherry_embed=1`. Keep it (or check before routing). |
| Backend: `ISSUER_MISMATCH` | Token from another environment — pass `issuer` (and `jwksUrl`) for staging. |
| Backend: `AUDIENCE_MISMATCH` / `APP_ID_MISMATCH` | Wrong `appId` (use your mini-app id from the portal), or the token is for another app. |
| Backend: `TOKEN_EXPIRED` | Launch tokens live 5 minutes — exchange once at startup for your own session. |
| Backend: `JWKS_UNAVAILABLE` | Couldn't reach `https://chat.cherry.fun/.well-known/jwks.json` from your server — check egress; answer 503, never accept the token. |
| `POLICY_DENIED` | Over the tier's limit or a forbidden instruction — see `err.policyCode` ([§8](#8-errors-wallet-limits--policy-codes)). |
| `Permission denied: wallet:sign not granted` | Grant the permission in the portal; check `cherry.permissions` (`reach: 'external'` grants only approved permissions). |
| `WALLET_CHANGED` / `NOT_A_SIGNER` | Transaction built for the wrong wallet — rebuild for the current one ([§7](#which-address-to-build-for)). |
| Wallet says "transaction not properly formed" | Stale/fake blockhash or wrong fee payer — rebuild with a fresh blockhash and the Cherry wallet as fee payer. |
| Navigation does nothing in a blink | Old host — the SDK retries with the alias automatically; make sure you have `navigate:profile` / `navigate:room`. |

## 17. API reference

### `@cherrydotfun/miniapp-sdk`

```ts
class CherryMiniApp {
  constructor(options?: { initTimeout?: number /* ms, 10_000 */; strict?: boolean; trustedOrigins?: readonly string[] });
  init(): Promise<void>;
  readonly isReady: boolean;
  readonly user: CherryUser;                 // throws before init
  readonly room: CherryRoom;                 // throws before init
  readonly launchToken: string;              // throws before init
  readonly blink: CherryBlinkContext | null;
  readonly context: CherryContext | null;   // display fields + user follow the host live
  onContextChange(listener: (context: CherryContext) => void): () => void;   // first resolution + every change
  readonly users: {
    me(): Promise<MiniAppPublicProfile>;
    get(cherryId: string): Promise<MiniAppPublicProfile>;
    followers(cherryId: string, options?: { cursor?: string; limit?: number }): Promise<MiniAppUserPage>;
    following(cherryId: string, options?: { cursor?: string; limit?: number }): Promise<MiniAppUserPage>;
    relationship(cherryId: string): Promise<{ following: boolean; followedBy: boolean }>;
  };                                         // rejects with CherryApiError
  readonly appId: string | null;
  readonly cherryId: string | null;
  readonly paymentWallet: string | null;
  readonly paymentWalletKind: PaymentWalletKind | null;
  readonly paymentWalletSetBy: PaymentWalletSetBy | null;
  readonly permissions: readonly string[];
  hasPermission(permission: string): boolean;
  readonly reach: CherryReach | null;
  readonly tier: CherryAppTier | null;
  readonly mode: CherryLaunchMode | null;
  readonly claims: Readonly<Partial<LaunchTokenPayload>> | null;   // unverified
  readonly wallet: {
    readonly publicKey: string | null;
    signTransaction(tx: unknown, options?: { label?: string }): Promise<Uint8Array>;
    signAllTransactions(txs: unknown[], options?: { label?: string }): Promise<Uint8Array[]>;
    signAndSendTransaction(tx: unknown, options?: { label?: string }): Promise<string>;
    signMessage(message: Uint8Array): Promise<Uint8Array>;
  };
  getPublicKey(): string | null;
  readonly navigate: { userProfile(identifier: string): Promise<void>; openRoom(identifier: string): Promise<void> };
  share(options?: ShareBlinkOptions): Promise<ShareBlinkResult>;
  on(event: 'suspended' | 'resumed' | 'walletDisconnected' | 'blink:update', listener: (data: unknown) => void): void;
  off(event: CherryMiniAppEvent, listener: (data: unknown) => void): void;
  destroy(): void;
}

function verifyLaunchToken(token: string, options: VerifyLaunchTokenOptions): Promise<LaunchTokenPayload>;
type VerifyLaunchTokenOptions = {
  appId: string;                              // `expectedAppId` (0.1.21 name) still accepted, deprecated
  issuer?: string | readonly string[];        // default 'https://chat.cherry.fun'
  jwksUrl?: string;                           // default 'https://chat.cherry.fun/.well-known/jwks.json'
  jwks?: JSONWebKeySet;                       // local key set instead of jwksUrl
  origin?: string;                            // `expectedOrigin` still accepted, deprecated
  requireAudience?: boolean;                  // default false
  scope?: LaunchTokenScope | readonly LaunchTokenScope[];   // 'launch' | 'inline' | 'fullscreen'
  clockTolerance?: number;                    // seconds, default 30
};
class LaunchTokenError extends Error { readonly code: LaunchTokenErrorCode; readonly cause?: unknown }

function readCherryDisplayContext(url?: string | URL): CherryDisplayContext;   // before init / SSR: cherry_lang, cherry_theme, token locale
function applyCherryContextToDocument(context: { locale?, colorScheme? } | null, target?: Document): void;   // opt-in
const CHERRY_LOCALES: readonly ['en', 'ru', 'de', 'fr', 'es', 'id', 'vi', 'zh', 'ja', 'ko'];
class CherryApiError extends Error { readonly code: CherryApiErrorCode; readonly status: number | null; readonly serverCode: string | null }
function cherryApiOrigin(token: string, trustedOrigins?: readonly string[]): string;   // the API origin a token may be sent to; throws UNTRUSTED_ISSUER

function isInsideCherry(options?: { strict?: boolean }): boolean;
function getCherryEnvironment(options?: { strict?: boolean }): { isEmbedded: boolean; platform: CherryPlatform };
function detectPlatform(options?: { strict?: boolean }): 'webview' | 'iframe' | 'standalone';

class BridgeError extends Error {
  readonly code: BridgeErrorCode | string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly policyCode: CherryPolicyCode | string | undefined;
  readonly reason: string | undefined;
  readonly policy: CherryPolicyDenial | null;
}
function getBridgeError(error: unknown): BridgeError | null;
function isPolicyDenied(error: unknown): boolean;

function getAppReferenceKeyBytes(appId: string): Uint8Array;   // sha256("cherry:app:" + appId)
function getAppReferenceAddress(appId: string): string;        // base58
function splitCherryFee(amount: bigint, cherryBps?: number /* 1000 */): { developerAmount: bigint; cherryAmount: bigint };
const CHERRY_REVENUE_SHARE_BPS = 1000;
const CHERRY_APP_REFERENCE_PREFIX = 'cherry:app:';

// Advanced
class Bridge { constructor(options?: BridgeOptions); request(method: string, params?: Record<string, unknown>): Promise<unknown>; readonly hostOrigin: string | null; readonly transport: 'webview' | 'iframe' | 'none'; readonly ignoredOrigins: readonly string[]; readonly trustedOrigins: readonly string[]; readonly hostContext: Readonly<Record<string, unknown>> | null; isTrustedOrigin(origin: string): boolean; configure(options: BridgeOptions): void; /* … */ }
function getSharedBridge(options?: { trustedOrigins?: readonly string[]; strict?: boolean }): Bridge;
function destroySharedBridge(): void;
function isTrustedHostOrigin(origin: string, extra?: readonly string[]): boolean;
const DEFAULT_TRUSTED_HOST_ORIGINS: readonly string[];
function getCherryCustomAuthConfig(cherry: CherryMiniApp): { token: string; jwksUrl: string; issuer: string };
const CHERRY_JWKS_URL: string, CHERRY_ISSUER: string, BRIDGE_VERSION: 2;
```

Types: `CherryContext`, `CherryDisplayContext`, `CherryLocale`,
`CherryColorScheme`, `CherryHostPlatform`, `CherrySafeArea`,
`CherryHostContext` (the wire object), `MiniAppPublicProfile`,
`MiniAppUserSummary`, `MiniAppUserPage`, `MiniAppRelationship`,
`CherryApiErrorCode`, `CherryUsersApi`, `CherryUserPageOptions`,
`CherryContextListener`, `CherryLaunchMode`, `CherryAppTier`, `CherryReach`,
`PaymentWalletKind`, `PaymentWalletSetBy`, `LaunchTokenPayload`,
`LaunchTokenScope`, `LaunchTokenErrorCode`, `BridgeErrorCode`,
`CherryPolicyCode`, `CherryPolicyDenial`, `BridgeOptions`, `BridgeTransport`,
`CherryFeeSplitAmounts`, `CherryUser`, `CherryRoom`, `CherryBlinkContext`,
`CherryNavigate`, `CherryWallet`, `ShareBlinkOptions`, `ShareBlinkResult`,
`CherryEnvironment`, `CherryPlatform`, `DetectPlatformOptions`,
`CherryMiniAppOptions`, `CherryMiniAppEvent`, `CherryCustomAuthConfig`, and the
bridge message types.

### `@cherrydotfun/miniapp-sdk/react`

```ts
function CherryMiniAppProvider(props: { children: ReactNode; initTimeout?: number; strict?: boolean; trustedOrigins?: readonly string[] }): JSX.Element;
function useCherryMiniApp(): { user: CherryUser | null; room: CherryRoom | null; launchToken: string | null; context: CherryContext | null; isReady: boolean; error: Error | null };
function useCherryContext(): CherryContext | null;                 // re-renders on cherry:context
function useCherryDisplayContext(): CherryDisplayContext;           // never null: the URL before the handshake
function useCherryUser(): MiniAppPublicProfile | null;              // context.user
function useCherryApp(): CherryMiniApp | null;
function useCherryWallet(): { publicKey: string | null; connected: boolean; signTransaction; signAllTransactions; signMessage; signAndSendTransaction };
function useCherryNavigate(): CherryNavigate;
function useCherryShare(): (options?: ShareBlinkOptions) => Promise<ShareBlinkResult>;
function useCherryBlink(): CherryBlinkContext | null;
function useCherryEnvironment(options?: { strict?: boolean }): CherryEnvironment;   // no provider needed
```

Re-exports `CherryMiniApp`, `verifyLaunchToken`, `LaunchTokenError`,
`BridgeError`, `getBridgeError`, `isPolicyDenied`, `readCherryDisplayContext`,
`applyCherryContextToDocument`, `CherryApiError`, the env helpers and types.

### `@cherrydotfun/miniapp-sdk/solana` (web3.js)

```ts
class CherryWalletAdapter extends BaseWalletAdapter { constructor(config?: { trustedOrigins?: readonly string[]; strict?: boolean }) }
const CherryWalletAdapterName: WalletName<'Cherry'>;
function getAppReferenceKey(appId: string): PublicKey;
function withAppReference(instruction: TransactionInstruction, appId: string): TransactionInstruction;
function buildCherryFeeSplit(params: CherryFeeSplitParams): TransactionInstruction[];   // synchronous
function buildCherryShareTransfer(params: CherryShareTransferParams): TransactionInstruction[];   // Cherry's share alone
interface CherryFeeSplitParams {
  payer: PublicKey | string; developer: PublicKey | string; treasury: PublicKey | string;
  amount: bigint; mint?: PublicKey | string; decimals?: number; cherryBps?: number;
  tokenProgram?: PublicKey | string; createAssociatedTokenAccounts?: boolean; appId?: string;
}
// + splitCherryFee, cherryShareOf, CHERRY_REVENUE_SHARE_BPS
```

### `@cherrydotfun/miniapp-sdk/kit` (@solana/kit)

```ts
function createCherrySigner(cherry: CherryMiniApp): CherryTransactionSigner;   // after init()
function getAppReferenceKey(appId: string): Address;
function withAppReference<T extends { readonly accounts?: readonly unknown[] }>(instruction: T, appId: string): T;
function buildCherryFeeSplit(params: CherryKitFeeSplitParams): CherryKitInstruction[];   // synchronous
function buildCherryShareTransfer(params: CherryKitShareTransferParams): CherryKitInstruction[];
interface CherryKitFeeSplitParams {
  payer: { address: string } | string;        // a TransactionSigner is attached to the instructions
  developer: string; treasury: string; amount: bigint; mint?: string; decimals?: number;
  cherryBps?: number; tokenProgram?: string; createAssociatedTokenAccounts?: boolean; appId?: string;
}
// + splitCherryFee, cherryShareOf, CHERRY_REVENUE_SHARE_BPS
```

## 18. Bridge protocol (advanced)

`postMessage`, protocol version 2. Prefer the SDK methods over raw requests.

| Message | Direction | |
|---|---|---|
| `cherry:init { version, token, capabilities, context? }` | host → app | fullscreen handshake; re-sent until acked |
| `cherry:ready { version }` | app → host | ack (the SDK re-acks a repeated init) |
| `cherry:context { context }` | host → app | the full context whenever the language, scheme or safe area changes (a missing `user` keeps the last one) |
| `cherry:request { id, method, params }` | app → host | |
| `cherry:response { id, result \| error: { code, message, data? } }` | host → app | |
| `cherry:event { event, payload }` | host → app | `suspended`, `resumed`, `walletDisconnected`, `blink:update`, … |

Methods: `wallet.connect`, `wallet.signMessage`, `wallet.signTransaction`,
`wallet.signTransactions`, `wallet.signAndSendTransaction`,
`navigate.userProfile` (alias `navigate.profile`), `navigate.openRoom` (alias
`navigate.room`), `host.share`, and inline: `host.init`, `host.resize`,
`host.callback`, `host.requestExpand`. The three transaction methods take an
optional `label` (string, ≤ 80 characters) beside `transaction(s)`. Raw access:
`getSharedBridge().request('host.resize', { height: 180 })`.

**Context v2** (`cherry:init.context`, `cherry:context.context`, the
`host.init` answer's `context`):

```ts
{ v: 2, locale: string, colorScheme: 'dark' | 'light', brand: string,
  platform: 'ios' | 'android' | 'web', appVersion?: string,
  safeArea: { top: number, right: number, bottom: number, left: number },   // CSS px
  user?: MiniAppPublicProfile }
```

Hosts also append `cherry_lang=<locale>&cherry_theme=<dark|light>` to the app
URL's query string (existing parameters are kept).

## 19. Migration 0.1.21 → 0.1.24

No breaking API changes; review these behaviour changes:

1. **Bridge origin checks.** In the web iframe the SDK now ignores messages
   that aren't from `window.parent` on `https://chat.cherry.fun`,
   `https://cherry.fun` or `https://*.cherry.fun`, and posts only to the locked
   host origin. Production Cherry needs no change. For staging/local Cherry
   builds pass `trustedOrigins`. Raw `getSharedBridge().request(...)` calls made
   before the handshake are now queued until the host's first message.
2. **`verifyLaunchToken`**: use `{ appId }` (`expectedAppId` still works).
   It now also checks `iss` (pass `issuer` for non-production), `aud` when
   present, requires `exp`, allows ±30 s clock skew, and throws
   `LaunchTokenError` with a `code`. The app-id check accepts `mini_app_id`
   too, so blink/bot launch tokens verify with your own mini-app id. The JWKS
   is cached instead of refetched per call. Plan to set
   `requireAudience: true` once Cherry announces `aud` on all tokens.
3. **`strict`** passed to `CherryMiniApp` / the provider now also governs the
   bridge transport (it was accepted but ignored before).
4. **Navigation** retries with `navigate.profile` / `navigate.room` on hosts
   that reject the canonical names.
5. **New**: `cherry.context` and per-field getters, `useCherryContext()`;
   context v2 — `locale`, `colorScheme`, `brand`, `platform`, `appVersion`,
   `safeArea` with live `cherry:context` updates (`onContextChange`,
   `useCherryDisplayContext()`, `readCherryDisplayContext()`,
   `applyCherryContextToDocument()`); the public profile — `context.user`,
   `useCherryUser()`, `cherry.users`;
   `BridgeError.data/policyCode/policy/reason`, `getBridgeError`,
   `isPolicyDenied`, reference-key and fee-split helpers, `trustedOrigins`
   options, `CherryWalletAdapter` config.
6. A top-level page outside Cherry no longer posts bridge messages to itself.
7. Optional peer dependency `@solana/kit` (types only, for the `/kit` helpers).

See [CHANGELOG.md](./CHANGELOG.md).

## 20. AI-assisted integration

This package ships a Claude Code / Codex skill —
[`skills/cherry-miniapp-integration`](./skills/cherry-miniapp-integration/SKILL.md) —
that walks an agent through integrating the SDK into an existing app (see
[skills/README.md](./skills/README.md) to install it). Tell your agent:
"Integrate the Cherry Mini-App SDK into this project" and point it at this
README.

## 21. Releasing the SDK

Bump `version` in `package.json`, update `CHANGELOG.md`, and push to `main`.
The `Publish SDK` workflow runs typechecks, tests, and the build, then publishes
the version if it is not already on npm and creates the matching `v<version>` tag.
You can also rerun it with GitHub Actions **Run workflow** on `main`.

Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
with GitHub Actions OIDC; no `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret is needed.
For `@cherrydotfun/miniapp-sdk`, the npm trusted publisher must match:

- Organization: `cherrydotfun`
- Repository: `miniapp-sdk`
- Workflow filename: `publish.yml`
- Environment: leave empty (the workflow does not use a GitHub environment)

The publishing job uses a GitHub-hosted runner, Node.js 24, npm 11 (OIDC requires
npm 11.5.1 or newer), and `id-token: write`. Authentication failures fail the job
so a skipped publication cannot appear successful.

## License

MIT
