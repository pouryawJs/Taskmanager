import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateCalendarTypeDto } from './update-calendar-type.dto';
import { CalendarType } from '@app/database';

describe('UpdateCalendarTypeDto', () => {
  it('passes validation with CalendarType.GREGORIAN', async () => {
    const dto = plainToInstance(UpdateCalendarTypeDto, {
      calendarType: CalendarType.GREGORIAN,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('passes validation with CalendarType.JALALI', async () => {
    const dto = plainToInstance(UpdateCalendarTypeDto, {
      calendarType: CalendarType.JALALI,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('fails validation when calendarType is invalid string', async () => {
    const dto = plainToInstance(UpdateCalendarTypeDto, {
      calendarType: 'lunar',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('calendarType');
  });

  it('fails validation when calendarType is empty or null', async () => {
    const dto = plainToInstance(UpdateCalendarTypeDto, {
      calendarType: '',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
