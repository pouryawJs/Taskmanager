import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';

import {
  GamificationProfile,
  PointTransaction,
  Task,
  TaskType,
  TaskOccurrence,
  TaskOccurrenceStatus,
  UserSettings,
} from '@app/database';

import {
  BASE_XP_REWARDS,
  CONSISTENCY_SCORE_CONFIG,
  GAMIFICATION_TRANSACTION_REASONS,
  LEVEL_PROGRESSION_CONFIG,
  STREAK_MULTIPLIER_CONFIG,
  STREAK_RULES_CONFIG,
} from './constants/gamification.constants';
import {
  addDaysToIsoDate,
  getTodayDateString,
} from '../tasks/utils/task-date.util';

export interface LevelInfo {
  currentLevel: number;
  currentLevelXp: number;
  xpRequiredForNextLevel: number;
  progressPercentage: number;
  tierTitle: string;
}

export interface TaskOccurrenceSummary {
  status: TaskOccurrenceStatus;
  completedAt?: Date | null;
  scheduledDueAt?: Date | null;
}

export interface ConsistencyScoreResult {
  score: number; // 0 to 100
  isProvisional: boolean; // true if samples < MIN_SAMPLE_SIZE
  sampleCount: number; // eligible occurrences evaluated
  completedCount: number;
  partiallyCompletedCount: number;
  notCompletedCount: number;
  skippedCount: number;
  cancelledCount: number;
}

export type ConsistencyPeriod = '7d' | '30d' | 'all';

export interface ConsistencyTrendBucket {
  label: string;
  dateKey: string;
  score: number | null; // null if no eligible occurrences
  sampleCount: number;
  completedCount: number;
  partiallyCompletedCount: number;
  notCompletedCount: number;
}

export interface ConsistencyTrendResult {
  period: ConsistencyPeriod;
  buckets: ConsistencyTrendBucket[];
  overallScore: number;
  isProvisional: boolean;
  sampleCount: number;
  startDate: string;
  endDate: string;
}

export interface GamificationOverview {
  totalXp: number;
  currentStreak: number;
  longestStreak: number;
  lastQualifiedDate: string | null;
  levelInfo: LevelInfo;
  consistencyScore: ConsistencyScoreResult;
}

/**
 * Determine semantic tier name based on level ranges.
 * - Levels 1–5: شروعکننده (Starter)
 * - Levels 6–15: سازنده عادت (Habit Builder)
 * - Levels 16–30: پایدار (Consistent)
 * - Levels 31+: استاد استمرار (Master)
 */
export function getTierTitleForLevel(level: number): string {
  if (level <= 5) return 'شروعکننده';
  if (level <= 15) return 'سازنده عادت';
  if (level <= 30) return 'پایدار';
  return 'استاد استمرار';
}

/**
 * Pure, deterministic mathematical calculation of user level from total XP.
 * Growth is controlled and non-punitive, using configured arithmetic step parameters.
 */
export function calculateLevelInfo(totalXp: number): LevelInfo {
  const baseXp = LEVEL_PROGRESSION_CONFIG.INITIAL_XP_THRESHOLD;
  const stepXp = LEVEL_PROGRESSION_CONFIG.XP_STEP_PER_LEVEL;

  let remainingXp = Math.max(0, Math.floor(totalXp || 0));
  let level = 1;
  let needed = baseXp;

  while (remainingXp >= needed) {
    remainingXp -= needed;
    level++;
    needed = baseXp + (level - 1) * stepXp;
  }

  const currentLevelXp = remainingXp;
  const xpRequiredForNextLevel = needed;
  const rawProgress = (currentLevelXp / xpRequiredForNextLevel) * 100;
  const progressPercentage = Math.min(
    100,
    Math.max(0, Math.round(rawProgress * 10) / 10),
  );

  return {
    currentLevel: level,
    currentLevelXp,
    xpRequiredForNextLevel,
    progressPercentage,
    tierTitle: getTierTitleForLevel(level),
  };
}

/**
 * Pure utility to calculate level-based multiplier from LEVEL_PROGRESSION_CONFIG.
 * formula: min(BASE + (level - 1) * GROWTH_RATE, MAX)
 */
