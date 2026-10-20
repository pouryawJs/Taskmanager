import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';

import {
  GamificationProfile,
  PointTransaction,
  TaskOccurrence,
  TaskOccurrenceStatus,
} from '@app/database';

import {
  BASE_XP_REWARDS,
  GAMIFICATION_TRANSACTION_REASONS,
} from './constants/gamification.constants';

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
   */
  async getOrCreateProfile(userId: string): Promise<GamificationProfile> {
    const existing = await this.getProfile(userId);
    if (existing) {
      return existing;
    }

    const repo = this.dataSource.getRepository(GamificationProfile);
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
        const loaded = await this.getProfile(userId);
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
   * Atomically and idempotently award XP for a finalized task occurrence within an ongoing transaction.
   * Uses ON CONFLICT DO NOTHING to guarantee that concurrent requests, Telegram retries,
   * or repeated status transitions never abort the PostgreSQL transaction or award duplicate XP.
   */
  async awardTaskOccurrenceXp(
    manager: EntityManager,
    occurrence: TaskOccurrence,
    userId: string,
  ): Promise<AwardTaskXpResult> {
    const { targetXp, timing, isEligible } =
      this.calculateOccurrenceCompletionXp(occurrence);

    if (!isEligible || targetXp <= 0) {
      return {
        awarded: false,
        pointsDelta: 0,
        reason: GAMIFICATION_TRANSACTION_REASONS.TASK_COMPLETION,
        idempotencyKey: '',
        timing,
      };
    }

    const idempotencyKey = this.buildTaskOccurrenceIdempotencyKey(
      occurrence.id,
      occurrence.status,
    );

    const pointTxRepo = manager.getRepository(PointTransaction);

    // 1. In-transaction query to check for existing XP already awarded to this occurrence
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
      targetXp,
      alreadyAwardedXp,
      streakMultiplier: 1.0, // Base XP only for Phase 2; streak multiplier deferred
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
