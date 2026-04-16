---
name: cherry-miniapp-integration
description: "Use when integrating @cherrydotfun/miniapp-sdk into an existing web3 application — adding Cherry embed support, wallet bridge, environment detection, and conditional UI rendering for apps that run both standalone and inside Cherry messenger."
---

# Cherry Mini-App SDK Integration

## Overview

Step-by-step guide for integrating `@cherrydotfun/miniapp-sdk` into an existing web3 application so it works both as a standalone app and embedded inside Cherry messenger (WebView on mobile, iframe on web).

The SDK supports two Solana integration paths:
- **@solana/web3.js** — legacy wallet-adapter (`sdk/solana`)
- **@solana/kit** — modern TransactionSigner (`sdk/kit`)

## When to Use

- Adding Cherry embed support to an existing Solana dApp
- Making a game or utility embeddable inside Cherry chat rooms
- Migrating from the legacy `cherry-wallet-bridge` protocol to SDK v2
- Setting up conditional UI (hide/show elements) based on embed context

## Prerequisites

The target app must be:
- A web application (React, Vue, vanilla JS, etc.)
- Using Solana (either @solana/web3.js or @solana/kit)
- Deployable as a static site or SPA accessible via URL

## Integration Checklist

Follow these steps IN ORDER. Mark each as completed before moving to the next.

### Step 1: Discovery — Understand the Target App

Research the codebase to answer:

1. **Framework**: React? Vue? Vanilla? Next.js? Vite?
2. **Solana SDK**: `@solana/web3.js` (legacy) or `@solana/kit` (modern)?
3. **Wallet integration**: wallet-adapter? custom? Which wallets?
4. **UI elements to hide in embed**: What should NOT appear inside Cherry?
   - Wallet connect button (Cherry provides the wallet)
   - App header/navigation bar (Cherry has its own)
   - Footer, sidebar, landing/splash screen
5. **Entry point**: Where does the app mount? (`main.tsx`, `App.tsx`)
6. **Build system**: Vite? Webpack?

ASK THE USER:
```
When this app runs inside Cherry, which UI elements should be hidden?
Common choices:
- Wallet connect button/modal
- Top navigation/header
- Footer
- Sidebar
- Landing/splash screen

Which Solana SDK does this project use?
- @solana/web3.js (with wallet-adapter)
- @solana/kit (modern)
```

### Step 2: Install SDK

```bash
npm install @cherrydotfun/miniapp-sdk
```

Install peer deps based on Solana SDK choice:

```bash
# For @solana/web3.js projects
npm install @solana/wallet-adapter-base @solana/web3.js

# For @solana/kit projects — no additional deps needed
```

### Step 2b: Server Configuration — CORS & CSP (Web iframe only)

> Skip if the mini-app will only be embedded in Cherry **mobile** (WebView). Required for Cherry **web** (iframe).

The browser blocks iframes and API calls unless the mini-app's server explicitly allows them.

#### Allow Cherry to embed the app (`frame-ancestors`)

Add to **every HTML response** from the mini-app's server:

```
Content-Security-Policy: frame-ancestors 'self' https://chat.cherry.fun
```

Make sure there is **no** `X-Frame-Options: DENY` or `X-Frame-Options: SAMEORIGIN` without override (these silently block the iframe in Chrome/Firefox).

Framework-specific examples:

```ts
// Next.js — next.config.ts
async headers() {
  return [{
    source: '/(.*)',
    headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self' https://chat.cherry.fun" }],
  }];
}
```

```ts
// Express
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://chat.cherry.fun");
  next();
});
```

```nginx
# Nginx
add_header Content-Security-Policy "frame-ancestors 'self' https://chat.cherry.fun" always;
```

#### Backend API CORS

Usually **no changes needed** — the iframe runs on the mini-app's own origin, so API calls are same-origin. Only act if:

- The backend has an explicit `Origin` allowlist → make sure `https://yourgame.example` is in it
- The backend checks `Referer` for CSRF protection → verify iframe requests still pass

#### Checklist

| | Requirement |
|---|---|
| ✅ | `frame-ancestors … https://chat.cherry.fun` on all HTML responses |
| ✅ | No `X-Frame-Options: DENY/SAMEORIGIN` without override |
| ✅ | Backend `Origin` allowlist includes the mini-app's own domain |

### Step 3: Environment Detection — Conditional Rendering

Add environment detection at the TOP of the component tree, BEFORE any provider:

```tsx
import { isInsideCherry, getCherryEnvironment } from '@cherrydotfun/miniapp-sdk';

const embedded = isInsideCherry();
const { platform } = getCherryEnvironment();
// platform: 'webview' (mobile) | 'iframe' (web) | 'standalone'
```

React hook (no provider needed):
```tsx
import { useCherryEnvironment } from '@cherrydotfun/miniapp-sdk/react';

function App() {
  const { isEmbedded, platform } = useCherryEnvironment();
}
```

**Strict mode** — opt in once all Cherry hosts your users run inject `window.__cherry` (WebView) or append `cherry_embed=1` (iframe). Prevents false positives in wallet in-app browsers:

```tsx
// All detection APIs accept { strict: true }
isInsideCherry({ strict: true });
const { isEmbedded } = useCherryEnvironment({ strict: true });
<CherryMiniAppProvider strict={true}>...</CherryMiniAppProvider>
new CherryMiniApp({ strict: true });
```

Without strict mode, fallbacks (`ReactNativeWebView`, `window.parent !== window`) are active for backward compatibility with older Cherry builds.

### Step 4a: Wallet — @solana/web3.js Path

For projects using `@solana/wallet-adapter-react`:

