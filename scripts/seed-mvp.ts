import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';

import {
  User,
  UserIdentity,
  IdentityProvider,
  UserSettings,
  UserStatus,
  Task,
  TaskType,
  TaskPriority,
  TaskOccurrence,
  TaskOccurrenceStatus,
  PointTransaction,
  GamificationProfile,
  ActivityEvent,
} from '@app/database';

import {
  localDateTimeToUtcDate,
  getTodayDateString,
  addDaysToIsoDate,
} from '@app/core/tasks/utils/task-date.util';

import {
  calculateLevelInfo,
  calculateConsistencyScore,
} from '@app/core/gamification/gamification.service';

import {
  BASE_XP_REWARDS,
  GAMIFICATION_TRANSACTION_REASONS,
} from '@app/core/gamification/constants/gamification.constants';

/**
 * Loads .env configuration without external dependencies.
 */
function loadEnvironment(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

/**
 * Validates that the active database target is a safe local development environment.
 */
function assertDevelopmentEnvironment(): void {
  const dbHost = (process.env.DB_HOST || '').toLowerCase().trim();
  const allowedHosts = ['localhost', '127.0.0.1', '::1'];

  if (!allowedHosts.includes(dbHost)) {
    throw new Error(
      `Database safety guard: DB_HOST is configured to '${dbHost}'. Seeding is strictly permitted only on local development databases (localhost / 127.0.0.1).`,
    );
  }
}

interface SeedStats {
  userResolved: { id: string; displayName: string | null; isNew: boolean };
  tasksCreated: number;
  tasksExisting: number;
  occurrencesCreated: number;
  occurrencesExisting: number;
  transactionsCreated: number;
  transactionsExisting: number;
  profileUpdated: boolean;
}

export async function runMvpSeed(): Promise<void> {
  loadEnvironment();
  assertDevelopmentEnvironment();

  const targetTelegramId = '886413664';
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = Number(process.env.DB_PORT) || 5432;
  const dbName = process.env.DB_DATABASE || 'task_manager_app';

  console.log('='.repeat(65));
  console.log('  Task Manager MVP — Safe Development Database Seed');
  console.log('='.repeat(65));
  console.log(`Target Database:  ${dbHost}:${dbPort}/${dbName}`);
  console.log(`Target Telegram:  ${targetTelegramId}`);
  console.log('-'.repeat(65));

  const dataSource = new DataSource({
    type: 'postgres',
    host: dbHost,
    port: dbPort,
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: dbName,
    entities: [
      User,
      UserIdentity,
      UserSettings,
      Task,
      TaskOccurrence,
      PointTransaction,
      GamificationProfile,
      ActivityEvent,
    ],
    synchronize: false,
    logging: false,
  });

  await dataSource.initialize();

  const stats: SeedStats = {
    userResolved: { id: '', displayName: null, isNew: false },
    tasksCreated: 0,
    tasksExisting: 0,
    occurrencesCreated: 0,
    occurrencesExisting: 0,
    transactionsCreated: 0,
    transactionsExisting: 0,
    profileUpdated: false,
  };

  try {
    await dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const identityRepo = manager.getRepository(UserIdentity);
      const settingsRepo = manager.getRepository(UserSettings);
      const taskRepo = manager.getRepository(Task);
      const occRepo = manager.getRepository(TaskOccurrence);
      const pointTxRepo = manager.getRepository(PointTransaction);
      const profileRepo = manager.getRepository(GamificationProfile);

      // 1. Resolve or idempotently create user
      const existingIdentity = await identityRepo.findOne({
        where: {
          provider: IdentityProvider.TELEGRAM,
          providerUserId: targetTelegramId,
        },
        relations: {
          user: {
            settings: true,
          },
        },
      });

      let user: User;
      if (existingIdentity?.user) {
        user = existingIdentity.user;
        stats.userResolved = {
          id: user.id,
          displayName: user.displayName,
          isNew: false,
        };
        console.log(`[USER] Existing user found: ID=${user.id}`);
      } else {
        const newUser = userRepo.create({
          displayName: 'Development User',
          status: UserStatus.ACTIVE,
        });
        user = await userRepo.save(newUser);

        await identityRepo.save(
          identityRepo.create({
            provider: IdentityProvider.TELEGRAM,
            providerUserId: targetTelegramId,
            userId: user.id,
          }),
        );

        const settings = await settingsRepo.save(
          settingsRepo.create({
            userId: user.id,
            timezone: 'Asia/Tehran',
            notificationsEnabled: true,
            reminderBeforeMinutes: 10,
            onboardingCompleted: true,
          }),
        );
        user.settings = settings;

        stats.userResolved = {
          id: user.id,
          displayName: user.displayName,
          isNew: true,
        };
        console.log(`[USER] Created new user: ID=${user.id}`);
      }

      const timezone = user.settings?.timezone || 'Asia/Tehran';
      const todayDate = getTodayDateString(timezone);
      const yesterdayDate = addDaysToIsoDate(todayDate, -1);
      const twoDaysAgoDate = addDaysToIsoDate(todayDate, -2);

      console.log(`[CONTEXT] Timezone: ${timezone} | Today: ${todayDate}`);

      // 2. Define MVP Seed Tasks
      const seedTaskDefinitions = [
        {
          key: 'TASK_DAILY_WORKOUT',
          title: '[MVP] ورزش و تحرک روزانه',
          type: TaskType.DAILY,
          priority: TaskPriority.HIGH,
          description: '[SEED:MVP] تمرین و تحرک روزانه برای حفظ سلامت و انرژی',
          scheduledStartTime: '08:00:00',
        },
        {
          key: 'TASK_DAILY_STUDY',
          title: '[MVP] مطالعه و یادگیری مستمر',
          type: TaskType.DAILY,
          priority: TaskPriority.NORMAL,
          description: '[SEED:MVP] مطالعه روزانه کتاب تخصصی یا پادکست آموزشی',
          scheduledStartTime: '20:00:00',
        },
        {
          key: 'TASK_DAILY_PLANNING',
          title: '[MVP] مرور و برنامه‌ریزی روزانه',
          type: TaskType.DAILY,
          priority: TaskPriority.LOW,
          description: '[SEED:MVP] بررسی کارهای فردا و نظم‌دهی به اهداف',
          scheduledStartTime: '22:30:00',
        },
        {
          key: 'TASK_ONETIME_LOGS',
          title: '[MVP] بررسی لاگ‌های سرور توسعه',
          type: TaskType.ONE_TIME,
          priority: TaskPriority.HIGH,
          description: '[SEED:MVP] بررسی خطاهای لاگ سرور بات و دیتابیس',
          scheduledStartTime: null,
        },
        {
          key: 'TASK_ONETIME_DOCS',
          title: '[MVP] سازماندهی مستندات معماری',
          type: TaskType.ONE_TIME,
          priority: TaskPriority.NORMAL,
          description: '[SEED:MVP] به‌روزرسانی تصمیمات فنی در agent-context',
          scheduledStartTime: null,
        },
      ];

      const tasksMap = new Map<string, Task>();

      for (const def of seedTaskDefinitions) {
        let task = await taskRepo.findOne({
          where: {
            ownerId: user.id,
            title: def.title,
          },
        });

        if (!task) {
          task = await taskRepo.save(
            taskRepo.create({
              ownerId: user.id,
              type: def.type,
              title: def.title,
              priority: def.priority,
              description: def.description,
              scheduledStartTime: def.scheduledStartTime,
              isActive: true,
            }),
          );
          stats.tasksCreated++;
          console.log(`[TASK] Created: "${def.title}" (ID: ${task.id})`);
        } else {
          stats.tasksExisting++;
          console.log(`[TASK] Found existing: "${def.title}" (ID: ${task.id})`);
        }

        tasksMap.set(def.key, task);
      }

      // 3. Define Seed Occurrences
      interface SeedOccDef {
        taskKey: string;
        date: string;
        status: TaskOccurrenceStatus;
        scheduledStartTime: string | null;
        dueTimeStr?: string | null;
        completedTimeStr?: string | null;
        notified?: boolean;
        pointsDelta?: number;
      }

      const seedOccurrenceDefs: SeedOccDef[] = [
        // Day -2 (twoDaysAgoDate): 3 daily tasks completed on time -> Day qualifies!
        {
          taskKey: 'TASK_DAILY_WORKOUT',
          date: twoDaysAgoDate,
          status: TaskOccurrenceStatus.COMPLETED,
          scheduledStartTime: '08:00:00',
          dueTimeStr: '09:00:00',
          completedTimeStr: '08:45:00',
          notified: true,
          pointsDelta: BASE_XP_REWARDS.ON_TIME_COMPLETION, // 10 XP
        },
        {
          taskKey: 'TASK_DAILY_STUDY',
          date: twoDaysAgoDate,
          status: TaskOccurrenceStatus.COMPLETED,
          scheduledStartTime: '20:00:00',
          dueTimeStr: '21:00:00',
          completedTimeStr: '20:30:00',
          notified: true,
          pointsDelta: BASE_XP_REWARDS.ON_TIME_COMPLETION, // 10 XP
        },
        {
          taskKey: 'TASK_DAILY_PLANNING',
          date: twoDaysAgoDate,
          status: TaskOccurrenceStatus.COMPLETED,
          scheduledStartTime: '22:30:00',
          dueTimeStr: '23:00:00',
          completedTimeStr: '22:45:00',
          notified: true,
          pointsDelta: BASE_XP_REWARDS.ON_TIME_COMPLETION, // 10 XP
        },

        // Day -1 (yesterdayDate): 3 daily tasks completed on time (consecutive streak 2!) + 1 skipped one-time task
        {
          taskKey: 'TASK_DAILY_WORKOUT',
          date: yesterdayDate,
          status: TaskOccurrenceStatus.COMPLETED,
          scheduledStartTime: '08:00:00',
          dueTimeStr: '09:00:00',
          completedTimeStr: '08:40:00',
          notified: true,
          // Day starts with streak 1 -> multiplier 1.05 -> round(10 * 1.05) = 11 XP
          pointsDelta: 11,
        },
        {
          taskKey: 'TASK_DAILY_STUDY',
          date: yesterdayDate,
          status: TaskOccurrenceStatus.COMPLETED,
          scheduledStartTime: '20:00:00',
          dueTimeStr: '21:00:00',
          completedTimeStr: '20:35:00',
          notified: true,
          pointsDelta: 11,
        },
        {
          taskKey: 'TASK_DAILY_PLANNING',
          date: yesterdayDate,
          status: TaskOccurrenceStatus.COMPLETED,
          scheduledStartTime: '22:30:00',
          dueTimeStr: '23:00:00',
          completedTimeStr: '22:40:00',
          notified: true,
          pointsDelta: 11,
        },
        {
          taskKey: 'TASK_ONETIME_DOCS',
          date: yesterdayDate,
          status: TaskOccurrenceStatus.SKIPPED,
          scheduledStartTime: null,
          notified: true,
        },

        // Day 0 (todayDate): 1 completed, 1 partially completed, 1 pending daily, 1 pending one-time
        {
          taskKey: 'TASK_DAILY_WORKOUT',
          date: todayDate,
          status: TaskOccurrenceStatus.COMPLETED,
          scheduledStartTime: '08:00:00',
          dueTimeStr: '09:00:00',
          completedTimeStr: '08:30:00',
          notified: true,
          // Day starts with streak 2 -> multiplier 1.10 -> round(10 * 1.10) = 11 XP
          pointsDelta: 11,
        },
        {
          taskKey: 'TASK_DAILY_STUDY',
          date: todayDate,
          status: TaskOccurrenceStatus.PARTIALLY_COMPLETED,
          scheduledStartTime: '20:00:00',
          dueTimeStr: '21:00:00',
          completedTimeStr: '11:00:00',
          notified: true,
          // Partial completion -> 4 XP (no streak multiplier per game rules)
          pointsDelta: BASE_XP_REWARDS.PARTIAL_COMPLETION,
        },
        {
          taskKey: 'TASK_DAILY_PLANNING',
          date: todayDate,
          status: TaskOccurrenceStatus.PENDING,
          scheduledStartTime: '22:30:00',
          dueTimeStr: '23:00:00',
          notified: false,
        },
        {
          taskKey: 'TASK_ONETIME_LOGS',
          date: todayDate,
          status: TaskOccurrenceStatus.PENDING,
          scheduledStartTime: null,
          notified: false,
        },
      ];

      for (const occDef of seedOccurrenceDefs) {
        const task = tasksMap.get(occDef.taskKey);
        if (!task) continue;

        let occ = await occRepo.findOne({
          where: {
            taskId: task.id,
            date: occDef.date,
          },
        });

        const scheduledDueAt = occDef.dueTimeStr
          ? localDateTimeToUtcDate(occDef.date, occDef.dueTimeStr, timezone)
          : null;

        const completedAt = occDef.completedTimeStr
          ? localDateTimeToUtcDate(occDef.date, occDef.completedTimeStr, timezone)
          : null;

        const notifiedAt = occDef.notified
          ? occDef.scheduledStartTime
            ? localDateTimeToUtcDate(occDef.date, occDef.scheduledStartTime, timezone)
            : new Date()
          : null;

        if (!occ) {
          occ = await occRepo.save(
            occRepo.create({
              taskId: task.id,
              date: occDef.date,
              status: occDef.status,
              scheduledStartTime: occDef.scheduledStartTime,
              scheduledDueAt,
              completedAt,
              notifiedAt,
            }),
          );
          stats.occurrencesCreated++;
        } else {
          stats.occurrencesExisting++;
        }

        // 4. Point Transaction Ledger Entry (if XP eligible)
        if (
          occDef.pointsDelta &&
          (occDef.status === TaskOccurrenceStatus.COMPLETED ||
            occDef.status === TaskOccurrenceStatus.PARTIALLY_COMPLETED)
        ) {
          const idempotencyKey =
            occDef.status === TaskOccurrenceStatus.PARTIALLY_COMPLETED
              ? `task_partial_completion:${occ.id}`
              : `task_completion:${occ.id}`;

          const existingTx = await pointTxRepo.findOne({
            where: { idempotencyKey },
          });

          if (!existingTx) {
            await manager
              .createQueryBuilder()
              .insert()
              .into(PointTransaction)
              .values({
                userId: user.id,
                taskOccurrenceId: occ.id,
                pointsDelta: occDef.pointsDelta,
                reason: GAMIFICATION_TRANSACTION_REASONS.TASK_COMPLETION,
                idempotencyKey,
                metadata: {
                  seed: true,
                  taskKey: occDef.taskKey,
                  status: occDef.status,
                  date: occDef.date,
                  timing: 'on_time',
                },
              })
              .orIgnore()
              .execute();

            stats.transactionsCreated++;
          } else {
            stats.transactionsExisting++;
          }
        }
      }

      // 5. Authoritatively update Gamification Profile streaks
      // Qualified days: twoDaysAgoDate (streak 1) and yesterdayDate (streak 2).
      // Today (todayDate) has 1 completion, threshold of 3 not reached yet.
      let profile = await profileRepo.findOne({ where: { userId: user.id } });
      if (!profile) {
        profile = profileRepo.create({
          userId: user.id,
          currentStreak: 2,
          longestStreak: 2,
          lastQualifiedDate: yesterdayDate,
        });
        await profileRepo.save(profile);
        stats.profileUpdated = true;
      } else {
        // Only advance streak if profile streak is below seeded streak
        let modified = false;
        if (profile.currentStreak < 2) {
          profile.currentStreak = 2;
          modified = true;
        }
        if (profile.longestStreak < 2) {
          profile.longestStreak = 2;
          modified = true;
        }
        if (!profile.lastQualifiedDate || profile.lastQualifiedDate < yesterdayDate) {
          profile.lastQualifiedDate = yesterdayDate;
          modified = true;
        }
        if (modified) {
          await profileRepo.save(profile);
          stats.profileUpdated = true;
        }
      }
    });

    // 6. Post-Execution Verification & Summaries
    console.log('-'.repeat(65));
    console.log('Seed Execution Statistics:');
    console.log(`  User:                 ${stats.userResolved.isNew ? 'CREATED' : 'EXISTING'} (ID: ${stats.userResolved.id})`);
    console.log(`  Tasks:                +${stats.tasksCreated} created, ${stats.tasksExisting} existing`);
    console.log(`  Occurrences:          +${stats.occurrencesCreated} created, ${stats.occurrencesExisting} existing`);
    console.log(`  Point Transactions:   +${stats.transactionsCreated} created, ${stats.transactionsExisting} existing`);
    console.log(`  Gamification Profile: ${stats.profileUpdated ? 'Updated' : 'Preserved'}`);
    console.log('-'.repeat(65));

    // Verify derived ledger totals
    const totalXpRes = await dataSource
      .getRepository(PointTransaction)
      .createQueryBuilder('pt')
      .select('COALESCE(SUM(pt.pointsDelta), 0)', 'total')
      .where('pt.userId = :userId', { userId: stats.userResolved.id })
      .getRawOne<{ total: string | number }>();

    const totalXp = Number(totalXpRes?.total || 0);
    const levelInfo = calculateLevelInfo(totalXp);

    const occurrences = await dataSource
      .getRepository(TaskOccurrence)
      .createQueryBuilder('occ')
      .innerJoin('occ.task', 'task')
      .where('task.ownerId = :userId', { userId: stats.userResolved.id })
      .select([
        'occ.status',
        'occ.completedAt',
        'occ.scheduledDueAt',
      ])
      .getMany();

    const consistencyScore = calculateConsistencyScore(
      occurrences.map((o) => ({
        status: o.status,
        completedAt: o.completedAt,
        scheduledDueAt: o.scheduledDueAt,
      })),
    );

    const profile = await dataSource
      .getRepository(GamificationProfile)
      .findOne({ where: { userId: stats.userResolved.id } });

    console.log('Gamification & Score Verification:');
    console.log(`  Authoritative Total XP:   ${totalXp} XP`);
    console.log(`  Current Level:            Level ${levelInfo.currentLevel} (${levelInfo.tierTitle})`);
    console.log(`  Level Progress:           ${levelInfo.currentLevelXp} / ${levelInfo.xpRequiredForNextLevel} XP (${levelInfo.progressPercentage}%)`);
    console.log(`  Current Streak:           ${profile?.currentStreak ?? 0} days (Longest: ${profile?.longestStreak ?? 0})`);
    console.log(`  Last Qualified Date:      ${profile?.lastQualifiedDate ?? 'None'}`);
    console.log(`  Consistency Score:        ${consistencyScore.score}% (Provisional: ${consistencyScore.isProvisional}, Samples: ${consistencyScore.sampleCount})`);
    console.log('='.repeat(65));
    console.log('MVP Seed completed successfully.');
  } finally {
    await dataSource.destroy();
  }
}

// Auto-run if executed directly via CLI
if (require.main === module) {
  runMvpSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed execution failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
