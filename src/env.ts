import type { CherryPlatform, CherryEnvironment } from './types';

export interface DetectPlatformOptions {
  /**
   * When `true`, only Cherry-injected signals are accepted:
   *   - `window.__cherry` for mobile WebView
   *   - `cherry_embed=1` query parameter for web iframe
   *
   * Fallbacks (`ReactNativeWebView`, plain `window.parent !== window`) are
   * disabled. Use this once all Cherry hosts you target have been updated to
   * inject the new signals, to eliminate false positives (e.g. wallet
   * in-app browsers that also run inside a WebView).
   *
   * Default: `false` (fallbacks enabled for backward compatibility).
   */
  strict?: boolean;
}

/**
 * Detect whether we're running inside Cherry messenger.
 *
 * WebView (mobile):
 *   - Primary:  `window.__cherry` — injected by Cherry before page loads
 *   - Fallback: `ReactNativeWebView` — present in any RN WebView (for older
 *               Cherry builds that don't inject `__cherry` yet)
 *               Disabled when `strict: true`.
 *
 * iframe (web):
 *   - Primary:  `cherry_embed=1` query parameter (set by Cherry host)
 *   - Fallback: plain `window.parent !== window` (for older Cherry builds
 *               that don't set the param yet)
 *               Disabled when `strict: true`.
 *
 * The fallback paths will be removed in a future major version once all
 * Cherry hosts are updated.
 */
export function detectPlatform(options: DetectPlatformOptions = {}): CherryPlatform {
  const { strict = false } = options;

  if (typeof window === 'undefined') return 'standalone';

  // Cherry-injected primary signals (fast path, no ambiguity).
  if ((window as unknown as { __cherry?: boolean }).__cherry) return 'webview';
  if (new URLSearchParams(window.location.search).get('cherry_embed') === '1') return 'iframe';

  if (strict) return 'standalone';

  // Fallback heuristics — order matters:
  // 1) Any nested iframe is iframe transport. This MUST run before the
  //    ReactNativeWebView check, otherwise Phantom mobile in-app browser
  //    (a RN WebView that injects window.ReactNativeWebView and then loads
  //    Cherry, which loads our miniapp inside an iframe) gets misclassified
  //    as a Cherry-mobile RN host and the SDK posts to the native bridge
  //    instead of the parent frame.
  if (window.parent !== window) return 'iframe';
  // 2) Top frame with a RN WebView bridge — this is the real Cherry-mobile
  //    case (miniapp loaded directly by the RN host, no iframe in between).
  if ((window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView) return 'webview';

  return 'standalone';
}

export function isInsideCherry(options: DetectPlatformOptions = {}): boolean {
  return detectPlatform(options) !== 'standalone';
}

export function getCherryEnvironment(options: DetectPlatformOptions = {}): CherryEnvironment {
  const platform = detectPlatform(options);
  return {
    isEmbedded: platform !== 'standalone',
    platform,
  };
}
