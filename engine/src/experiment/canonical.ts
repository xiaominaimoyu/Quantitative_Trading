/**
 * Canonical JSON serialization and content hashing (P0-4).
 *
 * Reproducibility depends on hashing being deterministic: object keys are
 * sorted, whitespace is fixed, and non-JSON values are rejected instead of
 * silently coerced. `JSON.stringify` alone is not enough because key order
 * follows insertion order.
 */

import { createHash } from 'node:crypto';

/**
 * Serialize any plain (JSON-shaped) value into a canonical string.
 *
 * Object keys are recursively sorted; arrays keep their order; numbers use
 * the ECMAScript number-to-string algorithm (stable within a runtime).
 *
 * @param value - Value to serialize.
 * @returns The canonical JSON string.
 * @throws {@link TypeError} for non-finite numbers, `undefined`, functions,
 * symbols and other values that are not JSON-safe.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number': {
      if (!Number.isFinite(value)) {
        throw new TypeError(`canonicalJson: non-finite number ${String(value)}`);
      }
      return JSON.stringify(value);
    }
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
      }
      const record = value as Record<string, unknown>;
      // JSON semantics: keys with `undefined` values are treated as absent,
      // which keeps optional config fields hashable.
      const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort();
      const parts = keys.map(
        (key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`,
      );
      return `{${parts.join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported value of type ${typeof value}`);
  }
}

/**
 * SHA-256 of a UTF-8 string, hex-encoded.
 *
 * @param input - String to hash.
 * @returns 64-character lowercase hex digest.
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Content hash of any JSON-shaped value: `sha256(canonicalJson(value))`.
 *
 * @param value - Value to fingerprint.
 * @returns 64-character lowercase hex digest.
 */
export function hashJson(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
