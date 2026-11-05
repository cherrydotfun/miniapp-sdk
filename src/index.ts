// Core types and constants
export {
  BRIDGE_VERSION,
  type BridgeMessage,
  type BridgeInitMessage,
  type BridgeReadyMessage,
  type BridgeRequest,
  type BridgeResponse,
  type BridgeEvent,
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
  type BridgeOptions,
  type BridgeTransport,
} from './bridge';
export { DEFAULT_TRUSTED_HOST_ORIGINS } from './constants';

// Main client
export { CherryMiniApp, type CherryMiniAppOptions, type CherryMiniAppEvent } from './client';

// Server-side token verification
export {
  verifyLaunchToken,
  LaunchTokenError,
  type VerifyLaunchTokenOptions,
  type LaunchTokenErrorCode,
  type LaunchTokenScope,
} from './token';

// Custom auth helpers (Privy, etc.)
export {
  getCherryCustomAuthConfig,
  CHERRY_JWKS_URL,
  CHERRY_ISSUER,
  type CherryCustomAuthConfig,
} from './privy';
