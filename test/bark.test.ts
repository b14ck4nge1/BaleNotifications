import assert from "node:assert/strict";
import test from "node:test";

import { barkGroupName } from "../src/bark.ts";

test("groups Bale notifications by sender inside a Bale namespace", () => {
  assert.equal(barkGroupName(undefined, "123456789"), "BaleNotifications:sender:123456789");
  assert.equal(barkGroupName("My Bale", "123456789"), "My Bale:sender:123456789");
  assert.equal(barkGroupName("My Bale", "987654321"), "My Bale:sender:987654321");
  assert.equal(barkGroupName("My Bale"), "My Bale:system");
});
