import { useState, useEffect, useRef, useCallback } from "react";
import { BChyperConnect } from "../core/BChyperConnect";
import {
  STORAGE_KEY_SESSION,
  STORAGE_KEY_QR,
  STORAGE_KEY_ADDRESS,
} from "../constants";
import type {
  BChyperConnectOptions,
  ConnectionListWebResponse,
  ConnectionRemovedResponse,
  TransactionDetails,
  TransactionResult,
  TransactionStatus,
  UseBChyperConnectReturn,
} from "../types";

export function useBChyperConnect(
  options: BChyperConnectOptions
): UseBChyperConnectReturn {
  const { appName, pairingUrl, deviceInfo } = options;

  // State (mirrors useBCSwapConnect.js exactly)
  const [isConnected,       setIsConnected]       = useState(false);
  const [isConnecting,      setIsConnecting]      = useState(false);
  const [isDisconnected,    setIsDisconnected]    = useState(false);
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

  // Resets in-memory state only. Does NOT touch localStorage — the saved
  // session/address are needed by reconnectSession() when mobile drops the
  // connection unexpectedly. Storage is only cleared on an intentional
  // web-side disconnect (see disconnectBCSwap).
  const _resetState = useCallback((error?: string) => {
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

      const connector = new BChyperConnect({ appName, pairingUrl, deviceInfo });
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

      // A genuine mobile-side disconnect (app killed, network loss, or the
      // user disconnecting from the mobile app itself) must be reported
      // here too — otherwise a session restored on page load can look
      // permanently "connected" even after the phone has actually dropped it.
      connector.on("disconnected", ({ message }) => {
        _resetState(`Disconnected: ${message}`);
        setIsDisconnected(true);
      });

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
    setIsDisconnected(false);
    setIsConnecting(true);

    // Cleanup previous connector
    connectorRef.current?.disconnect();

    const connector = new BChyperConnect({ appName, pairingUrl, deviceInfo });
    connectorRef.current = connector;

    connector.on("qr", ({ qrImage, sessionCode }) => {
      setQrImageBase64(qrImage);
      localStorage.setItem(STORAGE_KEY_QR, qrImage);
      if (sessionCode) {
        setAddress(sessionCode)
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
      // Mobile dropped the connection — keep localStorage intact so
      // reconnectSession() can restore the session afterward.
      _resetState(`Disconnected: ${message}`);
      setIsDisconnected(true);
    });

    connector.on("error", (msg) => {
      _resetState(msg);
    });

    connector.connect();
  }, [appName, pairingUrl, _resetState]);

  // reconnectSession()
  // Runtime reconnect (no page reload) after mobile drops the connection.

  const reconnectSession = useCallback((savedSession: string, savedAddress?: string) => {
    if (!savedSession) return;

    connectorRef.current?.disconnect();
    setIsDisconnected(false);
    setIsConnecting(true);

    const connector = new BChyperConnect({ appName, pairingUrl, deviceInfo });
    connectorRef.current = connector;

    connector.on("reconnected", ({ walletAddress }) => {
      const resolvedAddress = walletAddress || savedAddress || "";
      setMobileAddress(resolvedAddress);
      setAddress(savedSession);
      setIsConnected(true);
      setIsConnecting(false);
      setConnectionError(null);
      localStorage.setItem(STORAGE_KEY_SESSION, savedSession);
      localStorage.setItem(STORAGE_KEY_ADDRESS, resolvedAddress);
    });

    connector.on("disconnected", ({ message }) => {
      _resetState(`Disconnected: ${message}`);
      setIsDisconnected(true);
    });

    connector.on("error", (msg) => {
      _resetState(msg);
    });

    connector.reconnect(savedSession, savedAddress);
  }, [appName, pairingUrl, _resetState]);

  // disconnectBCSwap()
  // Mirrors disconnectBCSwap() in useBCSwapConnect.js — intentional web-side
  // disconnect, so this is the only place saved session data is cleared.

  const disconnectBCSwap = useCallback(() => {
    connectorRef.current?.disconnect();
    localStorage.removeItem(STORAGE_KEY_SESSION);
    localStorage.removeItem(STORAGE_KEY_QR);
    localStorage.removeItem(STORAGE_KEY_ADDRESS);
    _resetState();
    setIsDisconnected(false);
  }, [_resetState]);

  // sendTransaction()
  // Mirrors sendTransaction() in useBCSwapConnect.js

  const sendTransaction = useCallback((txDetails: TransactionDetails) => {
    if (!connectorRef.current) return;
    setTransactionStatus("pending");
    setTransactionResult(null);
    connectorRef.current.sendTransaction(txDetails);
  }, []);

  // getConnections()
  // Lists all active connections paired to this app name.
  const getConnections = useCallback((): Promise<ConnectionListWebResponse> => {
    if (!connectorRef.current) {
      return Promise.reject(new Error("Not connected"));
    }
    return connectorRef.current.getConnections();
  }, []);

  // removeConnection()
  // Removes/logs out a specific connection by id.
  const removeConnection = useCallback((id: number): Promise<ConnectionRemovedResponse> => {
    if (!connectorRef.current) {
      return Promise.reject(new Error("Not connected"));
    }
    return connectorRef.current.removeConnection(id);
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
    isDisconnected,
    address,
    mobileAddress,
    qrImageBase64,
    connectionError,
    lastConnectedTime,
    transactionStatus,
    transactionResult,
    connectToBCSwap,
    disconnectBCSwap,
    reconnectSession,
    sendTransaction,
    resetTransactionState,
    getConnections,
    removeConnection,
  };
}