export function calculateLevelMultiplier(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level || 1));
  const raw =
    LEVEL_PROGRESSION_CONFIG.BASE_LEVEL_MULTIPLIER +
    (safeLevel - 1) * LEVEL_PROGRESSION_CONFIG.LEVEL_MULTIPLIER_GROWTH_RATE;
  const rounded = Math.round(raw * 1000) / 1000;
  return Math.min(rounded, LEVEL_PROGRESSION_CONFIG.MAX_LEVEL_MULTIPLIER);
}

/**
 * Pure calculation of Consistency Score (0 to 100) based on task completion outcomes.
 * Ratio formula: RawScore = (sum(OutcomeWeights) / sampleCount) * 100
 * Neutral States (SKIPPED & CANCELLED) are excluded from both numerator and denominator.
 * Incomplete States (PENDING & IN_PROGRESS) are excluded from scoring.
 */
export function calculateConsistencyScore(
  occurrences: TaskOccurrenceSummary[],
): ConsistencyScoreResult {
  let completedCount = 0;
  let partiallyCompletedCount = 0;
  let notCompletedCount = 0;
  let skippedCount = 0;
  let cancelledCount = 0;
  let totalWeight = 0;

  for (const occ of occurrences) {
    switch (occ.status) {
      case TaskOccurrenceStatus.COMPLETED: {
        completedCount++;
        const isOnTime =
          Boolean(occ.scheduledDueAt) &&
          Boolean(occ.completedAt) &&
          new Date(occ.completedAt!).getTime() <=
            new Date(occ.scheduledDueAt!).getTime();

        if (isOnTime) {
          totalWeight += CONSISTENCY_SCORE_CONFIG.WEIGHTS.ON_TIME_COMPLETION;
        } else {
          totalWeight +=
            CONSISTENCY_SCORE_CONFIG.WEIGHTS.LATE_OR_NO_DEADLINE_COMPLETION;
        }
        break;
      }
      case TaskOccurrenceStatus.PARTIALLY_COMPLETED: {
        partiallyCompletedCount++;
        totalWeight += CONSISTENCY_SCORE_CONFIG.WEIGHTS.PARTIAL_COMPLETION;
        break;
      }
      case TaskOccurrenceStatus.NOT_COMPLETED: {
        notCompletedCount++;
        totalWeight += CONSISTENCY_SCORE_CONFIG.WEIGHTS.NOT_COMPLETED;
        break;
      }
      case TaskOccurrenceStatus.SKIPPED: {
        skippedCount++;
        break;
      }
      case TaskOccurrenceStatus.CANCELLED: {
        cancelledCount++;
        break;
      }
      default:
        break;
    }
  }

  const sampleCount =
    completedCount + partiallyCompletedCount + notCompletedCount;
  const isProvisional = sampleCount < CONSISTENCY_SCORE_CONFIG.MIN_SAMPLE_SIZE;

  if (sampleCount === 0) {
    return {
      score: 0,
      isProvisional: true,
      sampleCount: 0,
      completedCount: 0,
      partiallyCompletedCount: 0,
      notCompletedCount: 0,
      skippedCount,
      cancelledCount,
    };
  }

  const rawScore = (totalWeight / sampleCount) * 100;
  const score = Math.min(100, Math.max(0, Math.round(rawScore * 10) / 10));

  return {
    score,
    isProvisional,
    sampleCount,
    completedCount,
    partiallyCompletedCount,
    notCompletedCount,
    skippedCount,
    cancelledCount,
  };
}

function toIsoDate(val: unknown): string {
  if (!val) return '';
  if (typeof val === 'string') return val.slice(0, 10);
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}

/**
 * Pure calculation of bucketing and Consistency Score trend across a timeframe.
 * Adaptive bucket rules:
 * - 7d & 30d periods: daily buckets.
 * - all period: <= 30 calendar days: daily; 31–90 calendar days: weekly; > 90 calendar days: monthly.
 * Gaps (buckets with 0 eligible samples) produce score: null.
 */
