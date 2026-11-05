import { decodeJwt } from 'jose';
import type {
  CherryColorScheme,
  CherryDisplayContext,
  CherryHostPlatform,
  CherrySafeArea,
  MiniAppPublicProfile,
} from './types';

// Context v2: the host's language, colour scheme, platform and safe area, and
// the person's public profile. Everything here reads UNTRUSTED input (a
// postMessage, the URL, an unverified token) field by field: a value that is
// not what the contract says is dropped, never passed through.

const COLOR_SCHEMES: readonly CherryColorScheme[] = ['dark', 'light'];
const HOST_PLATFORMS: readonly CherryHostPlatform[] = ['ios', 'android', 'web'];

/** A BCP 47-shaped tag: `en`, `zh`, `pt-BR`, `zh-Hant-TW`. */
const LOCALE_TAG = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

/** URL parameters the hosts append to the app URL (query string). */
export const CHERRY_LANG_PARAM = 'cherry_lang';
export const CHERRY_THEME_PARAM = 'cherry_theme';

// ---- field readers ----

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function text(value: unknown, max = 512): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function localeOf(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 35 && LOCALE_TAG.test(value) ? value : null;
}

export function colorSchemeOf(value: unknown): CherryColorScheme | null {
  return oneOf(value, COLOR_SCHEMES);
}

function safeAreaOf(value: unknown): CherrySafeArea | null {
  if (!isObject(value)) return null;
  const edges = [value['top'], value['right'], value['bottom'], value['left']].map(finite);
  if (edges.some((e) => e === null)) return null;
  const [top, right, bottom, left] = edges.map((e) => Math.max(0, e as number)) as [number, number, number, number];
  return { top, right, bottom, left };
}

// ---- resolution ----

/**
 * The display half of the context, field by field: the host's context first,
 * then the launch URL (`cherry_lang` / `cherry_theme`), then the launch
 * token's `locale` claim.
 */
export function resolveDisplayContext(input: {
  host: Readonly<Record<string, unknown>> | null;
  urlLang?: string | null;
  urlTheme?: string | null;
  tokenLocale?: unknown;
}): CherryDisplayContext {
  const host = input.host ?? {};
  return {
    locale: localeOf(host['locale']) ?? localeOf(input.urlLang) ?? localeOf(input.tokenLocale),
    colorScheme: colorSchemeOf(host['colorScheme']) ?? colorSchemeOf(input.urlTheme),
    brand: text(host['brand'], 64),
    platform: oneOf(host['platform'], HOST_PLATFORMS),
    appVersion: text(host['appVersion'], 64),
    safeArea: safeAreaOf(host['safeArea']),
  };
}

/** Whether two display contexts (and profiles) say the same thing. */
export function sameDisplay(
  a: CherryDisplayContext & { user?: MiniAppPublicProfile | null },
  b: CherryDisplayContext & { user?: MiniAppPublicProfile | null },
): boolean {
  return JSON.stringify(displayKey(a)) === JSON.stringify(displayKey(b));
}

function displayKey(c: CherryDisplayContext & { user?: MiniAppPublicProfile | null }): unknown[] {
  return [c.locale, c.colorScheme, c.brand, c.platform, c.appVersion, c.safeArea, c.user ?? null];
}

// ---- the launch URL, before init ----

function launchParams(url?: string | URL): { get(name: string): string | null } {
  let href: string | null = null;
  if (url instanceof URL) href = url.href;
  else if (typeof url === 'string') href = url;
  else if (typeof window !== 'undefined') href = window.location.href;
  if (href === null) return { get: () => null };
  let parsed: URL;
  try {
    parsed = new URL(href, 'http://localhost');
  } catch {
    return { get: () => null };
  }
  const query = parsed.searchParams;
  const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  return { get: (name) => query.get(name) ?? fragment.get(name) };
}

/**
 * The display context the launch URL already carries — `cherry_lang`,
 * `cherry_theme`, and the inline token's `locale` claim — so the FIRST paint
 * can be in the right language and theme, before `init()` (or outside any
 * provider, or during SSR: pass the request URL). Fields the URL cannot say
 * (`safeArea`, `platform`, …) are `null`. After `init()`, prefer
 * `cherry.context`, which also follows the host live.
 */
