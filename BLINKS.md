# Building Blinks — Developer Guide

A **blink** is an interactive mini-app rendered **inline as a card inside a chat
message**. Instead of opening fullscreen, the mini-app mounts in a small,
sandboxed surface right in the conversation — a quiz, a poll, a swap widget, a
live score, a "sign this" prompt, a result snapshot.

This guide explains how blinks work end-to-end and how to build one correctly
with `@cherrydotfun/miniapp-sdk`.

> New here? Read the main [README](./README.md) first for install, wallet
> signing, and environment detection. This document is blink-specific.

---

## Table of contents

1. [What a blink is](#1-what-a-blink-is)
2. [Anatomy & lifecycle](#2-anatomy--lifecycle)
3. [Prerequisites & permissions](#3-prerequisites--permissions)
4. [Build a blink mini-app](#4-build-a-blink-mini-app)
5. [The blink context](#5-the-blink-context)
6. [Params — your blink's payload](#6-params--your-blinks-payload)
7. [Height & resizing](#7-height--resizing)
8. [Interactivity — callbacks & live updates](#8-interactivity--callbacks--live-updates)
9. [Wallet signing inside a blink](#9-wallet-signing-inside-a-blink)
10. [Sharing a result as a blink](#10-sharing-a-result-as-a-blink)
11. [How a blink gets sent](#11-how-a-blink-gets-sent)
12. [Server-side rendering (SSR)](#12-server-side-rendering-ssr)
13. [Constraints, limits & the bridge surface](#13-constraints-limits--the-bridge-surface)
14. [Validation rules reference](#14-validation-rules-reference)
15. [Troubleshooting](#15-troubleshooting)
16. [Checklist](#16-checklist)

---

## 1. What a blink is

A blink is a normal chat message with `messageType: 'interactive'` and a
`metadata.blink` payload. Clients render it as a **preview card** (icon +
title); tapping it **mounts your mini-app** in an inline WebView (mobile) /
iframe (web).

There are two kinds:

| Kind | `blink.type` | Renders | Identity |
|------|--------------|---------|----------|
| **Mini-app blink** | `'miniapp'` | A registered Cherry mini-app at a `route` | `miniAppId` |
| **URL blink** | `'url'` | A bot-owned URL inside a sandbox | the URL's origin |

This guide focuses on **mini-app blinks** (the SDK path). URL blinks are plain
bot-hosted pages and don't need the SDK.

**Blink vs fullscreen mini-app** — the *same* mini-app can run both ways. The
difference is the **launch mode**:

| | Fullscreen | Blink (inline) |
|---|---|---|
| Surface | Full screen / sheet | Small card in a chat bubble |
| Launch mode | `mode=fullscreen` (or none) | `mode=inline` |
| Wallet connect | `wallet.connect` allowed | **Not** allowed — viewer wallet is delivered automatically |
| Lifecycle | One instance, long-lived | LRU-capped, auto-unmounts off-screen |
| Context | `cherry.user` / `cherry.room` | `cherry.blink` (per-message identity) |

The SDK auto-detects the mode from the launch URL — **you write one mini-app**,
it adapts.

---

## 2. Anatomy & lifecycle

1. A **bot** sends a blink (`sendInteractiveMessage`) or a **user** shares one
   (`cherry.share`). The Cherry server mints a signed **launch token** (RS256
   JWT) bound to that specific message and bakes your `params`, `route`,
   `height`, `miniAppId`, `messageId`, and `sender` into it.
2. The message is stored with `metadata.blink = { type, miniAppId, route,
   params, height, interactive, launchToken, launchUrl }`.
3. In the chat, clients show a **preview card** (your mini-app's icon + name
   from its manifest). No iframe/WebView is mounted yet — cheap to scroll past.
4. On tap (or automatically if `interactive: false` + `inline:eager`), the
   client mounts your mini-app at:
   ```
   {your-origin}/inline?cherry_embed=1#token=<JWT>&mode=inline&route=<route>
   ```
   - `token` / `route` / `mode=inline` ride in the **URL fragment** (not sent to
     your server in the request — keeps them out of access logs / referrer).
   - `cherry_embed=1` is in the **query** so environment detection (and SSR)
     recognise the Cherry embed.
5. Your mini-app calls `cherry.init()`. The SDK sees `mode=inline`, performs the
   **inline handshake** (a `host.init` bridge request — *not* the fullscreen
   `cherry:init` push), and resolves with the **blink context**.
6. You render from `cherry.blink.params`. Optionally call `host.resize`,
   `host.callback`, wallet signing, etc.
7. When the card scrolls off-screen for ~30s, or the per-chat mount cap (max 3)
   is exceeded, the client **unmounts** your mini-app. It re-mounts (and
   re-runs `init`) when it returns to view. **Treat every mount as fresh** —
   persist nothing in memory across unmounts.

---

## 3. Prerequisites & permissions

Your mini-app must be **registered** in Cherry and declare the right
permissions in its manifest:

| Permission | Required for |
|------------|--------------|
| `inline:render` | **Mandatory** — without it the mini-app can't be used as a blink at all. |
| `inline:eager` | Sending a **non-interactive** blink (`interactive: false`) that **auto-mounts** without a tap (e.g. a live scoreboard). |

If `inline:render` is missing, sending/sharing fails with
`MINIAPP_INLINE_NOT_ALLOWED`. If you send `interactive: false` without
`inline:eager`, it fails with `BLINK_EAGER_NOT_ALLOWED`.

> Mini-app registration (manifest, `allowedOrigins`, icon, permissions) is done
> via the Cherry app/admin flow — ask your Cherry contact if you don't have a
> `miniAppId` yet.

---

## 4. Build a blink mini-app

The blink path is the **same SDK** you already use. Detect the blink context
and render from `params`.

### React

```tsx
import {
  CherryMiniAppProvider,
  useCherryMiniApp,
  useCherryBlink,
  useCherryWallet,
} from '@cherrydotfun/miniapp-sdk/react';

function Quiz() {
  const { isReady, error } = useCherryMiniApp();
  const blink = useCherryBlink();      // null unless launched as an inline blink

  if (error) return <p>Failed to connect to Cherry</p>;
  if (!isReady) return <p>Loading…</p>;

  // Rendered as a blink → show the per-message snapshot.
  if (blink) {
    const { question, options } = blink.params as {
      question: string;
      options: string[];
    };
    return (
      <div>
        <h3>{question}</h3>
        {options.map((o, i) => (
          <button key={i} onClick={() => answer(i)}>{o}</button>
        ))}
      </div>
    );
  }

  // Fullscreen / standalone fallback.
  return <FullApp />;
}

export default function App() {
  return (
    <CherryMiniAppProvider>
      <Quiz />
    </CherryMiniAppProvider>
  );
}
```

### Vanilla JS

```ts
import { CherryMiniApp } from '@cherrydotfun/miniapp-sdk';

const cherry = new CherryMiniApp();
await cherry.init();

if (cherry.blink) {
  render(cherry.blink.params);     // blink mode
} else {
  renderFullscreen();              // fullscreen / standalone
}
```

**Key rule:** in a blink, drive your UI from `cherry.blink.params` (and
`messageId`), not from local state or a fresh fetch. The card may mount/unmount
many times; `params` is the stable source of truth for *that* message.

---

## 5. The blink context

`cherry.blink` (and `useCherryBlink()`) returns `CherryBlinkContext | null`.
It's `null` for fullscreen/standalone, populated for inline blinks:

| Field | Type | Meaning |
|-------|------|---------|
| `messageId` | `string` | **Unique id of this blink message.** Use it as the stable per-message key (bind backend state, dedupe, correlate). Distinct per sent blink. |
| `roomId` | `string` | The chat the blink lives in. |
| `viewerWallet` | `string` | Wallet of the person **currently viewing** the blink (the signer). |
| `sender` | `string \| null` | Wallet that **sent** the blink (message author — a bot wallet or the sharer). |
| `miniAppId` | `string \| null` | Your mini-app id (null for URL blinks). |
| `appId` | `string \| null` | Owning bot/embed-app id, if any. |
| `route` | `string` | Route within your mini-app the blink opens. |
| `params` | `Record<string, unknown>` | The snapshot payload (see §6). |
| `height` | `'compact' \| 'medium' \| 'tall'` | The render-height bucket (see §7). |
| `initialHeight` | `number \| null` | Exact px the card **opens at** (no-jump), or `null` when the sender didn't pin one. Render your first paint at this height to avoid a layout jump (see §7). |
| `interactive` | `boolean` | `false` for read-only shared snapshots. |
| `source` | `string \| null` | `'user_share'` for user-shared snapshots; otherwise the bot source. |
| `blinkParamsVersion` | `number \| null` | Monotonic version of `params`, bumped on live updates. |
| `issuedAt` / `expiresAt` | `number \| null` | Launch-token unix timestamps. |
| `jti` | `string \| null` | Launch-token id. |

> `viewerWallet` ≠ `sender` in general: when the author views their own shared
> blink they're equal; when someone else opens it, `viewerWallet` is that other
> person and `sender` stays the author.

---

## 6. Params — your blink's payload

`params` is the heart of a blink: a JSON object the **sender** chose, baked into
the **signed launch token** at send time, and rendered by **every viewer**.

- **Tamper-proof.** `params` lives inside the RS256-signed JWT. A viewer can't
  forge or mutate it. (It is *not* E2E-encrypted, so don't put secrets in it.)
- **Bounded.** Max **4096 bytes** of JSON, max nesting **depth 8**. Keep it
  small — it's a snapshot, not a database.
- **Available everywhere it matters:** `cherry.blink.params` on the client, the
  `params` claim in the verified launch token on your **server** (SSR — see §12),
  and the `host.init` response.

```ts
// reading on the client
const { score, level } = cherry.blink.params as { score: number; level: number };
```

Design `params` so a single render is self-contained. If you need heavy/private
data, store it in your own backend keyed by `cherry.blink.messageId` and fetch
it on mount — but the lightweight, instantly-renderable bits belong in `params`.

---

## 7. Height & resizing

Blinks render at one of three fixed **height buckets**:

| Bucket | Height (px) |
|--------|-------------|
| `compact` | 96 |
| `medium` | 220 (default) |
| `tall` | 420 |

The sender picks the bucket. Inside it, you may request a tighter height to fit
your content (the host **clamps** to sensible bounds around the bucket — you can
shrink within the bucket, not exceed it):

```ts
// vanilla: ask the host to resize the card to your content height
await getSharedBridge().request('host.resize', { height: 180 });
```

> There's no dedicated typed helper for `host.resize` yet — use the bridge
> directly (imported from `@cherrydotfun/miniapp-sdk`). Most blinks just pick the
> right bucket at send time and don't resize.

### Initial height (no-jump)

The bucket is the render **ceiling**; by default a card opens at the full bucket
height and snaps to its real size on your first `host.resize`. To avoid that
jump, the sender can pin an exact **`initialHeight`** (CSS px, ≤ the bucket max)
— bots via `blink.initialHeight`, sharers via `share({ initialHeight })`. The
host opens the card at that height immediately, and the SDK exposes it as
`cherry.blink.initialHeight` (also the `initialHeight` field on the `host.init`
response, and the `initial_height` token claim for SSR). Render your first paint
at this height so the card never jumps:

```ts
// size your first paint to match the host card, then refine via host.resize
const h = cherry.blink?.initialHeight ?? undefined; // px, or undefined → use the bucket
```

`initialHeight` only controls the first frame — you can still call `host.resize`
afterwards for content-driven changes.

Pick the **smallest bucket that fits** — blinks share limited chat real estate.

---

## 8. Interactivity — callbacks & live updates

Blinks can be **interactive** (a bot stands behind them and reacts) or
**read-only snapshots** (`interactive: false` / user-shared, no bot).

### Sending data back to the bot — `host.callback`

When a user interacts (taps an option, submits a vote), send a small payload to
the owning bot:

```ts
import { getSharedBridge } from '@cherrydotfun/miniapp-sdk';

await getSharedBridge().request('host.callback', {
  data: JSON.stringify({ choice: 2 }),   // <= 256 bytes
});
```

Flow: the host POSTs this to Cherry with your **launch token** → Cherry verifies
it and emits a `callback_query` (source `blink_widget`) to the **bot** → the bot
answers via its Bot API (`answerCallbackQuery`), optionally with a toast/alert
and/or **updated params**.

- `data` is capped at **256 bytes**.
- A single launch token is shared by all viewers and can fire **many**
  callbacks over its lifetime — that's expected.
- **Read-only blinks reject callbacks** with `CALLBACK_NOT_SUPPORTED` (a
  user-shared snapshot has no bot to answer). Don't wire callbacks into a blink
  you intend to be a static result.

### Live param updates — the `blink:update` event

When the bot answers a callback with new `params`, Cherry bumps
`blinkParamsVersion` and pushes a **`blink:update`** event to the live card.
Subscribe to it so the card re-renders **without a remount**:

```ts
// vanilla
cherry.on('blink:update', (payload) => {
  const { params } = payload as { params: Record<string, unknown> };
  render(params);
});
```

```tsx
// React
import { useEffect, useState } from 'react';
import { useCherryApp, useCherryBlink } from '@cherrydotfun/miniapp-sdk/react';

function LiveBlink() {
  const app = useCherryApp();
  const blink = useCherryBlink();
  const [params, setParams] = useState(blink?.params ?? {});

  useEffect(() => {
    if (!app) return;
    const onUpdate = (p: { params: Record<string, unknown> }) =>
      setParams(p.params);
    app.on('blink:update', onUpdate);
    return () => app.off('blink:update', onUpdate);
  }, [app]);

  return <Render params={params} />;
}
```

This is how a poll's live tally, a game score, or a "processing… → done" state
updates in place.

---

## 9. Wallet signing inside a blink

Blinks can sign messages and transactions with the viewer's wallet — **but the
viewer wallet is delivered automatically**; you must **not** call
`wallet.connect` (it's blocked inline).

```ts
const { signMessage, signTransaction } = useCherryWallet();
const pubkey = cherry.wallet.publicKey;   // = the viewer's wallet (from host.init)
```

The same wallet APIs from the [README](./README.md#quick-start--solanaweb3js)
work: `signMessage`, `signTransaction`, `signAllTransactions`,
`signAndSendTransaction`, and the `@solana/kit` `createCherrySigner`.

### ⚠️ Transactions must be real and signable

This is the #1 cause of `"Invalid transaction — not properly formed and can't
be signed"` from wallets (Solflare/Phantom). The bridge faithfully passes your
transaction to the wallet; if the wallet rejects it, the **transaction content**
is the problem, not the bridge. Make sure:

1. **Fee-payer / first signer = the viewer wallet** (`cherry.wallet.publicKey`).
   If you build the tx for a different key, the connected wallet isn't a signer
   and refuses it.
2. **A real, fresh `recentBlockhash`** fetched from an RPC. A placeholder/dummy
   blockhash (common in copy-pasted examples) makes the wallet's simulation
   fail → "not properly formed". Never ship a hard-coded blockhash.
3. **Real instructions** with correct accounts. A degenerate 0-lamport
   self-transfer with a fake blockhash is exactly what triggers the rejection.
4. For `@solana/kit`, the viewer wallet **must be a required signer** of the
   compiled message, or `createCherrySigner` throws "not a required signer".

A correct build looks like (web3.js):

```ts
const { blockhash } = await connection.getLatestBlockhash();
const tx = new Transaction({ feePayer: new PublicKey(pubkey), recentBlockhash: blockhash })
  .add(/* real instruction(s) */);
const signed = await signTransaction(tx);
```

> `signMessage` working while `signTransaction` fails is the classic signature
> of a bad transaction (not a connection/bridge issue) — the wallet+bridge are
> fine; fix the tx.

---

## 10. Sharing a result as a blink

Any blink (or fullscreen mini-app) can let the **user** reshare a read-only
result snapshot into another DM or group:

```tsx
import { useCherryShare } from '@cherrydotfun/miniapp-sdk/react';

const share = useCherryShare();
const res = await share({
  route: '/result',
  params: { score: 9000 },           // the snapshot the recipient renders
  caption: 'I scored 9000!',
  height: 'medium',
  initialHeight: 180,                // optional: exact px the card opens at (≤ bucket max)
});
// res = { shared, roomId?, messageId? }
```

The host opens a recipient picker; on send you get the new `messageId`. The
shared blink is **read-only** (`interactive: false`, `source: 'user_share'`) —
no callbacks. The mini-app identity is taken from the current session (a
mini-app can only share **itself**). See the README's
[Sharing Results](./README.md#sharing-results-blinks) section.

---

## 11. How a blink gets sent

You usually don't send blinks from the blink mini-app itself — they're created
by a **bot** (Bot API) or by a **user share** (§10). For reference:

### From a bot (Bot API)

```http
POST /api/v1/bots/sendInteractiveMessage
Authorization: cha_<appId>_<secret>

{
  "roomId": "…",
  "content": "Daily quiz!",
  "blink": {
    "route": "/quiz",
    "params": { "question": "…", "options": ["A","B","C"] },
    "height": "tall",
    "initialHeight": 360,
    "interactive": true
  }
}
```

The bot must have a blink mini-app configured (`POST /api/v1/bots/setBlinkMiniApp`
with your `miniAppId`) — that's the mini-app every blink from that bot renders.
For a **URL blink**, send `blink: { "type": "url", "url": "https://…", … }`
(the origin must be in the app's `blinkOrigins`).

The server validates the payload, mints the launch token (adding `messageId`,
`sender`, `app_id`/`mini_app_id`), and returns the enriched message.

### From a user (share)

`cherry.share({...})` → `POST /api/v1/miniapp/share` (covered in §10).

---

## 12. Server-side rendering (SSR)

Cherry builds the launch URL as `{your-origin}/inline?token=<JWT>` — the token is
in the **query**, so your **server** receives it on the initial document request.
(The client additionally appends `#token=…&mode=inline` in the fragment for the
bridge handshake; that fragment is never sent to your server.) That means you can
verify the token server-side and render the blink HTML before the client mounts —
keyed by the stable `message_id`:

```ts
import { verifyLaunchToken } from '@cherrydotfun/miniapp-sdk';

// GET /inline?token=...
app.get('/inline', async (req, res) => {
  const payload = await verifyLaunchToken(String(req.query.token), {
    expectedAppId: 'your-app-id',
  });
  const messageId = payload.message_id;   // stable per-blink key
  const params = payload.params ?? {};     // signed snapshot
  res.send(renderBlinkHtml(params));
});
```

`payload` (inline tokens) carries `message_id`, `mini_app_id`, `route`,
`params`, `height`, `initial_height` (px the card opens at, if pinned),
`interactive`, `source`, plus `sub` (viewer) and `room_id`.
**Keep snapshot data inside the signed token's `params`** — never trust unsigned
query fields. See [`example/server.ts`](./example/server.ts) for a runnable
endpoint.

---

## 13. Constraints, limits & the bridge surface

### Allowed bridge methods (inline)

`host.init`, `host.resize`, `host.callback`, `host.share`,
`host.requestExpand`, `wallet.signMessage`, `wallet.signTransaction`,
`wallet.signTransactions`, `navigate.userProfile`, `navigate.openRoom`.

### Blocked inline (allowed only fullscreen)

`host.close`, `wallet.connect`, `wallet.disconnect` → respond
`METHOD_NOT_ALLOWED_IN_INLINE`. The viewer wallet is delivered via `host.init`;
never try to connect inside a blink.

### Lifecycle limits

- **Max 3** concurrently-mounted blinks per chat (LRU — a 4th evicts the
  oldest).
- A blink off-screen for ~**30s** auto-unmounts and re-mounts on return.
- ⇒ **No durable in-memory state.** Re-derive everything from `params` /
  `messageId` on each mount. Persist user-specific state in your backend keyed by
  `messageId` (+ `viewerWallet`).

### Token lifetime

Inline launch tokens live ~**15 minutes** from send. The token authorises
callbacks; long-lived interactions re-use the same token within that window.
(Sharing tolerates older tokens server-side.)

---

## 14. Validation rules reference

Enforced server-side when a blink is sent/shared (`BlinkValidationService`):

| Field | Rule | Error code |
|-------|------|------------|
| `route` | must start with `/`, only `[a-zA-Z0-9_\-/.]`, ≤ 257 chars, no `..`, no protocol | `BLINK_ROUTE_INVALID` |
| `params` | object, JSON ≤ **4096 bytes**, depth ≤ **8** | `BLINK_PARAMS_TOO_LARGE` / `BLINK_PARAMS_DEPTH` |
| `height` | one of `compact` \| `medium` \| `tall` | `BLINK_HEIGHT_INVALID` |
| `initialHeight` | positive integer, ≤ the `height` bucket max (`compact` 96 / `medium` 220 / `tall` 420) | `BLINK_INITIAL_HEIGHT_INVALID` |
| mini-app | must declare `inline:render` | `MINIAPP_INLINE_NOT_ALLOWED` |
| `interactive: false` | mini-app must declare `inline:eager` | `BLINK_EAGER_NOT_ALLOWED` |
| URL blink | origin must be in app `blinkOrigins`, https (http only for localhost in dev) | `BLINK_URL_NOT_ALLOWED` / `BLINK_URL_INVALID` |
| `host.callback` data | ≤ **256 bytes** | `CALLBACK_TOO_LARGE` |

---

## 15. Troubleshooting

| Symptom | Cause & fix |
|---------|-------------|
| **`Invalid transaction — not properly formed`** (Solflare/Phantom) | The **transaction** is bad, not the bridge. Use a **fresh `recentBlockhash`** from RPC, **fee-payer = `cherry.wallet.publicKey`**, and real instructions. See §9. `signMessage` working but `signTransaction` failing confirms it's the tx. |
| **Mini-app shows "standalone" inside a blink** | Environment detection didn't see Cherry. Ensure you call `cherry.init()` and don't strip the `?cherry_embed=1` query / `#…mode=inline` fragment in your router. Don't use `{ strict: true }` env detection unless all hosts inject the signals. |
| **`cherry.init()` times out in a blink** | You're on an old SDK that only waits for the fullscreen `cherry:init`. Upgrade — current SDK does the inline `host.init` handshake automatically when `mode=inline`. |
| **`cherry.blink` is `null`** | The mini-app wasn't launched as a blink (fullscreen/standalone), or `mode=inline` was lost from the URL. |
| **Callback rejected `CALLBACK_NOT_SUPPORTED`** | The blink is read-only (`interactive: false` / user-shared). Only bot-backed interactive blinks accept callbacks. |
| **`MINIAPP_INLINE_NOT_ALLOWED` when sending** | Mini-app manifest lacks `inline:render`. |
| **`wallet.connect` does nothing** | It's blocked inline by design. Use `cherry.wallet.publicKey` (the viewer wallet from `host.init`). |
| **State lost when scrolling away and back** | Expected — blinks unmount off-screen. Re-render from `params`/`messageId`; don't keep state in memory. |

---

## 16. Checklist

- [ ] Mini-app registered with `inline:render` (+ `inline:eager` if auto-mount).
- [ ] `cherry.init()` called; UI branches on `cherry.blink` (blink) vs not
      (fullscreen/standalone).
- [ ] UI renders from `cherry.blink.params` (+ `messageId`), not local state.
- [ ] `params` ≤ 4 KB, depth ≤ 8, no secrets.
- [ ] Right `height` bucket; size first paint to `cherry.blink.initialHeight`
      (when set) to avoid a jump; optional `host.resize` to fit content.
- [ ] Interactive? Wire `host.callback` and subscribe to `blink:update`.
      Read-only? Don't.
- [ ] Wallet: never `wallet.connect`; use `cherry.wallet.publicKey`; transactions
      have a **fresh blockhash** + **fee-payer = viewer**.
- [ ] No durable in-memory state — survive unmount/remount.
- [ ] (Optional) SSR via `verifyLaunchToken`, bind state by `message_id`.
```
