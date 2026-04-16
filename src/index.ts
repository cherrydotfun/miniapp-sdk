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
  type CherryUser,
  type CherryRoom,
  type CherryNavigate,
  type CherryWallet,
} from './types';

// Environment detection
export { detectPlatform, isInsideCherry, getCherryEnvironment, type DetectPlatformOptions } from './env';

// Bridge transport (exposed for advanced usage)
export { Bridge, BridgeError, getSharedBridge, destroySharedBridge } from './bridge';

// Main client
export { CherryMiniApp, type CherryMiniAppOptions, type CherryMiniAppEvent } from './client';

// Server-side token verification
export { verifyLaunchToken } from './token';

// Custom auth helpers (Privy, etc.)
export {
  getCherryCustomAuthConfig,
  CHERRY_JWKS_URL,
  CHERRY_ISSUER,
  type CherryCustomAuthConfig,
} from './privy';