export function readCherryDisplayContext(url?: string | URL): CherryDisplayContext {
  const params = launchParams(url);
  let tokenLocale: unknown = null;
  const token = params.get('token');
  if (token) {
    try {
      tokenLocale = (decodeJwt(token) as { locale?: unknown }).locale;
    } catch {
      // not a JWT — nothing to read
    }
  }
  return resolveDisplayContext({
    host: null,
    urlLang: params.get(CHERRY_LANG_PARAM),
    urlTheme: params.get(CHERRY_THEME_PARAM),
    tokenLocale,
  });
}

/**
 * Opt-in: mirror the context onto the document — `<html lang>`, a
 * `data-cherry-theme="dark|light"` attribute for your CSS, and the
 * `color-scheme` property (native form controls and scrollbars). Fields the
 * context does not know are left as they are. The SDK never calls this by
 * itself.
 *
 * ```ts
 * applyCherryContextToDocument(readCherryDisplayContext()); // before init
 * cherry.onContextChange(applyCherryContextToDocument);      // then live
 * ```
 */
export function applyCherryContextToDocument(
  context: Pick<Partial<CherryDisplayContext>, 'locale' | 'colorScheme'> | null | undefined,
  target?: Document,
): void {
  const doc = target ?? (typeof document !== 'undefined' ? document : undefined);
  if (!doc || !context) return;
  const root = doc.documentElement;
  const locale = localeOf(context.locale);
  if (locale) root.lang = locale;
  const scheme = colorSchemeOf(context.colorScheme);
  if (scheme) {
    root.setAttribute('data-cherry-theme', scheme);
    root.style.setProperty('color-scheme', scheme);
  }
}

// ---- the public profile ----

function nullableText(value: unknown, max = 2048): string | null {
  return text(value, max);
}

function list<T>(value: unknown, read: (item: unknown) => T | null): T[] {
  return Array.isArray(value) ? value.map(read).filter((v): v is T => v !== null) : [];
}

/**
 * A `MiniAppPublicProfile` from untrusted JSON, every field coerced to its
 * type (lists default to empty, counters to 0, the rest to `null`), or `null`
 * without a `cherryId`.
 */
export function normaliseProfile(raw: unknown): MiniAppPublicProfile | null {
  if (!isObject(raw)) return null;
  const cherryId = text(raw['cherryId'], 128);
  if (!cherryId) return null;
  const level = isObject(raw['level']) ? raw['level'] : null;
  const pet = isObject(raw['pet']) ? raw['pet'] : null;
  const social = isObject(raw['social']) ? raw['social'] : {};
  const trading = isObject(raw['trading']) ? raw['trading'] : null;
  return {
    cherryId,
    handle: nullableText(raw['handle'], 128),
    displayName: typeof raw['displayName'] === 'string' ? raw['displayName'] : '',
    avatarUrl: nullableText(raw['avatarUrl']),
    bio: typeof raw['bio'] === 'string' ? raw['bio'] : null,
    createdAt: nullableText(raw['createdAt'], 64),
    level:
      level && finite(level['level']) !== null
        ? { level: finite(level['level']) as number, cp: finite(level['cp']) ?? 0 }
        : null,
    pet:
      pet && typeof pet['name'] === 'string'
        ? {
            name: pet['name'],
            species: nullableText(pet['species'], 128),
            stage: nullableText(pet['stage'], 128),
            imageUrl: nullableText(pet['imageUrl']),
          }
        : null,
    socials: list(raw['socials'], (item) => {
      if (!isObject(item)) return null;
      const provider = text(item['provider'], 64);
      const handle = text(item['handle'], 256);
      if (!provider || !handle) return null;
      return { provider, handle, url: nullableText(item['url']), verified: item['verified'] === true };
    }),
    wallets: list(raw['wallets'], (item) => {
      if (!isObject(item)) return null;
      const address = text(item['address'], 128);
      const chain = oneOf(item['chain'], ['solana', 'evm'] as const);
      if (!address || !chain) return null;
      return {
        address,
        chain,
        cherryWallet: item['cherryWallet'] === true,
        domains: list(item['domains'], (d) => text(d, 256)),
      };
    }),
    badges: list(raw['badges'], (item) => {
      if (!isObject(item)) return null;
      const id = text(item['id'], 128);
      if (!id) return null;
      return { id, label: typeof item['label'] === 'string' ? item['label'] : id, iconUrl: nullableText(item['iconUrl']) };
    }),
    social: { followers: finite(social['followers']) ?? 0, following: finite(social['following']) ?? 0 },
    trading: trading
      ? {
          pnlUsd: finite(trading['pnlUsd']),
          volumeUsd: finite(trading['volumeUsd']),
          window: typeof trading['window'] === 'string' ? trading['window'] : '',
        }
      : null,
  };
}
