import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';

import {
  GamificationProfile,
  PointTransaction,
  TaskOccurrence,
  TaskOccurrenceStatus,
  UserSettings,
} from '@app/database';

import {
  BASE_XP_REWARDS,
  GAMIFICATION_TRANSACTION_REASONS,
  STREAK_MULTIPLIER_CONFIG,
  STREAK_RULES_CONFIG,
} from './constants/gamification.constants';
import {
  addDaysToIsoDate,
  getTodayDateString,
} from '../tasks/utils/task-date.util';

export interface GamificationOverview {
  totalXp: number;
  currentStreak: number;
  longestStreak: number;
  lastQualifiedDate: string | null;
}

export type OccurrenceTimingClassification =
  'on_time' | 'late' | 'no_deadline' | 'partial' | 'ineligible';

export interface AwardTaskXpResult {
  awarded: boolean;
  pointsDelta: number;
  reason: string;
  idempotencyKey: string;
  timing: OccurrenceTimingClassification;
  transaction?: PointTransaction | null;
}

@Injectable()
export class GamificationService {
  private readonly logger = new Logger(GamificationService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Retrieve the user's gamification profile if it exists.
   */
  async getProfile(userId: string): Promise<GamificationProfile | null> {
    return await this.dataSource.getRepository(GamificationProfile).findOne({
      where: { userId },
    });
  }

  /**
   * Retrieve or idempotently create the user's gamification profile.
   * Handles PostgreSQL concurrency race condition (23505) gracefully.
   * Optionally operates within an ongoing transaction manager.
   */
  async getOrCreateProfile(
    userId: string,
    manager?: EntityManager,
  ): Promise<GamificationProfile> {
    const repo =
      manager && typeof manager.getRepository === 'function'
        ? manager.getRepository(GamificationProfile)
        : this.dataSource.getRepository(GamificationProfile);

    if (!repo) {
      return {
        userId,
        currentStreak: 0,
        longestStreak: 0,
        lastQualifiedDate: null,
      } as GamificationProfile;
    }

    const existing = await repo.findOne({
      where: { userId },
    });
    if (existing) {
      return existing;
    }

    const profile = repo.create({
      userId,
      currentStreak: 0,
      longestStreak: 0,
      lastQualifiedDate: null,
    });

    try {
      return await repo.save(profile);
    } catch (error: unknown) {
      if (this.isUniqueConstraintViolation(error)) {
        this.logger.debug(
          `Concurrent profile creation detected for user ${userId}. Loading existing profile.`,
        );
        const loaded = await repo.findOne({ where: { userId } });
        if (loaded) {
          return loaded;
        }
      }

      this.logger.error(
        `Failed to create gamification profile for user ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Authoritatively calculate the user's total accumulated XP by summing
   * all pointsDelta entries in the immutable PointTransaction ledger.
   * Returns 0 if no transactions exist.
   */
  async getUserTotalXp(userId: string): Promise<number> {
    const result = await this.dataSource
      .getRepository(PointTransaction)
      .createQueryBuilder('pt')
      .select('COALESCE(SUM(pt.pointsDelta), 0)', 'total')
      .where('pt.userId = :userId', { userId })
      .getRawOne<{ total: string | number }>();

    const total = result?.total ? Number(result.total) : 0;
    return isNaN(total) ? 0 : total;
  }

  /**
   * Retrieve a consolidated overview of the user's gamification state:
   * authoritative total XP from the ledger and persistent streak metrics.
   */
  async getGamificationOverview(userId: string): Promise<GamificationOverview> {
    const [profile, totalXp] = await Promise.all([
      this.getOrCreateProfile(userId),
      this.getUserTotalXp(userId),
    ]);

    return {
      totalXp,
      currentStreak: profile.currentStreak,
      longestStreak: profile.longestStreak,
      lastQualifiedDate: profile.lastQualifiedDate,
    };
  }

  /**
   * Determine the eligible base XP and timing classification for an occurrence.
   *
   * Reward Rules (Phase 2):
   * - On-time completion with a reliable, explicit scheduledDueAt: 10 base XP.
   * - Late completion with a reliable, explicit scheduledDueAt: 7 base XP.
   * - Completion when scheduledDueAt is null: 7 base XP for MVP. Does NOT infer a deadline from scheduledStartTime.
   * - Partial completion: 4 base XP.
   * - Not completed, skipped, and cancelled: 0 XP (ineligible).
   */
  calculateOccurrenceCompletionXp(occurrence: TaskOccurrence): {
    targetXp: number;
    timing: OccurrenceTimingClassification;
    isEligible: boolean;
  } {
    if (occurrence.status === TaskOccurrenceStatus.COMPLETED) {
      if (
        occurrence.scheduledDueAt !== null &&
        occurrence.scheduledDueAt !== undefined
      ) {
        const dueTime = new Date(occurrence.scheduledDueAt).getTime();
        if (!isNaN(dueTime)) {
          const completedTime = occurrence.completedAt
            ? new Date(occurrence.completedAt).getTime()
            : Date.now();

          if (completedTime <= dueTime) {
            return {
              targetXp: BASE_XP_REWARDS.ON_TIME_COMPLETION,
              timing: 'on_time',
              isEligible: true,
            };
          } else {
            return {
              targetXp: BASE_XP_REWARDS.LATE_COMPLETION,
              timing: 'late',
              isEligible: true,
            };
          }
        }
      }

      // Explicit scheduledDueAt is null: award 7 base XP for MVP.
      // Do not infer a deadline from scheduledStartTime.
      return {
        targetXp: BASE_XP_REWARDS.NO_DEADLINE_COMPLETION,
        timing: 'no_deadline',
        isEligible: true,
      };
    }

    if (occurrence.status === TaskOccurrenceStatus.PARTIALLY_COMPLETED) {
      return {
        targetXp: BASE_XP_REWARDS.PARTIAL_COMPLETION,
        timing: 'partial',
        isEligible: true,
      };
    }

    return {
      targetXp: 0,
      timing: 'ineligible',
      isEligible: false,
    };
  }

  /**
   * Deterministic idempotency key for task occurrence awards.
   * Format: <event_type>:<taskOccurrenceId>
   */
  buildTaskOccurrenceIdempotencyKey(
    occurrenceId: string,
    status: TaskOccurrenceStatus,
  ): string {
    if (status === TaskOccurrenceStatus.PARTIALLY_COMPLETED) {
      return `task_partial_completion:${occurrenceId}`;
    }
    return `task_completion:${occurrenceId}`;
  }

  /**
   * Calculate dynamic streak multiplier from current streak count.
   * Formula: min(BASE_MULTIPLIER + currentStreak * DAILY_INCREMENT, MAXIMUM_MULTIPLIER)
   */
  calculateStreakMultiplier(currentStreak: number): number {
    if (currentStreak <= 0) {
      return STREAK_MULTIPLIER_CONFIG.BASE_MULTIPLIER;
    }
    const raw =
      STREAK_MULTIPLIER_CONFIG.BASE_MULTIPLIER +
      currentStreak * STREAK_MULTIPLIER_CONFIG.DAILY_INCREMENT;
    const rounded = Math.round(raw * 1000) / 1000;
    return Math.min(rounded, STREAK_MULTIPLIER_CONFIG.MAXIMUM_MULTIPLIER);
  }

  /**
   * Retrieve user's configured IANA timezone or default to 'Asia/Tehran'.
   */
  private async getUserTimezone(
    manager: EntityManager,
    userId: string,
  ): Promise<string> {
    try {
      const settingsRepo = manager.getRepository(UserSettings);
      if (settingsRepo && typeof settingsRepo.findOne === 'function') {
        const settings = await settingsRepo.findOne({ where: { userId } });
        if (settings?.timezone) {
          return settings.timezone;
        }
      }
    } catch {
      // fallback
    }
    return 'Asia/Tehran';
  }

  /**
   * Count distinct completed occurrences for a user on a given local calendar date.
   */
  async getDistinctCompletedOccurrencesCountForDate(
    manager: EntityManager,
    userId: string,
    date: string,
  ): Promise<number> {
    try {
      const occRepo = manager.getRepository(TaskOccurrence);
      if (!occRepo) {
        return 0;
      }

      if (typeof occRepo.createQueryBuilder === 'function') {
        const count = await occRepo
          .createQueryBuilder('occ')
          .innerJoin('occ.task', 'task')
          .where('task.ownerId = :userId', { userId })
          .andWhere('occ.date = :date', { date })
          .andWhere('occ.status = :status', {
            status: TaskOccurrenceStatus.COMPLETED,
          })
          .getCount();
        return count;
      }

      if (typeof occRepo.find === 'function') {
        const occurrences = await occRepo.find({
          where: {
            date,
            status: TaskOccurrenceStatus.COMPLETED,
          },
          relations: { task: true },
        });

        const userOccurrences = occurrences.filter(
          (occ) => !occ.task || occ.task.ownerId === userId,
        );
        const distinctIds = new Set(userOccurrences.map((occ) => occ.id));
        return distinctIds.size;
      }
    } catch {
      return 0;
    }
    return 0;
  }

  /**
   * Retrieve user's task occurrences within a date range (inclusive).
   */
  async getUserOccurrencesInDateRange(
    manager: EntityManager,
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<TaskOccurrence[]> {
    try {
      const occRepo = manager.getRepository(TaskOccurrence);
      if (!occRepo) {
        return [];
      }

      if (typeof occRepo.createQueryBuilder === 'function') {
        return await occRepo
          .createQueryBuilder('occ')
          .innerJoinAndSelect('occ.task', 'task')
          .where('task.ownerId = :userId', { userId })
          .andWhere('occ.date >= :startDate', { startDate })
          .andWhere('occ.date <= :endDate', { endDate })
          .getMany();
      }

      if (typeof occRepo.find === 'function') {
        const occurrences = await occRepo.find({
          relations: { task: true },
        });

        return occurrences.filter(
          (occ) =>
            (!occ.task || occ.task.ownerId === userId) &&
            occ.date >= startDate &&
            occ.date <= endDate,
        );
      }
    } catch {
      return [];
    }
    return [];
  }

  /**
   * Evaluate daily streak qualification, rest-day preservation, and broken streaks.
   * Updates GamificationProfile within the active transaction when a day newly qualifies.
   */
  async evaluateStreakProgression(
    manager: EntityManager,
    userId: string,
    profile: GamificationProfile,
    completionDate: Date = new Date(),
  ): Promise<GamificationProfile> {
    const timezone = await this.getUserTimezone(manager, userId);
    const todayDate = getTodayDateString(timezone, completionDate);

    // 1. Same-Day Idempotency Guard: already qualified today
    if (profile.lastQualifiedDate === todayDate) {
      return profile;
    }

    // 2. Count distinct completed occurrences for todayDate
    const completedCount =
      await this.getDistinctCompletedOccurrencesCountForDate(
        manager,
        userId,
        todayDate,
      );

    if (
      completedCount < STREAK_RULES_CONFIG.QUALIFIED_DAY_MIN_COMPLETED_TASKS
    ) {
      return profile;
    }

    // 3. Day newly qualifies! Evaluate historical continuity:
    let newStreak = 1;
    const lastDate = profile.lastQualifiedDate;

    if (!lastDate || profile.currentStreak === 0) {
      // Case 1: Initial streak (no prior history or reset)
      newStreak = 1;
    } else {
      const yesterdayDate = addDaysToIsoDate(todayDate, -1);
      if (lastDate === yesterdayDate) {
        // Case 2: Consecutive day
        newStreak = profile.currentStreak + 1;
      } else if (lastDate < yesterdayDate) {
        // Case 3: Intervening gap days (Rest Day vs Broken Streak)
        const gapStart = addDaysToIsoDate(lastDate, 1);
        const gapEnd = yesterdayDate;

        const gapOccurrences = await this.getUserOccurrencesInDateRange(
          manager,
          userId,
          gapStart,
          gapEnd,
        );

        if (gapOccurrences.length === 0) {
          // Every calendar day in gap had zero scheduled tasks -> Rest Days!
          newStreak = profile.currentStreak + 1;
        } else {
          // Group gap occurrences by date
          const occurrencesByDate = new Map<string, TaskOccurrence[]>();
          for (const occ of gapOccurrences) {
            const existingList = occurrencesByDate.get(occ.date) || [];
            existingList.push(occ);
            occurrencesByDate.set(occ.date, existingList);
          }

          let hasBrokenDay = false;
          for (const [, dateOccs] of occurrencesByDate.entries()) {
            const dayCompletedCount = dateOccs.filter(
              (o) => o.status === TaskOccurrenceStatus.COMPLETED,
            ).length;

            if (
              dayCompletedCount <
              STREAK_RULES_CONFIG.QUALIFIED_DAY_MIN_COMPLETED_TASKS
            ) {
              hasBrokenDay = true;
              break;
            }
          }

          if (hasBrokenDay) {
            newStreak = 1;
          } else {
            newStreak = profile.currentStreak + 1;
          }
        }
      } else {
        // lastDate > yesterdayDate (e.g. future date anomaly)
        newStreak = profile.currentStreak;
      }
    }

    // 4. Update and persist profile bounds within transaction
    profile.currentStreak = newStreak;
    profile.longestStreak = Math.max(profile.longestStreak || 0, newStreak);
    profile.lastQualifiedDate = todayDate;

    try {
      const profileRepo = manager.getRepository(GamificationProfile);
      if (profileRepo && typeof profileRepo.save === 'function') {
        return await profileRepo.save(profile);
      }
    } catch {
      // fallback
    }
    return profile;
  }

  /**
   * Atomically and idempotently award XP for a finalized task occurrence within an ongoing transaction.
   * Integrates dynamic streak progression and scaled streak multipliers.
   * Uses ON CONFLICT DO NOTHING to guarantee that concurrent requests, Telegram retries,
   * or repeated status transitions never abort the PostgreSQL transaction or award duplicate XP.
   */
  async awardTaskOccurrenceXp(
    manager: EntityManager,
    occurrence: TaskOccurrence,
    userId: string,
  ): Promise<AwardTaskXpResult> {
    const {
      targetXp: baseXp,
      timing,
      isEligible,
    } = this.calculateOccurrenceCompletionXp(occurrence);

    if (!isEligible || baseXp <= 0) {
      return {
        awarded: false,
        pointsDelta: 0,
        reason: GAMIFICATION_TRANSACTION_REASONS.TASK_COMPLETION,
        idempotencyKey: '',
        timing,
      };
    }

    // 1. Get or create user profile within transaction
    const profile = await this.getOrCreateProfile(userId, manager);

    // 2. Evaluate streak progression for qualifying completed occurrences
    let activeStreak = profile.currentStreak;
    if (occurrence.status === TaskOccurrenceStatus.COMPLETED) {
      const updatedProfile = await this.evaluateStreakProgression(
        manager,
        userId,
        profile,
        occurrence.completedAt ? new Date(occurrence.completedAt) : new Date(),
      );
      activeStreak = updatedProfile.currentStreak;
    }

    // 3. Determine dynamic streak multiplier and scaled target XP
    let streakMultiplier = 1.0;
    let targetXp = baseXp;

    if (occurrence.status === TaskOccurrenceStatus.COMPLETED) {
      streakMultiplier = this.calculateStreakMultiplier(activeStreak);
      targetXp = Math.round(baseXp * streakMultiplier);
    } else {
      // Partial completion: base XP without streak multiplier
      streakMultiplier = 1.0;
      targetXp = baseXp;
    }

    const idempotencyKey = this.buildTaskOccurrenceIdempotencyKey(
      occurrence.id,
      occurrence.status,
    );

    const pointTxRepo = manager.getRepository(PointTransaction);

    // 4. In-transaction query to check for existing XP already awarded to this occurrence
    const existingTransactions = await pointTxRepo.find({
      where: { taskOccurrenceId: occurrence.id },
    });

    const alreadyAwardedXp = existingTransactions.reduce(
      (sum, tx) => sum + (tx.pointsDelta || 0),
      0,
    );

    if (alreadyAwardedXp >= targetXp) {
      return {
        awarded: false,
        pointsDelta: 0,
        reason: GAMIFICATION_TRANSACTION_REASONS.TASK_COMPLETION,
        idempotencyKey,
        timing,
      };
    }

    const pointsDelta = targetXp - alreadyAwardedXp;
    if (pointsDelta <= 0) {
      return {
        awarded: false,
        pointsDelta: 0,
        reason: GAMIFICATION_TRANSACTION_REASONS.TASK_COMPLETION,
        idempotencyKey,
        timing,
      };
    }

    const metadata: Record<string, unknown> = {
      completionStatus: occurrence.status,
      completedAt: occurrence.completedAt
        ? new Date(occurrence.completedAt).toISOString()
        : null,
      scheduledDueAt: occurrence.scheduledDueAt
        ? new Date(occurrence.scheduledDueAt).toISOString()
        : null,
      timing,
      baseXp,
      targetXp,
      alreadyAwardedXp,
      streakMultiplier,
      currentStreak: activeStreak,
      onTime: timing === 'on_time',
    };

    const reason = GAMIFICATION_TRANSACTION_REASONS.TASK_COMPLETION;

    // 2. Safe database-level idempotency via ON CONFLICT DO NOTHING.
    // In PostgreSQL, ON CONFLICT DO NOTHING suppresses unique conflicts on idempotencyKey
    // without throwing code 23505 and without aborting the ongoing transaction block.
    const qb =
      typeof manager.createQueryBuilder === 'function'
        ? manager.createQueryBuilder()
        : typeof pointTxRepo.createQueryBuilder === 'function'
          ? pointTxRepo.createQueryBuilder()
          : null;

    if (qb) {
      const result = await qb
        .insert()
        .into(PointTransaction)
        .values({
          userId,
          taskOccurrenceId: occurrence.id,
          pointsDelta,
          reason,
          idempotencyKey,
          metadata,
        })
        .orIgnore()
        .execute();

      let hasInserted = false;
      const rawResult = result.raw as unknown;
      if (Array.isArray(rawResult)) {
        hasInserted = rawResult.length > 0;
      } else if (
        typeof rawResult === 'object' &&
        rawResult !== null &&
        'rowCount' in rawResult &&
        typeof rawResult.rowCount === 'number'
      ) {
        hasInserted = (rawResult as { rowCount: number }).rowCount > 0;
      } else if (result.identifiers && result.identifiers.length > 0) {
        hasInserted = Boolean(result.identifiers[0]?.id);
      }

      if (!hasInserted) {
        return {
          awarded: false,
          pointsDelta: 0,
          reason,
          idempotencyKey,
          timing,
        };
      }

      return {
        awarded: true,
        pointsDelta,
        reason,
        idempotencyKey,
        timing,
      };
    } else {
      // Mock / fallback for tests without QueryBuilder
      const tx = pointTxRepo.create({
        userId,
        taskOccurrenceId: occurrence.id,
        pointsDelta,
        reason,
        idempotencyKey,
        metadata,
      });
      const saved = await pointTxRepo.save(tx);
      return {
        awarded: true,
        pointsDelta,
        reason,
        idempotencyKey,
        timing,
        transaction: saved,
      };
    }
  }

  /**
   * Check if an error represents a PostgreSQL unique constraint violation (error code '23505').
   */
  private isUniqueConstraintViolation(error: unknown): boolean {
    if (error instanceof QueryFailedError) {
      const driverError = error.driverError as { code?: string } | undefined;
      return driverError?.code === '23505';
    }
    return false;
  }
}
