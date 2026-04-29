import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  WorkItemValidationError,
  parseLocalWorkItem,
  validateLocalWorkItem,
} from "../src/work-item/index.js";

async function readFixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(path.join("test", "fixtures", "work-items", name), "utf8"),
  ) as unknown;
}

test("accepts a valid local work item fixture", async () => {
  const parsed = parseLocalWorkItem(await readFixture("valid-local-work-item.json"));

  assert.deepEqual(parsed, {
    id: "local-work-item-1",
    title: "Validate local work item contracts",
    source: "local-fixture",
    status: "ready",
  });
});

test("returns actionable validation issues for malformed local work items", async () => {
  const missingTitle = validateLocalWorkItem(await readFixture("missing-title.json"));
  const malformedStatus = validateLocalWorkItem(await readFixture("malformed-status.json"));
  const nonObject = validateLocalWorkItem(await readFixture("non-object.json"));

  assert.equal(missingTitle.ok, false);
  assert.deepEqual(missingTitle.issues, [
    {
      path: "title",
      message: "title is required and must be a non-empty string.",
    },
  ]);

  assert.equal(malformedStatus.ok, false);
  assert.deepEqual(malformedStatus.issues, [
    {
      path: "status",
      message:
        "status must be one of: ready, blocked, running, completed, failed.",
    },
  ]);

  assert.equal(nonObject.ok, false);
  assert.deepEqual(nonObject.issues, [
    {
      path: "$",
      message: "Local work item input must be a JSON object.",
    },
  ]);
});

test("rejects non-plain objects at the local work item boundary", () => {
  class PrototypeBackedWorkItem {
    readonly id = "local-work-item-1";
    readonly title = "Prototype-backed work item";
    readonly source = "local-fixture";
    readonly status = "ready";
  }

  const classInstance = validateLocalWorkItem(new PrototypeBackedWorkItem());
  const inheritedFields = validateLocalWorkItem(
    Object.create({
      id: "local-work-item-1",
      title: "Inherited fields work item",
      source: "local-fixture",
      status: "ready",
    }) as unknown,
  );

  assert.equal(classInstance.ok, false);
  assert.deepEqual(classInstance.issues, [
    {
      path: "$",
      message: "Local work item input must be a JSON object.",
    },
  ]);

  assert.equal(inheritedFields.ok, false);
  assert.deepEqual(inheritedFields.issues, [
    {
      path: "$",
      message: "Local work item input must be a JSON object.",
    },
  ]);
});

test("throws a validation error that preserves individual local work item issues", async () => {
  assert.throws(
    () => parseLocalWorkItem({
      id: "",
      title: "Missing source and invalid id",
      status: "ready",
    }),
    (error: unknown) => {
      assert.ok(error instanceof WorkItemValidationError);
      assert.match(error.message, /Local work item is malformed/);
      assert.deepEqual(error.issues, [
        {
          path: "id",
          message:
            "id is required and must be a non-empty string matching letters, numbers, dots, underscores, or hyphens.",
        },
        {
          path: "source",
          message: "source is required and must be a non-empty string.",
        },
      ]);

      return true;
    },
  );
});
