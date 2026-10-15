import { Transform } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  Matches,
  ValidateIf,
  IsOptional,
} from 'class-validator';
import { IsIanaTimezone } from './update-timezone.dto';

export class RegisterTelegramUserDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[1-9]\d*$/, {
    message:
      'telegramUserId must be a positive integer represented as a string.',
  })
  @MaxLength(20)
  telegramUserId!: string;

  @ValidateIf(
    (_object: unknown, value: unknown) => value !== null && value !== undefined,
  )
  @Transform(({ value }: { value: unknown }): string | null =>
    typeof value === 'string' ? value.trim() : null,
  )
  @IsString()
  @MaxLength(100)
  displayName?: string | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }): string | undefined =>
    typeof value === 'string' ? value.trim() : undefined,
  )
  @IsString()
  @MaxLength(64)
  @IsIanaTimezone()
  timezone?: string;
}
