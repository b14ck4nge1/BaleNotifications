import { decodeBaleIncomingMessage, messageKey } from "./bale.ts";
import { baleUserIdFromToken, configuredBaleUserId } from "./auth.ts";
import { sendBark, type BarkSenderProfile } from "./bark.ts";
import { encodeBaleHandshake, encodeBalePing } from "./protobuf.ts";
import {
  decodeBaleRpcResponse,
  decodeFileUrl,
  decodeLoadedUser,
  encodeFileUrlRequest,
  encodeLoadUserRequest,
  type BaleRpcResponse,
} from "./profile.ts";
import type { DurableState, Env, UpgradeResponse } from "./runtime.ts";

const WATCHDOG_MS = 60_000;
const MAX_RECONNECT_MS = 5 * 60_000;
const SEEN_LIMIT = 200;
const PROFILE_CACHE_MS = 6 * 60 * 60_000;
const RPC_TIMEOUT_MS = 7_000;

interface CachedProfile extends BarkSenderProfile {
  senderId: string;
  expiresAt: number;
  avatarFileId?: string;
}

interface PendingRpc {
  resolve(value: BaleRpcResponse): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface RelayStatus {
  running: boolean;
  connected: boolean;
  reconnectAttempts: number;
  lastConnectedAt?: string;
  lastDisconnectedAt?: string;
  lastMessageAt?: string;
  lastSenderId?: string;
  lastNotificationAt?: string;
  selfMessageFilterActive: boolean;
  lastOwnMessageIgnoredAt?: string;
  lastError?: string;
}

export class BaleRelay {
  private readonly state: DurableState;
  private readonly env: Env;
  private readonly selfUserId: string | undefined;
  private socket: (WebSocket & { accept(options?: { allowHalfOpen?: boolean }): void }) | null = null;
  private connecting: Promise<void> | null = null;
  private stopped = true;
  private reconnectAttempts = 0;
  private lastError: string | undefined;
  private readonly processingKeys = new Set<string>();
  private readonly pendingRpc = new Map<number, PendingRpc>();
  private nextRequestId = 1;

  constructor(state: DurableState, env: Env) {
    this.state = state;
    this.env = env;
    this.selfUserId =
      configuredBaleUserId(env.BALE_SELF_ID) ?? baleUserIdFromToken(env.BALE_TOKEN);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path !== "/start") {
      this.stopped = (await this.state.storage.get<boolean>("stopped")) ?? true;
    }
    if (path === "/start" && request.method === "POST") {
      this.stopped = false;
      await this.state.storage.put("stopped", false);
      await this.ensureConnected();
      return this.json(await this.status());
    }
    if (path === "/ensure" && request.method === "POST") {
      this.stopped = (await this.state.storage.get<boolean>("stopped")) ?? true;
      if (!this.stopped) await this.ensureConnected();
      await this.scheduleWatchdog(WATCHDOG_MS);
      return this.json(await this.status());
    }
    if (path === "/stop" && request.method === "POST") {
      this.stopped = true;
      await this.state.storage.put("stopped", true);
      this.socket?.close(1000, "Stopped by administrator");
      this.socket = null;
      return this.json(await this.status());
    }
    if (path === "/test" && request.method === "POST") {
      await sendBark(this.env, undefined, undefined, true);
      return this.json({ ok: true });
    }
    if (path === "/profile" && request.method === "GET") {
      const senderId = url.searchParams.get("sender_id");
      if (!senderId || !/^\d+$/.test(senderId)) {
        return this.json({ error: "sender_id must be a Bale numeric user ID" }, 400);
      }
      await this.ensureConnected();
      return this.json(await this.resolveProfile(senderId, true));
    }
    if (path === "/status") return this.json(await this.status());
    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    this.stopped = (await this.state.storage.get<boolean>("stopped")) ?? true;
    if (!this.stopped) {
      if (this.isConnected()) {
        try {
          this.socket?.send(encodeBalePing());
        } catch (error) {
          await this.recordError(error);
          this.socket = null;
        }
      }
      await this.ensureConnected().catch((error) => this.recordError(error));
      await this.scheduleWatchdog(this.reconnectDelay());
    }
  }

