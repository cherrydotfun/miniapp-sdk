/**
 * Mini verification server for testing launch tokens.
 *
 * Usage:
 *   npx tsx server.ts
 *
 * The frontend sends the launch token to POST /api/verify,
 * the server verifies it against Cherry's JWKS and logs the result.
 */

import { createServer } from 'node:http';
import * as jose from 'jose';

const PORT = parseInt(process.env.PORT || '3456', 10);
const APP_ID = process.env.APP_ID || 'example-app';
const JWKS_URL = process.env.JWKS_URL || 'https://chat.cherry.fun/.well-known/jwks.json';

function log(label: string, data: unknown) {
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  console.log(`\n[${time}] ${label}`);
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

const jwks = jose.createRemoteJWKSet(new URL(JWKS_URL));

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Demo "store" for per-message state, keyed by the blink's unique `messageId`.
 * A real miniapp/bot would persist this in a DB. We bind data here at SSR time
 * (before the client mounts) so the rendered HTML is self-contained.
 */
const messageStore = new Map<string, { boundAt: string; params: unknown }>();

const server = createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/verify') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString());

    const token = body.token as string;
    if (!token) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing token field' }));
      return;
    }

    log('Received token', token.slice(0, 60) + '...');

    try {
      const { payload } = await jose.jwtVerify(token, jwks, {
        algorithms: ['RS256'],
      });

      if (payload.app_id !== APP_ID) {
        throw new Error(`Token app_id mismatch: expected ${APP_ID}, got ${payload.app_id}`);
      }

      log('Token VERIFIED', {
        wallet: payload.sub,
        appId: payload.app_id,
        roomId: payload.room_id,
        origin: payload.origin,
        user: payload.user,
        room: payload.room,
        issuedAt: new Date((payload.iat ?? 0) * 1000).toISOString(),
        expiresAt: new Date((payload.exp ?? 0) * 1000).toISOString(),
        jti: payload.jti,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ verified: true, payload }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log('Token REJECTED', message);

      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ verified: false, error: message }));
    }
    return;
  }

  // ── SSR blink render ──────────────────────────────────────────────────────
  // The inline blink launch URL is `/inline?token=...`. The token (a signed
  // JWT) carries `message_id`, `route` and `params` in the QUERY string, so it
  // reaches THIS server. We verify it, bind per-message state keyed by
  // `message_id`, and render the blink server-side — before the client mounts.
  if (req.method === 'GET' && (req.url ?? '').startsWith('/inline')) {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const token = url.searchParams.get('token');
    if (!token) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<h1>Missing token</h1>');
      return;
    }
    try {
      const { payload } = await jose.jwtVerify(token, jwks, {
        algorithms: ['RS256'],
      });
      if (payload.app_id !== APP_ID) {
        throw new Error(`app_id mismatch: ${String(payload.app_id)}`);
      }

      const messageId = String(payload.message_id ?? '');
      const route = String(payload.route ?? '/');
      const params = (payload.params ?? {}) as Record<string, unknown>;

      // Bind data to this blink, keyed by its unique messageId, BEFORE render.
      if (messageId && !messageStore.has(messageId)) {
        messageStore.set(messageId, {
          boundAt: new Date().toISOString(),
          params,
        });
      }
      const bound = messageId ? messageStore.get(messageId) : undefined;

      log('SSR render blink', { messageId, route, source: payload.source });

      const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blink ${escapeHtml(messageId)}</title></head>
<body style="font-family:system-ui;background:#0b0a14;color:#fff;margin:0;padding:16px">
  <div style="background:#1a1a24;border-radius:12px;padding:16px">
    <div style="font-size:12px;color:#a0a0b8">messageId</div>
    <div style="font-family:monospace;font-size:13px;margin-bottom:8px">${escapeHtml(messageId || '—')}</div>
    <div style="font-size:12px;color:#a0a0b8">route</div>
    <div style="margin-bottom:8px">${escapeHtml(route)}</div>
    <div style="font-size:12px;color:#a0a0b8">params (rendered server-side)</div>
    <pre style="background:#0a0a0a;border-radius:8px;padding:10px;overflow:auto;font-size:12px">${escapeHtml(JSON.stringify(params, null, 2))}</pre>
    <div style="font-size:11px;color:#737373">bound at ${escapeHtml(bound?.boundAt ?? 'n/a')}</div>
  </div>
</body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log('SSR token REJECTED', message);
      res.writeHead(401, { 'Content-Type': 'text/html' });
      res.end(`<h1>Invalid token</h1><pre>${escapeHtml(message)}</pre>`);
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n🔐 Cherry Mini-App Verification Server`);
  console.log(`   POST http://localhost:${PORT}/api/verify`);
  console.log(`   GET  http://localhost:${PORT}/inline?token=...  (SSR blink render)`);
  console.log(`   APP_ID: ${APP_ID}`);
  console.log(`   JWKS:   ${JWKS_URL}\n`);
});
