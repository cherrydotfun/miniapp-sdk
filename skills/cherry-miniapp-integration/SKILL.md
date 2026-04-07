---
name: cherry-miniapp-integration
description: "Use when integrating @cherrydotfun/miniapp-sdk into an existing web3 application — adding Cherry embed support, wallet bridge, environment detection, and conditional UI rendering for apps that run both standalone and inside Cherry messenger."
---

# Cherry Mini-App SDK Integration

## Overview

Step-by-step guide for integrating `@cherrydotfun/miniapp-sdk` into an existing web3 application so it works both as a standalone app and embedded inside Cherry messenger (WebView on mobile, iframe on web).

## When to Use

- Adding Cherry embed support to an existing Solana dApp
- Making a game or utility embeddable inside Cherry chat rooms
- Migrating from the legacy `cherry-wallet-bridge` protocol to SDK v2
- Setting up conditional UI (hide/show elements) based on embed context

## Prerequisites

The target app must be:
- A web application (React, Vue, vanilla JS, etc.)
- Using Solana wallet adapters (`@solana/wallet-adapter-*`) or direct `@solana/web3.js`
- Deployable as a static site or SPA accessible via URL

## Integration Checklist

Follow these steps IN ORDER. Mark each as completed before moving to the next.

### Step 1: Discovery — Understand the Target App

Research the codebase to answer:

1. **Framework**: React? Vue? Vanilla? Next.js? Vite?
2. **Wallet integration**: Which wallet adapter is used? Where is the WalletProvider?
3. **UI elements to hide in embed**: What should NOT appear when running inside Cherry?
   - Wallet connect button (Cherry provides the wallet)
   - App header/navigation bar (Cherry has its own)
   - Footer
   - Any standalone-only features
4. **Entry point**: Where does the app mount? (`main.tsx`, `App.tsx`, `index.tsx`)
5. **Build system**: Vite? Webpack? How are dependencies bundled?

ASK THE USER:
```
When this app runs inside Cherry, which UI elements should be hidden?
Common choices:
- Wallet connect button/modal
- Top navigation/header
- Footer
- Sidebar
- Landing/splash screen
```

### Step 2: Install SDK

```bash
npm install @cherrydotfun/miniapp-sdk
# peer deps (skip if already installed)
npm install @solana/wallet-adapter-base @solana/web3.js
```

### Step 3: Environment Detection — Conditional Rendering

Add environment detection at the TOP of the component tree, BEFORE any provider:

```tsx
import { isInsideCherry, getCherryEnvironment } from '@cherrydotfun/miniapp-sdk';

// Synchronous check — works before any async init
const embedded = isInsideCherry();
const { platform } = getCherryEnvironment();
// platform: 'webview' (Cherry mobile) | 'iframe' (Cherry web) | 'standalone'
```

Detection logic:
- `window.ReactNativeWebView` exists → `webview` (Cherry mobile app)
- `window.parent !== window` → `iframe` (Cherry web app)
- Otherwise → `standalone`

React hook (no provider needed):
```tsx
import { useCherryEnvironment } from '@cherrydotfun/miniapp-sdk/react';

function App() {
  const { isEmbedded, platform } = useCherryEnvironment();
  // Use to conditionally render UI
}
```

### Step 4: Wallet Provider — Cherry Adapter

Replace or extend the wallet configuration to use `CherryWalletAdapter` when embedded:

```tsx
import { CherryWalletAdapter } from '@cherrydotfun/miniapp-sdk';
import { isInsideCherry } from '@cherrydotfun/miniapp-sdk';

function getWallets() {
  if (isInsideCherry()) {
    // ONLY Cherry adapter when embedded — no wallet selection UI needed
    return [new CherryWalletAdapter()];
  }
  // Standalone: standard wallets
  return [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
    // ... other adapters
  ];
}

// In WalletProvider:
const wallets = useMemo(() => getWallets(), []);
const embedded = isInsideCherry();

<WalletProvider wallets={wallets} autoConnect={embedded}>
  {embedded ? <AutoSelectCherry>{children}</AutoSelectCherry> : children}
</WalletProvider>
```

Auto-select helper (selects Cherry wallet automatically):
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

### Step 5: Cherry Provider — User & Room Context

Wrap the embedded app with `CherryMiniAppProvider` to get user/room data and launch token:

