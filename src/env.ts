import type { CherryPlatform, CherryEnvironment } from './types';

export function detectPlatform(): CherryPlatform {
  if (typeof window === 'undefined') return 'standalone';
  if ((window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView) return 'webview';
  if (window.parent !== window) return 'iframe';
  return 'standalone';
}

export function isInsideCherry(): boolean {
  return detectPlatform() !== 'standalone';
}

export function getCherryEnvironment(): CherryEnvironment {
  const platform = detectPlatform();
  return {
    isEmbedded: platform !== 'standalone',
    platform,
  };
}
