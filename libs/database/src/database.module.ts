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
import { DatabaseConnectionLogger } from './database-connection.logger';

const entities = [
  User,
  UserIdentity,
  UserSettings,
  Task,
  TaskOccurrence,
  ActivityEvent,
  PointTransaction,
];

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

        entities,

        synchronize: true,
      }),
    }),
  ],
  providers: [DatabaseConnectionLogger],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
