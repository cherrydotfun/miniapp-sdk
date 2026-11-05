/** Issuer (`iss`) of every Cherry launch token. */
export const CHERRY_ISSUER = 'https://chat.cherry.fun';

/** Public keys that sign Cherry launch tokens (RS256, rotated by `kid`). */
export const CHERRY_JWKS_URL = 'https://chat.cherry.fun/.well-known/jwks.json';

/**
 * Origins of the Cherry web hosts a mini-app accepts `postMessage` traffic
 * from in iframe mode. `https://*.cherry.fun` matches any subdomain, the way a
 * CSP `frame-ancestors` source does. Extend it (e.g. for a staging host) with
 * the `trustedOrigins` option; it can't be narrowed or disabled.
 */
export const DEFAULT_TRUSTED_HOST_ORIGINS: readonly string[] = Object.freeze([
  'https://chat.cherry.fun',
  'https://cherry.fun',
  'https://*.cherry.fun',
]);

/** The languages Cherry ships, as `CherryContext.locale` reports them. */
export const CHERRY_LOCALES = Object.freeze(['en', 'ru', 'de', 'fr', 'es', 'id', 'vi', 'zh', 'ja', 'ko'] as const);
