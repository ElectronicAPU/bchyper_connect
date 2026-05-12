// Core class (framework-agnostic)
export { BChyperConnect } from "./core/BChyperConnect";

// React hook
export { useBChyperConnect } from "./react/useBChyperConnect";

// Types
export type {
  BChyperConnectOptions,
  SwapTransactionDetails,
  SwapDetails,
  SendTransactionPayload,
  TransactionResult,
  TransactionStatus,
  BChyperEvents,
  UseBChyperConnectReturn,
} from "./types";

// Constants (in case consumer wants storage key names)
export {
  STORAGE_KEY_SESSION,
  STORAGE_KEY_QR,
  STORAGE_KEY_ADDRESS,
  APP_NAME,
} from "./constants";
