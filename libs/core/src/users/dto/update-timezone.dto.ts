import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  MaxLength,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

export function isValidIanaTimezone(timeZone: unknown): boolean {
  if (!timeZone || typeof timeZone !== 'string') {
    return false;
  }
  const trimmed = timeZone.trim();
  if (trimmed.length === 0 || trimmed.length > 64) {
    return false;
  }
  // Offsets like +03:30 or GMT+3 or -04:00 are not valid IANA identifiers
  if (/^[+-]\d{2}(:?\d{2})?$/.test(trimmed) || /^GMT[+-]\d+$/i.test(trimmed)) {
    return false;
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

export function IsIanaTimezone(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isIanaTimezone',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return isValidIanaTimezone(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid IANA time-zone identifier (e.g. 'Asia/Tehran', 'Europe/Amsterdam').`;
        },
      },
    });
  };
}

export class UpdateTimezoneDto {
  @Transform(({ value }: { value: unknown }): string =>
    typeof value === 'string' ? value.trim() : '',
  )
  @IsString({ message: 'Time zone must be a string.' })
  @IsNotEmpty({ message: 'Time zone cannot be empty.' })
  @MaxLength(64, { message: 'Time zone cannot exceed 64 characters.' })
  @IsIanaTimezone()
  timezone!: string;
}
