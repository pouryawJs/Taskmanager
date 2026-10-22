import { buildCalendarKeyboard } from './tasks.keyboards';
import { CalendarType } from '@app/database';

describe('Tasks Keyboards - buildCalendarKeyboard', () => {
  const todayDate = '2026-10-22'; // 30 Mehr 1405 (Thursday)

  describe('Gregorian mode (default)', () => {
    it('builds calendar with correct headers, month label, shortcuts, and styling', () => {
      const keyboard = buildCalendarKeyboard(
        2026,
        10,
        todayDate,
        CalendarType.GREGORIAN,
      );
      const rows = keyboard.inline_keyboard;

      // Row 0: Quick shortcuts (Today & Tomorrow)
      expect(rows[0]).toHaveLength(2);
      expect(rows[0][0].text).toBe('📅 امروز (2026-10-22)');
      expect(rows[0][0].callback_data).toBe('task:date:select:2026-10-22');
      expect((rows[0][0] as any).style).toBe('success');

      expect(rows[0][1].text).toBe('📅 فردا (2026-10-23)');
      expect(rows[0][1].callback_data).toBe('task:date:select:2026-10-23');
      expect((rows[0][1] as any).style).toBe('success');

      // Row 1: Month navigation
      expect(rows[1][1].text).toBe('📅 2026 / 10');
      expect(rows[1][2].callback_data).toBe('task:date:nav:2026-11');

      // Row 2: Weekday headers
      const dayHeaders = rows[2].map((btn) => btn.text);
      expect(dayHeaders).toEqual(['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج']);

      // Day grid buttons
      // Oct 22 is today. Days 1 to 21 are past days: neutral '·', no style
      // Days 22 to 31 are selectable: .primary()
      const allGridButtons = rows.slice(3, -1).flat();
      const pastButtons = allGridButtons.filter(
        (b) => b.callback_data === 'task:date:past',
      );
      expect(pastButtons.length).toBe(21);
      pastButtons.forEach((btn) => {
        expect(btn.text).toBe('·');
        expect((btn as any).style).toBeUndefined(); // neutral / default
      });

      const selectableButtons = allGridButtons.filter((b) =>
        b.callback_data?.startsWith('task:date:select:'),
      );
      expect(selectableButtons.length).toBe(10); // Oct 22 to 31 = 10 days
      selectableButtons.forEach((btn) => {
        expect((btn as any).style).toBe('primary');
      });

      // Check specific day callbacks
      expect(selectableButtons[0].text).toBe('22');
      expect(selectableButtons[0].callback_data).toBe(
        'task:date:select:2026-10-22',
      );
      expect(selectableButtons[9].text).toBe('31');
      expect(selectableButtons[9].callback_data).toBe(
        'task:date:select:2026-10-31',
      );

      // Last row: Back button styled danger
      const lastRow = rows[rows.length - 1];
      expect(lastRow[0].text).toBe('🔙 بازگشت به انتخاب نوع تسک');
      expect(lastRow[0].callback_data).toBe('task:back:to_type');
      expect((lastRow[0] as any).style).toBe('danger');
    });

    it('navigates across year boundaries in Gregorian mode', () => {
      // Month 12: next is next year month 1
      const decKb = buildCalendarKeyboard(
        2026,
        12,
        todayDate,
        CalendarType.GREGORIAN,
      );
      expect(decKb.inline_keyboard[1][2].callback_data).toBe(
        'task:date:nav:2027-01',
      );

      // Month 1 of 2027 when today is 2026-12-15: prev month 2026-12 is enabled
      const janKb = buildCalendarKeyboard(
        2027,
        1,
        '2026-12-15',
        CalendarType.GREGORIAN,
      );
      expect(janKb.inline_keyboard[1][0].callback_data).toBe(
        'task:date:nav:2026-12',
      );
    });
  });

  describe('Jalali mode', () => {
    it('builds calendar with Jalali month name, Jalali shortcuts, correct days and canonical callbacks', () => {
      // 1405-07 (Mehr 1405), today is 2026-10-22 (1405-07-30)
      const keyboard = buildCalendarKeyboard(
        1405,
        7,
        todayDate,
        CalendarType.JALALI,
      );
      const rows = keyboard.inline_keyboard;

      // Row 0: Quick shortcuts with Jalali formatted labels but canonical callbacks
      expect(rows[0][0].text).toBe('📅 امروز (1405/07/30)');
      expect(rows[0][0].callback_data).toBe('task:date:select:2026-10-22');
      expect((rows[0][0] as any).style).toBe('success');

      expect(rows[0][1].text).toBe('📅 فردا (1405/08/01)');
      expect(rows[0][1].callback_data).toBe('task:date:select:2026-10-23');
      expect((rows[0][1] as any).style).toBe('success');

      // Row 1: Month navigation with Persian month name
      expect(rows[1][1].text).toBe('📅 مهر 1405');
      expect(rows[1][2].callback_data).toBe('task:date:nav:1405-08');

      // Row 2: Weekday headers
      const dayHeaders = rows[2].map((btn) => btn.text);
      expect(dayHeaders).toEqual(['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج']);

      // Mehr has exactly 30 days.
      // Days 1 to 29 are past days (relative to 1405/07/30): neutral '·'
      // Day 30 is today: selectable with .primary()
      const allGridButtons = rows.slice(3, -1).flat();
      const pastButtons = allGridButtons.filter(
        (b) => b.callback_data === 'task:date:past',
      );
      expect(pastButtons.length).toBe(29);
      pastButtons.forEach((btn) => {
        expect(btn.text).toBe('·');
        expect((btn as any).style).toBeUndefined();
      });

      const selectableButtons = allGridButtons.filter((b) =>
        b.callback_data?.startsWith('task:date:select:'),
      );
      expect(selectableButtons.length).toBe(1);
      expect(selectableButtons[0].text).toBe('30');
      // Crucial requirement: resolves to canonical Gregorian date 2026-10-22
      expect(selectableButtons[0].callback_data).toBe(
        'task:date:select:2026-10-22',
      );
      expect((selectableButtons[0] as any).style).toBe('primary');

      // Back button styled danger
      const lastRow = rows[rows.length - 1];
      expect(lastRow[0].text).toBe('🔙 بازگشت به انتخاب نوع تسک');
      expect((lastRow[0] as any).style).toBe('danger');
    });

    it('navigates future Jalali months and resolves every day to correct canonical Gregorian dates', () => {
      // Navigate to Aban 1405 (Month 8 of 1405, 30 days)
      const keyboard = buildCalendarKeyboard(
        1405,
        8,
        todayDate,
        CalendarType.JALALI,
      );
      const rows = keyboard.inline_keyboard;

      expect(rows[1][1].text).toBe('📅 آبان 1405');
      expect(rows[1][0].callback_data).toBe('task:date:nav:1405-07');
      expect(rows[1][2].callback_data).toBe('task:date:nav:1405-09');

      const allGridButtons = rows.slice(3, -1).flat();
      const selectableButtons = allGridButtons.filter((b) =>
        b.callback_data?.startsWith('task:date:select:'),
      );
      // Aban has 30 days, all 30 days are in the future relative to 1405/07/30
      expect(selectableButtons.length).toBe(30);

      // 1 Aban 1405 corresponds to 2026-10-23
      expect(selectableButtons[0].text).toBe('1');
      expect(selectableButtons[0].callback_data).toBe(
        'task:date:select:2026-10-23',
      );
      expect((selectableButtons[0] as any).style).toBe('primary');

      // 30 Aban 1405 corresponds to 2026-11-21
      expect(selectableButtons[29].text).toBe('30');
      expect(selectableButtons[29].callback_data).toBe(
        'task:date:select:2026-11-21',
      );
      expect((selectableButtons[29] as any).style).toBe('primary');
    });

    it('navigates across Jalali year boundaries (month 12 to 1 and month 1 to 12)', () => {
      // Month 12 of 1404
      const esfdKb = buildCalendarKeyboard(
        1404,
        12,
        '2026-03-01',
        CalendarType.JALALI,
      );
      expect(esfdKb.inline_keyboard[1][1].text).toBe('📅 اسفند 1404');
      expect(esfdKb.inline_keyboard[1][2].callback_data).toBe(
        'task:date:nav:1405-01',
      );

      // Month 1 of 1405 when today is 1404-12-29 (2026-03-20): prev month 1404-12 is enabled
      const farvKb = buildCalendarKeyboard(
        1405,
        1,
        '2026-03-20',
        CalendarType.JALALI,
      );
      expect(farvKb.inline_keyboard[1][1].text).toBe('📅 فروردین 1405');
      expect(farvKb.inline_keyboard[1][0].callback_data).toBe(
        'task:date:nav:1404-12',
      );
    });
  });
});
