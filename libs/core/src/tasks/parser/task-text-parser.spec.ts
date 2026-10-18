import {
  TaskTextParser,
  TaskTextParseException,
  parseTaskText,
  tryParseTaskText,
  toAsciiDigits,
} from './task-text-parser';

describe('TaskTextParser', () => {
  describe('toAsciiDigits', () => {
    it('should convert Persian digits to ASCII', () => {
      expect(toAsciiDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
      expect(toAsciiDigits('ساعت ۱۸:۳۰')).toBe('ساعت 18:30');
    });

    it('should convert Arabic-Indic digits to ASCII', () => {
      expect(toAsciiDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
      expect(toAsciiDigits('الساعة ٠٩:١٥')).toBe('الساعة 09:15');
    });

    it('should leave standard ASCII digits and characters untouched', () => {
      expect(toAsciiDigits('18:00 Hello')).toBe('18:00 Hello');
    });
  });

  describe('Format A: Title-only tasks', () => {
    it('should parse a single title-only task in English', () => {
      const result = TaskTextParser.parse('Buy groceries');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        title: 'Buy groceries',
        scheduledStartTime: null,
        scheduledEndTime: null,
        originalLine: 1,
        rawText: 'Buy groceries',
      });
    });

    it('should parse a single title-only task in Persian', () => {
      const result = TaskTextParser.parse('مطالعه داکیومنت NestJS');

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('مطالعه داکیومنت NestJS');
      expect(result[0].scheduledStartTime).toBeNull();
      expect(result[0].scheduledEndTime).toBeNull();
    });

    it('should trim surrounding whitespace around title', () => {
      const result = TaskTextParser.parse('   Clean desk   ');

      expect(result[0].title).toBe('Clean desk');
    });

    it('should preserve ordinary words resembling time suffixes if not matching time syntax', () => {
      const result1 = TaskTextParser.parse('Meet with team at office');
      expect(result1[0].title).toBe('Meet with team at office');
      expect(result1[0].scheduledStartTime).toBeNull();

      const result2 = TaskTextParser.parse('Flight from Tehran to Shiraz');
      expect(result2[0].title).toBe('Flight from Tehran to Shiraz');
      expect(result2[0].scheduledStartTime).toBeNull();
      expect(result2[0].scheduledEndTime).toBeNull();

      const result3 = TaskTextParser.parse('ساعت مچی دیواری زیبا');
      expect(result3[0].title).toBe('ساعت مچی دیواری زیبا');
      expect(result3[0].scheduledStartTime).toBeNull();
    });
  });

  describe('Format B: Start time only', () => {
    it('should parse English "at HH:mm"', () => {
      const result = TaskTextParser.parse('Exercise at 18:00');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        title: 'Exercise',
        scheduledStartTime: '18:00:00',
        scheduledEndTime: null,
        originalLine: 1,
        rawText: 'Exercise at 18:00',
      });
    });

    it('should parse Persian "ساعت HH:mm"', () => {
      const result = TaskTextParser.parse('ورزش ساعت 18:00');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        title: 'ورزش',
        scheduledStartTime: '18:00:00',
        scheduledEndTime: null,
        originalLine: 1,
        rawText: 'ورزش ساعت 18:00',
      });
    });

    it('should parse Persian digits with "ساعت ۱۸:۳۰"', () => {
      const result = TaskTextParser.parse('جلسه کاری ساعت ۱۸:۳۰');

      expect(result[0].title).toBe('جلسه کاری');
      expect(result[0].scheduledStartTime).toBe('18:30:00');
      expect(result[0].scheduledEndTime).toBeNull();
    });

    it('should support single-digit hour "at 9:00"', () => {
      const result = TaskTextParser.parse('Morning meeting at 9:00');

      expect(result[0].title).toBe('Morning meeting');
      expect(result[0].scheduledStartTime).toBe('09:00:00');
    });

    it('should preserve Persian digits inside title while converting time to ASCII', () => {
      const result = TaskTextParser.parse('خرید ۲ عدد کتاب ساعت ۱۸:۰۰');

      expect(result[0].title).toBe('خرید ۲ عدد کتاب');
      expect(result[0].scheduledStartTime).toBe('18:00:00');
    });
  });

  describe('Format C: Interval (Start and End Time)', () => {
    it('should parse English "from HH:mm to HH:mm"', () => {
      const result = TaskTextParser.parse('Study from 09:00 to 10:30');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        title: 'Study',
        scheduledStartTime: '09:00:00',
        scheduledEndTime: '10:30:00',
        originalLine: 1,
        rawText: 'Study from 09:00 to 10:30',
      });
    });

    it('should parse Persian "از HH:mm تا HH:mm"', () => {
      const result = TaskTextParser.parse('مطالعه کتاب از 09:00 تا 10:30');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        title: 'مطالعه کتاب',
        scheduledStartTime: '09:00:00',
        scheduledEndTime: '10:30:00',
        originalLine: 1,
        rawText: 'مطالعه کتاب از 09:00 تا 10:30',
      });
    });

    it('should parse Persian digits for intervals "از ۰۹:۰۰ تا ۱۰:۳۰"', () => {
      const result = TaskTextParser.parse('مطالعه کتاب از ۰۹:۰۰ تا ۱۰:۳۰');

      expect(result[0].title).toBe('مطالعه کتاب');
      expect(result[0].scheduledStartTime).toBe('09:00:00');
      expect(result[0].scheduledEndTime).toBe('10:30:00');
    });
  });

  describe('Multi-line & Mixed Submissions', () => {
    it('should parse a mixture of timed and untimed tasks with blank lines', () => {
      const input = `
Buy groceries
Study from 09:00 to 10:30

Exercise at 18:00
پیاده‌روی عصرگاهی
`;

      const result = TaskTextParser.parse(input);

      expect(result).toHaveLength(4);
      expect(result[0]).toMatchObject({
        title: 'Buy groceries',
        scheduledStartTime: null,
        originalLine: 2,
      });
      expect(result[1]).toMatchObject({
        title: 'Study',
        scheduledStartTime: '09:00:00',
        scheduledEndTime: '10:30:00',
        originalLine: 3,
      });
      expect(result[2]).toMatchObject({
        title: 'Exercise',
        scheduledStartTime: '18:00:00',
        scheduledEndTime: null,
        originalLine: 5,
      });
      expect(result[3]).toMatchObject({
        title: 'پیاده‌روی عصرگاهی',
        scheduledStartTime: null,
        originalLine: 6,
      });
    });
  });

  describe('Validation & Error Scenarios', () => {
    it('should throw TaskTextParseException with original line number when title is empty', () => {
      expect(() => TaskTextParser.parse('at 18:00')).toThrow(
        TaskTextParseException,
      );

      try {
        TaskTextParser.parse('ساعت 18:00');
      } catch (err) {
        expect(err).toBeInstanceOf(TaskTextParseException);
        const parseErr = err as TaskTextParseException;
        expect(parseErr.errors[0].line).toBe(1);
        expect(parseErr.errors[0].message).toContain(
          'Task title cannot be empty',
        );
      }
    });

    it('should reject title exceeding 160 characters', () => {
      const longTitle = 'A'.repeat(161);
      try {
        TaskTextParser.parse(longTitle);
        fail('Expected error');
      } catch (err) {
        expect(err).toBeInstanceOf(TaskTextParseException);
        const parseErr = err as TaskTextParseException;
        expect(parseErr.errors[0].message).toContain(
          'cannot exceed 160 characters',
        );
      }
    });

    it('should reject invalid hour values (e.g. 25:00 or 24:00)', () => {
      try {
        TaskTextParser.parse('Exercise at 25:00');
        fail('Expected error');
      } catch (err) {
        expect(err).toBeInstanceOf(TaskTextParseException);
        const parseErr = err as TaskTextParseException;
        expect(parseErr.errors[0].message).toContain(
          'Hours must be between 00 and 23',
        );
      }
    });

    it('should reject invalid minute values (e.g. 18:60 or 18:90)', () => {
      try {
        TaskTextParser.parse('Exercise at 18:90');
        fail('Expected error');
      } catch (err) {
        expect(err).toBeInstanceOf(TaskTextParseException);
        const parseErr = err as TaskTextParseException;
        expect(parseErr.errors[0].message).toContain(
          'Minutes must be between 00 and 59',
        );
      }
    });

    it('should reject when end time is earlier than start time in an interval', () => {
      try {
        TaskTextParser.parse('Study from 10:30 to 09:00');
        fail('Expected error');
      } catch (err) {
        expect(err).toBeInstanceOf(TaskTextParseException);
        const parseErr = err as TaskTextParseException;
        expect(parseErr.errors[0].message).toContain(
          'Scheduled end time (09:00:00) must be later than start time (10:30:00)',
        );
      }
    });

    it('should reject when end time is equal to start time in an interval', () => {
      try {
        TaskTextParser.parse('Study from 10:00 to 10:00');
        fail('Expected error');
      } catch (err) {
        expect(err).toBeInstanceOf(TaskTextParseException);
        const parseErr = err as TaskTextParseException;
        expect(parseErr.errors[0].message).toContain(
          'must be later than start time',
        );
      }
    });

    it('should reject incomplete interval expressions', () => {
      expect(() => TaskTextParser.parse('Study from 09:00')).toThrow(
        TaskTextParseException,
      );
      expect(() => TaskTextParser.parse('Study to 10:00')).toThrow(
        TaskTextParseException,
      );
      expect(() => TaskTextParser.parse('مطالعه از 09:00')).toThrow(
        TaskTextParseException,
      );
      expect(() => TaskTextParser.parse('مطالعه تا 10:00')).toThrow(
        TaskTextParseException,
      );
    });

    it('should reject ambiguous mixed intervals such as "ساعت 08:00 تا 10:00"', () => {
      try {
        TaskTextParser.parse('ورزش ساعت 08:00 تا 10:00');
        fail('Expected error');
      } catch (err) {
        expect(err).toBeInstanceOf(TaskTextParseException);
        const parseErr = err as TaskTextParseException;
        expect(parseErr.errors[0].message).toContain('Ambiguous time suffix');
      }
    });

    it('should reject conflicting or repeated time expressions', () => {
      try {
        TaskTextParser.parse('Meeting at 10:00 at 12:00');
        fail('Expected error');
      } catch (err) {
        expect(err).toBeInstanceOf(TaskTextParseException);
        const parseErr = err as TaskTextParseException;
        expect(parseErr.errors[0].message).toContain(
          'Conflicting or repeated time expressions',
        );
      }
    });

    it('should enforce all-or-nothing: valid line followed by invalid line fails entire submission', () => {
      const input = `
Valid task 1
Valid task 2 at 10:00
Invalid task at 25:99
Valid task 3
`;

      const result = tryParseTaskText(input);

      expect(result.success).toBe(false);
      expect(result.tasks).toHaveLength(0); // none returned!
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].line).toBe(4); // Line 4 in original input
      expect(result.errors[0].rawText).toBe('Invalid task at 25:99');
    });

    it('should return error if input message is completely blank', () => {
      const result = tryParseTaskText('   \n\n   ');

      expect(result.success).toBe(false);
      expect(result.tasks).toHaveLength(0);
      expect(result.errors[0].message).toContain(
        'Message does not contain any tasks',
      );
    });
  });

  describe('Convenience Functions (parseTaskText & tryParseTaskText)', () => {
    it('parseTaskText should return tasks directly on valid input', () => {
      const tasks = parseTaskText('Read book');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Read book');
    });

    it('tryParseTaskText should return success true on valid input', () => {
      const result = tryParseTaskText('Read book');
      expect(result.success).toBe(true);
      expect(result.tasks).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
    });
  });
});
