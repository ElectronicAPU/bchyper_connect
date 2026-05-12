import { useState, useEffect, useRef, useCallback } from "react";
import { BChyperConnect } from "../core/BChyperConnect";
import {
  STORAGE_KEY_SESSION,
  STORAGE_KEY_QR,
  STORAGE_KEY_ADDRESS,
} from "../constants";
import type {
  BChyperConnectOptions,
  TransactionDetails,
  TransactionResult,
  TransactionStatus,
  UseBChyperConnectReturn,
} from "../types";

export function useBChyperConnect(
  options: BChyperConnectOptions
): UseBChyperConnectReturn {
  const { appName, pairingUrl } = options;

  // State (mirrors useBCSwapConnect.js exactly)
  const [isConnected,       setIsConnected]       = useState(false);
  const [isConnecting,      setIsConnecting]      = useState(false);
  const [address,           setAddress]           = useState<string | null>(null);
  const [mobileAddress,     setMobileAddress]     = useState<string | null>(null);
  const [qrImageBase64,     setQrImageBase64]     = useState<string | null>(null);
  const [connectionError,   setConnectionError]   = useState<string | null>(null);
  const [lastConnectedTime, setLastConnectedTime] = useState(0);
  const [transactionStatus, setTransactionStatus] = useState<TransactionStatus>("idle");
  const [transactionResult, setTransactionResult] = useState<TransactionResult | null>(null);

  const connectorRef    = useRef<BChyperConnect | null>(null);
  const isConnectingRef = useRef(false);
  const isConnectedRef  = useRef(false);

  // Keep refs in sync — prevents stale closures (mirrors hook pattern)
  useEffect(() => {
    isConnectingRef.current = isConnecting;
    isConnectedRef.current  = isConnected;
  }, [isConnecting, isConnected]);

  // Internal helpers

  const _resetState = useCallback((error?: string) => {
    localStorage.removeItem(STORAGE_KEY_SESSION);
    localStorage.removeItem(STORAGE_KEY_QR);
    localStorage.removeItem(STORAGE_KEY_ADDRESS);

    setIsConnected(false);
    setIsConnecting(false);
    setAddress(null);
    setMobileAddress(null);
    setQrImageBase64(null);
    setConnectionError(error ?? null);
  }, []);

  // Page reload rehydration
  // Mirrors the useEffect([]) block in useBCSwapConnect.js

  useEffect(() => {
    const savedSession = localStorage.getItem(STORAGE_KEY_SESSION);
    const savedQr      = localStorage.getItem(STORAGE_KEY_QR);
    const savedAddress = localStorage.getItem(STORAGE_KEY_ADDRESS);

    if (savedSession && savedSession !== "Mobile-App-User") {
      setAddress(savedSession);
      setIsConnected(true);
      if (savedQr)      setQrImageBase64(savedQr);
      if (savedAddress) setMobileAddress(savedAddress);

      const connector = new BChyperConnect({ appName, pairingUrl });
      connectorRef.current = connector;

      connector.on("connected", ({ walletAddress }) => {
        setMobileAddress(walletAddress);
        setIsConnected(true);
        localStorage.setItem(STORAGE_KEY_ADDRESS, walletAddress);
      });

      connector.on("reconnected", ({ walletAddress }) => {
        setMobileAddress(walletAddress);
        setIsConnected(true);
        localStorage.setItem(STORAGE_KEY_ADDRESS, walletAddress);
      });

      connector.on("transactionAccepted", (res) => {
        setTransactionStatus("accepted");
        setTransactionResult(res);
      });

      connector.on("transactionRejected", (res) => {
        setTransactionStatus("rejected");
        setTransactionResult(res);
      });

      // otherDisconnected is intentionally ignored on restore to prevent
      // UI flash on temp disconnect — mirrors hook behaviour exactly
      connector.on("error", (msg) => setConnectionError(msg));

      connector.reconnect(savedSession, savedAddress ?? undefined);

    } else if (savedSession === "Mobile-App-User") {
      // Clear invalid legacy session — mirrors hook
      localStorage.removeItem(STORAGE_KEY_SESSION);
    }

    return () => {
      connectorRef.current?.disconnect();
    };
  }, []); // run once on mount

  // connectToBCSwap()
  // Mirrors connectToBCSwap() in useBCSwapConnect.js

  const connectToBCSwap = useCallback(() => {
    if (isConnectingRef.current || isConnectedRef.current) return;

    _resetState();
    setIsConnecting(true);

    // Cleanup previous connector
    connectorRef.current?.disconnect();

    const connector = new BChyperConnect({ appName, pairingUrl });
    connectorRef.current = connector;

    connector.on("qr", ({ qrImage, sessionCode }) => {
      setQrImageBase64(qrImage);
      localStorage.setItem(STORAGE_KEY_QR, qrImage);
      if (sessionCode) {
        // Store temp sessionCode from QR — confirmed in mobileConnected
      }
    });

    connector.on("connected", ({ sessionCode, walletAddress }) => {
      setAddress(sessionCode);
      setMobileAddress(walletAddress);
      setIsConnected(true);
      setIsConnecting(false);
      setConnectionError(null);
      setLastConnectedTime(Date.now());
      localStorage.setItem(STORAGE_KEY_SESSION, sessionCode);
      localStorage.setItem(STORAGE_KEY_ADDRESS, walletAddress);
    });

    connector.on("reconnected", ({ walletAddress }) => {
      setMobileAddress(walletAddress);
      setIsConnected(true);
      setIsConnecting(false);
      localStorage.setItem(STORAGE_KEY_ADDRESS, walletAddress);
    });

    connector.on("transactionAccepted", (res) => {
      setTransactionStatus("accepted");
      setTransactionResult(res);
    });

    connector.on("transactionRejected", (res) => {
      setTransactionStatus("rejected");
      setTransactionResult(res);
    });

    connector.on("disconnected", ({ message }) => {
      _resetState(`Disconnected: ${message}`);
    });

    connector.on("error", (msg) => {
      _resetState(msg);
    });

    connector.connect();
  }, [appName, pairingUrl, _resetState]);

  // disconnectBCSwap()
  // Mirrors disconnectBCSwap() in useBCSwapConnect.js

  const disconnectBCSwap = useCallback(() => {
    connectorRef.current?.disconnect();
    _resetState();
  }, [_resetState]);

  // sendTransaction()
  // Mirrors sendTransaction() in useBCSwapConnect.js

  const sendTransaction = useCallback((txDetails: TransactionDetails) => {
    if (!connectorRef.current) return;
    setTransactionStatus("pending");
    setTransactionResult(null);
    connectorRef.current.sendTransaction(txDetails);
  }, []);

  // resetTransactionState()

  const resetTransactionState = useCallback(() => {
    setTransactionStatus("idle");
    setTransactionResult(null);
  }, []);

  // Cleanup on unmount

  useEffect(() => {
    return () => {
      connectorRef.current?.disconnect();
    };
  }, []);

  return {
    isConnected,
    isConnecting,
    address,
    mobileAddress,
    qrImageBase64,
    connectionError,
    lastConnectedTime,
    transactionStatus,
    transactionResult,
    connectToBCSwap,
    disconnectBCSwap,
    sendTransaction,
    resetTransactionState,
  };
}
