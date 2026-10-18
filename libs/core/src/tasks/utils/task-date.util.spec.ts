import { BadRequestException } from '@nestjs/common';
import {
  isValidIsoDate,
  normalizeTimeString,
  getTodayDateString,
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
});
