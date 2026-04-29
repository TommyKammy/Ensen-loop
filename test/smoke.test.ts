import assert from "node:assert/strict";
import test from "node:test";

import { describeProduct, productIdentity } from "../src/index.js";

test("defines the independent Ensen-loop product baseline", () => {
  assert.equal(productIdentity.name, "Ensen-loop");
  assert.equal(productIdentity.role, "development lane engine");
  assert.equal(productIdentity.successorTo, "codex-supervisor");
  assert.equal(productIdentity.independent, true);
  assert.match(describeProduct(), /independent development lane engine/);
});