```tsx
import { CherryMiniAppProvider } from '@cherrydotfun/miniapp-sdk/react';

function Root() {
  const embedded = isInsideCherry();

  if (embedded) {
    return (
      <CherryMiniAppProvider>
        <WalletProviderWithCherry>
          <App />
        </WalletProviderWithCherry>
      </CherryMiniAppProvider>
    );
  }

  return (
    <StandardWalletProvider>
      <App />
    </StandardWalletProvider>
  );
}
```

Access context in components:
```tsx
import { useCherryMiniApp, useCherryWallet } from '@cherrydotfun/miniapp-sdk/react';

function GameUI() {
  const { user, room, launchToken, isReady } = useCherryMiniApp();
  const { publicKey, signTransaction, signMessage } = useCherryWallet();

  // user.publicKey, user.displayName, user.avatarUrl
  // room.id, room.title, room.memberCount
  // launchToken — JWT for backend verification
}
```

### Step 6: Hide Standalone-Only UI

Use `isEmbedded` to conditionally render elements:

```tsx
function Header() {
  const { isEmbedded } = useCherryEnvironment();

  if (isEmbedded) return null; // Cherry has its own header

  return <nav>...</nav>;
}

function WalletButton() {
  const { isEmbedded } = useCherryEnvironment();

  if (isEmbedded) return null; // Cherry provides the wallet

  return <WalletMultiButton />;
}
```

### Step 7: Navigation — Cherry Host Integration

Allow your app to open Cherry screens:

```tsx
import { useCherryNavigate } from '@cherrydotfun/miniapp-sdk/react';

function UserList() {
  const navigate = useCherryNavigate();
  const { isEmbedded } = useCherryEnvironment();

  const handleUserClick = (address: string) => {
    if (isEmbedded) {
      // Opens profile in Cherry (supports wallet, domain, @handle)
      navigate.userProfile(address);
    } else {
      // Standalone: your own profile page
      router.push(`/profile/${address}`);
    }
  };
}
```

Supported navigate methods:
- `navigate.userProfile(id)` — wallet address, domain (`alice.sol`), or `@handle`
- `navigate.openRoom(id)` — roomId or `@handle`

### Step 8: Backend Token Verification (Optional)

If your backend needs to verify the user's identity:

```ts
import { verifyLaunchToken } from '@cherrydotfun/miniapp-sdk';

// In your API route handler:
const payload = await verifyLaunchToken(token, {
  expectedAppId: 'your-app-id',
  // jwksUrl defaults to https://chat.cherry.fun/.well-known/jwks.json
  // For dev: jwksUrl: 'http://localhost:3000/.well-known/jwks.json'
});

// payload.sub — verified wallet address
// payload.room_id — room context
// payload.user — { display_name, avatar_url }
```

### Step 9: Verify Integration

Test both modes:

**Standalone mode:**
- App works normally with standard wallet adapters
- No Cherry-specific UI appears
- Wallet connect flow works as before

**Embedded mode (in Cherry):**
- Wallet auto-connects (no connect button)
- User/room context available via hooks
- signTransaction/signMessage work through Cherry bridge
- Hidden UI elements don't appear
- Navigation opens Cherry screens

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Using `Buffer` in browser code | Use `btoa()`/`atob()` or SDK helpers |
| `require('@solana/web3.js')` in ESM | Use top-level `import` |
| Checking `isInsideCherry()` after async init | Call synchronously at module load |
| Not auto-selecting Cherry wallet | Add `AutoSelectCherry` component |
| Showing wallet connect in embed | Wrap with `if (!isEmbedded)` |
| Hardcoding standalone-only logic | Use `useCherryEnvironment()` for all checks |

## Bridge Protocol Reference

The SDK uses postMessage to communicate with Cherry host:

| Message | Direction | Purpose |
|---------|-----------|---------|
| `cherry:init` | Host → App | JWT token + capabilities |
| `cherry:ready` | App → Host | Handshake complete |
| `cherry:request` | App → Host | Wallet/navigate ops |
| `cherry:response` | Host → App | Operation result |
| `cherry:event` | Host → App | `suspended`, `resumed`, `walletDisconnected` |

The SDK handles all of this internally — you don't need to work with postMessage directly.

## Lifecycle Events

```tsx
import { CherryMiniApp } from '@cherrydotfun/miniapp-sdk';

const cherry = new CherryMiniApp();
await cherry.init();

cherry.on('suspended', () => {
  // User left the chat — pause game, save state
});

cherry.on('resumed', () => {
  // User came back — resume game
});

cherry.on('walletDisconnected', () => {
  // Wallet disconnected — handle gracefully
});
```
