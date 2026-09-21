import assert from "node:assert/strict";
import test from "node:test";

import { baleUserIdFromToken, configuredBaleUserId } from "../src/auth.ts";

function jwt(payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encoded}.signature`;
}

test("extracts the Bale account ID from the JWT payload", () => {
  assert.equal(baleUserIdFromToken(jwt({ payload: { user_id: 123456789 } })), "123456789");
  assert.equal(baleUserIdFromToken(jwt({ user_id: "987654321" })), "987654321");
});

test("rejects invalid account IDs and tokens", () => {
  assert.equal(baleUserIdFromToken("not-a-jwt"), undefined);
  assert.equal(baleUserIdFromToken(jwt({ payload: { user_id: "not-numeric" } })), undefined);
  assert.equal(configuredBaleUserId(" 123456789 "), "123456789");
  assert.equal(configuredBaleUserId("abc"), undefined);
});

