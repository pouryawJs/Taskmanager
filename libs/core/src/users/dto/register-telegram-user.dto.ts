import { Transform } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  Matches,
  ValidateIf,
} from 'class-validator';

export class RegisterTelegramUserDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[1-9]\d*$/, {
    message:
      'telegramUserId must be a positive integer represented as a string.',
  })
  @MaxLength(20)
  telegramUserId!: string;

  @ValidateIf((_object, value) => value !== null)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  displayName!: string | null;
}
