import { Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';

import { User } from '@app/database';
import { UserIdentity, IdentityProvider } from '@app/database';
import { UserSettings } from '@app/database';

import { RegisterTelegramUserDto } from './dto/register-telegram-user.dto';

export interface RegisterUserResult {
  user: User;
  isNew: boolean;
}

@Injectable()
export class UsersService {
  constructor(private readonly dataSource: DataSource) {}

  async registerTelegramUser(
    dto: RegisterTelegramUserDto,
  ): Promise<RegisterUserResult> {
    // is this user already registered with this telegramUserId?
    const existingIdentity = await this.dataSource
      .getRepository(UserIdentity)
      .findOne({
        where: {
          provider: IdentityProvider.TELEGRAM,
          providerUserId: dto.telegramUserId,
        },
        relations: {
          user: true,
        },
      });

    if (existingIdentity) {
      return {
        user: existingIdentity.user,
        isNew: false,
      };
    }

    try {
      // register a new user with the provided telegramUserId and displayName
      return await this.dataSource.transaction(async (manager) => {
        const userRepository = manager.getRepository(User);
        const identityRepository = manager.getRepository(UserIdentity);
        const settingsRepository = manager.getRepository(UserSettings);

        const user = await userRepository.save(
          userRepository.create({
            displayName: dto.displayName,
          }),
        );

        await identityRepository.save(
          identityRepository.create({
            provider: IdentityProvider.TELEGRAM,
            providerUserId: dto.telegramUserId,
            userId: user.id,
          }),
        );

        await settingsRepository.save(
          settingsRepository.create({
            userId: user.id,
          }),
        );

        return {
          user,
          isNew: true,
        };
      });
    } catch (error: unknown) {
      // Handle unique constraint violation (code : 23505)
      if (
        error instanceof QueryFailedError &&
        (
          error as QueryFailedError & {
            driverError?: { code?: string };
          }
        ).driverError?.code === '23505'
      ) {
        const identity = await this.dataSource
          .getRepository(UserIdentity)
          .findOne({
            where: {
              provider: IdentityProvider.TELEGRAM,
              providerUserId: dto.telegramUserId,
            },
            relations: {
              user: true,
            },
          });

        if (identity) {
          return {
            user: identity.user,
            isNew: false,
          };
        }
      }

      throw error;
    }
  }
}
