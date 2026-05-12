export const APP_NAME = "BCSWAP";

export const STORAGE_KEY_SESSION = "bcswap_wallet_session";
export const STORAGE_KEY_QR      = "bcswap_wallet_qr";
export const STORAGE_KEY_ADDRESS = "bcswap_mobile_address";

export const SOCKET_CONFIG = {
  transports: ["websocket", "polling"] as string[],
  upgrade: false,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  timeout: 10000,
};

export const SOCKET_RECONNECT_CONFIG = {
  transports: ["websocket"] as string[],
  upgrade: false,
  reconnection: true,
};
