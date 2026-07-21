import { io, Socket } from "socket.io-client";
import EventEmitter from "eventemitter3";
import {
  SOCKET_CONFIG,
  SOCKET_RECONNECT_CONFIG,
  STORAGE_KEY_SESSION,
  STORAGE_KEY_ADDRESS,
} from "../constants";
import type {
  BChyperConnectOptions,
  BChyperEvents,
  TransactionDetails,
  MobileConnectedData,
  MobileReconnectedData,
  OtherDisconnectedData,
  TransactionResult,
  QrResponse,
} from "../types";

export class BChyperConnect extends EventEmitter<BChyperEvents> {
  private socket: Socket | null = null;
  private sessionCode: string | null = null;
  private walletAddress: string | null = null;
  private appName: string;
  private pairingUrl: string;
  private _isConnecting = false;
  private _isConnected = false;

  constructor(options: BChyperConnectOptions) {
    super();
    this.appName = options.appName;
    this.pairingUrl = options.pairingUrl;
  }

  // Getters
  get isConnected()  { return this._isConnected;  }
  get isConnecting() { return this._isConnecting; }
  get address()      { return this.walletAddress;  }  // actual wallet address
  get session()      { return this.sessionCode;    }  // pairing session code

  // connect()
  // Fresh connect — requests QR from server, emits 'qr' event when ready.
  // Mirrors connectToBCSwap() in useBCSwapConnect.js

  connect(): void {
    if (this._isConnecting || this._isConnected) return;

    this._isConnecting = true;
    this._cleanup();

    const socket = io(this.pairingUrl, SOCKET_CONFIG);
    this.socket = socket;

    let qrRequested = false;

    const requestQr = () => {
      if (qrRequested) return;

      socket.emit("webQr", { webApp: this.appName }, (response: QrResponse | QrResponse[]) => {
        const data = Array.isArray(response) ? response[0] : response;

        if (data?.qrImage) {
          if (data.sessionCode) this.sessionCode = data.sessionCode;
          qrRequested = true;
          this.emit("qr", {
            qrImage: data.qrImage,
            sessionCode: this.sessionCode ?? "",
          });
        } else {
          this._reset("Failed to get QR code");
        }
      });
    };

    socket.on("connect", requestQr);

    // Server may also push QR via event instead of ack
    socket.on("webQrReady", (response: QrResponse | QrResponse[]) => {
      const data = Array.isArray(response) ? response[0] : response;
      if (data?.qrImage) {
        if (data.sessionCode) this.sessionCode = data.sessionCode;
        qrRequested = true;
        this.emit("qr", {
          qrImage: data.qrImage,
          sessionCode: this.sessionCode ?? "",
        });
      }
    });

    this._attachCoreListeners(socket);
  }

  // reconnect()
  // Restores a saved session on page reload.
  // Mirrors the useEffect([]) rehydration block in useBCSwapConnect.js

  reconnect(savedSessionCode: string, savedWalletAddress?: string): void {
    if (!savedSessionCode || savedSessionCode === "Mobile-App-User") return;

    this.sessionCode = savedSessionCode;
    this.walletAddress = savedWalletAddress ?? null;
    this._isConnected = true;

    const socket = io(this.pairingUrl, SOCKET_RECONNECT_CONFIG);
    this.socket = socket;

    socket.on("connect", () => {
      socket.emit(
        "webReconnect",
        { sessionCode: savedSessionCode },
        (response: { success?: boolean } | boolean) => {
          const ok =
            (response as { success?: boolean })?.success === true ||
            response === true;

          if (!ok) {
            // Session expired on server
            this._reset("Session expired. Please reconnect.");
          }
        }
      );
    });

    // otherDisconnected is reported on restored sessions too, so a genuine
    // mobile-side disconnect (including one the user triggers manually from
    // the mobile app) is never silently swallowed after a reconnect/reload.
    this._attachCoreListeners(socket);
  }

  // sendTransaction()
  // Sends swap details to mobile for signing.
  // Payload shape exactly matches SwapComponent.jsx → handleMobileConfirm()

  sendTransaction(transactionDetails: TransactionDetails): void {
    if (!this.socket?.connected) {
      this.emit("error", "Cannot send transaction: socket not connected");
      return;
    }

    const currentAddress =
      this.walletAddress ?? localStorage.getItem(STORAGE_KEY_ADDRESS);

    if (!currentAddress) {
      this.emit("error", "Cannot send transaction: no wallet address found");
      return;
    }

    const payload = {
      sessionCode: this.sessionCode ?? localStorage.getItem(STORAGE_KEY_SESSION),
      walletAddress: currentAddress,
      remark: "send transaction",
      app: "DEX",
      transactionDetails,
    };

    this.socket.emit("webSendTransaction", payload, (_ack: unknown) => {
      // ack is informational only — result arrives via transactionAccepted/Rejected
    });
  }

  // disconnect()
  // Manual disconnect — mirrors disconnectBCSwap() in hook
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
    }
    this._cleanup();
    this._reset();
  }

  // Private

  private _attachCoreListeners(
    socket: Socket,
    options: { ignoreOtherDisconnected?: boolean } = {}
  ): void {
    socket.on("mobileConnected", (data: MobileConnectedData) => {
      // sessionCode may come under different keys -- mirrors hook fallback chain
      const sessionCode =
        data.sessionCode ??
        data.address ??
        data.userAddress ??
        this.sessionCode;

      const walletAddress = data.walletAddress;

      if (sessionCode)   this.sessionCode  = sessionCode;
      if (walletAddress) this.walletAddress = walletAddress;

      this._isConnected  = true;
      this._isConnecting = false;

      this.emit("connected", {
        sessionCode:   this.sessionCode  ?? "",
        walletAddress: this.walletAddress ?? "",
      });
    });

    socket.on("mobileReconnected", (data: MobileReconnectedData) => {
      if (data.walletAddress) {
        this.walletAddress = data.walletAddress;
        this._isConnected  = true;
        this._isConnecting = false;
      }
      this.emit("reconnected", { walletAddress: data.walletAddress ?? "" });
    });

    socket.on("transactionAccepted", (response: TransactionResult) => {
      this.emit("transactionAccepted", response);
    });

    socket.on("transactionRejected", (response: TransactionResult) => {
      this.emit("transactionRejected", response);
    });

    socket.on("otherDisconnected", (data: OtherDisconnectedData) => {
      if (options.ignoreOtherDisconnected) return;
      this._reset(data?.message ?? "Disconnected");
      this.emit("disconnected", { message: data?.message ?? "Disconnected" });
    });

    socket.on("connect_error", (err: Error) => {
      this._reset(`Connection error: ${err.message}`);
      this.emit("error", err.message);
    });

    socket.on("error", (err: { message?: string }) => {
      const msg = err?.message ?? "Socket error";
      this._reset(msg);
      this.emit("error", msg);
    });
  }

  private _cleanup(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  private _reset(errorMessage?: string): void {
    this._isConnected  = false;
    this._isConnecting = false;
    this.sessionCode   = null;
    this.walletAddress = null;

    if (errorMessage) {
      this.emit("error", errorMessage);
    }
  }
}
