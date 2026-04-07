# @cherrydotfun/miniapp-sdk

SDK for building mini-apps embedded in [Cherry](https://cherry.fun) messenger. Provides wallet integration, user/room context, and navigation — works in both WebView (mobile) and iframe (web).

## Install

```bash
npm install @cherrydotfun/miniapp-sdk
```

Peer dependencies:

```bash
npm install @solana/wallet-adapter-base @solana/web3.js react
```

## Quick Start (React)

```tsx
import { CherryMiniAppProvider, useCherryMiniApp, useCherryWallet } from '@cherrydotfun/miniapp-sdk/react';

function App() {
  return (
    <CherryMiniAppProvider>
      <MyGame />
    </CherryMiniAppProvider>
  );
}

function MyGame() {
  const { user, room, launchToken, isReady } = useCherryMiniApp();
  const { publicKey, signTransaction, signMessage } = useCherryWallet();

  if (!isReady) return <div>Loading...</div>;

  return (
    <div>
      <p>Welcome, {user.displayName}!</p>
      <p>Room: {room.title} ({room.memberCount} members)</p>
      <p>Wallet: {publicKey}</p>
    </div>
  );
}
```

## Environment Detection

Check if running inside Cherry before initializing the SDK:

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

## Wallet Adapter

Drop-in replacement for Solana wallet adapter:

```tsx
import { CherryWalletAdapter } from '@cherrydotfun/miniapp-sdk';

// Use in @solana/wallet-adapter-react WalletProvider
const wallets = [new CherryWalletAdapter()];
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
  await navigate.userProfile('7xKXt...');

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
  // jwksUrl defaults to https://api.cherry.fun/.well-known/jwks.json
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

console.log(cherry.user.publicKey);
console.log(cherry.room.title);

const sig = await cherry.wallet.signMessage(new TextEncoder().encode('hello'));
await cherry.navigate.userProfile('alice.sol');

cherry.on('suspended', () => console.log('App suspended'));
cherry.on('resumed', () => console.log('App resumed'));
```

## API Reference

### React Hooks

| Hook | Description |
|------|-------------|
| `useCherryMiniApp()` | `{ user, room, launchToken, isReady, error }` |
| `useCherryWallet()` | `{ publicKey, connected, signTransaction, signMessage, signAndSendTransaction }` |
| `useCherryNavigate()` | `{ userProfile(id), openRoom(id) }` |
| `useCherryEnvironment()` | `{ isEmbedded, platform }` — no provider needed |

### CherryMiniApp

| Property/Method | Description |
|-----------------|-------------|
| `init()` | Wait for Cherry host handshake |
| `user` | `{ publicKey, displayName, avatarUrl }` |
| `room` | `{ id, title, memberCount }` |
| `launchToken` | JWT string for backend verification |
| `wallet.signTransaction(tx)` | Sign a Solana transaction |
| `wallet.signMessage(msg)` | Sign an arbitrary message |
| `wallet.signAndSendTransaction(tx)` | Sign and submit transaction |
| `navigate.userProfile(id)` | Open user profile (wallet/domain/@handle) |
| `navigate.openRoom(id)` | Open room (roomId/@handle) |
| `on(event, handler)` | Listen to `suspended`, `resumed`, `walletDisconnected` |
| `destroy()` | Cleanup listeners |

### Bridge Protocol

The SDK communicates with Cherry via `postMessage`. The protocol is versioned (`v2`) and uses JWT launch tokens for authentication.

| Message | Direction | Description |
|---------|-----------|-------------|
| `cherry:init` | Host → App | Handshake with JWT token |
| `cherry:ready` | App → Host | App acknowledges init |
| `cherry:request` | App → Host | Wallet/navigate operations |
| `cherry:response` | Host → App | Operation result |
| `cherry:event` | Host → App | Lifecycle events |

## License

MIT
