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
  WebDeviceInfo,
  ConnectionListWebResponse,
  ConnectionRemovedResponse,
} from "../types";

export class BChyperConnect extends EventEmitter<BChyperEvents> {
  private socket: Socket | null = null;
  private sessionCode: string | null = null;
  private walletAddress: string | null = null;
  private appName: string;
  private pairingUrl: string;
  private deviceInfo: WebDeviceInfo;
  private _isConnecting = false;
  private _isConnected = false;

  constructor(options: BChyperConnectOptions) {
    super();
    this.appName = options.appName;
    this.pairingUrl = options.pairingUrl;
    this.deviceInfo = options.deviceInfo ?? {};
  }

  // Getters
  get isConnected() {
    return this._isConnected;
  }
  get isConnecting() {
    return this._isConnecting;
  }
  get address() {
    return this.walletAddress;
  } // actual wallet address
  get session() {
    return this.sessionCode;
  } // pairing session code
  get socketId() {
    return this.socket?.id ?? null;
  } // current webSocketId

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

    const webQrPayload = { webApp: this.appName, ...this.deviceInfo };

    const requestQr = () => {
      if (qrRequested) {
        if (this.sessionCode) {
          socket.emit("webReconnect", { sessionCode: this.sessionCode });
        }
        return;
      }

      socket.emit(
        "webQr",
        webQrPayload,
        (response: QrResponse | QrResponse[]) => {
          const data = Array.isArray(response) ? response[0] : response;

          if (data?.qrImage) {
            if (data.sessionCode) this.sessionCode = data.sessionCode;
            qrRequested = true;
            this.emit("qr", {
              ...webQrPayload,
              qrImage: data.qrImage,
              sessionCode: this.sessionCode ?? "",
            });
          } else {
            this._reset("Failed to get QR code");
          }
        },
      );
    };

    socket.on("connect", requestQr);

    // Server may also push QR via event instead of ack
    socket.on("webQrReady", (response: QrResponse | QrResponse[]) => {
      const data = Array.isArray(response) ? response[0] : response;
      if (data?.qrImage) {
        if (data.sessionCode) this.sessionCode = data.sessionCode;
        qrRequested = true;
        this.emit("qr", {
          ...webQrPayload,
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
      let settled = false;

      const handleResponse = (
        response: { success?: boolean; status?: boolean } | boolean,
      ) => {
        if (settled) return;
        settled = true;
        socket.off("webReconnect", handleResponse);

        const ok =
          (response as { success?: boolean; status?: boolean })?.success ===
            true ||
          (response as { success?: boolean; status?: boolean })?.status ===
            true ||
          response === true;

        if (ok) {
          this._isConnected = true;
          this.emit("reconnected", { walletAddress: this.walletAddress ?? "" });
        } else {
          // Session expired on server
          this._reset("Session expired. Please reconnect.");
        }
      };

      socket.on("webReconnect", handleResponse);
      socket.emit(
        "webReconnect",
        { sessionCode: savedSessionCode },
        handleResponse,
      );
    });

    this._attachCoreListeners(socket);
  }

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
      sessionCode:
        this.sessionCode ?? localStorage.getItem(STORAGE_KEY_SESSION),
      walletAddress: currentAddress,
      remark: "send transaction",
      app: "DEX",
      transactionDetails,
    };

    this.socket.emit("webSendTransaction", payload, (_ack: unknown) => {
      // ack is informational only — result arrives via transactionAccepted/Rejected
    });
  }

  // closeSocket()
  // Plain, synchronous socket teardown — no removeConnection cleanup. Used
  // when replacing a stale socket for the SAME session (e.g. reconnectSession)
  // where we must not tell the server to drop the session we're restoring.
  closeSocket(): void {
    if (this.socket) {
      this.socket.disconnect();
    }
    this._cleanup();
    this._reset();
  }

