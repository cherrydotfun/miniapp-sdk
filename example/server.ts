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
import { verifyLaunchToken } from '@cherrydotfun/miniapp-sdk';

const PORT = 3456;
const APP_ID = process.env.APP_ID || 'example-app';
const JWKS_URL = process.env.JWKS_URL || 'http://localhost:3000/.well-known/jwks.json';

function log(label: string, data: unknown) {
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  console.log(`\n[${time}] ${label}`);
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

const server = createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
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
      const payload = await verifyLaunchToken(token, {
        expectedAppId: APP_ID,
        jwksUrl: JWKS_URL,
      });

      log('Token VERIFIED', {
        wallet: payload.sub,
        appId: payload.app_id,
        roomId: payload.room_id,
        origin: payload.origin,
        user: payload.user,
        room: payload.room,
        issuedAt: new Date(payload.iat * 1000).toISOString(),
        expiresAt: new Date(payload.exp * 1000).toISOString(),
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

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n🔐 Cherry Mini-App Verification Server`);
  console.log(`   http://localhost:${PORT}/api/verify`);
  console.log(`   APP_ID: ${APP_ID}`);
  console.log(`   JWKS:   ${JWKS_URL}\n`);
});