```tsx
import { CherryWalletAdapter } from '@cherrydotfun/miniapp-sdk/solana';
import { isInsideCherry } from '@cherrydotfun/miniapp-sdk';

function getWallets() {
  if (isInsideCherry()) {
    return [new CherryWalletAdapter()];
  }
  return [new PhantomWalletAdapter(), new SolflareWalletAdapter()];
}

const wallets = useMemo(() => getWallets(), []);
const embedded = isInsideCherry();

<WalletProvider wallets={wallets} autoConnect={embedded}>
  {embedded ? <AutoSelectCherry>{children}</AutoSelectCherry> : children}
</WalletProvider>
```

Auto-select helper:
```tsx
function AutoSelectCherry({ children }: { children: ReactNode }) {
  const { select, wallets } = useWallet();
  useEffect(() => {
    const cherry = wallets.find(w => w.adapter.name === 'Cherry');
    if (cherry) select(cherry.adapter.name);
  }, [wallets, select]);
  return <>{children}</>;
}
```

### Step 4b: Wallet — @solana/kit Path

For projects using `@solana/kit`:

```tsx
import { CherryMiniApp } from '@cherrydotfun/miniapp-sdk';
import { createCherrySigner } from '@cherrydotfun/miniapp-sdk/kit';

const cherry = new CherryMiniApp();
await cherry.init();

// TransactionSigner — use with @solana/kit transaction builders
const signer = createCherrySigner(cherry);

// Sign transactions
const [signed] = await signer.signTransactions([{ messageBytes, signatures: {} }]);

// Sign messages
const [signature] = await signer.signMessages([messageBytes]);
```

With React:
```tsx
import { CherryMiniAppProvider, useCherryApp } from '@cherrydotfun/miniapp-sdk/react';
import { createCherrySigner } from '@cherrydotfun/miniapp-sdk/kit';

function MyComponent() {
  const app = useCherryApp();

  const handleSign = async () => {
    const signer = createCherrySigner(app);
    const [signed] = await signer.signTransactions([{ messageBytes, signatures: {} }]);
  };
}
```

### Step 5: Cherry Provider — User & Room Context

Wrap the embedded app with `CherryMiniAppProvider`:

```tsx
import { CherryMiniAppProvider } from '@cherrydotfun/miniapp-sdk/react';

function Root() {
  const embedded = isInsideCherry();

  if (embedded) {
    return (
      <CherryMiniAppProvider>
        <App />
      </CherryMiniAppProvider>
    );
  }

  return <App />; // standalone mode
}
```

Access context in components:
```tsx
import { useCherryMiniApp, useCherryWallet } from '@cherrydotfun/miniapp-sdk/react';

function GameUI() {
  const { user, room, launchToken, isReady } = useCherryMiniApp();
  const { publicKey, signTransaction, signAllTransactions, signMessage } = useCherryWallet();
}
```

### Step 6: Hide Standalone-Only UI

```tsx
function Header() {
  const { isEmbedded } = useCherryEnvironment();
  if (isEmbedded) return null;
  return <nav>...</nav>;
}

function WalletButton() {
  const { isEmbedded } = useCherryEnvironment();
  if (isEmbedded) return null;
  return <WalletMultiButton />;
}
```

### Step 7: Navigation — Cherry Host Integration

```tsx
import { useCherryNavigate } from '@cherrydotfun/miniapp-sdk/react';

function UserList() {
  const navigate = useCherryNavigate();
  const { isEmbedded } = useCherryEnvironment();

  const handleUserClick = (address: string) => {
    if (isEmbedded) {
      navigate.userProfile(address); // wallet, domain, or @handle
    } else {
      router.push(`/profile/${address}`);
    }
  };
}
```

### Step 8: Backend Token Verification (Optional)

```ts
import { verifyLaunchToken } from '@cherrydotfun/miniapp-sdk';

const payload = await verifyLaunchToken(token, {
  expectedAppId: 'your-app-id',
  // jwksUrl defaults to https://chat.cherry.fun/.well-known/jwks.json
});
// payload.sub — verified wallet address
```

### Step 9: Verify Integration

Test both modes:

**Standalone:**
- App works normally with standard wallets
- No Cherry-specific UI appears

**Embedded (in Cherry):**
- Wallet auto-connects
- User/room context available
- signTransaction/signMessage work
- Hidden UI elements don't appear
- Navigation opens Cherry screens

**Web iframe specifically:**
- App loads inside Cherry web (not blocked by `X-Frame-Options` / CSP)
- Browser DevTools show no `Refused to frame` errors
- API calls from within the iframe succeed (check Network tab for CORS errors)

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Using `Buffer` in browser code | Use `btoa()`/`atob()` or SDK helpers |
| `require()` in ESM context | Use top-level `import` |
| Importing `CherryWalletAdapter` from root | Use `from '@cherrydotfun/miniapp-sdk/solana'` |
| Checking `isInsideCherry()` after async init | Call synchronously at module load |
| Not auto-selecting Cherry wallet | Add `AutoSelectCherry` component |
| Showing wallet connect in embed | Wrap with `if (!isEmbedded)` |
| App doesn't load in Cherry web (iframe) | Missing `frame-ancestors https://chat.cherry.fun` CSP header |
| `X-Frame-Options: SAMEORIGIN` blocks embed | Remove or override with CSP `frame-ancestors` |
| `isInsideCherry()` false in Cherry web | Cherry web adds `cherry_embed=1` to URL — verify the param reaches the app; check if SPA strips query params |
| False positive in wallet in-app browser | Enable strict mode: `isInsideCherry({ strict: true })` |

## Lifecycle Events

```tsx
cherry.on('suspended', () => { /* user left chat — pause game */ });
cherry.on('resumed', () => { /* user came back — resume */ });
cherry.on('walletDisconnected', () => { /* handle gracefully */ });
```
