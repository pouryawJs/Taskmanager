import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateTimezoneDto, isValidIanaTimezone } from './update-timezone.dto';

describe('UpdateTimezoneDto and isValidIanaTimezone', () => {
  describe('isValidIanaTimezone', () => {
    it('should return true for standard valid IANA timezones', () => {
      expect(isValidIanaTimezone('Asia/Tehran')).toBe(true);
      expect(isValidIanaTimezone('UTC')).toBe(true);
      expect(isValidIanaTimezone('Europe/London')).toBe(true);
      expect(isValidIanaTimezone('Europe/Amsterdam')).toBe(true);
      expect(isValidIanaTimezone('America/New_York')).toBe(true);
      expect(isValidIanaTimezone('Asia/Tokyo')).toBe(true);
    });

    it('should return false for invalid strings', () => {
      expect(isValidIanaTimezone('Invalid/Timezone')).toBe(false);
      expect(isValidIanaTimezone('Tehran')).toBe(false);
      expect(isValidIanaTimezone('')).toBe(false);
      expect(isValidIanaTimezone('   ')).toBe(false);
      expect(isValidIanaTimezone(null)).toBe(false);
      expect(isValidIanaTimezone(undefined)).toBe(false);
      expect(isValidIanaTimezone(12345)).toBe(false);
    });

    it('should reject raw UTC/GMT offsets', () => {
      expect(isValidIanaTimezone('+03:30')).toBe(false);
      expect(isValidIanaTimezone('-05:00')).toBe(false);
      expect(isValidIanaTimezone('+00:00')).toBe(false);
      expect(isValidIanaTimezone('GMT+3')).toBe(false);
    });
  });

  describe('UpdateTimezoneDto', () => {
    it('should validate a valid IANA timezone', async () => {
      const dto = plainToInstance(UpdateTimezoneDto, {
        timezone: ' Asia/Tehran ',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.timezone).toBe('Asia/Tehran');
    });

    it('should fail validation on an invalid timezone', async () => {
      const dto = plainToInstance(UpdateTimezoneDto, {
        timezone: 'Not/A/Timezone',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should fail validation on empty timezone', async () => {
      const dto = plainToInstance(UpdateTimezoneDto, { timezone: '' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