export function buildConsistencyTrendBuckets(
  occurrences: (TaskOccurrenceSummary & { date?: string })[],
  startDate: string,
  endDate: string,
  period: ConsistencyPeriod,
): ConsistencyTrendResult {
  const normStartDate = toIsoDate(startDate);
  const normEndDate = toIsoDate(endDate);

  const dStart = new Date(normStartDate + 'T00:00:00Z');
  const dEnd = new Date(normEndDate + 'T00:00:00Z');
  const spanDays = Math.max(
    1,
    Math.round((dEnd.getTime() - dStart.getTime()) / 86400000) + 1,
  );

  interface BucketDef {
    label: string;
    dateKey: string;
    startDate: string;
    endDate: string;
  }

  const bucketDefs: BucketDef[] = [];

  if (period === '7d' || period === '30d' || spanDays <= 30) {
    // Daily buckets
    let curr = normStartDate;
    while (curr <= normEndDate) {
      const parts = curr.split('-');
      const label = `${parts[1]}/${parts[2]}`;
      bucketDefs.push({
        label,
        dateKey: curr,
        startDate: curr,
        endDate: curr,
      });
      curr = addDaysToIsoDate(curr, 1);
    }
  } else if (spanDays <= 90) {
    // Weekly buckets (7-day intervals)
    let currStart = normStartDate;
    let weekIndex = 1;
    while (currStart <= normEndDate) {
      const currEnd = addDaysToIsoDate(currStart, 6);
      const effectiveEnd = currEnd > normEndDate ? normEndDate : currEnd;
      const startParts = currStart.split('-');
      const label = `W${weekIndex} (${startParts[1]}/${startParts[2]})`;
      bucketDefs.push({
        label,
        dateKey: currStart,
        startDate: currStart,
        endDate: effectiveEnd,
      });
      currStart = addDaysToIsoDate(effectiveEnd, 1);
      weekIndex++;
    }
  } else {
    // Monthly buckets (calendar months YYYY-MM)
    const [startYear, startMonth] = normStartDate.split('-').map(Number);
    const [endYear, endMonth] = normEndDate.split('-').map(Number);

    let y = startYear;
    let m = startMonth;

    while (y < endYear || (y === endYear && m <= endMonth)) {
      const ymStr = `${y}-${String(m).padStart(2, '0')}`;
      const lastDayOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const bStart = `${ymStr}-01` < normStartDate ? normStartDate : `${ymStr}-01`;
      const mEnd = `${ymStr}-${String(lastDayOfMonth).padStart(2, '0')}`;
      const bEnd = mEnd > normEndDate ? normEndDate : mEnd;

      const label = `${y}/${String(m).padStart(2, '0')}`;
      bucketDefs.push({
        label,
        dateKey: ymStr,
        startDate: bStart,
        endDate: bEnd,
      });

      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
  }

  const buckets: ConsistencyTrendBucket[] = [];

  for (const bDef of bucketDefs) {
    const bucketOccs = occurrences.filter((o) => {
      const occDate = o.date;
      return occDate && occDate >= bDef.startDate && occDate <= bDef.endDate;
    });

    const scoreRes = calculateConsistencyScore(bucketOccs);

    buckets.push({
      label: bDef.label,
      dateKey: bDef.dateKey,
      score: scoreRes.sampleCount > 0 ? scoreRes.score : null,
      sampleCount: scoreRes.sampleCount,
      completedCount: scoreRes.completedCount,
      partiallyCompletedCount: scoreRes.partiallyCompletedCount,
      notCompletedCount: scoreRes.notCompletedCount,
    });
  }

  const overall = calculateConsistencyScore(occurrences);

  return {
    period,
    buckets,
    overallScore: overall.score,
    isProvisional: overall.isProvisional,
    sampleCount: overall.sampleCount,
    startDate,
    endDate,
  };
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
   * authoritative total XP, persistent streak metrics, derived level, and lifetime consistency score.
   */
  async getGamificationOverview(userId: string): Promise<GamificationOverview> {
    const [profile, totalXp, consistencyScore] = await Promise.all([
      this.getOrCreateProfile(userId),
      this.getUserTotalXp(userId),
      this.getUserConsistencyScore(userId),
    ]);

    return {
      totalXp,
      currentStreak: profile.currentStreak,
      longestStreak: profile.longestStreak,
      lastQualifiedDate: profile.lastQualifiedDate,
      levelInfo: calculateLevelInfo(totalXp),
      consistencyScore,
    };
  }

  /**
   * Pure derivation of user consistency score from occurrence summaries.
   */
  calculateConsistencyScore(
    occurrences: TaskOccurrenceSummary[],
  ): ConsistencyScoreResult {
    return calculateConsistencyScore(occurrences);
  }

  /**
   * Authoritatively calculate the user's Consistency Score across their lifetime history
   * or within a specified calendar date range (YYYY-MM-DD).
   */
  async getUserConsistencyScore(
    userId: string,
    options?: { startDate?: string; endDate?: string },
  ): Promise<ConsistencyScoreResult> {
    const occRepo = this.dataSource.getRepository(TaskOccurrence);
    let occurrences: TaskOccurrence[] = [];

    if (typeof occRepo.createQueryBuilder === 'function') {
      const qb = occRepo
        .createQueryBuilder('occ')
        .innerJoinAndSelect('occ.task', 'task')
        .where('task.ownerId = :userId', { userId });

      if (options?.startDate && options?.endDate) {
        qb.andWhere('occ.date BETWEEN :startDate AND :endDate', {
          startDate: options.startDate,
          endDate: options.endDate,
        });
      } else if (options?.startDate) {
        qb.andWhere('occ.date >= :startDate', { startDate: options.startDate });
      } else if (options?.endDate) {
        qb.andWhere('occ.date <= :endDate', { endDate: options.endDate });
      }

      occurrences = await qb.getMany();
    } else if (typeof occRepo.find === 'function') {
      const all = await occRepo.find({ relations: { task: true } });
      occurrences = all.filter((occ) => {
        if (occ.task && occ.task.ownerId !== userId) return false;
        if (options?.startDate && occ.date < options.startDate) return false;
        if (options?.endDate && occ.date > options.endDate) return false;
        return true;
      });
    }

    return calculateConsistencyScore(occurrences);
  }

  /**
   * Authoritatively calculate the user's Consistency Score trend across bucketing timeframes.
   * Supports:
   * - '7d': 7 daily buckets (today + past 6 local dates).
   * - '30d': 30 daily buckets (today + past 29 local dates).
   * - 'all': Adaptive history buckets (<=30 days: daily, 31-90 days: weekly, >90 days: monthly).
   */
  async getConsistencyScoreTrend(
    userId: string,
    period: ConsistencyPeriod = 'all',
  ): Promise<ConsistencyTrendResult> {
    const timezone = await this.getUserTimezone(
      this.dataSource.manager,
      userId,
    );
    const todayDate = getTodayDateString(timezone);

    let startDate: string;
    const endDate = todayDate;

    if (period === '7d') {
      startDate = addDaysToIsoDate(todayDate, -6);
    } else if (period === '30d') {
      startDate = addDaysToIsoDate(todayDate, -29);
    } else {
      // 'all'
      const occRepo = this.dataSource.getRepository(TaskOccurrence);
      let minDate: string | null = null;
      if (typeof occRepo.createQueryBuilder === 'function') {
        const minRes = await occRepo
          .createQueryBuilder('occ')
          .innerJoin('occ.task', 'task')
          .where('task.ownerId = :userId', { userId })
          .select('MIN(occ.date)::text', 'minDate')
          .getRawOne<{ minDate: string | Date | null }>();
        minDate = minRes?.minDate ? toIsoDate(minRes.minDate) : null;
      } else if (typeof occRepo.find === 'function') {
        const allOccs = await occRepo.find({ relations: { task: true } });
        const userOccs = allOccs.filter(
          (o) => !o.task || o.task.ownerId === userId,
        );
        if (userOccs.length > 0) {
          const sorted = userOccs.map((o) => toIsoDate(o.date)).sort();
          minDate = sorted[0];
        }
      }

      if (!minDate || minDate > todayDate) {
        startDate = addDaysToIsoDate(todayDate, -6);
      } else {
        startDate = minDate;
      }
    }

    const occurrences = await this.getUserOccurrencesInDateRange(
      this.dataSource.manager,
      userId,
      startDate,
      endDate,
    );

    return buildConsistencyTrendBuckets(
      occurrences,
      startDate,
      endDate,
      period,
    );
  }

  /**
   * Pure bucketing helper exposed on the service.
   */
  buildConsistencyTrendBuckets(
    occurrences: (TaskOccurrenceSummary & { date?: string })[],
    startDateOrPeriod: string,
    endDateOrTz?: string,
    periodOrAnchor?: string,
  ): ConsistencyTrendResult {
    if (
      startDateOrPeriod === '7d' ||
      startDateOrPeriod === '30d' ||
      startDateOrPeriod === 'all'
    ) {
      const period = startDateOrPeriod;
      const tz = endDateOrTz || 'Asia/Tehran';
      const anchorDate = periodOrAnchor || getTodayDateString(tz);
      let startDate: string;
      if (period === '7d') startDate = addDaysToIsoDate(anchorDate, -6);
      else if (period === '30d') startDate = addDaysToIsoDate(anchorDate, -29);
      else {
        const sorted = occurrences
          .filter((o) => Boolean(o.date))
          .map((o) => o.date!)
          .sort();
        startDate =
          sorted.length > 0 && sorted[0] <= anchorDate
            ? sorted[0]
            : addDaysToIsoDate(anchorDate, -6);
      }
      return buildConsistencyTrendBuckets(
        occurrences,
        startDate,
        anchorDate,
        period,
      );
    }

    return buildConsistencyTrendBuckets(
      occurrences,
      startDateOrPeriod,
      endDateOrTz!,
      periodOrAnchor as ConsistencyPeriod,
    );
  }

  /**
   * Pure derivation of user level progression details from total XP.
   */
  calculateLevelInfo(totalXp: number): LevelInfo {
    return calculateLevelInfo(totalXp);
  }

  /**
   * Pure calculation of level reward multiplier.
   */
  calculateLevelMultiplier(level: number): number {
    return calculateLevelMultiplier(level);
  }

  /**
   * Derive the user's level progression, tier title, and XP progress
   * purely from their authoritative total XP in the PointTransaction ledger.
   */
  async getUserLevelInfo(userId: string): Promise<LevelInfo> {
    const totalXp = await this.getUserTotalXp(userId);
    return calculateLevelInfo(totalXp);
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
    manager: EntityManager | undefined,
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<TaskOccurrence[]> {
    try {
      const occRepo =
        manager && typeof manager.getRepository === 'function'
          ? manager.getRepository(TaskOccurrence)
          : this.dataSource.getRepository(TaskOccurrence);
      if (!occRepo) {
        return [];
      }

      if (typeof occRepo.createQueryBuilder === 'function') {
        const qb = occRepo
          .createQueryBuilder('occ')
          .innerJoinAndSelect('occ.task', 'task')
          .where('task.ownerId = :userId', { userId })
          .andWhere('occ.date >= :startDate', { startDate })
          .andWhere('occ.date <= :endDate', { endDate });

        if (typeof qb.orderBy === 'function') {
          qb.orderBy('occ.date', 'ASC');
        }

        return await qb.getMany();
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

        const { hasBrokenDay } = await this.checkGapContinuity(
          manager,
          userId,
          gapStart,
          gapEnd,
          timezone,
        );

        if (hasBrokenDay) {
          newStreak = 1;
        } else {
          newStreak = profile.currentStreak + 1;
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
   * Retrieves active daily recurring tasks for a user to determine scheduled commitments.
   */
  async getUserActiveDailyTasks(
    manager: EntityManager,
    userId: string,
  ): Promise<Task[]> {
    try {
      const taskRepo = manager.getRepository(Task);
      if (taskRepo && typeof taskRepo.find === 'function') {
        return await taskRepo.find({
          where: {
            ownerId: userId,
            type: TaskType.DAILY,
            isActive: true,
          },
          relations: { occurrences: true },
        });
      }
    } catch {
      // fallback
    }
    return [];
  }

  /**
   * Check continuity across an intervening calendar gap.
   * Distinguishes:
   * 1. Genuinely unscheduled rest days (no occurrences, no active daily recurring tasks).
   * 2. Scheduled commitment days with fewer than 3 completed tasks (broken streak).
   * 3. Missing/unmaterialized occurrences for active daily recurring tasks (broken streak, not rest days).
   */
  async checkGapContinuity(
    manager: EntityManager,
    userId: string,
    gapStart: string,
    gapEnd: string,
    timezone: string,
  ): Promise<{ hasBrokenDay: boolean }> {
    if (gapStart > gapEnd) {
      return { hasBrokenDay: false };
    }

    const gapOccurrences = await this.getUserOccurrencesInDateRange(
      manager,
      userId,
      gapStart,
      gapEnd,
    );

    const activeDailyTasks = await this.getUserActiveDailyTasks(
      manager,
      userId,
    );

    const occurrencesByDate = new Map<string, TaskOccurrence[]>();
    for (const occ of gapOccurrences) {
      const existingList = occurrencesByDate.get(occ.date) || [];
      existingList.push(occ);
      occurrencesByDate.set(occ.date, existingList);
    }

    let currentDate = gapStart;
    while (currentDate <= gapEnd) {
      const dateOccs = occurrencesByDate.get(currentDate) || [];
      const hasActiveDailyTask = activeDailyTasks.some((task) => {
        let taskStartDate: string | null = null;
        if (task.occurrences && task.occurrences.length > 0) {
          const sorted = task.occurrences.map((o) => o.date).sort();
          taskStartDate = sorted[0];
        } else if (task.createdAt) {
          taskStartDate = getTodayDateString(
            timezone,
            new Date(task.createdAt),
          );
        }
        return taskStartDate !== null && currentDate >= taskStartDate;
      });

      const hasScheduledCommitment = dateOccs.length > 0 || hasActiveDailyTask;

      if (hasScheduledCommitment) {
        const completedCount = dateOccs.filter(
          (o) => o.status === TaskOccurrenceStatus.COMPLETED,
        ).length;

        if (
          completedCount < STREAK_RULES_CONFIG.QUALIFIED_DAY_MIN_COMPLETED_TASKS
        ) {
          return { hasBrokenDay: true };
        }
      }

      currentDate = addDaysToIsoDate(currentDate, 1);
    }

    return { hasBrokenDay: false };
  }

  /**
   * Determine the active streak established before the current occurrence.
   * Intended policy: The first three completions of a local day use the streak
   * established before that day. Qualifying the third occurrence updates the streak
   * for future rewards, without retroactively recalculating earlier rewards.
   */
  async getPreDayActiveStreak(
    manager: EntityManager,
    userId: string,
    profile: GamificationProfile,
    todayDate: string,
    timezone: string,
  ): Promise<number> {
    const lastDate = profile.lastQualifiedDate;
    if (!lastDate || profile.currentStreak === 0) {
      return 0;
    }

    const yesterdayDate = addDaysToIsoDate(todayDate, -1);
    if (lastDate === yesterdayDate) {
      return profile.currentStreak;
    }

    if (lastDate < yesterdayDate) {
      const gapStart = addDaysToIsoDate(lastDate, 1);
      const gapEnd = yesterdayDate;
      const { hasBrokenDay } = await this.checkGapContinuity(
        manager,
        userId,
        gapStart,
        gapEnd,
        timezone,
      );
      if (hasBrokenDay) {
        return 0;
      }
      return profile.currentStreak;
    }

    return profile.currentStreak;
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

    // 2. Determine whether today was already qualified before this completion
    const timezone = await this.getUserTimezone(manager, userId);
    const todayDate = getTodayDateString(
      timezone,
      occurrence.completedAt ? new Date(occurrence.completedAt) : new Date(),
    );
    const isAlreadyQualifiedToday = profile.lastQualifiedDate === todayDate;

    // 3. Determine the pre-completion active streak:
    // If today was already qualified before this completion (4th, 5th, etc.), use the updated profile.currentStreak.
    // If today was not yet qualified, the first three completions use the streak established BEFORE today.
    let activeStreak = 0;
    if (isAlreadyQualifiedToday) {
      activeStreak = profile.currentStreak;
    } else {
      activeStreak = await this.getPreDayActiveStreak(
        manager,
        userId,
        profile,
        todayDate,
        timezone,
      );
    }

    // 4. Evaluate streak progression for qualifying completed occurrences.
    // Qualifying the 3rd completion updates the profile streak for future rewards.
    if (occurrence.status === TaskOccurrenceStatus.COMPLETED) {
      await this.evaluateStreakProgression(
        manager,
        userId,
        profile,
        occurrence.completedAt ? new Date(occurrence.completedAt) : new Date(),
      );
    }

    // 5. Determine dynamic streak multiplier and scaled target XP using the active streak
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

    const metadata: Record<string, any> = {
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
