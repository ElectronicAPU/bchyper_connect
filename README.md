# @bchyper/connect-sdk

[![npm version](https://img.shields.io/npm/v/@bchyper/connect-sdk.svg)](https://www.npmjs.com/package/@bchyper/connect-sdk)
[![npm downloads](https://img.shields.io/npm/dm/@bchyper/connect-sdk.svg)](https://www.npmjs.com/package/@bchyper/connect-sdk)

SDK for connecting the BC Hyper mobile wallet to any web dApp via a pairing server.

Works with **React**, **Next.js**, **Vue 3**, **Angular**, **Svelte**, or any plain JavaScript project.

---

## Installation

```bash
npm install @bchyper/connect-sdk
```

---

## What you need before using this SDK

You need two things from your BC Hyper pairing server:

| Value | Description |
|---|---|
| `pairingUrl` | WebSocket URL of your pairing server e.g. `wss://pairing.bcswap.org` |
| `appName` | Name of your dApp sent to the server e.g. `"BCSWAP"` |

Store the `pairingUrl` in your `.env` file — never hardcode it.

```env
# Vite / Next.js / Vue CLI
VITE_PAIRING_URL=wss://pairing.bcswap.org
NEXT_PUBLIC_PAIRING_URL=wss://pairing.bcswap.org
```

---

## How to choose which option to use

| You are using | Use this |
|---|---|
| React / Next.js | Option A — `useBChyperConnect` hook |
| Vue 3 | Option B — Core class inside a composable |
| Angular | Option B — Core class inside a service |
| Svelte | Option B — Core class inside a store |
| Plain JS / Node | Option B — Core class directly |

---

## Option A — React / Next.js (Hook)

### Step 1 — Call the hook

```tsx
import { useBChyperConnect } from '@bchyper/connect-sdk';

function App() {
  const {
    isConnected,
    isConnecting,
    isDisconnected,      // true only when mobile drops the connection
    address,             // sessionCode
    mobileAddress,       // actual wallet address from mobile
    qrImageBase64,       // base64 QR image — show this to the user
    connectionError,
    connectToBCSwap,
    disconnectBCSwap,
    reconnectSession,    // (savedSession, savedAddress) => void — runtime reconnect
    sendTransaction,
    transactionStatus,  // "idle" | "pending" | "accepted" | "rejected"
    transactionResult,
    resetTransactionState,
    getConnections,      // (appName?) => Promise<ConnectionListWebResponse>
    removeConnection,    // (id: number, appName?) => Promise<ConnectionRemovedResponse>
    currentSocketId,     // () => string | null — this tab's own webSocketId, for matching against connectionListWeb's sessions
  } = useBChyperConnect({
    appName:    'BCSWAP',
    pairingUrl: import.meta.env.VITE_PAIRING_URL, // Next.js: process.env.NEXT_PUBLIC_PAIRING_URL
    deviceInfo: {
      webIpAddress:      '203.0.113.10',
      webBrowser:         navigator.userAgent,
      webLocation:        'Kolkata, IN',
      webOperatingSystem: navigator.platform,
    },
  });
}
```

### Step 2 — Show QR and connection state

```tsx
{!isConnected && (
  <button onClick={connectToBCSwap}>Connect Mobile Wallet</button>
)}

{isConnecting && qrImageBase64 && (
  <img src={qrImageBase64} alt="Scan with BC Hyper app" />
)}

{isConnected && <p>Connected: {mobileAddress}</p>}
{connectionError && <p style={{ color: 'red' }}>{connectionError}</p>}
```

### Step 3 — Send a transaction

The key is the action type — `SWAP`, `STAKE`, `BRIDGE`, or anything your mobile app supports:

```tsx
// SWAP
sendTransaction({
  SWAP: {
    chainId: 14700,
    tokenAddressA: 'NATIVE',
    tokenAddressB: '0xfe50b757...',
    tokenSymbolA: 'VTCN',
    tokenSymbolB: 'USDT',
    tokenDecimalsA: 18,
    tokenDecimalsB: 18,
    amountIn: '1.5',
    amountOut: '3.2',
    slippage: '0.5',
    deadlineMinutes: 20,
    isNativePay: true,
    isWrap: false,
    isUnwrap: false,
  }
});

// STAKE
sendTransaction({
  STAKE: { poolAddress: '0xabc123...', amount: '100', duration: 30 }
});

// BRIDGE
sendTransaction({
  BRIDGE: { fromChain: 1, toChain: 56, token: '0xdef456...', amount: '5' }
});
```

### Step 4 — Handle transaction result

```tsx
useEffect(() => {
  if (transactionStatus === 'accepted') {
    console.log('TX Hash:', transactionResult?.data?.txHash);
    resetTransactionState();
  }
  if (transactionStatus === 'rejected') {
    console.log('Rejected:', transactionResult?.message);
    resetTransactionState();
  }
}, [transactionStatus]);
```

### Step 5 — Disconnect

```tsx
<button onClick={() => disconnectBCSwap()}>Disconnect</button>
```

`disconnectBCSwap()` is now `async`. Internally it first asks the server to remove this tab's own connection record (best-effort, capped at ~2.5s so a slow/unreachable server never blocks the click) and only then closes the socket and clears `localStorage`. Awaiting it is optional — the local disconnect always happens even if the server round-trip fails or times out — but await it if you want to know the cleanup attempt has finished before e.g. redirecting the user.

### Step 6 — Handle mobile-side disconnect and reconnect at runtime

If the mobile app drops the connection (app killed, network loss, etc.) without a page reload, `isDisconnected` becomes `true` and the saved session/address remain in `localStorage`. Call `reconnectSession` to re-pair without asking the user to scan a new QR code:

```tsx
import { useEffect } from 'react';

useEffect(() => {
  if (isDisconnected) {
    const savedSession = localStorage.getItem('bcswap_wallet_session');
    const savedAddress = localStorage.getItem('bcswap_mobile_address');
    if (savedSession) {
      reconnectSession(savedSession, savedAddress ?? undefined);
    }
  }
}, [isDisconnected]);
```

> Note: `disconnectBCSwap()` (intentional, web-initiated disconnect) clears `localStorage` and resets `isDisconnected` to `false`. A mobile-initiated drop does **not** clear `localStorage`, so `reconnectSession` has what it needs to restore the session.

### Step 7 — List and manage active connections

Every paired browser/device is tracked server-side per `appName`. Use `getConnections` to list them and `removeConnection` to log one out remotely — like a "manage devices" screen. Compare each session's `webSocketId` against `currentSocketId()` to mark/handle "this is the tab you're using right now" specially (e.g. disconnect locally too if the user revokes it):

```tsx
const [sessions, setSessions] = useState<ConnectionSession[]>([]);

async function loadSessions() {
  const res = await getConnections();
  if (res.status) setSessions(res.data.sessions);
}

async function logoutSession(id: number, isCurrentSession: boolean) {
  const res = await removeConnection(id);
  if (res.status) {
    setSessions((prev) => prev.filter((s) => s.id !== res.data.session.id));
    if (isCurrentSession) {
      // You just revoked the session this tab is using — disconnect locally too.
      await disconnectBCSwap();
    }
  }
}
```

```tsx
{sessions.map((s) => {
  const isCurrentSession = s.webSocketId === currentSocketId();
  return (
    <div key={s.id}>
      <p>{s.webBrowser} — {s.webLocation} ({s.webOperatingSystem}){isCurrentSession ? ' (You)' : ''}</p>
      <p>{s.isWebAlive ? 'Active' : 'Inactive'} · last seen {s.lastSeenAt}</p>
      <button onClick={() => logoutSession(s.id, isCurrentSession)}>Log out</button>
    </div>
  );
})}
```

> **Note on server ack behavior:** some pairing server versions do not acknowledge `connectionListWeb` / `connectionRemoveWeb` / `webReconnect` with a proper socket.io ack packet — they instead re-emit the result as a plain event with the same name. The SDK already handles this: `getConnections`, `removeConnection`, and the internal `webReconnect` handshake all listen for both the ack callback and the plain event, resolving on whichever arrives first. No extra handling is needed on your end.

---

## Option B — Vue 3 (Composable)

Create a composable file `useBChyper.js` in your Vue project:

```js
// src/composables/useBChyper.js
import { ref, onUnmounted } from 'vue';
import { BChyperConnect } from '@bchyper/connect-sdk';

export function useBChyper() {
  const isConnected    = ref(false);
  const isConnecting   = ref(false);
  const mobileAddress  = ref(null);
  const qrImageBase64  = ref(null);
  const connectionError = ref(null);
  const txStatus       = ref('idle'); // idle | pending | accepted | rejected
  const txResult       = ref(null);

  const connector = new BChyperConnect({
    appName:    'BCSWAP',
    pairingUrl: import.meta.env.VITE_PAIRING_URL,
  });

  connector.on('qr', ({ qrImage }) => {
    qrImageBase64.value = qrImage;
  });

  connector.on('connected', ({ walletAddress }) => {
    mobileAddress.value  = walletAddress;
    isConnected.value    = true;
    isConnecting.value   = false;
    connectionError.value = null;
  });

  connector.on('reconnected', ({ walletAddress }) => {
    mobileAddress.value = walletAddress;
    isConnected.value   = true;
  });

  connector.on('transactionAccepted', (result) => {
    txStatus.value = 'accepted';
    txResult.value = result;
  });

  connector.on('transactionRejected', (result) => {
    txStatus.value = 'rejected';
    txResult.value = result;
  });

  connector.on('disconnected', ({ message }) => {
    isConnected.value   = false;
    mobileAddress.value = null;
    connectionError.value = message;
  });

  connector.on('error', (message) => {
    connectionError.value = message;
    isConnecting.value    = false;
  });

  const connect = () => {
    isConnecting.value = true;
    connector.connect();
  };

  const disconnect = async () => {
    await connector.disconnect(); // async — removes this session server-side before closing the socket
    isConnected.value   = false;
    mobileAddress.value = null;
  };

  const sendTransaction = (txDetails) => {
    txStatus.value = 'pending';
    connector.sendTransaction(txDetails);
  };

  // Cleanup when component unmounts
  onUnmounted(() => connector.disconnect());

  return {
    isConnected, isConnecting, mobileAddress,
    qrImageBase64, connectionError, txStatus, txResult,
    connect, disconnect, sendTransaction,
  };
}
```

Use it in any Vue component:

```vue
<script setup>
import { useBChyper } from '@/composables/useBChyper';

const { isConnected, qrImageBase64, mobileAddress, connect, disconnect, sendTransaction } = useBChyper();
</script>

<template>
  <button v-if="!isConnected" @click="connect">Connect</button>
  <img v-if="qrImageBase64" :src="qrImageBase64" alt="Scan QR" />
  <p v-if="isConnected">{{ mobileAddress }}</p>
  <button v-if="isConnected" @click="disconnect">Disconnect</button>
</template>
```

---

## Option C — Angular (Service)

Create a service in your Angular project:

```ts
// src/app/services/bchyper.service.ts
import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { BChyperConnect } from '@bchyper/connect-sdk';

@Injectable({ providedIn: 'root' })
export class BChyperService implements OnDestroy {
  isConnected$   = new BehaviorSubject<boolean>(false);
  mobileAddress$ = new BehaviorSubject<string | null>(null);
  qrImage$       = new BehaviorSubject<string | null>(null);
  txStatus$      = new BehaviorSubject<string>('idle');
  txResult$      = new BehaviorSubject<any>(null);
  error$         = new BehaviorSubject<string | null>(null);

  private connector = new BChyperConnect({
    appName:    'BCSWAP',
    pairingUrl: environment.pairingUrl, // from environment.ts
  });

  constructor() {
    this.connector.on('qr', ({ qrImage }) => {
      this.qrImage$.next(qrImage);
    });

    this.connector.on('connected', ({ walletAddress }) => {
      this.mobileAddress$.next(walletAddress);
      this.isConnected$.next(true);
    });

    this.connector.on('reconnected', ({ walletAddress }) => {
      this.mobileAddress$.next(walletAddress);
      this.isConnected$.next(true);
    });

    this.connector.on('transactionAccepted', (result) => {
      this.txStatus$.next('accepted');
      this.txResult$.next(result);
    });

    this.connector.on('transactionRejected', (result) => {
      this.txStatus$.next('rejected');
      this.txResult$.next(result);
    });

    this.connector.on('disconnected', ({ message }) => {
      this.isConnected$.next(false);
      this.mobileAddress$.next(null);
      this.error$.next(message);
    });

    this.connector.on('error', (msg) => this.error$.next(msg));
  }

  connect()                           { this.connector.connect(); }
  async disconnect()                  { await this.connector.disconnect(); this.isConnected$.next(false); }
  sendTransaction(txDetails: any)     { this.txStatus$.next('pending'); this.connector.sendTransaction(txDetails); }

  ngOnDestroy() { this.connector.disconnect(); } // fire-and-forget on teardown is fine
}
```

Use it in any Angular component:

```ts
// src/app/components/wallet/wallet.component.ts
import { Component } from '@angular/core';
import { BChyperService } from '../../services/bchyper.service';

@Component({
  selector: 'app-wallet',
  template: `
    <button *ngIf="!(svc.isConnected$ | async)" (click)="svc.connect()">Connect</button>
    <img *ngIf="svc.qrImage$ | async as qr" [src]="qr" alt="Scan QR" />
    <p *ngIf="svc.isConnected$ | async">{{ svc.mobileAddress$ | async }}</p>
    <button *ngIf="svc.isConnected$ | async" (click)="svc.disconnect()">Disconnect</button>
  `
})
export class WalletComponent {
  constructor(public svc: BChyperService) {}
}
```

---

## Option D — Svelte (Store)

```js
// src/stores/bchyper.js
import { writable } from 'svelte/store';
import { BChyperConnect } from '@bchyper/connect-sdk';

const connector = new BChyperConnect({
  appName:    'BCSWAP',
  pairingUrl: import.meta.env.VITE_PAIRING_URL,
});

export const isConnected   = writable(false);
export const mobileAddress = writable(null);
export const qrImageBase64 = writable(null);
export const txStatus      = writable('idle');
export const txResult      = writable(null);
export const error         = writable(null);

connector.on('qr',                ({ qrImage })      => qrImageBase64.set(qrImage));
connector.on('connected',         ({ walletAddress }) => { mobileAddress.set(walletAddress); isConnected.set(true); });
connector.on('reconnected',       ({ walletAddress }) => { mobileAddress.set(walletAddress); isConnected.set(true); });
connector.on('transactionAccepted', (result)          => { txStatus.set('accepted'); txResult.set(result); });
connector.on('transactionRejected', (result)          => { txStatus.set('rejected'); txResult.set(result); });
connector.on('disconnected',      ({ message })       => { isConnected.set(false); error.set(message); });
connector.on('error',             (msg)               => error.set(msg));

export const connect         = ()          => connector.connect();
export const disconnect      = async ()    => { await connector.disconnect(); isConnected.set(false); mobileAddress.set(null); };
export const sendTransaction = (txDetails) => { txStatus.set('pending'); connector.sendTransaction(txDetails); };
```

Use it in any Svelte component:

```svelte
<script>
  import { isConnected, qrImageBase64, mobileAddress, connect, disconnect } from '../stores/bchyper';
</script>

{#if !$isConnected}
  <button on:click={connect}>Connect</button>
{/if}

{#if $qrImageBase64}
  <img src={$qrImageBase64} alt="Scan QR" />
{/if}

{#if $isConnected}
  <p>{$mobileAddress}</p>
  <button on:click={disconnect}>Disconnect</button>
{/if}
```

---

## Option E — Plain JavaScript

```js
import { BChyperConnect } from '@bchyper/connect-sdk';

const connector = new BChyperConnect({
  appName:    'BCSWAP',
  pairingUrl: 'wss://pairing.bcswap.org',
});

connector.on('qr', ({ qrImage }) => {
  document.getElementById('qr-img').src = qrImage;
});

connector.on('connected', ({ walletAddress }) => {
  document.getElementById('address').textContent = walletAddress;
  localStorage.setItem('bcswap_wallet_session', walletAddress);
});

connector.on('transactionAccepted', (result) => {
  console.log('TX Hash:', result?.data?.txHash);
});

connector.on('transactionRejected', (result) => {
  console.log('Rejected:', result?.message);
});

connector.on('error', (msg) => console.error(msg));

document.getElementById('connect-btn').addEventListener('click', () => connector.connect());
document.getElementById('disconnect-btn').addEventListener('click', () => connector.disconnect()); // async — safe to fire-and-forget here
```

---

## Core class reference (`BChyperConnect`)

For Vue / Angular / Svelte / plain JS usage (Options B–E), these are the relevant methods and getters beyond `connect()` / `reconnect()` / `sendTransaction()`:

| Member | Type | Description |
|---|---|---|
| `disconnect()` | `() => Promise<void>` | Intentional, permanent disconnect. Best-effort removes this session's server-side record (`connectionListWeb`/`connectionRemoveWeb`), capped at ~2.5s, then closes the socket. Use this for a user-clicked "Disconnect" button. |
| `closeSocket()` | `() => void` | Plain, synchronous socket teardown with **no** server-side session removal. Use this only when immediately replacing the socket for the *same* session (e.g. your own `reconnectSession`-style logic) — calling `disconnect()` there would incorrectly tell the server to drop the session you're about to restore. |
| `socketId` | `string \| null` (getter) | The current socket's own id (`webSocketId` as the server sees it). Compare against a `connectionListWeb` session's `webSocketId` to find "this connection, right now." |
| `getConnections(appName?)` | `() => Promise<ConnectionListWebResponse>` | List all sessions for `appName` (defaults to the `appName` passed to the constructor). |
| `removeConnection(id, appName?)` | `() => Promise<ConnectionRemovedResponse>` | Revoke a session by its list `id`. |

---

## Socket Events Reference

### Web → Server (emitted by SDK)

| Event | Payload | When |
|---|---|---|
| `webQr` | `{ webApp, webIpAddress?, webBrowser?, webLocation?, webOperatingSystem? }` | Fresh connect — requests QR |
| `webReconnect` | `{ sessionCode: string }` | Page reload — restores session |
| `webSendTransaction` | `{ sessionCode, walletAddress, remark, app, transactionDetails }` | Sending tx to mobile |
| `connectionListWeb` | `{ webAppName: string }` | Requesting the list of active connections |
| `connectionRemoveWeb` | `{ webAppName: string, id: number }` | Removing/logging out a connection by id |

### Server → Web (received by SDK)

| Event | Payload | When |
|---|---|---|
| `webQrReady` | `{ qrImage, sessionCode }` | Server pushes QR (alternative to ack) |
| `mobileConnected` | `{ sessionCode, walletAddress }` | Mobile scanned QR and joined |
| `mobileReconnected` | `{ walletAddress }` | Mobile re-joined existing session |
| `transactionAccepted` | `{ data?: { txHash? }, message? }` | Mobile signed and broadcast tx |
| `transactionRejected` | `{ data?, message? }` | Mobile rejected tx |
| `otherDisconnected` | `{ message }` | Mobile disconnected |
| `connectionRemoved` | `{ status, message, data: { session } }` | A connection was removed (ack for `connectionRemoveWeb`, also pushed to the removed session) |

> **Ack vs. plain-event note:** on some server deployments, `connectionListWeb`, `connectionRemoveWeb`, and `webReconnect` responses arrive as a plain re-emitted event (`42["eventName", data]`) rather than a proper socket.io ack packet (`43<id>[data]`) tied to the original request. If you're inspecting the raw WebSocket frames and see the response event but the SDK's promise/callback never resolves, this is the cause. The SDK's `getConnections`, `removeConnection`, and internal `reconnect()` already listen for both forms and resolve on whichever fires first — this is handled for you, but worth knowing if you ever bypass the SDK and talk to the socket directly.

---

## localStorage Keys

These three keys are used by the SDK internally. All frameworks share the same keys.

| Key | Value | Who writes it |
|---|---|---|
| `bcswap_wallet_session` | Session code (pairing room ID) | React hook — on `connected` event |
| `bcswap_wallet_qr` | Last QR image (base64) | React hook — on `qr` event |
| `bcswap_mobile_address` | Connected wallet address | React hook — on `connected` event |

> **React hook** — reads and writes all three keys automatically. You do not touch them.
>
> **Core class** (`BChyperConnect`) — reads `bcswap_wallet_session` and `bcswap_mobile_address` as a fallback inside `sendTransaction()` if the values are not already in memory. It does NOT write to localStorage — that is your responsibility in Vue / Angular / Svelte / plain JS.
>
> This means for Vue / Angular / Svelte you must save the keys yourself after `connected` fires (as shown in the examples above), otherwise `sendTransaction()` may fail to find the wallet address after a page reload.

---

## TypeScript Types

```ts
import type {
  BChyperConnectOptions,     // { appName, pairingUrl, deviceInfo? }
  WebDeviceInfo,             // { webIpAddress?, webBrowser?, webLocation?, webOperatingSystem? }
  TransactionDetails,        // { [action: string]: Record<string, any> }
  TransactionResult,         // { data?: { txHash? }, message?, ... }
  TransactionStatus,         // "idle" | "pending" | "accepted" | "rejected"
  BChyperEvents,             // all event signatures
  ConnectionSession,         // a single paired connection record
  ConnectionListWebResponse, // { status, message, data: { sessions } }
  ConnectionRemovedResponse, // { status, message, data: { session } }
} from '@bchyper/connect-sdk';
```

---

## Building from source

```bash
cd bchyper_connect
npm install
npm run build    # outputs to dist/
npm run dev      # watch mode
```

## Installing locally in your project (during development)

```bash
# From your project root
npm install ./bchyper_connect
```
