import { BadRequestException } from '@nestjs/common';

/**
 * Validates whether a string is a valid ISO calendar date (YYYY-MM-DD),
 * including year, month, and day-of-month correctness (accounting for leap years).
 */
export function isValidIsoDate(dateStr?: string | null): boolean {
  if (!dateStr || typeof dateStr !== 'string') {
    return false;
  }

  const trimmed = dateStr.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return false;
  }

  const [yearStr, monthStr, dayStr] = trimmed.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (month < 1 || month > 12) {
    return false;
  }
  if (day < 1 || day > 31) {
    return false;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * Normalizes a time-of-day string into standardized 'HH:mm:ss' format.
 * Accepts 'HH:mm' or 'HH:mm:ss' between 00:00:00 and 23:59:59.
 * Returns null if input is null or undefined.
 * Throws BadRequestException if format or values are invalid.
 */
export function normalizeTimeString(timeStr?: string | null): string | null {
  if (timeStr === undefined || timeStr === null) {
    return null;
  }

  if (typeof timeStr !== 'string') {
    throw new BadRequestException('Scheduled start time must be a string.');
  }

  const trimmed = timeStr.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const match = trimmed.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (!match) {
    throw new BadRequestException(
      `Invalid time format '${timeStr}'. Expected HH:mm or HH:mm:ss (e.g. '09:30' or '14:00:00').`,
    );
  }

  const hours = match[1];
  const minutes = match[2];
  const seconds = match[3] ?? '00';

  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Returns today's calendar date string (YYYY-MM-DD) evaluated in the provided IANA timezone.
 * Defaults to 'Asia/Tehran'.
 */
export function getTodayDateString(timezone: string = 'Asia/Tehran'): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  } catch {
    const fallbackFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tehran',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return fallbackFormatter.format(new Date());
  }
}

/**
 * Converts a local calendar date string (YYYY-MM-DD) and local time string (HH:mm or HH:mm:ss)
 * within an IANA timezone into a UTC Date object.
 *
 * Uses standard Intl.DateTimeFormat with a refinement iteration to accurately account for
 * local standard time and daylight saving time offsets.
 *
 * Throws BadRequestException if date or time formats are invalid.
 */
export function localDateTimeToUtcDate(
  dateStr: string,
  timeStr: string,
  timeZone: string = 'Asia/Tehran',
): Date {
  if (!isValidIsoDate(dateStr)) {
    throw new BadRequestException(
      `'${dateStr}' is not a valid calendar date in YYYY-MM-DD format.`,
    );
  }

  const normalizedTime = normalizeTimeString(timeStr);
  if (!normalizedTime) {
    throw new BadRequestException('A valid time string is required.');
  }

  const [yearStr, monthStr, dayStr] = dateStr.trim().split('-');
  const [hoursStr, minutesStr, secondsStr] = normalizedTime.split(':');

  const y = parseInt(yearStr, 10);
  const m = parseInt(monthStr, 10);
  const d = parseInt(dayStr, 10);
  const h = parseInt(hoursStr, 10);
  const min = parseInt(minutesStr, 10);
  const s = parseInt(secondsStr, 10);

  const targetUtcMs = Date.UTC(y, m - 1, d, h, min, s);

  // Determine IANA timezone to use with fallback to 'Asia/Tehran'
  let safeTz = timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: safeTz });
  } catch {
    safeTz = 'Asia/Tehran';
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const getOffsetMs = (epochMs: number): number => {
    const parts = formatter.formatToParts(new Date(epochMs));
    const p: Record<string, number> = {};
    for (const { type, value } of parts) {
      if (type !== 'literal') {
        p[type] = parseInt(value, 10);
      }
    }
    const localHour = p.hour === 24 ? 0 : p.hour;
    const localMs = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      localHour,
      p.minute,
      p.second,
    );
    return localMs - epochMs;
  };

  const offsetAtTarget = getOffsetMs(targetUtcMs);
  const candidateUtc1 = targetUtcMs - offsetAtTarget;
  const offset1 = getOffsetMs(candidateUtc1);
  const candidateUtc2 = targetUtcMs - offset1;
  const offset2 = getOffsetMs(candidateUtc2);

  // If offset1 === offset2, the local time exists and is resolved unambiguously.
  // If offset1 !== offset2, the local time falls in a nonexistent spring-forward gap (e.g. 02:00 jumps to 03:00).
  // In a spring-forward gap, we advance into post-transition time by using candidateUtc1 (e.g. 02:30 -> 03:30 local time),
  // aligning with the standard ECMAScript Temporal specification.
  const finalUtcMs = offset1 === offset2 ? candidateUtc2 : candidateUtc1;

  return new Date(finalUtcMs);
}

/**
 * Formats a UTC Date (or ISO string) into local time 'HH:mm' within an IANA timezone.
 * Defaults to 'Asia/Tehran'.
 * Throws BadRequestException if date is invalid.
 */
export function formatUtcToLocalTime(
  date: Date | string,
  timeZone: string = 'Asia/Tehran',
): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) {
    throw new BadRequestException('Invalid date object.');
  }

  let safeTz = timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: safeTz });
  } catch {
    safeTz = 'Asia/Tehran';
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });

  const parts = formatter.formatToParts(d);
  let hour = '00';
  let minute = '00';

  for (const { type, value } of parts) {
    if (type === 'hour') {
      const h = parseInt(value, 10);
      hour = String(h === 24 ? 0 : h).padStart(2, '0');
    } else if (type === 'minute') {
      minute = value.padStart(2, '0');
    }
  }

  return `${hour}:${minute}`;
}

/**
 * Formats a time-of-day string ('HH:mm:ss' or 'HH:mm') into standard 'HH:mm' format for display.
 * Returns null if input is empty or nullish.
 */
export function formatTimeString(timeStr?: string | null): string | null {
  if (!timeStr || typeof timeStr !== 'string') {
    return null;
  }
  const trimmed = timeStr.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const match = trimmed.match(/^([01]\d|2[0-3]):([0-5]\d)/);
  if (!match) {
    return trimmed;
  }
  return `${match[1]}:${match[2]}`;
}
