import { IsOptional, IsString, IsBoolean } from 'class-validator';

export class UpdateOccurrenceScheduleDto {
  @IsOptional()
  @IsString({ message: 'Date must be a string in YYYY-MM-DD format.' })
  date?: string | null;

  @IsOptional()
  @IsString({
    message: 'Start time must be a string in HH:mm or HH:mm:ss format.',
  })
  startTime?: string | null;

  @IsOptional()
  @IsString({
    message: 'End time must be a string in HH:mm or HH:mm:ss format.',
  })
  endTime?: string | null;

  @IsOptional()
  @IsBoolean({ message: 'clearSchedule must be a boolean.' })
  clearSchedule?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'updateTaskDefault must be a boolean.' })
  updateTaskDefault?: boolean;
}
