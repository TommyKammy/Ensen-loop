import { sanitizePublicDiagnosticMessage } from "../safety/public-artifact.js";

const localPathPlaceholder = "<local-path>";

const quotedAbsolutePathPattern =
  /(["'])(\/[^"'\r\n]+|[A-Za-z]:[\\/][^"'\r\n]+|\\\\[^"'\r\n]+)\1/g;
const windowsDrivePathPattern = /\b[A-Za-z]:[\\/][^\s"'\r\n]+/g;
const windowsUncPathPattern = /\\\\[^\s"'\r\n]+/g;
const posixAbsolutePathPattern = /(^|[\s(:])\/[^\s"'\r\n)]+/g;

export function sanitizeCliErrorMessage(message: string): string {
  return sanitizePublicDiagnosticMessage(message)
    .replace(quotedAbsolutePathPattern, (_match, quote: string) => `${quote}${localPathPlaceholder}${quote}`)
    .replace(windowsDrivePathPattern, localPathPlaceholder)
    .replace(windowsUncPathPattern, localPathPlaceholder)
    .replace(posixAbsolutePathPattern, (match: string, prefix: string) => `${prefix}${localPathPlaceholder}`);
}
