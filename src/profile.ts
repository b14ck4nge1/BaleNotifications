import {
  concatBytes,
  encodeIntField,
  encodeMessageField,
  encodeStringField,
  integer,
  parseProto,
  stringValue,
  type ProtoFields,
  type WireValue,
} from "./protobuf.ts";

export interface BaleFileRef {
  fileId: bigint;
  accessHash: bigint;
}

export interface BaleProfileData {
  senderId: string;
  name: string;
  avatar?: BaleFileRef;
}

export interface BaleFileUrl {
  url: string;
  timeoutMs?: number;
}

export interface BaleRpcResponse {
  requestId: number;
  result?: ProtoFields;
  error?: string;
}

function parseNestedValue(value: WireValue): ProtoFields | undefined {
  if (value.wireType !== 2) return undefined;
  try {
    return parseProto(value.value);
  } catch {
    return undefined;
  }
}

function nestedValues(fields: ProtoFields, field: number): ProtoFields[] {
  return (fields.get(field) ?? [])
    .map(parseNestedValue)
    .filter((value): value is ProtoFields => value !== undefined);
}

function metadataEntry(name: string, value: string): Uint8Array {
  const wrappedValue = encodeStringField(1, value);
  return concatBytes(encodeStringField(1, name), encodeMessageField(2, wrappedValue));
}

function rpcRequest(
  service: string,
  method: string,
  payload: Uint8Array,
  requestId: number,
): Uint8Array {
  const sessionId = Date.now().toString();
  const metadata = concatBytes(
    encodeMessageField(1, metadataEntry("app_version", "113466")),
    encodeMessageField(1, metadataEntry("browser_type", "1")),
    encodeMessageField(1, metadataEntry("browser_version", "138.0.0.0")),
    encodeMessageField(1, metadataEntry("os_type", "3")),
    encodeMessageField(1, metadataEntry("session_id", sessionId)),
  );
  const body = concatBytes(
    encodeStringField(1, service),
    encodeStringField(2, method),
    encodeMessageField(3, payload),
    encodeMessageField(4, metadata),
    encodeIntField(5, requestId),
  );
  return encodeMessageField(1, body);
}

export function encodeLoadUserRequest(senderId: bigint, requestId: number): Uint8Array {
  const peer = concatBytes(encodeIntField(1, senderId), encodeIntField(2, 1));
  return rpcRequest(
    "bale.users.v1.Users",
    "LoadUsers",
    encodeMessageField(1, peer),
    requestId,
  );
}

export function encodeFileUrlRequest(
  fileId: bigint,
  accessHash: bigint,
  requestId: number,
): Uint8Array {
  const file = concatBytes(
    encodeIntField(1, fileId),
    encodeIntField(2, accessHash),
    encodeMessageField(3, encodeIntField(1, 1)),
  );
  return rpcRequest(
    "ai.bale.server.Files",
    "GetNasimFileUrl",
    encodeMessageField(1, file),
    requestId,
  );
}

export function decodeBaleRpcResponse(data: Uint8Array): BaleRpcResponse | null {
  try {
    const root = parseProto(data);
    const response = nestedValues(root, 1)[0];
    if (!response) return null;
    const requestId = integer(response, 3);
    if (requestId === undefined || requestId > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    const error = nestedValues(response, 1)[0];
    return {
      requestId: Number(requestId),
      result: nestedValues(response, 2)[0],
      error: error ? stringValue(error, 2) ?? `Bale error ${integer(error, 1) ?? "unknown"}` : undefined,
    };
  } catch {
    return null;
  }
}

function findFileRef(fields: ProtoFields, depth = 0): BaleFileRef | undefined {
  if (depth > 4) return undefined;
  const fileId = integer(fields, 1);
  const accessHash = integer(fields, 2);
  if (fileId !== undefined && accessHash !== undefined && fileId > 10_000n) {
    return { fileId, accessHash };
  }
  for (const values of fields.values()) {
    for (const value of values) {
      const nested = parseNestedValue(value);
      if (!nested) continue;
      const found = findFileRef(nested, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

export function decodeLoadedUser(result: ProtoFields, senderId: string): BaleProfileData | null {
  try {
    const expectedId = BigInt(senderId);
    const users = nestedValues(result, 1);
    const user = users.find((candidate) => integer(candidate, 1) === expectedId) ?? users[0];
    if (!user) return null;
    const name = (stringValue(user, 4) || stringValue(user, 3) || `Bale user ${senderId}`).trim();

    // Bale currently places avatar metadata in an undocumented user field. Field 6
    // is preferred; field 8 is retained as a compatibility fallback for older data.
    const avatarContainers = [...nestedValues(user, 6), ...nestedValues(user, 8)];
    const avatar = avatarContainers.map((value) => findFileRef(value)).find(Boolean);
    return { senderId, name, avatar };
  } catch {
    return null;
  }
}

export function decodeFileUrl(result: ProtoFields): BaleFileUrl | null {
  const entry = nestedValues(result, 1)[0];
  if (!entry) return null;
  const url = stringValue(entry, 2);
  if (!url) return null;
  const timeout = integer(entry, 3);
  return {
    url,
    timeoutMs:
      timeout !== undefined && timeout <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(timeout)
        : undefined,
  };
}

