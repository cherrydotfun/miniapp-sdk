// React provider and context
export { CherryMiniAppProvider, type CherryMiniAppProviderProps } from './provider';

// Hooks
export {
  useCherryMiniApp,
  useCherryApp,
  useCherryWallet,
  useCherryNavigate,
  useCherryShare,
  useCherryBlink,
  useCherryEnvironment,
  useCherryContext,
  useCherryDisplayContext,
  useCherryUser,
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
  CherryAppTier,
  CherryReach,
  PaymentWalletKind,
  PaymentWalletSetBy,
  CherryBlinkContext,
  CherryContext,
  CherryDisplayContext,
  CherryLocale,
  CherryColorScheme,
  CherryHostPlatform,
  CherrySafeArea,
  MiniAppPublicProfile,
  MiniAppUserSummary,
  MiniAppUserPage,
  MiniAppRelationship,
  CherryLaunchMode,
  ShareBlinkOptions,
  ShareBlinkResult,
} from '../types';

// Context v2 helpers (no provider needed)
export { readCherryDisplayContext, applyCherryContextToDocument } from '../context';
export { CherryApiError, type CherryApiErrorCode, type CherryUsersApi, type CherryUserPageOptions } from '../users';

// Re-export environment helpers (useful in non-hook contexts inside React apps)
export { isInsideCherry, getCherryEnvironment, detectPlatform, type DetectPlatformOptions } from '../env';

// Re-export main client for direct use
export {
  CherryMiniApp,
  type CherryMiniAppOptions,
  type CherryMiniAppEvent,
  type CherryContextListener,
} from '../client';
export { verifyLaunchToken, LaunchTokenError, type VerifyLaunchTokenOptions } from '../token';
export {
  BridgeError,
  getBridgeError,
  isPolicyDenied,
  type BridgeErrorCode,
  type CherryPolicyCode,
  type CherryPolicyDenial,
} from '../bridge';
export { BRIDGE_VERSION } from '../types';
