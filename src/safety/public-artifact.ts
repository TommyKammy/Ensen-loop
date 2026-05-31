const secretLikePlaceholder = "<secret-like-value>";
const customerIdentifierPlaceholder = "<customer-identifier>";
const customerPathPlaceholder = "<customer-path>";
const customerDomainPlaceholder = "<customer-domain>";
const privateRepositoryPlaceholder = "<private-repository>";
const regulatedRecordLikePlaceholder = "<regulated-record-like-value>";

const secretLikePatterns: readonly RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/gi,
  /\b(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic|token)?\s*[^\s"'`<>;]+/gi,
  /\b(?:cookie|set-cookie)\s*:\s*[A-Za-z0-9._~-]+=[^\s"'`<>;]+/gi,
  /\b(?:password|passwd|token|secret|credential|api[_-]?key|apikey|session(?:id)?|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*[^\s"'`<>;]+/gi,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{8,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/g,
  /\b(?:sk-[A-Za-z0-9][A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/g,
];

const customerIdentifierPatterns: readonly RegExp[] = [
  /\b(?:customer|cust|tenant|account|organization|org)[_-]?id\s*[:=]\s*[A-Za-z0-9][A-Za-z0-9._~-]{5,}\b/gi,
  /\b(?:cust|customer|tenant|acct|org)_[A-Za-z0-9][A-Za-z0-9._~-]{5,}\b/gi,
];

const customerPathPatterns: readonly RegExp[] = [
  /\b(?:customers?|tenants?|accounts?)\/[A-Za-z0-9._~@/-]+\b/gi,
  /<customer-ref>\/[A-Za-z0-9._~@/-]+\b/gi,
];

const customerDomainPatterns: readonly RegExp[] = [
  /\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:customer|tenant|private|internal)\.example\b/gi,
];

const privateRepositoryDetailPatterns: readonly RegExp[] = [
  /\b(?:https?:\/\/)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]*(?:private|customer|tenant|confidential|internal)[A-Za-z0-9_.-]*(?=$|[\s"'`<>)\]}?,.;:/#])/gi,
  /\bgit@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]*(?:private|customer|tenant|confidential|internal)[A-Za-z0-9_.-]*(?:\.git)?(?=$|[\s"'`<>)\]}?,.;:/#])/gi,
];

const regulatedRecordLikePatterns: readonly RegExp[] = [
  /\bMRN[-_:# ]*\d{6,}\b(?:\s+DOB\s+\d{4}-\d{2}-\d{2})?/gi,
  /\bDOB\s+\d{4}-\d{2}-\d{2}\b/gi,
  /\b(?:electronic signature|batch release|final disposition)\s+(?:record|approval|id)[-_:# ]*[A-Za-z0-9._~-]+\b/gi,
];

export const workstationLocalPathPattern =
  /(?:^|[\s"'([{<>=])(?:\/(?!\/)(?:[A-Za-z0-9._~@-]+(?:\/[A-Za-z0-9._~@-]+)*\/?)|~(?:[/\\]|\s|$)|\$HOME(?:[/\\]|\s|$)|%USERPROFILE%(?:[/\\]|\s|$)|[A-Za-z]:[\\/][^"'`<>\s]+|\\\\[^"'`<>\s\\]+\\[^"'`<>\s\\]+(?:\\[^"'`<>\s\\]+)*)/i;

export function containsUnsafePublicArtifactText(value: string): boolean {
  return (
    containsPattern(value, secretLikePatterns) ||
    containsPattern(value, customerIdentifierPatterns) ||
    containsPattern(value, customerPathPatterns) ||
    containsPattern(value, customerDomainPatterns) ||
    containsPattern(value, privateRepositoryDetailPatterns) ||
    containsPattern(value, regulatedRecordLikePatterns) ||
    workstationLocalPathPattern.test(value)
  );
}

export function sanitizePublicDiagnosticMessage(message: string): string {
  let sanitized = replacePatterns(message, secretLikePatterns, secretLikePlaceholder);
  sanitized = replacePatterns(sanitized, customerIdentifierPatterns, customerIdentifierPlaceholder);
  sanitized = replacePatterns(sanitized, customerPathPatterns, customerPathPlaceholder);
  sanitized = replacePatterns(sanitized, customerDomainPatterns, customerDomainPlaceholder);
  sanitized = replacePatterns(sanitized, privateRepositoryDetailPatterns, privateRepositoryPlaceholder);
  sanitized = replacePatterns(
    sanitized,
    regulatedRecordLikePatterns,
    regulatedRecordLikePlaceholder,
  );
  return sanitized;
}

function containsPattern(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

function replacePatterns(
  message: string,
  patterns: readonly RegExp[],
  placeholder: string,
): string {
  return patterns.reduce((sanitized, pattern) => {
    pattern.lastIndex = 0;
    return sanitized.replace(pattern, placeholder);
  }, message);
}
