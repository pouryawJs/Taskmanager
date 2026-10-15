import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateDisplayNameDto {
  @Transform(({ value }: { value: unknown }): string =>
    typeof value === 'string' ? value.trim() : '',
  )
  @IsString({ message: 'Display name must be a string.' })
  @IsNotEmpty({ message: 'Display name cannot be empty or whitespace only.' })
  @MinLength(1, { message: 'Display name must have at least 1 character.' })
  @MaxLength(100, { message: 'Display name cannot exceed 100 characters.' })
  displayName!: string;
}
