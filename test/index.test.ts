import assert from "node:assert/strict";
import test from "node:test";

import { autoStartEnabled } from "../src/index.ts";

test("auto-start is enabled by default and can be disabled", () => {
  assert.equal(autoStartEnabled({}), true);
  assert.equal(autoStartEnabled({ AUTO_START: "true" }), true);
  assert.equal(autoStartEnabled({ AUTO_START: "false" }), false);
  assert.equal(autoStartEnabled({ AUTO_START: "off" }), false);
});

