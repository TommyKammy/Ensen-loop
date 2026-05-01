import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { sanitizeCliErrorMessage } from "../src/cli/diagnostics.js";

test("CLI filesystem diagnostics redact local absolute path shapes", () => {
  const homePath = path.join(os.homedir(), "ensen-loop", "marker.json");
  const posixTempPath = path.join(os.tmpdir(), "ensen-loop-xgate3-state", "marker.json");
  const windowsHomePath = ["C:", "Users", "operator", "AppData", "Local", "Temp", "marker.json"].join("\\");
  const windowsSlashPath = ["D:", "Users", "operator", "workspace", "marker.json"].join("/");
  const windowsUncPath = ["", "", "server", "share", "folder", "marker.json"].join("\\");

  const message = [
    `ENOENT: no such file or directory, open '${homePath}'`,
    `EISDIR: illegal operation on a directory, open "${posixTempPath}"`,
    `EPERM: operation not permitted, open '${windowsHomePath}'`,
    `EACCES: permission denied, open ${windowsSlashPath}`,
    `EBUSY: resource busy or locked, open '${windowsUncPath}'`,
  ].join("\n");

  const sanitized = sanitizeCliErrorMessage(message);

  assert.doesNotMatch(sanitized, new RegExp(escapeRegExp(homePath)));
  assert.doesNotMatch(sanitized, new RegExp(escapeRegExp(posixTempPath)));
  assert.doesNotMatch(sanitized, new RegExp(escapeRegExp(windowsHomePath)));
  assert.doesNotMatch(sanitized, new RegExp(escapeRegExp(windowsSlashPath)));
  assert.doesNotMatch(sanitized, new RegExp(escapeRegExp(windowsUncPath)));
  assert.match(sanitized, /ENOENT: no such file or directory, open '<local-path>'/);
  assert.match(sanitized, /EISDIR: illegal operation on a directory, open "<local-path>"/);
  assert.match(sanitized, /EPERM: operation not permitted, open '<local-path>'/);
  assert.match(sanitized, /EACCES: permission denied, open <local-path>/);
  assert.match(sanitized, /EBUSY: resource busy or locked, open '<local-path>'/);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
