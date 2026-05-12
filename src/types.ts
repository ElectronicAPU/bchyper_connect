// SDK Options
export interface BChyperConnectOptions {
  appName: string;    // sent as { webApp } in webQr emit
  pairingUrl: string; // your BCSWAP_PAIRING_URL value
}

// Transaction
export interface SwapDetails {
  chainId: number;
  tokenAddressA: string;    // "NATIVE" or contract address
  tokenAddressB: string;    // "NATIVE" or contract address
  tokenSymbolA: string;
  tokenSymbolB: string;
  tokenDecimalsA: number;
  tokenDecimalsB: number;
  amountIn: string;
  amountOut: string;
  slippage: string;
  deadlineMinutes: number;
  isNativePay: boolean;
  isWrap: boolean;
  isUnwrap: boolean;
}

// Specific shape for SWAP action (kept for reference and autocomplete)
export interface SwapTransactionDetails {
  SWAP: SwapDetails;
}

// Generic — any action key works: SWAP, STAKE, UNSTAKE, BRIDGE, etc.
// { SWAP: { ... } } | { STAKE: { ... } } | { BRIDGE: { ... } }
export type TransactionDetails = {
  [action: string]: Record<string, any>;
};

export interface SendTransactionPayload {
  sessionCode: string;
  walletAddress: string;
  remark: string;       // always "send transaction"
  app: string;          // always "DEX"
  transactionDetails: TransactionDetails;
}

// Socket Event Payloads

// Emitted: webQr
export interface WebQrPayload {
  webApp: string;
}

// Ack from webQr / pushed via webQrReady
export interface QrResponse {
  qrImage: string;
  sessionCode?: string;
}

// Emitted: webReconnect
export interface WebReconnectPayload {
  sessionCode: string;
}

// Ack from webReconnect
export interface WebReconnectAck {
  success?: boolean;
}

// Received: mobileConnected
export interface MobileConnectedData {
  sessionCode?: string;
  address?: string;      // fallback key server may use
  userAddress?: string;  // fallback key server may use
  walletAddress?: string;
}

// Received: mobileReconnected
export interface MobileReconnectedData {
  walletAddress: string;
}

// Received: otherDisconnected
export interface OtherDisconnectedData {
  message?: string;
}

// Received: transactionAccepted / transactionRejected
export interface TransactionResult {
  data?: {
    txHash?: string;
    [key: string]: any;
  };
  message?: string;
  [key: string]: any;
}

// SDK Event Map (EventEmitter typed events)

export interface BChyperEvents {
  qr:                  (payload: { qrImage: string; sessionCode: string }) => void;
  connected:           (payload: { sessionCode: string; walletAddress: string }) => void;
  reconnected:         (payload: { walletAddress: string }) => void;
  transactionAccepted: (result: TransactionResult) => void;
  transactionRejected: (result: TransactionResult) => void;
  disconnected:        (payload: { message: string }) => void;
  error:               (message: string) => void;
}

// Hook Return Type

export type TransactionStatus = "idle" | "pending" | "accepted" | "rejected";

export interface UseBChyperConnectReturn {
  // State
  isConnected: boolean;
  isConnecting: boolean;
  address: string | null;             // sessionCode
  mobileAddress: string | null;       // actual wallet address
  qrImageBase64: string | null;
  connectionError: string | null;
  lastConnectedTime: number;
  // Transaction
  transactionStatus: TransactionStatus;
  transactionResult: TransactionResult | null;
  // Actions
  connectToBCSwap: () => void;
  disconnectBCSwap: () => void;
  sendTransaction: (txDetails: TransactionDetails) => void;
  resetTransactionState: () => void;
}
