const secretLikePlaceholder = "<secret-like-value>";

const secretLikePatterns: readonly RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/gi,
  /\b(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic|token)?\s*[^\s"'`<>;]+/gi,
  /\b(?:cookie|set-cookie)\s*:\s*[A-Za-z0-9._~-]+=[^\s"'`<>;]+/gi,
  /\b(?:password|passwd|token|secret|credential|api[_-]?key|apikey|session(?:id)?|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*[^\s"'`<>;]+/gi,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{8,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/g,
  /\b(?:sk-[A-Za-z0-9][A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/g,
];

export const workstationLocalPathPattern =
  /(?:^|[\s"'([{<>=])(?:\/(?!\/)(?:[A-Za-z0-9._~@-]+(?:\/[A-Za-z0-9._~@-]+)*\/?)|~(?:[/\\]|\s|$)|\$HOME(?:[/\\]|\s|$)|%USERPROFILE%(?:[/\\]|\s|$)|[A-Za-z]:[\\/][^"'`<>\s]+|\\\\[^"'`<>\s\\]+\\[^"'`<>\s\\]+(?:\\[^"'`<>\s\\]+)*)/i;

export function containsUnsafePublicArtifactText(value: string): boolean {
  return secretLikePatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  }) || workstationLocalPathPattern.test(value);
}

export function sanitizePublicDiagnosticMessage(message: string): string {
  return secretLikePatterns.reduce((sanitized, pattern) => {
    pattern.lastIndex = 0;
    return sanitized.replace(pattern, secretLikePlaceholder);
  }, message);
}
