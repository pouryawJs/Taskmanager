import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  Matches,
} from 'class-validator';
import { TaskPriority, TaskType } from '@app/database';

export class CreateTaskDto {
  @IsString({ message: 'Title must be a string.' })
  @IsNotEmpty({ message: 'Title cannot be empty.' })
  @MaxLength(160, { message: 'Title cannot exceed 160 characters.' })
  title: string;

  @IsOptional()
  @IsString({ message: 'Description must be a string.' })
  description?: string | null;

  @IsOptional()
  @IsEnum(TaskPriority, {
    message: `Priority must be one of: ${Object.values(TaskPriority).join(', ')}.`,
  })
  priority?: TaskPriority = TaskPriority.NORMAL;

  @IsOptional()
  @IsEnum(TaskType, {
    message: `Type must be one of: ${Object.values(TaskType).join(', ')}.`,
  })
  type?: TaskType = TaskType.ONE_TIME;

  @IsOptional()
  @IsString({ message: 'Date must be a string.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Date must be in YYYY-MM-DD format.',
  })
  date?: string;

  @IsOptional()
  @IsString({ message: 'Scheduled start time must be a string.' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    message: 'Scheduled start time must be in HH:mm or HH:mm:ss format.',
  })
  scheduledStartTime?: string | null;

  @IsOptional()
  @IsInt({ message: 'Estimated minutes must be an integer.' })
  @Min(0, { message: 'Estimated minutes cannot be negative.' })
  estimatedMinutes?: number | null;

  @IsOptional()
  scheduledStartAt?: Date | string | null;

  @IsOptional()
  scheduledDueAt?: Date | string | null;
}
