import assert from "node:assert/strict";
import test from "node:test";

import { decodeBaleIncomingMessage } from "../src/bale.ts";
import {
  concatBytes,
  encodeBaleHandshake,
  encodeIntField,
  encodeMessageField,
  parseProto,
  integer,
  nested,
} from "../src/protobuf.ts";
import {
  decodeBaleRpcResponse,
  decodeFileUrl,
  decodeLoadedUser,
  encodeLoadUserRequest,
} from "../src/profile.ts";

const text = (field: number, value: string) =>
  encodeMessageField(field, new TextEncoder().encode(value));

function sampleIncomingFrame(): Uint8Array {
  const chat = concatBytes(encodeIntField(1, 1), encodeIntField(2, 987654321));
  const textMessage = text(1, "hello from Bale");
  const content = encodeMessageField(15, textMessage);
  const message = concatBytes(
    encodeMessageField(1, chat),
    encodeIntField(2, 123456789),
    encodeIntField(3, 1_720_000_000_000n),
    encodeIntField(4, 42),
    encodeMessageField(5, content),
  );
  const update = encodeMessageField(55, message);
  const updateBody = encodeMessageField(1, update);
  const updateField = encodeMessageField(1, updateBody);
  return encodeMessageField(2, updateField);
}

function sampleDocumentFrame(): Uint8Array {
  const chat = concatBytes(encodeIntField(1, 2), encodeIntField(2, 777));
  const caption = text(1, "quarterly report");
  const document = concatBytes(
    encodeIntField(1, 99),
    encodeIntField(2, 100),
    text(5, "application/pdf"),
    encodeMessageField(8, caption),
  );
  const content = encodeMessageField(4, document);
  const message = concatBytes(
    encodeMessageField(1, chat),
    encodeIntField(2, 555),
    encodeIntField(3, 1_720_000_000_001n),
    encodeIntField(4, 43),
    encodeMessageField(5, content),
  );
  return encodeMessageField(
    2,
    encodeMessageField(1, encodeMessageField(1, encodeMessageField(55, message))),
  );
}

test("encodes the Bale authorization handshake", () => {
  const root = parseProto(encodeBaleHandshake());
  const auth = nested(root, 3);
  assert.ok(auth);
  assert.equal(integer(auth, 1), 1n);
  assert.equal(integer(auth, 2), 1n);
});

test("decodes an incoming private Bale text message", () => {
  assert.deepEqual(decodeBaleIncomingMessage(sampleIncomingFrame()), {
    chatType: 1,
    chatId: "987654321",
    senderId: "123456789",
    messageId: "42",
    date: "1720000000000",
    text: "hello from Bale",
    contentKind: "text",
  });
});

test("ignores non-update frames", () => {
  assert.equal(decodeBaleIncomingMessage(encodeMessageField(5, new Uint8Array())), null);
});

test("decodes attachment captions", () => {
  const decoded = decodeBaleIncomingMessage(sampleDocumentFrame());
  assert.equal(decoded?.chatType, 2);
  assert.equal(decoded?.text, "[Attachment] quarterly report");
  assert.equal(decoded?.contentKind, "document");
});

test("fails closed on malformed protobuf", () => {
  assert.equal(decodeBaleIncomingMessage(Uint8Array.from([0x12, 0x7f])), null);
});

test("encodes a Bale LoadUsers RPC request", () => {
  const root = parseProto(encodeLoadUserRequest(123456789n, 7));
  const body = nested(root, 1);
  assert.ok(body);
  assert.equal(new TextDecoder().decode(body.get(1)?.[0]?.value as Uint8Array), "bale.users.v1.Users");
  assert.equal(integer(body, 5), 7n);
});

test("decodes sender name and avatar metadata", () => {
  const avatar = concatBytes(encodeIntField(1, 99887766), encodeIntField(2, 55443322));
  const user = concatBytes(
    encodeIntField(1, 123456789),
    text(3, "Public name"),
    text(4, "Saved contact name"),
    encodeMessageField(6, avatar),
  );
  const result = parseProto(encodeMessageField(1, user));
  const profile = decodeLoadedUser(result, "123456789");
  assert.equal(profile?.name, "Saved contact name");
  assert.equal(profile?.avatar?.fileId, 99887766n);
  assert.equal(profile?.avatar?.accessHash, 55443322n);
});

test("decodes Bale RPC and temporary file URL responses", () => {
  const fileUrl = concatBytes(
    encodeIntField(1, 99887766),
    text(2, "https://cdn.example/avatar.jpg"),
    encodeIntField(3, 600000),
  );
  const result = encodeMessageField(1, fileUrl);
  const responseBody = concatBytes(
    encodeMessageField(2, result),
    encodeIntField(3, 9),
  );
  const rpc = decodeBaleRpcResponse(encodeMessageField(1, responseBody));
  assert.equal(rpc?.requestId, 9);
  assert.equal(decodeFileUrl(rpc!.result!)?.url, "https://cdn.example/avatar.jpg");
});

