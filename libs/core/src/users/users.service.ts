import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';

import {
  User,
  UserIdentity,
  IdentityProvider,
  UserSettings,
  OnboardingStep,
  UserStatus,
} from '@app/database';

import { RegisterTelegramUserDto } from './dto/register-telegram-user.dto';
import { isValidIanaTimezone } from './dto/update-timezone.dto';

export interface RegisterUserResult {
  user: User;
  isNew: boolean;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Find an existing user by their Telegram User ID, including settings.
   */
  async findTelegramUser(telegramUserId: string): Promise<User | null> {
    const identity = await this.dataSource.getRepository(UserIdentity).findOne({
      where: {
        provider: IdentityProvider.TELEGRAM,
        providerUserId: telegramUserId,
      },
      relations: {
        user: {
          settings: true,
        },
      },
    });

    return identity?.user ?? null;
  }

  /**
   * Idempotently start or resume registration for a Telegram user.
   * If the user already exists, returns the existing user and settings.
   * If new, atomically provisions User, UserIdentity, and initial UserSettings.
   */
  async initiateTelegramUser(
    telegramUserId: string,
    suggestedDisplayName?: string | null,
  ): Promise<RegisterUserResult> {
    const existing = await this.findTelegramUser(telegramUserId);
    if (existing) {
      return {
        user: existing,
        isNew: false,
      };
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const userRepository = manager.getRepository(User);
        const identityRepository = manager.getRepository(UserIdentity);
        const settingsRepository = manager.getRepository(UserSettings);

        const trimmedSuggestedName =
          typeof suggestedDisplayName === 'string' &&
          suggestedDisplayName.trim().length > 0
            ? suggestedDisplayName.trim().slice(0, 100)
            : null;

        const user = await userRepository.save(
          userRepository.create({
            displayName: trimmedSuggestedName,
            status: UserStatus.ACTIVE,
          }),
        );

        await identityRepository.save(
          identityRepository.create({
            provider: IdentityProvider.TELEGRAM,
            providerUserId: telegramUserId,
            userId: user.id,
          }),
        );

        const settings = await settingsRepository.save(
          settingsRepository.create({
            userId: user.id,
            timezone: 'Asia/Tehran',
            onboardingStep: OnboardingStep.NAME,
            onboardingCompleted: false,
          }),
        );

        user.settings = settings;

        return {
          user,
          isNew: true,
        };
      });
    } catch (error: unknown) {
      if (this.isUniqueConstraintViolation(error)) {
        this.logger.warn(
          `Concurrent registration detected for Telegram ID ${telegramUserId}. Fetching existing record.`,
        );
        const user = await this.findTelegramUser(telegramUserId);
        if (user) {
          return {
            user,
            isNew: false,
          };
        }
      }

      this.logger.error(
        `Failed to initiate Telegram user registration for ${telegramUserId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Update the user's display name and advance the onboarding step.
   */
  async updateDisplayName(
    userId: string,
    displayName: string,
    nextStep: OnboardingStep = OnboardingStep.TIMEZONE,
  ): Promise<User> {
    const trimmedName = displayName?.trim();
    if (!trimmedName || trimmedName.length === 0) {
      throw new BadRequestException(
        'Display name cannot be empty or whitespace only.',
      );
    }
    if (trimmedName.length > 100) {
      throw new BadRequestException(
        'Display name cannot exceed 100 characters.',
      );
    }

    return await this.dataSource.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const settingsRepository = manager.getRepository(UserSettings);

      const user = await userRepository.findOne({
        where: { id: userId },
        relations: { settings: true },
      });

      if (!user) {
        throw new NotFoundException(`User with ID ${userId} not found.`);
      }

      user.displayName = trimmedName;
      await userRepository.save(user);

      if (user.settings) {
        user.settings.onboardingStep = nextStep;
        await settingsRepository.save(user.settings);
      } else {
        user.settings = await settingsRepository.save(
          settingsRepository.create({
            userId: user.id,
            timezone: 'Asia/Tehran',
            onboardingStep: nextStep,
            onboardingCompleted: false,
          }),
        );
      }

      return user;
    });
  }

  /**
   * Update the user's timezone and advance the onboarding step.
   */
  async updateTimezone(
    userId: string,
    timezone: string,
    nextStep: OnboardingStep = OnboardingStep.GAMIFICATION,
  ): Promise<User> {
    const trimmedTz = timezone?.trim();
    if (!isValidIanaTimezone(trimmedTz)) {
      throw new BadRequestException(
        `'${timezone}' is not a valid IANA time-zone identifier.`,
      );
    }

    return await this.dataSource.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const settingsRepository = manager.getRepository(UserSettings);

      const user = await userRepository.findOne({
        where: { id: userId },
        relations: { settings: true },
      });

      if (!user) {
        throw new NotFoundException(`User with ID ${userId} not found.`);
      }

      if (user.settings) {
        user.settings.timezone = trimmedTz;
        user.settings.onboardingStep = nextStep;
        await settingsRepository.save(user.settings);
      } else {
        user.settings = await settingsRepository.save(
          settingsRepository.create({
            userId: user.id,
            timezone: trimmedTz,
            onboardingStep: nextStep,
            onboardingCompleted: false,
          }),
        );
      }

      return user;
    });
  }

  /**
   * Set the current onboarding step (e.g. when awaiting custom input).
   */
  async setOnboardingStep(userId: string, step: OnboardingStep): Promise<User> {
    return await this.dataSource.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const settingsRepository = manager.getRepository(UserSettings);

      const user = await userRepository.findOne({
        where: { id: userId },
        relations: { settings: true },
      });

      if (!user) {
        throw new NotFoundException(`User with ID ${userId} not found.`);
      }

      if (user.settings) {
        user.settings.onboardingStep = step;
        await settingsRepository.save(user.settings);
      } else {
        user.settings = await settingsRepository.save(
          settingsRepository.create({
            userId: user.id,
            timezone: 'Asia/Tehran',
            onboardingStep: step,
            onboardingCompleted: false,
          }),
        );
      }

      return user;
    });
  }

  /**
   * Mark onboarding as complete.
   */
  async completeOnboarding(userId: string): Promise<User> {
    return await this.dataSource.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const settingsRepository = manager.getRepository(UserSettings);

      const user = await userRepository.findOne({
        where: { id: userId },
        relations: { settings: true },
      });

      if (!user) {
        throw new NotFoundException(`User with ID ${userId} not found.`);
      }

      if (user.settings) {
        user.settings.onboardingCompleted = true;
        user.settings.onboardingStep = OnboardingStep.COMPLETED;
        await settingsRepository.save(user.settings);
      } else {
        user.settings = await settingsRepository.save(
          settingsRepository.create({
            userId: user.id,
            timezone: 'Asia/Tehran',
            onboardingStep: OnboardingStep.COMPLETED,
            onboardingCompleted: true,
          }),
        );
      }

      return user;
    });
  }

  /**
   * Original registration method preserved for backwards compatibility and bulk/API registrations.
   */
  async registerTelegramUser(
    dto: RegisterTelegramUserDto,
  ): Promise<RegisterUserResult> {
    const existing = await this.findTelegramUser(dto.telegramUserId);
    if (existing) {
      return {
        user: existing,
        isNew: false,
      };
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const userRepository = manager.getRepository(User);
        const identityRepository = manager.getRepository(UserIdentity);
        const settingsRepository = manager.getRepository(UserSettings);

        const user = await userRepository.save(
          userRepository.create({
            displayName: dto.displayName ?? null,
            status: UserStatus.ACTIVE,
          }),
        );

        await identityRepository.save(
          identityRepository.create({
            provider: IdentityProvider.TELEGRAM,
            providerUserId: dto.telegramUserId,
            userId: user.id,
          }),
        );

        const settings = await settingsRepository.save(
          settingsRepository.create({
            userId: user.id,
            timezone: dto.timezone || 'Asia/Tehran',
            onboardingStep: OnboardingStep.COMPLETED,
            onboardingCompleted: true,
          }),
        );

        user.settings = settings;

        return {
          user,
          isNew: true,
        };
      });
    } catch (error: unknown) {
      if (this.isUniqueConstraintViolation(error)) {
        const user = await this.findTelegramUser(dto.telegramUserId);
        if (user) {
          return {
            user,
            isNew: false,
          };
        }
      }

      throw error;
    }
  }

  private isUniqueConstraintViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (
        error as QueryFailedError & {
          driverError?: { code?: string };
        }
      ).driverError?.code === '23505'
    );
  }
}
