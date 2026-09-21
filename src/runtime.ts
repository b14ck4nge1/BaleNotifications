export interface DurableStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  setAlarm(timestamp: number | Date): Promise<void>;
}

export interface DurableState {
  storage: DurableStorage;
  waitUntil(promise: Promise<unknown>): void;
}

export interface DurableObjectStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStub;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface ScheduledController {
  scheduledTime: number;
  cron: string;
}

export interface Env {
  BALE_RELAY: DurableObjectNamespace;
  BALE_TOKEN: string;
  BARK_URL: string;
  ADMIN_TOKEN: string;
  BALE_WS_URL?: string;
  BALE_SELF_ID?: string;
  BARK_GROUP?: string;
  NOTIFY_CHAT_TYPES?: string;
  MESSAGE_PREVIEW?: string;
  AUTO_START?: string;
}

export interface UpgradeResponse extends Response {
  webSocket?: WebSocket & { accept(options?: { allowHalfOpen?: boolean }): void };
}

