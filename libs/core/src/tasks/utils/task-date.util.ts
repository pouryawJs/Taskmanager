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
