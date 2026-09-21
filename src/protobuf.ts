export type WireValue =
  | { wireType: 0; value: bigint }
  | { wireType: 1; value: Uint8Array }
  | { wireType: 2; value: Uint8Array }
  | { wireType: 5; value: Uint8Array };

export type ProtoFields = Map<number, WireValue[]>;

const textDecoder = new TextDecoder("utf-8", { fatal: false });
const textEncoder = new TextEncoder();

function readVarint(data: Uint8Array, start: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  let offset = start;

  while (offset < data.length && shift <= 70n) {
    const byte = data[offset++];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [result, offset];
    shift += 7n;
  }

  throw new Error("Invalid or truncated protobuf varint");
}

export function parseProto(data: Uint8Array): ProtoFields {
  const fields: ProtoFields = new Map();
  let offset = 0;

  const add = (field: number, value: WireValue) => {
    const values = fields.get(field) ?? [];
    values.push(value);
    fields.set(field, values);
  };

  while (offset < data.length) {
    const [tag, afterTag] = readVarint(data, offset);
    offset = afterTag;
    const field = Number(tag >> 3n);
    const wireType = Number(tag & 7n);
    if (field <= 0) throw new Error("Invalid protobuf field number");

    if (wireType === 0) {
      const [value, afterValue] = readVarint(data, offset);
      offset = afterValue;
      add(field, { wireType: 0, value });
      continue;
    }

    if (wireType === 1 || wireType === 5) {
      const size = wireType === 1 ? 8 : 4;
      if (offset + size > data.length) throw new Error("Truncated fixed-width field");
      const value = data.slice(offset, offset + size);
      offset += size;
      add(field, { wireType, value } as WireValue);
      continue;
    }

    if (wireType === 2) {
      const [lengthValue, afterLength] = readVarint(data, offset);
      const length = Number(lengthValue);
      offset = afterLength;
      if (!Number.isSafeInteger(length) || length < 0 || offset + length > data.length) {
        throw new Error("Invalid length-delimited protobuf field");
      }
      const value = data.slice(offset, offset + length);
      offset += length;
      add(field, { wireType: 2, value });
      continue;
    }

    throw new Error(`Unsupported protobuf wire type ${wireType}`);
  }

  return fields;
}

export function firstField(fields: ProtoFields, number: number): WireValue | undefined {
  return fields.get(number)?.[0];
}

export function nested(fields: ProtoFields, number: number): ProtoFields | undefined {
  const value = firstField(fields, number);
  if (!value || value.wireType !== 2) return undefined;
  return parseProto(value.value);
}

export function integer(fields: ProtoFields, number: number): bigint | undefined {
  const value = firstField(fields, number);
  if (!value) return undefined;
  if (value.wireType === 0) return value.value;
  if (value.wireType !== 1 && value.wireType !== 5) return undefined;

  let result = 0n;
  for (let index = value.value.length - 1; index >= 0; index--) {
    result = (result << 8n) | BigInt(value.value[index]);
  }
  return result;
}

export function stringValue(fields: ProtoFields, number: number): string | undefined {
  const value = firstField(fields, number);
  if (!value || value.wireType !== 2) return undefined;
  return textDecoder.decode(value.value);
}

export function encodeVarint(value: bigint | number): Uint8Array {
  let remaining = typeof value === "number" ? BigInt(value) : value;
  if (remaining < 0n) throw new Error("Negative protobuf varints are not supported");
  const bytes: number[] = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0n);
  return Uint8Array.from(bytes);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function encodeIntField(field: number, value: bigint | number): Uint8Array {
  return concatBytes(encodeVarint(BigInt(field << 3)), encodeVarint(value));
}

export function encodeMessageField(field: number, message: Uint8Array): Uint8Array {
  return concatBytes(
    encodeVarint(BigInt((field << 3) | 2)),
    encodeVarint(message.length),
    message,
  );
}

export function encodeStringField(field: number, value: string): Uint8Array {
  return encodeMessageField(field, textEncoder.encode(value));
}

export function encodeBaleHandshake(): Uint8Array {
  const auth = concatBytes(encodeIntField(1, 1), encodeIntField(2, 1));
  return encodeMessageField(3, auth);
}

export function encodeBalePing(timestamp = Date.now()): Uint8Array {
  return encodeMessageField(2, encodeIntField(1, BigInt(timestamp)));
}

