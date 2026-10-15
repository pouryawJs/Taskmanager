import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateDisplayNameDto } from './update-display-name.dto';

describe('UpdateDisplayNameDto', () => {
  it('should pass with a valid trimmed display name', async () => {
    const dto = plainToInstance(UpdateDisplayNameDto, {
      displayName: ' Ali Reza ',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.displayName).toBe('Ali Reza');
  });

  it('should fail when displayName is empty string', async () => {
    const dto = plainToInstance(UpdateDisplayNameDto, { displayName: '' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail when displayName is whitespace only', async () => {
    const dto = plainToInstance(UpdateDisplayNameDto, { displayName: '    ' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail when displayName exceeds 100 characters', async () => {
    const dto = plainToInstance(UpdateDisplayNameDto, {
      displayName: 'a'.repeat(101),
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
