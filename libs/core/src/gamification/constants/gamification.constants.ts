/**
 * Gamification System Constants — Phase 1 Foundation
 *
 * Centralized, configurable parameters for XP rewards, streak multipliers,
 * progressive leveling curves, and performance score boundaries.
 *
 * NOTE: These values are provisional defaults for calibration and tuning.
 * Business formulas consuming these constants will be implemented in subsequent phases.
 */

/**
 * Base XP awarded for discrete task occurrence completion outcomes.
 *
 * NOTE on completion timing:
 * `scheduledDueAt` is nullable on TaskOccurrence.
 * - ON_TIME_COMPLETION applies when an occurrence with an explicit deadline (`scheduledDueAt`)
 *   is completed on or before that deadline (`completedAt <= scheduledDueAt`).
 * - LATE_COMPLETION applies when completed after that explicit deadline (`completedAt > scheduledDueAt`).
 * - If `scheduledDueAt` is NULL (e.g. untimed tasks or start-time-only tasks), no reliable completion
 *   deadline exists in the database. Product policy for classifying deadline-less completions
 *   must be explicitly decided in Phase 2 rather than inventing an artificial deadline.
 */
export const BASE_XP_REWARDS = {
  /** Occurrence completed on or before verified deadline */
  ON_TIME_COMPLETION: 10,
  /** Occurrence completed after verified deadline */
  LATE_COMPLETION: 7,
  /** Occurrence marked as partially completed */
  PARTIAL_COMPLETION: 4,
  /** Occurrence timed out or marked not completed */
  NOT_COMPLETED: 0,
  /** Occurrence skipped for the scheduled date */
  SKIPPED: 0,
  /** Occurrence cancelled */
  CANCELLED: 0,
} as const;

export type BaseXpRewardType = keyof typeof BASE_XP_REWARDS;

/**
 * Streak multiplier configuration parameters.
 *
 * Provisional tuning values only. Intended formula for future implementation:
 *   min(BASE_MULTIPLIER + qualifiedStreakDays * DAILY_INCREMENT, MAXIMUM_MULTIPLIER)
 */
export const STREAK_MULTIPLIER_CONFIG = {
  /** Baseline multiplier for day 0 or 1 */
  BASE_MULTIPLIER: 1.0,
  /** Additional multiplier bonus per consecutive qualified day */
  DAILY_INCREMENT: 0.02,
  /** Maximum attainable streak multiplier cap */
  MAXIMUM_MULTIPLIER: 1.5,
} as const;

/**
 * Progressive leveling curve parameters.
 *
 * NOTE: These are provisional configuration values ONLY, not a finalized algorithm.
 * The leveling curve must be reviewed and calibrated before implementation to guarantee
 * achievable progression and controlled growth across higher levels.
 */
export const LEVEL_PROGRESSION_CONFIG = {
  /** Provisional initial XP threshold required to advance from Level 1 to Level 2 */
  INITIAL_XP_THRESHOLD: 50,
  /** Provisional growth parameter for XP required by subsequent levels */
  XP_GROWTH_FACTOR: 1.25,
  /** Provisional baseline XP reward multiplier at Level 1 */
  BASE_LEVEL_MULTIPLIER: 1.0,
  /** Provisional increment added to reward multiplier per level gained */
  LEVEL_MULTIPLIER_GROWTH_RATE: 0.01,
  /** Provisional maximum level reward multiplier cap */
  MAX_LEVEL_MULTIPLIER: 2.0,
} as const;

/**
 * Qualification rules for streak tracking.
 *
 * NOTE: Streak logic is NOT implemented in Phase 1. The profile fields store persistent counters.
 * Future logic must evaluate local calendar days using the user's configured timezone and count
 * distinct completed occurrences. Days without scheduled occurrences must be distinguished from
 * days with scheduled tasks that failed to meet the threshold.
 */
export const STREAK_RULES_CONFIG = {
  /** Minimum number of distinct TaskOccurrences completed in a local calendar day to qualify as a useful day */
  QUALIFIED_DAY_MIN_COMPLETED_TASKS: 3,
} as const;

/**
 * Consistency Score configuration boundaries and provisional reporting thresholds.
 *
 * NOTE: MIN_SAMPLE_SIZE is a provisional default and has NOT been approved as a product rule.
 * It is kept configurable so it does not prematurely constrain lifetime-history scoring.
 */
export const CONSISTENCY_SCORE_CONFIG = {
  /** Lower bound of Consistency Score */
  MIN_SCORE: 0,
  /** Upper bound of Consistency Score */
  MAX_SCORE: 100,
  /** Provisional sample size threshold; unapproved and subject to product calibration */
  MIN_SAMPLE_SIZE: 5,
} as const;

/** Alias for backward compatibility */
export const PERFORMANCE_SCORE_CONFIG = CONSISTENCY_SCORE_CONFIG;

/**
 * Standard business reason codes for PointTransaction records.
 */
export const GAMIFICATION_TRANSACTION_REASONS = {
  TASK_COMPLETION: 'task_completion',
  STREAK_BONUS: 'streak_bonus',
  LEVEL_UP_BONUS: 'level_up_bonus',
  MANUAL_ADJUSTMENT: 'manual_adjustment',
  REVERSAL: 'reversal',
} as const;

export type GamificationTransactionReason =
  (typeof GAMIFICATION_TRANSACTION_REASONS)[keyof typeof GAMIFICATION_TRANSACTION_REASONS];
