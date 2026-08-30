/**
 * Deterministic timestamp parsing (P0-3).
 *
 * `Date.parse` is deliberately avoided for naive strings: its behavior is
 * implementation- and locale-dependent (Node parses naive strings as local
 * time), which would break reproducibility across machines. Parsing is
 * done with an explicit grammar instead.
 */

/**
 * Grammar accepted by {@link parseTimestamp}:
 * `YYYY-MM-DD[T ]HH:MM[:SS[.fff]][Z|±HH:MM|±HHMM]`
 */
const TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|z|[+-]\d{2}:?\d{2})?$/;

/**
 * Parse a raw timestamp into epoch milliseconds (UTC).
 *
 * - Numbers pass through unchanged (must be finite).
 * - Strings with an explicit offset (`Z` or `±HH:MM`) are converted to UTC.
 * - Naive strings (no offset) are interpreted as UTC plus
 *   `naiveOffsetMinutes` (e.g. `480` treats `09:30` as UTC+8 wall time).
 * - Out-of-range calendar components (month 13, hour 25, ...) are rejected
 *   instead of silently rolling over.
 *
 * @param raw - Raw timestamp (epoch ms or string).
 * @param naiveOffsetMinutes - Offset applied to naive strings. Default 0.
 * @returns Epoch milliseconds, or `null` when unparseable.
 */
export function parseTimestamp(raw: string | number, naiveOffsetMinutes = 0): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }

  const match = TIMESTAMP_RE.exec(raw.trim());
  if (!match) {
    return null;
  }
  const [, y, mo, d, h, mi, sec = '0', frac, offset] = match;

  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(sec);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23) return null;
  if (minute > 59) return null;
  if (second > 59) return null;

  const ms = frac ? Number(frac.padEnd(3, '0')) : 0;
  const utc = Date.UTC(year, month - 1, day, hour, minute, second, ms);

  if (!offset || offset === 'Z' || offset === 'z') {
    return utc - naiveOffsetMinutes * 60_000;
  }

  const sign = offset.startsWith('-') ? -1 : 1;
  const digits = offset.slice(1).replace(':', '');
  const offsetHours = Number(digits.slice(0, 2));
  const offsetMinutes = Number(digits.slice(2, 4) || '0');
  if (offsetHours > 23 || offsetMinutes > 59) return null;
  return utc - sign * (offsetHours * 60 + offsetMinutes) * 60_000;
}
