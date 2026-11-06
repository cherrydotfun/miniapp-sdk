// Core types and constants
export {
  BRIDGE_VERSION,
  type BridgeMessage,
  type BridgeInitMessage,
  type BridgeReadyMessage,
  type BridgeRequest,
  type BridgeResponse,
  type BridgeEvent,
  type BridgeContextMessage,
  type CherryHostContext,
  type CherryDisplayContext,
  type CherryLocale,
  type CherryColorScheme,
  type CherryHostPlatform,
  type CherrySafeArea,
  type MiniAppPublicProfile,
  type MiniAppUserSummary,
  type MiniAppUserPage,
  type MiniAppRelationship,
  type CherryPlatform,
  type CherryEnvironment,
  type LaunchTokenPayload,
  type CherryAppTier,
  type CherryReach,
  type PaymentWalletKind,
  type PaymentWalletSetBy,
  type CherryUser,
  type CherryRoom,
  type CherryNavigate,
  type CherryWallet,
  type CherryBlinkContext,
  type CherryContext,
  type CherryLaunchMode,
  type ShareBlinkOptions,
  type ShareBlinkResult,
} from './types';

// Environment detection
export { detectPlatform, isInsideCherry, getCherryEnvironment, type DetectPlatformOptions } from './env';

// Bridge transport (exposed for advanced usage)
export {
  Bridge,
  BridgeError,
  getSharedBridge,
  destroySharedBridge,
  isTrustedHostOrigin,
  getBridgeError,
  isPolicyDenied,
  type BridgeErrorCode,
  type CherryPolicyCode,
  type CherryPolicyDenial,
  type BridgeOptions,
  type BridgeTransport,
} from './bridge';
export { DEFAULT_TRUSTED_HOST_ORIGINS, CHERRY_LOCALES } from './constants';

// Main client
export {
  CherryMiniApp,
  type CherryMiniAppOptions,
  type CherryMiniAppEvent,
  type CherryContextListener,
} from './client';

// Context v2 — language, theme, platform, safe area (opt-in document helper)
export { readCherryDisplayContext, applyCherryContextToDocument } from './context';

// Public profile API (`cherry.users`)
export {
  CherryApiError,
  cherryApiOrigin,
  type CherryApiErrorCode,
  type CherryUsersApi,
  type CherryUserPageOptions,
} from './users';

// Server-side token verification
export {
  verifyLaunchToken,
  LaunchTokenError,
  type VerifyLaunchTokenOptions,
  type LaunchTokenErrorCode,
  type LaunchTokenScope,
} from './token';

// On-chain attribution & Cherry fee math (library-agnostic; the /solana and
// /kit entries add instruction builders)
export {
  getAppReferenceKeyBytes,
  getAppReferenceAddress,
  splitCherryFee,
  cherryShareOf,
  CHERRY_APP_REFERENCE_PREFIX,
  CHERRY_REVENUE_SHARE_BPS,
  type CherryFeeSplitAmounts,
} from './attribution';

// Custom auth helpers (Privy, etc.)
export {
  getCherryCustomAuthConfig,
  CHERRY_JWKS_URL,
  CHERRY_ISSUER,
  type CherryCustomAuthConfig,
} from './privy';
