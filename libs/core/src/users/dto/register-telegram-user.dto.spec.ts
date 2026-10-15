import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterTelegramUserDto } from './register-telegram-user.dto';

describe('RegisterTelegramUserDto', () => {
  it('should validate valid telegramUserId and displayName', async () => {
    const dto = plainToInstance(RegisterTelegramUserDto, {
      telegramUserId: '123456789',
      displayName: ' Ali ',
      timezone: 'Asia/Tehran',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.displayName).toBe('Ali');
  });

  it('should reject non-numeric telegramUserId', async () => {
    const dto = plainToInstance(RegisterTelegramUserDto, {
      telegramUserId: 'abc-123',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject negative or zero telegramUserId', async () => {
    const dto = plainToInstance(RegisterTelegramUserDto, {
      telegramUserId: '0',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
