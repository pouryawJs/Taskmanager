import { BadRequestException } from '@nestjs/common';

import {
  DataSource,
  QueryFailedError,
  Repository,
  EntityManager,
} from 'typeorm';

import {
  User,
  UserIdentity,
  IdentityProvider,
  UserSettings,
  OnboardingStep,
  UserStatus,
  PointTransaction,
} from '@app/database';

import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let dataSource: jest.Mocked<DataSource>;
  let identityRepo: jest.Mocked<Repository<UserIdentity>>;
  let userRepo: jest.Mocked<Repository<User>>;
  let settingsRepo: jest.Mocked<Repository<UserSettings>>;
  let pointTransactionRepo: jest.Mocked<Repository<PointTransaction>>;

  beforeEach(() => {
    identityRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<UserIdentity>>;

    userRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<User>>;

    settingsRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<UserSettings>>;

    pointTransactionRepo = {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<Repository<PointTransaction>>;

    dataSource = {
      getRepository: jest.fn((entity) => {
        if (entity === UserIdentity) return identityRepo;
        if (entity === User) return userRepo;
        if (entity === UserSettings) return settingsRepo;
        if (entity === PointTransaction) return pointTransactionRepo;
        return null;
      }),
      transaction: jest.fn(),
    } as unknown as jest.Mocked<DataSource>;

    service = new UsersService(dataSource);
  });

  describe('findTelegramUser', () => {
    it('should return existing user when identity exists', async () => {
      const mockUser = { id: 'u-1', displayName: 'Test User' } as User;
      const mockIdentity = {
        id: 'i-1',
        provider: IdentityProvider.TELEGRAM,
        providerUserId: '123456',
        user: mockUser,
      } as UserIdentity;

      identityRepo.findOne.mockResolvedValue(mockIdentity);

      const result = await service.findTelegramUser('123456');
      expect(result).toBe(mockUser);
      expect(identityRepo.findOne).toHaveBeenCalledWith({
        where: {
          provider: IdentityProvider.TELEGRAM,
          providerUserId: '123456',
        },
        relations: {
          user: {
            settings: true,
          },
        },
      });
    });

    it('should return null when identity does not exist', async () => {
      identityRepo.findOne.mockResolvedValue(null);

      const result = await service.findTelegramUser('999999');
      expect(result).toBeNull();
    });
  });

  describe('initiateTelegramUser (Requirements 1, 2, 8, 9, 10, 11)', () => {
    it('(Req 1 & 11) should create new user, identity, and settings atomically with Asia/Tehran and no starting points', async () => {
      identityRepo.findOne.mockResolvedValue(null);

      const createdUser = {
        id: 'u-100',
        displayName: 'John Doe',
        status: UserStatus.ACTIVE,
      } as User;
      const createdIdentity = {
        id: 'i-100',
        provider: IdentityProvider.TELEGRAM,
        providerUserId: '555123',
        userId: 'u-100',
      } as UserIdentity;
      const createdSettings = {
        userId: 'u-100',
        timezone: 'Asia/Tehran',
        onboardingStep: OnboardingStep.NAME,
        onboardingCompleted: false,
      } as UserSettings;

      dataSource.transaction.mockImplementation(async (cb) => {
        const manager = {
          getRepository: jest.fn((entity) => {
            if (entity === User) {
              return {
                create: jest.fn().mockReturnValue(createdUser),
                save: jest.fn().mockResolvedValue(createdUser),
              };
            }
            if (entity === UserIdentity) {
              return {
                create: jest.fn().mockReturnValue(createdIdentity),
                save: jest.fn().mockResolvedValue(createdIdentity),
              };
            }
            if (entity === UserSettings) {
              return {
                create: jest.fn().mockReturnValue(createdSettings),
                save: jest.fn().mockResolvedValue(createdSettings),
              };
            }
            return null;
          }),
        } as unknown as EntityManager;
        return await cb(manager);
      });

      const result = await service.initiateTelegramUser('555123', 'John Doe');

      expect(result.isNew).toBe(true);
      expect(result.user.id).toBe('u-100');
      expect(result.user.settings.timezone).toBe('Asia/Tehran');
      expect(result.user.settings.onboardingStep).toBe(OnboardingStep.NAME);
      expect(result.user.settings.onboardingCompleted).toBe(false);

      // Verify no starting points / point transactions were created
      expect(pointTransactionRepo.find).not.toHaveBeenCalled();
    });

    it('(Req 2 & 8) should return existing user when already initiated or partially onboarded', async () => {
      const existingUser = {
        id: 'u-200',
        displayName: 'Returning User',
        settings: {
          timezone: 'Asia/Tehran',
          onboardingStep: OnboardingStep.TIMEZONE,
          onboardingCompleted: false,
        },
      } as User;

      identityRepo.findOne.mockResolvedValue({
        id: 'i-200',
        provider: IdentityProvider.TELEGRAM,
        providerUserId: '555123',
        user: existingUser,
      } as UserIdentity);

      const result = await service.initiateTelegramUser('555123');

      expect(result.isNew).toBe(false);
      expect(result.user.id).toBe('u-200');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('(Req 9) should handle code 23505 concurrency conflict gracefully and return existing user', async () => {
      // First find returns null (race condition)
      identityRepo.findOne
        .mockResolvedValueOnce(null)
        // Second find (after conflict) returns the user created concurrently
        .mockResolvedValueOnce({
          id: 'i-race',
          provider: IdentityProvider.TELEGRAM,
          providerUserId: '555999',
          user: { id: 'u-race', displayName: 'Race User' } as User,
        } as UserIdentity);

      const queryError = new QueryFailedError('query', [], new Error('uq'));
      Object.assign(queryError, { driverError: { code: '23505' } });

      dataSource.transaction.mockRejectedValue(queryError);

      const result = await service.initiateTelegramUser('555999', 'Race User');

      expect(result.isNew).toBe(false);
      expect(result.user.id).toBe('u-race');
    });

    it('(Req 10) should propagate error when transaction fails and rollback', async () => {
      identityRepo.findOne.mockResolvedValue(null);
      const dbError = new Error('Database connection failed');
      dataSource.transaction.mockRejectedValue(dbError);

      await expect(
        service.initiateTelegramUser('555000', 'Fail User'),
      ).rejects.toThrow('Database connection failed');
    });
  });

  describe('updateDisplayName (Requirements 3 & 4)', () => {
    it('(Req 3) should update suggested display name and advance step to TIMEZONE', async () => {
      const user = {
        id: 'u-1',
        displayName: null,
        settings: {
          userId: 'u-1',
          onboardingStep: OnboardingStep.NAME,
        } as UserSettings,
      } as User;

      dataSource.transaction.mockImplementation(async (cb) => {
        const manager = {
          getRepository: jest.fn((entity) => {
            if (entity === User) {
              return {
                findOne: jest.fn().mockResolvedValue(user),
                save: jest.fn().mockImplementation((u) => Promise.resolve(u)),
              };
            }
            if (entity === UserSettings) {
              return {
                save: jest.fn().mockImplementation((s) => Promise.resolve(s)),
              };
            }
            return null;
          }),
        } as unknown as EntityManager;
        return await cb(manager);
      });

      const updated = await service.updateDisplayName('u-1', 'Sara Parker');
      expect(updated.displayName).toBe('Sara Parker');
      expect(updated.settings.onboardingStep).toBe(OnboardingStep.TIMEZONE);
    });

    it('(Req 4) should accept custom display name with trimming', async () => {
      const user = {
        id: 'u-1',
        displayName: null,
        settings: {
          userId: 'u-1',
          onboardingStep: OnboardingStep.AWAITING_CUSTOM_NAME,
        } as UserSettings,
      } as User;

      dataSource.transaction.mockImplementation(async (cb) => {
        const manager = {
          getRepository: jest.fn((entity) => {
            if (entity === User) {
              return {
                findOne: jest.fn().mockResolvedValue(user),
                save: jest.fn().mockImplementation((u) => Promise.resolve(u)),
              };
            }
            if (entity === UserSettings) {
              return {
                save: jest.fn().mockImplementation((s) => Promise.resolve(s)),
              };
            }
            return null;
          }),
        } as unknown as EntityManager;
        return await cb(manager);
      });

      const updated = await service.updateDisplayName('u-1', '  Custom Name  ');
      expect(updated.displayName).toBe('Custom Name');
    });

    it('(Req 4) should reject empty or whitespace-only name', async () => {
      await expect(service.updateDisplayName('u-1', '   ')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('(Req 4) should reject name exceeding 100 characters', async () => {
      await expect(
        service.updateDisplayName('u-1', 'a'.repeat(101)),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateTimezone (Requirements 5, 6, 7)', () => {
    it('(Req 5) should confirm default Asia/Tehran timezone and advance step to GAMIFICATION', async () => {
      const user = {
        id: 'u-1',
        displayName: 'User',
        settings: {
          userId: 'u-1',
          timezone: 'Asia/Tehran',
          onboardingStep: OnboardingStep.TIMEZONE,
        } as UserSettings,
      } as User;

      dataSource.transaction.mockImplementation(async (cb) => {
        const manager = {
          getRepository: jest.fn((entity) => {
            if (entity === User) {
              return { findOne: jest.fn().mockResolvedValue(user) };
            }
            if (entity === UserSettings) {
              return {
                save: jest.fn().mockImplementation((s) => Promise.resolve(s)),
              };
            }
            return null;
          }),
        } as unknown as EntityManager;
        return await cb(manager);
      });

      const updated = await service.updateTimezone('u-1', 'Asia/Tehran');
      expect(updated.settings.timezone).toBe('Asia/Tehran');
      expect(updated.settings.onboardingStep).toBe(OnboardingStep.GAMIFICATION);
    });

    it('(Req 6) should update with alternative valid IANA timezone', async () => {
      const user = {
        id: 'u-1',
        displayName: 'User',
        settings: {
          userId: 'u-1',
          timezone: 'Asia/Tehran',
          onboardingStep: OnboardingStep.TIMEZONE,
        } as UserSettings,
      } as User;

      dataSource.transaction.mockImplementation(async (cb) => {
        const manager = {
          getRepository: jest.fn((entity) => {
            if (entity === User) {
              return { findOne: jest.fn().mockResolvedValue(user) };
            }
            if (entity === UserSettings) {
              return {
                save: jest.fn().mockImplementation((s) => Promise.resolve(s)),
              };
            }
            return null;
          }),
        } as unknown as EntityManager;
        return await cb(manager);
      });

      const updated = await service.updateTimezone('u-1', 'Europe/Amsterdam');
      expect(updated.settings.timezone).toBe('Europe/Amsterdam');
      expect(updated.settings.onboardingStep).toBe(OnboardingStep.GAMIFICATION);
    });

    it('(Req 7) should reject invalid timezone identifier', async () => {
      await expect(
        service.updateTimezone('u-1', 'Invalid/Timezone'),
      ).rejects.toThrow(BadRequestException);
    });

    it('(Req 7) should reject raw offset like +03:30', async () => {
      await expect(service.updateTimezone('u-1', '+03:30')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('completeOnboarding (Step 5)', () => {
    it('should mark onboardingCompleted to true and step to COMPLETED', async () => {
      const user = {
        id: 'u-1',
        displayName: 'Complete User',
        settings: {
          userId: 'u-1',
          timezone: 'Asia/Tehran',
          onboardingStep: OnboardingStep.GAMIFICATION,
          onboardingCompleted: false,
        } as UserSettings,
      } as User;

      dataSource.transaction.mockImplementation(async (cb) => {
        const manager = {
          getRepository: jest.fn((entity) => {
            if (entity === User) {
              return { findOne: jest.fn().mockResolvedValue(user) };
            }
            if (entity === UserSettings) {
              return {
                save: jest.fn().mockImplementation((s) => Promise.resolve(s)),
              };
            }
            return null;
          }),
        } as unknown as EntityManager;
        return await cb(manager);
      });

      const updated = await service.completeOnboarding('u-1');
      expect(updated.settings.onboardingCompleted).toBe(true);
      expect(updated.settings.onboardingStep).toBe(OnboardingStep.COMPLETED);
    });
  });
});
