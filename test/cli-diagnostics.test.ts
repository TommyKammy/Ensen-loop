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

test("CLI diagnostics redact secret-like values", () => {
  const authHeader = "Authorization: Bearer ghp_1234567890abcdef";
  const sessionCookie = "Cookie: sessionid=s3ssion-value; path=/";
  const privateKeyMarker = "-----BEGIN OPENSSH PRIVATE KEY-----";
  const apiKeyAssignment = "apiKey = sk-test-1234567890abcdef";
  const message = [
    `request failed with ${authHeader}`,
    `adapter returned ${sessionCookie}`,
    `fixture included ${privateKeyMarker}`,
    `config contained ${apiKeyAssignment}`,
  ].join("\n");

  const sanitized = sanitizeCliErrorMessage(message);

  assert.doesNotMatch(sanitized, new RegExp(escapeRegExp(authHeader)));
  assert.doesNotMatch(sanitized, new RegExp(escapeRegExp(sessionCookie)));
  assert.doesNotMatch(sanitized, new RegExp(escapeRegExp(privateKeyMarker)));
  assert.doesNotMatch(sanitized, new RegExp(escapeRegExp(apiKeyAssignment)));
  assert.match(sanitized, /request failed with <secret-like-value>/);
  assert.match(sanitized, /adapter returned <secret-like-value>/);
  assert.match(sanitized, /fixture included <secret-like-value>/);
  assert.match(sanitized, /config contained <secret-like-value>/);
});

test("CLI diagnostics redact customer and regulated-looking values", () => {
  const customerId = "customer_id=cust_synthetic_123456";
  const customerPath = "customers/synthetic-pharma/orders/export.json";
  const customerDomain = "alpha-customer.customer.example";
  const regulatedRecord = "MRN-12345678 DOB 1970-01-01";
  const message = [
    `artifact blocked for ${customerId}`,
    `artifact blocked for customer path ${customerPath}`,
    `artifact blocked for tenant ${customerDomain}`,
    `artifact blocked for synthetic regulated fixture ${regulatedRecord}`,
  ].join("\n");

  const sanitized = sanitizeCliErrorMessage(message);

  assert.doesNotMatch(sanitized, new RegExp(escapeRegExp(customerId)));
  assert.doesNotMatch(sanitized, new RegExp(escapeRegExp(customerPath)));
  assert.doesNotMatch(sanitized, new RegExp(escapeRegExp(customerDomain)));
  assert.doesNotMatch(sanitized, new RegExp(escapeRegExp(regulatedRecord)));
  assert.match(sanitized, /artifact blocked for <customer-identifier>/);
  assert.match(sanitized, /artifact blocked for customer path <customer-path>/);
  assert.match(sanitized, /artifact blocked for tenant <customer-domain>/);
  assert.match(sanitized, /artifact blocked for synthetic regulated fixture <regulated-record-like-value>/);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
