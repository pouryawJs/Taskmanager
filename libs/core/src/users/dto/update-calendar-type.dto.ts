import { IsEnum, IsNotEmpty } from 'class-validator';
import { CalendarType } from '@app/database';

export class UpdateCalendarTypeDto {
  @IsNotEmpty({ message: 'Calendar type cannot be empty.' })
  @IsEnum(CalendarType, {
    message: 'Calendar type must be either gregorian or jalali.',
  })
  calendarType!: CalendarType;
}
