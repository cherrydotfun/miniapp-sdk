/**
 * Test harness: a fake `window` plus a scriptable Cherry host.
 *
 * bun has no DOM, and the SDK only touches a narrow slice of it (message
 * listeners, `location`, `parent.postMessage` / `ReactNativeWebView`), so the
 * fake implements exactly that slice. The host side records every message the
 * app sends and answers `cherry:request`s from per-method FIFO queues, which
 * keeps each test's host behaviour explicit and ordered.
 */
import { PublicKey } from '@solana/web3.js';
import { destroySharedBridge } from '../src/bridge';

export type Transport = 'webview' | 'iframe';

type Message = Record<string, unknown>;

export type HostAnswer =
  | { result: unknown }
  | { error: unknown }
  | ((params: Record<string, unknown> | undefined) => { result: unknown } | { error: unknown });

export interface SentRecord {
  transport: Transport;
  message: Message;
  /** postMessage options bag (iframe transport only). */
  options?: unknown;
}

export interface InstallOptions {
  transport?: Transport;
  /** Query string, without the leading `?`. `cherry_embed=1` is added for iframe transport. */
  search?: string;
  /** Fragment, without the leading `#`. */
  hash?: string;
}

export class FakeHost {
  readonly sent: SentRecord[] = [];
  private readonly listeners = new Set<(event: { data: unknown }) => void>();
  private readonly answers = new Map<string, HostAnswer[]>();
  private readonly idAliases = new Map<string, string>();

  /** Queue the answer for the next request of `method`. Unqueued requests stay pending. */
  answerNext(method: string, answer: HostAnswer): this {
    const queue = this.answers.get(method) ?? [];
    queue.push(answer);
    this.answers.set(method, queue);
    return this;
  }

  /** Deliver a message to the app as the host would (`window.postMessage` → `message` event). */
  post(data: unknown, meta: { source?: unknown; origin?: string; isTrusted?: boolean } = {}): void {
    const win = g.window as { parent?: unknown } | undefined;
    for (const listener of [...this.listeners]) listener({ data, source: meta.source ?? win?.parent, origin: meta.origin ?? 'https://chat.cherry.fun', isTrusted: meta.isTrusted ?? true } as { data: unknown });
  }

