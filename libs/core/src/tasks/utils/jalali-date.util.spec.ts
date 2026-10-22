import {
  gregorianToJalali,
  jalaliToGregorian,
  isJalaliLeapYear,
  getJalaliMonthDays,
  formatIsoDateToJalali,
  formatDateForUser,
  formatDateTimeForUser,
  JALALI_MONTH_NAMES,
} from './jalali-date.util';
import { CalendarType } from '@app/database';

describe('Jalali Date Utilities (jalali-date.util)', () => {
  describe('Month names and lengths', () => {
    it('has 12 Jalali month names in correct Persian sequence', () => {
      expect(JALALI_MONTH_NAMES).toHaveLength(12);
      expect(JALALI_MONTH_NAMES[0]).toBe('فروردین');
      expect(JALALI_MONTH_NAMES[6]).toBe('مهر');
      expect(JALALI_MONTH_NAMES[11]).toBe('اسفند');
    });

    it('returns 31 days for months 1 to 6', () => {
      for (let m = 1; m <= 6; m++) {
        expect(getJalaliMonthDays(1405, m)).toBe(31);
      }
    });

    it('returns 30 days for months 7 to 11', () => {
      for (let m = 7; m <= 11; m++) {
        expect(getJalaliMonthDays(1405, m)).toBe(30);
      }
    });

    it('returns 29 days for month 12 in a common year, and 30 in a leap year', () => {
      // 1403 is a leap year; 1404 and 1405 are common years
      expect(isJalaliLeapYear(1403)).toBe(true);
      expect(getJalaliMonthDays(1403, 12)).toBe(30);

      expect(isJalaliLeapYear(1404)).toBe(false);
      expect(getJalaliMonthDays(1404, 12)).toBe(29);

      expect(isJalaliLeapYear(1405)).toBe(false);
      expect(getJalaliMonthDays(1405, 12)).toBe(29);
    });
  });

  describe('Gregorian <-> Jalali conversions', () => {
    it('correctly converts known Gregorian dates to Jalali', () => {
      // 2026-10-22 -> 1405-07-30 (30 Mehr 1405)
      const j1 = gregorianToJalali(2026, 10, 22);
      expect(j1).toEqual({ jy: 1405, jm: 7, jd: 30 });

      // 2026-03-21 -> 1405-01-01 (Nowruz 1405)
      const j2 = gregorianToJalali(2026, 3, 21);
      expect(j2).toEqual({ jy: 1405, jm: 1, jd: 1 });

      // 2026-03-20 -> 1404-12-29 (Last day of 1404)
      const j3 = gregorianToJalali(2026, 3, 20);
      expect(j3).toEqual({ jy: 1404, jm: 12, jd: 29 });

      // 2024-03-20 -> 1403-01-01 (Leap year boundary)
      const j4 = gregorianToJalali(2024, 3, 20);
      expect(j4).toEqual({ jy: 1403, jm: 1, jd: 1 });

      // 2025-03-20 -> 1403-12-30 (30 Esfand in leap year 1403)
      const j5 = gregorianToJalali(2025, 3, 20);
      expect(j5).toEqual({ jy: 1403, jm: 12, jd: 30 });
    });

    it('correctly converts Jalali dates back to Gregorian', () => {
      const g1 = jalaliToGregorian(1405, 7, 30);
      expect(g1).toEqual({ gy: 2026, gm: 10, gd: 22 });

      const g2 = jalaliToGregorian(1405, 1, 1);
      expect(g2).toEqual({ gy: 2026, gm: 3, gd: 21 });

      const g3 = jalaliToGregorian(1404, 12, 29);
      expect(g3).toEqual({ gy: 2026, gm: 3, gd: 20 });

      const g4 = jalaliToGregorian(1403, 12, 30);
      expect(g4).toEqual({ gy: 2025, gm: 3, gd: 20 });
    });

    it('preserves round-trip conversions for every day of a month', () => {
      // Round trip check for all 30 days of Mehr 1405
      for (let day = 1; day <= 30; day++) {
        const g = jalaliToGregorian(1405, 7, day);
        const j = gregorianToJalali(g.gy, g.gm, g.gd);
        expect(j).toEqual({ jy: 1405, jm: 7, jd: day });
      }

      // Round trip check for all 31 days of Farvardin 1405
      for (let day = 1; day <= 31; day++) {
        const g = jalaliToGregorian(1405, 1, day);
        const j = gregorianToJalali(g.gy, g.gm, g.gd);
        expect(j).toEqual({ jy: 1405, jm: 1, jd: day });
      }
    });
  });

  describe('formatIsoDateToJalali', () => {
    it('formats ISO dates into YYYY/MM/DD Jalali format', () => {
      expect(formatIsoDateToJalali('2026-10-22')).toBe('1405/07/30');
      expect(formatIsoDateToJalali('2026-03-21')).toBe('1405/01/01');
      expect(formatIsoDateToJalali('2026-03-20')).toBe('1404/12/29');
    });

    it('gracefully handles malformed or non-string inputs', () => {
      expect(formatIsoDateToJalali('')).toBe('');
      expect(formatIsoDateToJalali('invalid')).toBe('invalid');
      expect(formatIsoDateToJalali(null as unknown as string)).toBe(null);
    });
  });

  describe('formatDateForUser', () => {
    it('returns Jalali date string when calendarType is JALALI', () => {
      expect(formatDateForUser('2026-10-22', CalendarType.JALALI)).toBe(
        '1405/07/30',
      );
      expect(formatDateForUser('2026-10-22', 'jalali')).toBe('1405/07/30');
    });

    it('returns Gregorian date string when calendarType is GREGORIAN or unset', () => {
      expect(formatDateForUser('2026-10-22', CalendarType.GREGORIAN)).toBe(
        '2026-10-22',
      );
      expect(formatDateForUser('2026-10-22')).toBe('2026-10-22');
      expect(formatDateForUser('2026-10-22', null)).toBe('2026-10-22');
    });
  });

  describe('formatDateTimeForUser', () => {
    it('formats date and time in Gregorian mode', () => {
      const dt = new Date('2026-10-22T14:30:00Z');
      const formatted = formatDateTimeForUser(
        dt,
        'Asia/Tehran',
        CalendarType.GREGORIAN,
      );
      expect(formatted).toBe('2026-10-22 18:00');
    });

    it('formats date and time in Jalali mode', () => {
      const dt = new Date('2026-10-22T14:30:00Z');
      const formatted = formatDateTimeForUser(
        dt,
        'Asia/Tehran',
        CalendarType.JALALI,
      );
      expect(formatted).toBe('1405/07/30 18:00');
    });

    it('correctly handles date near local midnight across timezones', () => {
      // 2026-10-22 23:45 in Tehran (+03:30) is 2026-10-22 20:15 UTC
      const lateEvening = new Date('2026-10-22T20:15:00Z');
      expect(
        formatDateTimeForUser(
          lateEvening,
          'Asia/Tehran',
          CalendarType.GREGORIAN,
        ),
      ).toBe('2026-10-22 23:45');
      expect(
        formatDateTimeForUser(lateEvening, 'Asia/Tehran', CalendarType.JALALI),
      ).toBe('1405/07/30 23:45');

      // 30 minutes later: 2026-10-23 00:15 in Tehran is 2026-10-22 20:45 UTC
      const nextDayMidnight = new Date('2026-10-22T20:45:00Z');
      expect(
        formatDateTimeForUser(
          nextDayMidnight,
          'Asia/Tehran',
          CalendarType.GREGORIAN,
        ),
      ).toBe('2026-10-23 00:15');
      expect(
        formatDateTimeForUser(
          nextDayMidnight,
          'Asia/Tehran',
          CalendarType.JALALI,
        ),
      ).toBe('1405/08/01 00:15');
    });

    it('returns null for nullish or invalid date inputs', () => {
      expect(formatDateTimeForUser(null)).toBeNull();
      expect(formatDateTimeForUser(undefined)).toBeNull();
      expect(formatDateTimeForUser('invalid-date')).toBeNull();
    });
  });
});