  // disconnect()
  // Manual disconnect — mirrors disconnectBCSwap() in hook.
  // Tells the server to drop this session's connectionListWeb record BEFORE
  // tearing down the socket — otherwise the server never sees the session as
  // destroyed, since disconnect() closing the socket immediately afterward
  // would prevent the connectionRemoveWeb emit from ever reaching the wire.
  // Capped with a short timeout so a slow/unreachable server can't block
  // disconnecting locally for long.
  async disconnect(): Promise<void> {
    const socket = this.socket;
    const mySocketId = socket?.id;

    if (socket?.connected && mySocketId) {
      try {
        await Promise.race([
          (async () => {
            const res = await this.getConnections();
            const mine = res?.data?.sessions?.find(
              (s) => s.webSocketId === mySocketId,
            );
            if (mine) await this.removeConnection(mine.id);
          })(),
          new Promise((resolve) => setTimeout(resolve, 2500)),
        ]);
      } catch {
        // ignore — local disconnect still proceeds below
      }
    }

    if (this.socket) {
      this.socket.disconnect();
    }
    this._cleanup();
    this._reset();
  }

  // NOTE: the server does not ack connectionListWeb/connectionRemoveWeb with a
  // real socket.io ack packet (id-tagged 43<id>[...]) — it instead re-emits the
  // result as a plain event (42["connectionListWeb", ...]), which never invokes
  // the emit() callback. So we resolve from whichever arrives first: the ack
  // callback (in case the server is ever fixed) or the plain event listener
  // (what actually happens today).
  getConnections(appName?: string): Promise<ConnectionListWebResponse> {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        console.log("rejected:", "socket not connected");
        reject(new Error("Cannot list connections: socket not connected"));
        return;
      }

      const socket = this.socket;
      let settled = false;

      const onEvent = (response: ConnectionListWebResponse) => {
        if (settled) return;
        settled = true;
        socket.off("connectionListWeb", onEvent);
        resolve(response);
      };
      socket.on("connectionListWeb", onEvent);

      socket.emit(
        "connectionListWeb",
        { webAppName: appName ?? this.appName },
        (response: ConnectionListWebResponse) => {
          if (settled) return;
          settled = true;
          socket.off("connectionListWeb", onEvent);
          // console.log("response:", response);
          resolve(response);
        },
      );
    });
  }

  removeConnection(
    id: number,
    appName?: string,
  ): Promise<ConnectionRemovedResponse> {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        console.log("rejected:", "socket not connected");
        reject(new Error("Cannot remove connection: socket not connected"));
        return;
      }

      const socket = this.socket;
      let settled = false;

      const onEvent = (response: ConnectionRemovedResponse) => {
        if (settled) return;
        settled = true;
        socket.off("connectionRemoveWeb", onEvent);
        // console.log("response:", response);
        resolve(response);
      };
      socket.on("connectionRemoveWeb", onEvent);

      socket.emit(
        "connectionRemoveWeb",
        { webAppName: appName ?? this.appName, id },
        (response: ConnectionRemovedResponse) => {
          if (settled) return;
          settled = true;
          socket.off("connectionRemoveWeb", onEvent);
          // console.log("response:", response);
          resolve(response);
        },
      );
    });
  }

  // Private

  private _attachCoreListeners(
    socket: Socket,
    options: { ignoreOtherDisconnected?: boolean } = {},
  ): void {
    socket.on("mobileConnected", (data: MobileConnectedData) => {
      // sessionCode may come under different keys -- mirrors hook fallback chain
      const sessionCode =
        data.sessionCode ??
        data.address ??
        data.userAddress ??
        this.sessionCode;

      const walletAddress = data.walletAddress;

      if (sessionCode) this.sessionCode = sessionCode;
      if (walletAddress) this.walletAddress = walletAddress;

      this._isConnected = true;
      this._isConnecting = false;

      this.emit("connected", {
        sessionCode: this.sessionCode ?? "",
        walletAddress: this.walletAddress ?? "",
      });
    });

    socket.on("mobileReconnected", (data: MobileReconnectedData) => {
      if (data.walletAddress) {
        this.walletAddress = data.walletAddress;
        this._isConnected = true;
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

    socket.on("connectionRemoved", (response: ConnectionRemovedResponse) => {
      this.emit("connectionRemoved", response);
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
    this._isConnected = false;
    this._isConnecting = false;
    this.sessionCode = null;
    this.walletAddress = null;

    if (errorMessage) {
      this.emit("error", errorMessage);
    }
  }
}
