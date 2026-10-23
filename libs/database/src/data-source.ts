import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';

import { User } from './entities/user.entity';
import { UserIdentity } from './entities/user-identity.entity';
import { UserSettings } from './entities/user-settings.entity';
import { Task } from './entities/task.entity';
import { TaskOccurrence } from './entities/task-occurrence.entity';
import { ActivityEvent } from './entities/activity-event.entity';
import { PointTransaction } from './entities/point-transaction.entity';
import { GamificationProfile } from './entities/gamification-profile.entity';
import { InitialDatabaseSchema1771360000000 } from './migrations/1771360000000-InitialDatabaseSchema';

dotenv.config();

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

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || 'task_manager_app',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities,
  migrations,
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
};

const AppDataSource = new DataSource(dataSourceOptions);
export default AppDataSource;