  /** Requests the app sent, with request ids replaced by stable aliases (`req#1`, …). */
  requests(method?: string): Message[] {
    return this.sent
      .map((r) => r.message)
      .filter((m) => m['type'] === 'cherry:request' && (method === undefined || m['method'] === method));
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  // ---- wiring used by installHost ----

  addListener(fn: (event: { data: unknown }) => void): void {
    this.listeners.add(fn);
  }

  removeListener(fn: (event: { data: unknown }) => void): void {
    this.listeners.delete(fn);
  }

  receive(transport: Transport, raw: Message, options?: unknown): void {
    // Clone so later mutation by the app cannot rewrite history, and alias the
    // random request id so recorded transcripts are stable across runs.
    const message = JSON.parse(JSON.stringify(raw)) as Message;
    const realId = typeof message['id'] === 'string' ? (message['id'] as string) : null;
    if (realId !== null) message['id'] = this.alias(realId);
    this.sent.push(options === undefined ? { transport, message } : { transport, message, options });

    if (message['type'] !== 'cherry:request' || realId === null) return;
    const method = String(message['method']);
    const answer = this.answers.get(method)?.shift();
    if (!answer) return;
    const params = message['params'] as Record<string, unknown> | undefined;
    const resolved = typeof answer === 'function' ? answer(params) : answer;
    // Answer asynchronously, like a real host.
    queueMicrotask(() => {
      this.post({ type: 'cherry:response', id: realId, ...resolved });
    });
  }

  private alias(id: string): string {
    let alias = this.idAliases.get(id);
    if (!alias) {
      alias = `req#${this.idAliases.size + 1}`;
      this.idAliases.set(id, alias);
    }
    return alias;
  }
}

const g = globalThis as unknown as { window?: unknown };

/** Install a fresh fake window + host. Call `uninstallHost()` in afterEach. */
export function installHost(options: InstallOptions = {}): FakeHost {
  uninstallHost();
  const host = new FakeHost();
  const transport = options.transport ?? 'webview';
  const searchParts = [options.search ?? ''].filter(Boolean);
  if (transport === 'iframe' && !searchParts.some((s) => s.includes('cherry_embed=1'))) {
    searchParts.unshift('cherry_embed=1');
  }
  const search = searchParts.length ? `?${searchParts.join('&')}` : '';
  const hash = options.hash ? `#${options.hash}` : '';

  const win: Record<string, unknown> = {
    location: { search, hash },
    addEventListener(type: string, fn: (event: { data: unknown }) => void) {
      if (type === 'message') host.addListener(fn);
    },
    removeEventListener(type: string, fn: (event: { data: unknown }) => void) {
      if (type === 'message') host.removeListener(fn);
    },
  };
  if (transport === 'webview') {
    win['__cherry'] = true;
    win['ReactNativeWebView'] = {
      postMessage(data: string) {
        host.receive('webview', JSON.parse(data) as Message);
      },
    };
    win['parent'] = win;
  } else {
    win['parent'] = {
      postMessage(message: Message, targetOrOptions: unknown) {
        host.receive('iframe', message, targetOrOptions);
      },
    };
  }
  g.window = win;
  return host;
}

export function uninstallHost(): void {
  destroySharedBridge();
  delete g.window;
}

/** Let queued microtasks and zero-delay timers run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

// ---- tokens ----

function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

/** Unsigned JWT: the client only decodes launch tokens, it never verifies them. */
export function unsignedJwt(payload: Record<string, unknown>): string {
  return `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify(payload))}.c2ln`;
}

// ---- wallets ----

/** Deterministic base58 wallet address from a seed byte. */
export function walletFromSeed(seed: number): string {
  return new PublicKey(Uint8Array.from({ length: 32 }, (_, i) => (seed * 31 + i) % 256)).toBase58();
}

export const SUB = walletFromSeed(1);
export const PAYER = walletFromSeed(2);
export const OTHER = walletFromSeed(3);

export const ISS = 'https://chat.cherry.fun';

/** Claims of a 0.1.21-era embed/fullscreen `cherry:init` token (no CherryID claims). */
export const LEGACY_EMBED_CLAIMS = {
  sub: SUB,
  iss: ISS,
  app_id: 'app_1',
  room_id: 'room_1',
  origin: 'https://game.example',
  user: { display_name: 'Alice', avatar_url: 'https://cdn.example/a.png' },
  room: { title: 'Lobby', member_count: 3 },
  permissions: ['wallet:sign'],
  reach: 'project',
  iat: 1_700_000_000,
  exp: 1_700_000_300,
  jti: 'jti-embed-1',
} as const;

/** Claims of a 0.1.21-era inline blink token (unchanged by the CherryID work). */
export const LEGACY_INLINE_CLAIMS = {
  iss: ISS,
  scope: 'inline',
  mode: 'inline',
  app_id: 'app_1',
  mini_app_id: 'mini_1',
  room_id: 'room_claims',
  message_id: 'msg_claims',
  sender: OTHER,
  route: '/claims-route',
  params: { fromToken: true },
  height: 'medium',
  initial_height: 150,
  interactive: true,
  iat: 1_700_000_000,
  exp: 1_700_000_900,
  jti: 'jti-inline-1',
} as const;

// ---- capture helpers ----

export interface CapturedError {
  name: string;
  message: string;
  code?: unknown;
  /** Wallet-adapter errors wrap the bridge error. */
  inner?: CapturedError;
}

export function describeError(e: unknown): CapturedError {
  if (!(e instanceof Error)) return { name: 'non-Error', message: String(e) };
  const out: CapturedError = { name: e.name, message: e.message };
  const code = (e as { code?: unknown }).code;
  if (code !== undefined) out.code = code;
  const inner = (e as { error?: unknown }).error;
  if (inner instanceof Error) out.inner = describeError(inner);
  return out;
}

export type Outcome =
  | { threw: CapturedError }
  | { resolved: unknown }
  | { rejected: CapturedError }
  | { returned: unknown };

/**
 * Run `fn` and record how it ended — synchronous throw vs rejected promise is
 * part of the contract (e.g. an unserialisable transaction throws
 * synchronously), so the two are kept distinct.
 */
export async function outcome(fn: () => unknown): Promise<Outcome> {
  let value: unknown;
  try {
    value = fn();
  } catch (e) {
    return { threw: describeError(e) };
  }
  if (!(value instanceof Promise)) return { returned: plain(value) };
  try {
    return { resolved: plain(await value) };
  } catch (e) {
    return { rejected: describeError(e) };
  }
}

/**
 * JSON-safe copy that keeps the shape strict: `undefined` and byte arrays are
 * encoded explicitly so a JSON round trip cannot hide an added key.
 */
export function plain(value: unknown): unknown {
  if (value === undefined) return '[undefined]';
  if (value instanceof Uint8Array) return { bytes: Array.from(value) };
  if (value instanceof Error) return describeError(value);
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = plain(v);
    return out;
  }
  return value;
}

export function b64(bytes: number[]): string {
  return Buffer.from(bytes).toString('base64');
}
