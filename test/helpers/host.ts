import { vi } from 'vitest';

/** A posted message as the fake host saw it. */
export interface Posted {
  message: Record<string, unknown>;
  targetOrigin: string;
}

/**
 * A fake Cherry web host: replaces `window.parent` (so the SDK runs in iframe
 * mode) with an object whose `postMessage` records what the SDK sent.
 */
export interface FakeParent {
  window: { postMessage: ReturnType<typeof vi.fn> };
  posted: Posted[];
  /** Messages the SDK posted, optionally only of one type. */
  sent(type?: string): Record<string, unknown>[];
  /** The last `cherry:request` the SDK posted. */
  lastRequest(): { id: string; method: string; params?: Record<string, unknown> };
}

export function installFakeParent(): FakeParent {
  const posted: Posted[] = [];
  const parent = {
    postMessage: vi.fn((message: unknown, target: unknown) => {
      const targetOrigin =
        typeof target === 'string' ? target : String((target as { targetOrigin?: string }).targetOrigin);
      posted.push({ message: message as Record<string, unknown>, targetOrigin });
    }),
  };
  Object.defineProperty(window, 'parent', { value: parent, configurable: true, writable: true });
  return {
    window: parent,
    posted,
    sent: (type) => posted.map((p) => p.message).filter((m) => !type || m['type'] === type),
    lastRequest: () => {
      const reqs = posted.map((p) => p.message).filter((m) => m['type'] === 'cherry:request');
      const last = reqs[reqs.length - 1];
      if (!last) throw new Error('no cherry:request was posted');
      return last as { id: string; method: string; params?: Record<string, unknown> };
    },
  };
}

export function restoreParent(): void {
  Object.defineProperty(window, 'parent', { value: window, configurable: true, writable: true });
}

/** Deliver a message to the page as if `source` posted it from `origin`. */
export function deliver(data: unknown, init: { origin?: string; source?: unknown } = {}): void {
  const event = new MessageEvent('message', { data, origin: init.origin ?? '' });
  if ('source' in init) {
    Object.defineProperty(event, 'source', { value: init.source });
  }
  window.dispatchEvent(event);
}

/** Let queued promise callbacks run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

/** An unsigned JWT carrying `claims` — enough for the client, which only decodes. */
export function fakeToken(claims: Record<string, unknown>): string {
  const b64 = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}.c2ln`;
}

export function setUrl(pathAndQuery: string): void {
  window.history.replaceState({}, '', pathAndQuery);
}

/**
 * Make the fake host answer every `cherry:request` the SDK posts with
 * `answer(method, params)` → `{ result }` or `{ error }` (delivered async,
 * from `origin`, as window.parent).
 */
export function autoRespond(
  host: FakeParent,
  answer: (method: string, params: Record<string, unknown> | undefined) => Record<string, unknown> | null,
  origin = 'https://chat.cherry.fun',
): void {
  host.window.postMessage.mockImplementation((message: unknown, target: unknown) => {
    const targetOrigin =
      typeof target === 'string' ? target : String((target as { targetOrigin?: string }).targetOrigin);
    host.posted.push({ message: message as Record<string, unknown>, targetOrigin });
    const msg = message as { type?: string; id?: string; method?: string; params?: Record<string, unknown> };
    if (msg.type !== 'cherry:request' || !msg.method) return;
    const response = answer(msg.method, msg.params);
    if (!response) return;
    setTimeout(() => deliver({ type: 'cherry:response', id: msg.id, ...response }, { origin, source: host.window }), 0);
  });
}
