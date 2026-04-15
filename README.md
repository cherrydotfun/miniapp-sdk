# @cherrydotfun/miniapp-sdk

SDK for building mini-apps embedded in [Cherry](https://cherry.fun) messenger. Provides wallet integration, user/room context, and navigation — works in both WebView (mobile) and iframe (web).

Supports both **@solana/web3.js** (legacy wallet-adapter) and **@solana/kit** (modern TransactionSigner).

## Install

```bash
npm install @cherrydotfun/miniapp-sdk
```

Peer dependencies — install only what you need:

```bash
# For @solana/web3.js (legacy wallet-adapter)
npm install @solana/wallet-adapter-base @solana/web3.js

# For @solana/kit (modern)
npm install @solana/signers

# For React hooks
npm install react
```

## Package Exports

| Entry Point | Description | Solana Dependency |
|-------------|-------------|-------------------|
| `@cherrydotfun/miniapp-sdk` | Core client, bridge, env detection, token verification | None |
| `@cherrydotfun/miniapp-sdk/react` | React provider and hooks | None |
| `@cherrydotfun/miniapp-sdk/solana` | CherryWalletAdapter for wallet-adapter ecosystem | `@solana/web3.js` + `@solana/wallet-adapter-base` |
| `@cherrydotfun/miniapp-sdk/kit` | TransactionSigner for @solana/kit | None (structural typing) |

## Quick Start — @solana/web3.js

```tsx
import { CherryMiniAppProvider, useCherryMiniApp, useCherryWallet } from '@cherrydotfun/miniapp-sdk/react';
import { CherryWalletAdapter } from '@cherrydotfun/miniapp-sdk/solana';

// Drop-in for @solana/wallet-adapter-react
const wallets = [new CherryWalletAdapter()];

function MyGame() {
  const { user, room, launchToken, isReady } = useCherryMiniApp();
  const { publicKey, signTransaction, signAllTransactions, signMessage } = useCherryWallet();

  if (!isReady) return <div>Loading...</div>;

  return (
    <div>
      <p>Welcome, {user.displayName}!</p>
      <p>Room: {room.title} ({room.memberCount} members)</p>
    </div>
  );
}
```

## Quick Start — @solana/kit

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

## Quick Start — React + Kit

```tsx
import { CherryMiniAppProvider, useCherryApp } from '@cherrydotfun/miniapp-sdk/react';
import { createCherrySigner } from '@cherrydotfun/miniapp-sdk/kit';

function MyGame() {
  const app = useCherryApp(); // CherryMiniApp instance

  const handleSign = async () => {
    const signer = createCherrySigner(app);
    const [signed] = await signer.signTransactions([{ messageBytes, signatures: {} }]);
  };
}
```

## Environment Detection

Check if running inside Cherry before initializing:

```tsx
import { isInsideCherry, getCherryEnvironment } from '@cherrydotfun/miniapp-sdk';

if (isInsideCherry()) {
  // Running inside Cherry — SDK will work
} else {
  // Standalone — show regular wallet connect
}

const env = getCherryEnvironment();
// env.platform: 'webview' | 'iframe' | 'standalone'
// env.isEmbedded: boolean
```

React hook (no provider needed):

```tsx
import { useCherryEnvironment } from '@cherrydotfun/miniapp-sdk/react';

function App() {
  const { isEmbedded, platform } = useCherryEnvironment();
  if (!isEmbedded) return <StandaloneApp />;
  return <CherryMiniAppProvider><EmbeddedApp /></CherryMiniAppProvider>;
}
```

## Navigation

Open Cherry screens from your mini-app:

```tsx
import { useCherryNavigate } from '@cherrydotfun/miniapp-sdk/react';

function MyComponent() {
  const navigate = useCherryNavigate();

  // Open user profile — accepts wallet address, domain, or @handle
  await navigate.userProfile('alice.sol');
  await navigate.userProfile('@alice');

  // Open room — accepts roomId or @handle
  await navigate.openRoom('@solminer');
  await navigate.openRoom('roomId123');
}
```

## Launch Token (Backend Verification)

The SDK provides a JWT launch token signed by Cherry's server. Verify it on your backend:

```ts
import { verifyLaunchToken } from '@cherrydotfun/miniapp-sdk';

const payload = await verifyLaunchToken(token, {
  expectedAppId: 'your-app-id',
  // jwksUrl defaults to https://chat.cherry.fun/.well-known/jwks.json
});

// payload.sub — wallet address
// payload.room_id — room where app was opened
// payload.user — { display_name, avatar_url }
// payload.room — { title, member_count }
```

## Vanilla JS (No React)

```ts
import { CherryMiniApp } from '@cherrydotfun/miniapp-sdk';

const cherry = new CherryMiniApp();
await cherry.init();

cherry.user.publicKey;   // wallet address
cherry.room.title;       // room name
cherry.launchToken;      // JWT for backend

const sig = await cherry.wallet.signMessage(new TextEncoder().encode('hello'));
const signed = await cherry.wallet.signAllTransactions([tx1, tx2, tx3]); // batch sign
await cherry.navigate.userProfile('alice.sol');

cherry.on('suspended', () => console.log('App suspended'));
cherry.on('resumed', () => console.log('App resumed'));
```

## API Reference

### React Hooks

| Hook | Description |
|------|-------------|
| `useCherryMiniApp()` | `{ user, room, launchToken, isReady, error }` |
| `useCherryApp()` | `CherryMiniApp` instance (for kit signer etc.) |
| `useCherryWallet()` | `{ publicKey, connected, signTransaction, signAllTransactions, signMessage, signAndSendTransaction }` |
| `useCherryNavigate()` | `{ userProfile(id), openRoom(id) }` |
| `useCherryEnvironment()` | `{ isEmbedded, platform }` — no provider needed |

### CherryMiniApp (Core)

| Property/Method | Description |
|-----------------|-------------|
| `init()` | Wait for Cherry host handshake |
| `user` | `{ publicKey, displayName, avatarUrl }` |
| `room` | `{ id, title, memberCount }` |
| `launchToken` | JWT string for backend verification |
| `wallet.signTransaction(tx)` | Sign a transaction (returns `Uint8Array`) |
| `wallet.signAllTransactions(txs)` | Sign multiple transactions in a single batch (returns `Uint8Array[]`) |
| `wallet.signMessage(msg)` | Sign an arbitrary message |
| `wallet.signAndSendTransaction(tx)` | Sign and submit transaction |
| `navigate.userProfile(id)` | Open user profile (wallet/domain/@handle) |
| `navigate.openRoom(id)` | Open room (roomId/@handle) |
| `on(event, handler)` | Listen to `suspended`, `resumed`, `walletDisconnected` |
| `destroy()` | Cleanup listeners |

### CherryWalletAdapter (solana/)

```ts
import { CherryWalletAdapter } from '@cherrydotfun/miniapp-sdk/solana';
```

Drop-in `BaseWalletAdapter` for `@solana/wallet-adapter-react`. Handles connect, signTransaction, signAllTransactions, signMessage, sendTransaction.

### createCherrySigner (kit/)

```ts
import { createCherrySigner } from '@cherrydotfun/miniapp-sdk/kit';
```

Returns a `TransactionSigner` compatible with `@solana/kit`. Supports `signTransactions` and `signMessages`.

### Bridge Protocol

The SDK communicates with Cherry via `postMessage`. The protocol is versioned (`v2`) and uses JWT launch tokens for authentication.

| Message | Direction | Description |
|---------|-----------|-------------|
| `cherry:init` | Host → App | Handshake with JWT token |
| `cherry:ready` | App → Host | App acknowledges init |
| `cherry:request` | App → Host | Wallet/navigate operations |
| `cherry:response` | Host → App | Operation result |
| `cherry:event` | Host → App | Lifecycle events |

## AI-Assisted Integration

This package includes a [Claude Code / Codex skill](./skills/README.md) that automates SDK integration into existing web3 apps. After installing the SDK, copy the skill to your AI assistant and say "Integrate Cherry Mini-App SDK" — it will analyze your codebase and guide you step by step.

## License

MIT
