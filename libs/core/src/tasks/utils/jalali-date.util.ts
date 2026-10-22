import {
  toJalaali,
  toGregorian,
  isLeapJalaaliYear,
  jalaaliMonthLength,
} from 'jalaali-js';
import { CalendarType } from '@app/database';

export const JALALI_MONTH_NAMES = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
] as const;

/**
 * Converts a Gregorian date (year, month 1-12, day 1-31) to Jalali (jy, jm, jd).
 */
export function gregorianToJalali(
  gy: number,
  gm: number,
  gd: number,
): { jy: number; jm: number; jd: number } {
  return toJalaali(gy, gm, gd);
}

/**
 * Converts a Jalali date (year, month 1-12, day 1-31) to Gregorian (gy, gm, gd).
 */
export function jalaliToGregorian(
  jy: number,
  jm: number,
  jd: number,
): { gy: number; gm: number; gd: number } {
  return toGregorian(jy, jm, jd);
}

/**
 * Checks if a given Jalali year is a leap year.
 */
export function isJalaliLeapYear(jy: number): boolean {
  return isLeapJalaaliYear(jy);
}

/**
 * Returns the number of days in a given Jalali month (1-12) for a given Jalali year.
 * Months 1-6 have 31 days, months 7-11 have 30 days, month 12 has 29 or 30 (leap) days.
 */
export function getJalaliMonthDays(jy: number, jm: number): number {
  return jalaaliMonthLength(jy, jm);
}

/**
 * Converts a valid Gregorian ISO date string (YYYY-MM-DD) to a Jalali date string (YYYY/MM/DD).
 */
export function formatIsoDateToJalali(dateStr: string): string {
  if (!dateStr || typeof dateStr !== 'string') {
    return dateStr;
  }
  const parts = dateStr.trim().split('-');
  if (parts.length !== 3) {
    return dateStr;
  }

  const [gy, gm, gd] = parts.map(Number);
  if (isNaN(gy) || isNaN(gm) || isNaN(gd)) {
    return dateStr;
  }

  const { jy, jm, jd } = toJalaali(gy, gm, gd);
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
}

/**
 * Formats a calendar date string (YYYY-MM-DD) according to the user's preferred calendar.
 * In Jalali mode: returns 'YYYY/MM/DD'.
 * In Gregorian mode (default): returns 'YYYY-MM-DD'.
 */
export function formatDateForUser(
  dateStr?: string | null,
  calendarType?: CalendarType | string | null,
): string {
  if (!dateStr || typeof dateStr !== 'string') {
    return '';
  }
  if (calendarType === CalendarType.JALALI) {
    return formatIsoDateToJalali(dateStr);
  }
  return dateStr;
}

/**
 * Formats a Date object or timestamp string into local date and time within an IANA timezone,
 * according to the user's preferred calendar.
 */
export function formatDateTimeForUser(
  date: Date | string | null | undefined,
  timeZone: string = 'Asia/Tehran',
  calendarType?: CalendarType | string | null,
): string | null {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;

  let safeTz = timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: safeTz });
  } catch {
    safeTz = 'Asia/Tehran';
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: safeTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const formatted = formatter.format(d).replace(',', '').trim();
    if (calendarType === CalendarType.JALALI) {
      const datePart = formatted.slice(0, 10);
      const timePart = formatted.slice(11).trim();
      return `${formatIsoDateToJalali(datePart)} ${timePart}`;
    }
    return formatted;
  } catch {
    const iso = d.toISOString().replace('T', ' ').slice(0, 16);
    if (calendarType === CalendarType.JALALI) {
      const datePart = iso.slice(0, 10);
      const timePart = iso.slice(11).trim();
      return `${formatIsoDateToJalali(datePart)} ${timePart}`;
    }
    return iso;
  }
}
