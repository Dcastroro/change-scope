export const LIMITS = Object.freeze({
  configBytes: 1_048_576,
  changeBytes: 8_388_608,
  projects: 10_000,
  edges: 100_000,
  selectors: 50_000,
  changes: 100_000,
  pathBytes: 4_096,
  pathDepth: 128,
  matches: 1_000_000,
  gitMilliseconds: 15_000,
});

export class ScopeError extends Error {
  constructor(code) { super(code); this.name = 'ScopeError'; this.code = code; }
}
export function fail(code) { throw new ScopeError(code); }
export function pathParts(value, directory = false) {
  if (typeof value !== 'string' || !value || value.length > LIMITS.pathBytes || !value.isWellFormed() || Buffer.byteLength(value) > LIMITS.pathBytes
    || /[\\:\x00-\x1f\x7f*?\[\]{}]/.test(value) || value.startsWith('/')) fail('invalid-path');
  const clean = directory && value.endsWith('/') ? value.slice(0, -1) : value;
  const parts = clean.split('/');
  if (parts.length > LIMITS.pathDepth || parts.some(part => !part || part === '.' || part === '..')) fail('invalid-path');
  return parts;
}
export function jsonText(bytes, maxBytes) {
  if (bytes.length > maxBytes) fail('input-limit');
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('invalid-json'); }
}
export function objectKeys(value, allowed, code = 'invalid-config') {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.includes(key))) fail(code);
}
