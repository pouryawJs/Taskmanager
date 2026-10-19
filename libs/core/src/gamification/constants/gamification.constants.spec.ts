import {
  BASE_XP_REWARDS,
  STREAK_MULTIPLIER_CONFIG,
  LEVEL_PROGRESSION_CONFIG,
  STREAK_RULES_CONFIG,
  CONSISTENCY_SCORE_CONFIG,
  PERFORMANCE_SCORE_CONFIG,
  GAMIFICATION_TRANSACTION_REASONS,
} from './gamification.constants';

describe('Gamification Constants (Phase 1)', () => {
  describe('BASE_XP_REWARDS', () => {
    it('should define provisional rewards for all occurrence completion outcomes', () => {
      expect(BASE_XP_REWARDS.ON_TIME_COMPLETION).toBe(10);
      expect(BASE_XP_REWARDS.LATE_COMPLETION).toBe(7);
      expect(BASE_XP_REWARDS.PARTIAL_COMPLETION).toBe(4);
      expect(BASE_XP_REWARDS.NOT_COMPLETED).toBe(0);
      expect(BASE_XP_REWARDS.SKIPPED).toBe(0);
      expect(BASE_XP_REWARDS.CANCELLED).toBe(0);
    });

    it('should preserve reward hierarchy: on-time > late > partial > incomplete', () => {
      expect(BASE_XP_REWARDS.ON_TIME_COMPLETION).toBeGreaterThan(
        BASE_XP_REWARDS.LATE_COMPLETION,
      );
      expect(BASE_XP_REWARDS.LATE_COMPLETION).toBeGreaterThan(
        BASE_XP_REWARDS.PARTIAL_COMPLETION,
      );
      expect(BASE_XP_REWARDS.PARTIAL_COMPLETION).toBeGreaterThan(
        BASE_XP_REWARDS.NOT_COMPLETED,
      );
    });
  });

  describe('STREAK_MULTIPLIER_CONFIG', () => {
    it('should define base multiplier, daily increment, and maximum multiplier cap', () => {
      expect(STREAK_MULTIPLIER_CONFIG.BASE_MULTIPLIER).toBe(1.0);
      expect(STREAK_MULTIPLIER_CONFIG.DAILY_INCREMENT).toBe(0.02);
      expect(STREAK_MULTIPLIER_CONFIG.MAXIMUM_MULTIPLIER).toBe(1.5);
    });

    it('should have valid mathematical constraints', () => {
      expect(STREAK_MULTIPLIER_CONFIG.DAILY_INCREMENT).toBeGreaterThan(0);
      expect(STREAK_MULTIPLIER_CONFIG.MAXIMUM_MULTIPLIER).toBeGreaterThan(
        STREAK_MULTIPLIER_CONFIG.BASE_MULTIPLIER,
      );
    });
  });

  describe('LEVEL_PROGRESSION_CONFIG', () => {
    it('should define progressive leveling curve parameters', () => {
      expect(LEVEL_PROGRESSION_CONFIG.INITIAL_XP_THRESHOLD).toBe(50);
      expect(LEVEL_PROGRESSION_CONFIG.XP_GROWTH_FACTOR).toBe(1.25);
      expect(LEVEL_PROGRESSION_CONFIG.BASE_LEVEL_MULTIPLIER).toBe(1.0);
      expect(LEVEL_PROGRESSION_CONFIG.LEVEL_MULTIPLIER_GROWTH_RATE).toBe(0.01);
      expect(LEVEL_PROGRESSION_CONFIG.MAX_LEVEL_MULTIPLIER).toBe(2.0);
    });

    it('should configure attainable progression without unbounded spikes', () => {
      expect(LEVEL_PROGRESSION_CONFIG.INITIAL_XP_THRESHOLD).toBeGreaterThan(0);
      expect(LEVEL_PROGRESSION_CONFIG.XP_GROWTH_FACTOR).toBeGreaterThan(1.0);
      expect(LEVEL_PROGRESSION_CONFIG.MAX_LEVEL_MULTIPLIER).toBeGreaterThan(
        LEVEL_PROGRESSION_CONFIG.BASE_LEVEL_MULTIPLIER,
      );
    });
  });

  describe('STREAK_RULES_CONFIG', () => {
    it('should define useful-day qualification threshold of at least 3 distinct completions', () => {
      expect(STREAK_RULES_CONFIG.QUALIFIED_DAY_MIN_COMPLETED_TASKS).toBe(3);
    });
  });

  describe('CONSISTENCY_SCORE_CONFIG / PERFORMANCE_SCORE_CONFIG', () => {
    it('should define consistency score boundaries between 0 and 100', () => {
      expect(CONSISTENCY_SCORE_CONFIG.MIN_SCORE).toBe(0);
      expect(CONSISTENCY_SCORE_CONFIG.MAX_SCORE).toBe(100);
      expect(CONSISTENCY_SCORE_CONFIG.MIN_SAMPLE_SIZE).toBe(5);
    });

    it('should maintain backward-compatible alias PERFORMANCE_SCORE_CONFIG', () => {
      expect(PERFORMANCE_SCORE_CONFIG).toBe(CONSISTENCY_SCORE_CONFIG);
    });
  });

  describe('GAMIFICATION_TRANSACTION_REASONS', () => {
    it('should define standard transaction reason codes', () => {
      expect(GAMIFICATION_TRANSACTION_REASONS.TASK_COMPLETION).toBe(
        'task_completion',
      );
      expect(GAMIFICATION_TRANSACTION_REASONS.STREAK_BONUS).toBe(
        'streak_bonus',
      );
      expect(GAMIFICATION_TRANSACTION_REASONS.LEVEL_UP_BONUS).toBe(
        'level_up_bonus',
      );
      expect(GAMIFICATION_TRANSACTION_REASONS.MANUAL_ADJUSTMENT).toBe(
        'manual_adjustment',
      );
      expect(GAMIFICATION_TRANSACTION_REASONS.REVERSAL).toBe('reversal');
    });
  });
});
