import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';

import { User } from './entities/user.entity';
import { UserIdentity } from './entities/user-identity.entity';
import { UserSettings } from './entities/user-settings.entity';
import { Task } from './entities/task.entity';
import { TaskOccurrence } from './entities/task-occurrence.entity';
import { ActivityEvent } from './entities/activity-event.entity';
import { PointTransaction } from './entities/point-transaction.entity';
import { GamificationProfile } from './entities/gamification-profile.entity';
import { DatabaseConnectionLogger } from './database-connection.logger';
import { InitialDatabaseSchema1771360000000 } from './migrations/1771360000000-InitialDatabaseSchema';

export const entities = [
  User,
  UserIdentity,
  UserSettings,
  Task,
  TaskOccurrence,
  ActivityEvent,
  PointTransaction,
  GamificationProfile,
];

export const migrations = [InitialDatabaseSchema1771360000000];

@Module({
  imports: [
    ConfigModule,

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService): TypeOrmModuleOptions => ({
        type: 'postgres',

        host: configService.getOrThrow<string>('DB_HOST'),
        port: configService.get<number>('DB_PORT') ?? 5432,
        username: configService.getOrThrow<string>('DB_USERNAME'),
        password: configService.getOrThrow<string>('DB_PASSWORD'),
        database: configService.getOrThrow<string>('DB_DATABASE'),
        ssl:
          configService.get<string>('DB_SSL') === 'true'
            ? { rejectUnauthorized: false }
            : undefined,

        entities,
        migrations,

        // Production safety guard: synchronize is strictly disabled by default.
        // It requires explicit NODE_ENV=development AND DB_SYNCHRONIZE=true.
        synchronize:
          configService.get<string>('NODE_ENV') === 'development' &&
          configService.get<string>('DB_SYNCHRONIZE') === 'true',
        migrationsRun: false,
      }),
    }),
  ],
  providers: [DatabaseConnectionLogger],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
