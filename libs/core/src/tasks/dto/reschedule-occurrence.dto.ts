import {
  IsString,
  IsNotEmpty,
  Matches,
  IsOptional,
  IsBoolean,
} from 'class-validator';

export class RescheduleOccurrenceDto {
  @IsString({ message: 'Scheduled start time must be a string.' })
  @IsNotEmpty({ message: 'Scheduled start time cannot be empty.' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    message: 'Scheduled start time must be in HH:mm or HH:mm:ss format.',
  })
  newStartTime: string;

  @IsOptional()
  @IsBoolean({ message: 'updateTaskDefault must be a boolean.' })
  updateTaskDefault?: boolean;
}
