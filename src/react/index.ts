// React provider and context
export { CherryMiniAppProvider, type CherryMiniAppProviderProps } from './provider';

// Hooks
export {
  useCherryMiniApp,
  useCherryApp,
  useCherryWallet,
  useCherryNavigate,
  useCherryShare,
  useCherryEnvironment,
  type UseCherryMiniAppResult,
  type UseCherryWalletResult,
} from './hooks';

// Re-export commonly needed types from core
export type {
  CherryUser,
  CherryRoom,
  CherryEnvironment,
  CherryPlatform,
  LaunchTokenPayload,
  ShareBlinkOptions,
  ShareBlinkResult,
} from '../types';

// Re-export environment helpers (useful in non-hook contexts inside React apps)
export { isInsideCherry, getCherryEnvironment, detectPlatform, type DetectPlatformOptions } from '../env';

// Re-export main client for direct use
export { CherryMiniApp, type CherryMiniAppOptions, type CherryMiniAppEvent } from '../client';
export { verifyLaunchToken } from '../token';
export { BRIDGE_VERSION } from '../types';