  private isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private async ensureConnected(): Promise<void> {
    if (this.stopped || this.isConnected()) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.connect();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async connect(): Promise<void> {
    if (!this.env.BALE_TOKEN) throw new Error("BALE_TOKEN is missing");
    const url = this.env.BALE_WS_URL ?? "https://next-ws.bale.ai/ws/";
    const response = (await fetch(url, {
      headers: {
        Upgrade: "websocket",
        Cookie: `access_token=${this.env.BALE_TOKEN}`,
        Origin: "https://web.bale.ai",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/135 Safari/537.36",
      },
    })) as UpgradeResponse;

    if (response.status !== 101 || !response.webSocket) {
      throw new Error(`Bale WebSocket upgrade failed with HTTP ${response.status}`);
    }

    const socket = response.webSocket;
    socket.accept({ allowHalfOpen: true });
    socket.binaryType = "arraybuffer";
    socket.addEventListener("message", (event) => {
      const task = this.handleSocketMessage(event.data);
      this.state.waitUntil(task);
    });
    socket.addEventListener("close", (event) => {
      if (this.socket === socket) this.socket = null;
      const task = this.onDisconnected(`Bale closed the socket (${event.code}): ${event.reason}`);
      this.state.waitUntil(task);
    });
    socket.addEventListener("error", () => {
      if (this.socket === socket) this.socket = null;
      const task = this.onDisconnected("Bale WebSocket error");
      this.state.waitUntil(task);
    });

    this.socket = socket;
    socket.send(encodeBaleHandshake());
    this.reconnectAttempts = 0;
    this.lastError = undefined;
    await this.state.storage.put("lastConnectedAt", new Date().toISOString());
    await this.scheduleWatchdog(WATCHDOG_MS);
  }

  private async handleSocketMessage(data: unknown): Promise<void> {
    let bytes: Uint8Array;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (ArrayBuffer.isView(data)) {
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else if (data instanceof Blob) bytes = new Uint8Array(await data.arrayBuffer());
    else return;

    const message = decodeBaleIncomingMessage(bytes);
    const rpc = decodeBaleRpcResponse(bytes);
    if (rpc) {
      const pending = this.pendingRpc.get(rpc.requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRpc.delete(rpc.requestId);
        if (rpc.error) pending.reject(new Error(rpc.error));
        else pending.resolve(rpc);
      }
      return;
    }
    if (!message || !this.shouldNotify(message.chatType)) return;
    if (this.selfUserId && message.senderId === this.selfUserId) {
      await this.state.storage.put("lastOwnMessageIgnoredAt", new Date().toISOString());
      return;
    }
    const key = messageKey(message);
    if (this.processingKeys.has(key) || (await this.wasSeen(key))) return;

    this.processingKeys.add(key);
    try {
      await Promise.all([
        this.state.storage.put("lastMessageAt", new Date().toISOString()),
        this.state.storage.put("lastSenderId", message.senderId),
      ]);
      let profile: CachedProfile | undefined;
      try {
        profile = await this.resolveProfile(message.senderId);
      } catch (error) {
        await this.recordError(error);
      }
      await sendBark(this.env, message, profile);
      await Promise.all([
        this.remember(key),
        this.state.storage.put("lastNotificationAt", new Date().toISOString()),
      ]);
    } catch (error) {
      await this.recordError(error);
      throw error;
    } finally {
      this.processingKeys.delete(key);
    }
  }

  private async callBale(buildRequest: (requestId: number) => Uint8Array): Promise<BaleRpcResponse> {
    await this.ensureConnected();
    if (!this.socket || !this.isConnected()) throw new Error("Bale WebSocket is not connected");
    const requestId = this.nextRequestId++;
    if (this.nextRequestId >= Number.MAX_SAFE_INTEGER) this.nextRequestId = 1;

    return new Promise<BaleRpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRpc.delete(requestId);
        reject(new Error(`Bale profile request ${requestId} timed out`));
      }, RPC_TIMEOUT_MS);
      this.pendingRpc.set(requestId, { resolve, reject, timeout });
      try {
        this.socket?.send(buildRequest(requestId));
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRpc.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private async resolveProfile(senderId: string, force = false): Promise<CachedProfile> {
    const cacheKey = `profile:${senderId}`;
    if (!force) {
      const cached = await this.state.storage.get<CachedProfile>(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached;
    }

    const userResponse = await this.callBale((requestId) =>
      encodeLoadUserRequest(BigInt(senderId), requestId),
    );
    if (!userResponse.result) throw new Error(`Bale returned no profile for sender ${senderId}`);
    const loaded = decodeLoadedUser(userResponse.result, senderId);
    if (!loaded) throw new Error(`Could not decode Bale profile for sender ${senderId}`);

    let iconUrl: string | undefined;
    let expiresAt = Date.now() + PROFILE_CACHE_MS;
    if (loaded.avatar) {
      const fileResponse = await this.callBale((requestId) =>
        encodeFileUrlRequest(loaded.avatar!.fileId, loaded.avatar!.accessHash, requestId),
      );
      const file = fileResponse.result ? decodeFileUrl(fileResponse.result) : null;
      if (file) {
        iconUrl = file.url;
        if (file.timeoutMs) {
          const timeoutAt = file.timeoutMs > Date.now() ? file.timeoutMs : Date.now() + file.timeoutMs;
          expiresAt = Math.min(expiresAt, Math.max(Date.now() + 60_000, timeoutAt - 60_000));
        }
      }
    }

    const profile: CachedProfile = {
      senderId,
      name: loaded.name,
      iconUrl,
      avatarFileId: loaded.avatar?.fileId.toString(),
      expiresAt,
    };
    await this.state.storage.put(cacheKey, profile);
    return profile;
  }

  private shouldNotify(chatType: number): boolean {
    const allowed = (this.env.NOTIFY_CHAT_TYPES ?? "1")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter(Number.isFinite);
    return allowed.includes(chatType);
  }

  private async wasSeen(key: string): Promise<boolean> {
    const seen = (await this.state.storage.get<string[]>("seenMessages")) ?? [];
    return seen.includes(key);
  }

  private async remember(key: string): Promise<void> {
    const seen = (await this.state.storage.get<string[]>("seenMessages")) ?? [];
    if (seen.includes(key)) return;
    seen.push(key);
    await this.state.storage.put("seenMessages", seen.slice(-SEEN_LIMIT));
  }

  private async onDisconnected(reason: string): Promise<void> {
    for (const [requestId, pending] of this.pendingRpc) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
      this.pendingRpc.delete(requestId);
    }
    this.reconnectAttempts += 1;
    this.lastError = reason;
    await Promise.all([
      this.state.storage.put("lastDisconnectedAt", new Date().toISOString()),
      this.state.storage.put("lastError", reason),
    ]);
    if (!this.stopped) await this.scheduleWatchdog(this.reconnectDelay());
  }

  private reconnectDelay(): number {
    if (this.isConnected()) return WATCHDOG_MS;
    return Math.min(MAX_RECONNECT_MS, 1_000 * 2 ** Math.min(this.reconnectAttempts, 8));
  }

  private async scheduleWatchdog(delay: number): Promise<void> {
    await this.state.storage.setAlarm(Date.now() + Math.max(1_000, delay));
  }

  private async recordError(error: unknown): Promise<void> {
    this.lastError = error instanceof Error ? error.message : String(error);
    console.error(this.lastError);
    await this.state.storage.put("lastError", this.lastError);
  }

  private async status(): Promise<RelayStatus> {
    const [
      lastConnectedAt,
      lastDisconnectedAt,
      lastMessageAt,
      lastSenderId,
      lastNotificationAt,
      lastOwnMessageIgnoredAt,
      storedError,
    ] =
      await Promise.all([
        this.state.storage.get<string>("lastConnectedAt"),
        this.state.storage.get<string>("lastDisconnectedAt"),
        this.state.storage.get<string>("lastMessageAt"),
        this.state.storage.get<string>("lastSenderId"),
        this.state.storage.get<string>("lastNotificationAt"),
        this.state.storage.get<string>("lastOwnMessageIgnoredAt"),
        this.state.storage.get<string>("lastError"),
      ]);
    return {
      running: !this.stopped,
      connected: this.isConnected(),
      reconnectAttempts: this.reconnectAttempts,
      lastConnectedAt,
      lastDisconnectedAt,
      lastMessageAt,
      lastSenderId,
      lastNotificationAt,
      selfMessageFilterActive: this.selfUserId !== undefined,
      lastOwnMessageIgnoredAt,
      lastError: this.lastError ?? storedError,
    };
  }

  private json(value: unknown, status = 200): Response {
    return Response.json(value, { status });
  }
}

