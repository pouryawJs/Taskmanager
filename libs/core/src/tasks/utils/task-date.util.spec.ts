import { BadRequestException } from '@nestjs/common';
import {
  isValidIsoDate,
  normalizeTimeString,
  getTodayDateString,
  localDateTimeToUtcDate,
  formatUtcToLocalTime,
  formatTimeString,
} from './task-date.util';

describe('task-date.util', () => {
  describe('isValidIsoDate', () => {
    it('should return true for valid YYYY-MM-DD dates', () => {
      expect(isValidIsoDate('2026-10-18')).toBe(true);
      expect(isValidIsoDate('2024-02-29')).toBe(true); // leap year
      expect(isValidIsoDate('2026-01-01')).toBe(true);
      expect(isValidIsoDate('2026-12-31')).toBe(true);
    });

    it('should return false for invalid calendar dates', () => {
      expect(isValidIsoDate('2026-02-29')).toBe(false); // not leap year
      expect(isValidIsoDate('2026-04-31')).toBe(false); // April has 30 days
      expect(isValidIsoDate('2026-13-01')).toBe(false); // invalid month
      expect(isValidIsoDate('2026-00-10')).toBe(false);
      expect(isValidIsoDate('2026-05-00')).toBe(false);
    });

    it('should return false for non-date or malformed strings', () => {
      expect(isValidIsoDate('')).toBe(false);
      expect(isValidIsoDate(null)).toBe(false);
      expect(isValidIsoDate(undefined)).toBe(false);
      expect(isValidIsoDate('18-10-2026')).toBe(false);
      expect(isValidIsoDate('2026/10/18')).toBe(false);
      expect(isValidIsoDate('hello')).toBe(false);
    });
  });

  describe('normalizeTimeString', () => {
    it('should normalize HH:mm to HH:mm:00', () => {
      expect(normalizeTimeString('09:30')).toBe('09:30:00');
      expect(normalizeTimeString('00:00')).toBe('00:00:00');
      expect(normalizeTimeString('23:59')).toBe('23:59:00');
    });

    it('should keep HH:mm:ss unchanged', () => {
      expect(normalizeTimeString('14:45:30')).toBe('14:45:30');
    });

    it('should return null for empty or nullish values', () => {
      expect(normalizeTimeString(null)).toBeNull();
      expect(normalizeTimeString(undefined)).toBeNull();
      expect(normalizeTimeString('')).toBeNull();
      expect(normalizeTimeString('   ')).toBeNull();
    });

    it('should throw BadRequestException for invalid time formats', () => {
      expect(() => normalizeTimeString('24:00')).toThrow(BadRequestException);
      expect(() => normalizeTimeString('12:60')).toThrow(BadRequestException);
      expect(() => normalizeTimeString('invalid')).toThrow(BadRequestException);
      expect(() => normalizeTimeString('9:30')).toThrow(BadRequestException);
    });
  });

  describe('getTodayDateString', () => {
    it('should return a valid YYYY-MM-DD date string for Asia/Tehran', () => {
      const today = getTodayDateString('Asia/Tehran');
      expect(isValidIsoDate(today)).toBe(true);
    });

    it('should return a valid YYYY-MM-DD date string for UTC', () => {
      const today = getTodayDateString('UTC');
      expect(isValidIsoDate(today)).toBe(true);
    });

    it('should fall back to Asia/Tehran if invalid timezone is passed', () => {
      const today = getTodayDateString('invalid-tz');
      expect(isValidIsoDate(today)).toBe(true);
    });
  });

  describe('localDateTimeToUtcDate', () => {
    it('should convert local date and time in Asia/Tehran (UTC+3:30) to correct UTC Date', () => {
      const result = localDateTimeToUtcDate(
        '2026-10-18',
        '10:30:00',
        'Asia/Tehran',
      );
      expect(result.toISOString()).toBe('2026-10-18T07:00:00.000Z');
    });

    it('should convert local date and time in UTC to identical UTC Date', () => {
      const result = localDateTimeToUtcDate('2026-10-18', '10:30:00', 'UTC');
      expect(result.toISOString()).toBe('2026-10-18T10:30:00.000Z');
    });

    it('should convert local date and time in America/New_York (UTC-4 in October) to correct UTC Date', () => {
      const result = localDateTimeToUtcDate(
        '2026-10-18',
        '10:30:00',
        'America/New_York',
      );
      expect(result.toISOString()).toBe('2026-10-18T14:30:00.000Z');
    });

    it('should handle HH:mm input without seconds', () => {
      const result = localDateTimeToUtcDate(
        '2026-10-18',
        '10:30',
        'Asia/Tehran',
      );
      expect(result.toISOString()).toBe('2026-10-18T07:00:00.000Z');
    });

    it('should throw BadRequestException for invalid date', () => {
      expect(() =>
        localDateTimeToUtcDate('invalid-date', '10:30:00', 'Asia/Tehran'),
      ).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid time', () => {
      expect(() =>
        localDateTimeToUtcDate('2026-10-18', '25:99:00', 'Asia/Tehran'),
      ).toThrow(BadRequestException);
    });

    it('should fall back to Asia/Tehran if timezone is invalid', () => {
      const result = localDateTimeToUtcDate(
        '2026-10-18',
        '10:30:00',
        'invalid-timezone',
      );
      expect(result.toISOString()).toBe('2026-10-18T07:00:00.000Z');
    });

    it('should resolve winter standard time in America/New_York (EST, UTC-5)', () => {
      const result = localDateTimeToUtcDate(
        '2026-01-15',
        '10:30:00',
        'America/New_York',
      );
      expect(result.toISOString()).toBe('2026-01-15T15:30:00.000Z');
    });

    it('should advance nonexistent spring-forward local time in America/New_York to post-transition time', () => {
      // On 2026-03-08 in America/New_York, 02:00 springs forward to 03:00.
      // 02:30 does not exist locally; it is advanced by the gap duration to 03:30 EDT (07:30 UTC).
      const result = localDateTimeToUtcDate(
        '2026-03-08',
        '02:30:00',
        'America/New_York',
      );
      expect(result.toISOString()).toBe('2026-03-08T07:30:00.000Z');
    });

    it('should resolve ambiguous fall-back local time in America/New_York deterministically to earlier occurrence', () => {
      // On 2026-11-01 in America/New_York, 02:00 falls back to 01:00.
      // 01:30 occurs twice; our implementation resolves to the earlier occurrence (05:30 UTC, EDT).
      const result = localDateTimeToUtcDate(
        '2026-11-01',
        '01:30:00',
        'America/New_York',
      );
      expect(result.toISOString()).toBe('2026-11-01T05:30:00.000Z');
    });
  });

  describe('formatUtcToLocalTime', () => {
    it('should convert UTC Date to local HH:mm in Asia/Tehran (UTC+3:30)', () => {
      const date = new Date('2026-10-18T10:00:00.000Z');
      expect(formatUtcToLocalTime(date, 'Asia/Tehran')).toBe('13:30');
    });

    it('should convert UTC Date to local HH:mm in UTC', () => {
      const date = new Date('2026-10-18T10:00:00.000Z');
      expect(formatUtcToLocalTime(date, 'UTC')).toBe('10:00');
    });

    it('should convert UTC Date to local HH:mm in America/New_York (EDT, UTC-4)', () => {
      const date = new Date('2026-10-18T10:00:00.000Z');
      expect(formatUtcToLocalTime(date, 'America/New_York')).toBe('06:00');
    });

    it('should fall back to Asia/Tehran for invalid timezone', () => {
      const date = new Date('2026-10-18T10:00:00.000Z');
      expect(formatUtcToLocalTime(date, 'invalid-tz')).toBe('13:30');
    });

    it('should throw BadRequestException for invalid date', () => {
      expect(() => formatUtcToLocalTime('invalid-date')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('formatTimeString', () => {
    it('should format HH:mm:ss to HH:mm', () => {
      expect(formatTimeString('09:30:00')).toBe('09:30');
      expect(formatTimeString('14:45:30')).toBe('14:45');
    });

    it('should return HH:mm unchanged', () => {
      expect(formatTimeString('18:00')).toBe('18:00');
    });

    it('should return null for empty or nullish strings', () => {
      expect(formatTimeString(null)).toBeNull();
      expect(formatTimeString(undefined)).toBeNull();
      expect(formatTimeString('')).toBeNull();
      expect(formatTimeString('   ')).toBeNull();
    });
  });
});
