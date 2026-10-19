import { IsString, IsOptional, MaxLength, IsEnum } from 'class-validator';
import { TaskPriority } from '@app/database';

export class UpdateTaskDto {
  @IsOptional()
  @IsString({ message: 'Task title must be a string.' })
  @MaxLength(160, { message: 'Task title cannot exceed 160 characters.' })
  title?: string;

  @IsOptional()
  description?: string | null;

  @IsOptional()
  @IsEnum(TaskPriority, {
    message: 'Task priority must be one of: low, normal, high.',
  })
  priority?: TaskPriority;
}
