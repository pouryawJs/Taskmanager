import {
  User,
  GamificationProfile,
  PointTransaction,
  TaskOccurrence,
  TaskOccurrenceStatus,
} from '../index';

describe('Gamification Entities (Phase 1)', () => {
  describe('GamificationProfile Entity', () => {
    it('should instantiate with default streak values and null qualified date', () => {
      const profile = new GamificationProfile();
      profile.userId = '11111111-1111-4111-8111-111111111111';
      profile.currentStreak = 0;
      profile.longestStreak = 0;
      profile.lastQualifiedDate = null;

      expect(profile.userId).toBe('11111111-1111-4111-8111-111111111111');
      expect(profile.currentStreak).toBe(0);
      expect(profile.longestStreak).toBe(0);
      expect(profile.lastQualifiedDate).toBeNull();
    });

    it('should associate with a User via OneToOne relation', () => {
      const user = new User();
      user.id = '11111111-1111-4111-8111-111111111111';
      user.displayName = 'Streak Master';

      const profile = new GamificationProfile();
      profile.userId = user.id;
      profile.user = user;
      profile.currentStreak = 5;
      profile.longestStreak = 12;
      profile.lastQualifiedDate = '2026-10-19';

      user.gamificationProfile = profile;

      expect(profile.user).toBe(user);
      expect(profile.user.id).toBe(user.id);
      expect(profile.currentStreak).toBe(5);
      expect(profile.longestStreak).toBe(12);
      expect(profile.lastQualifiedDate).toBe('2026-10-19');
      expect(user.gamificationProfile).toBe(profile);
    });
  });

  describe('PointTransaction Entity (XP Ledger)', () => {
    it('should instantiate an immutable XP reward transaction referencing a user and occurrence', () => {
      const tx = new PointTransaction();
      tx.id = '22222222-2222-4222-8222-222222222222';
      tx.userId = '11111111-1111-4111-8111-111111111111';
      tx.taskOccurrenceId = '33333333-3333-4333-8333-333333333333';
      tx.pointsDelta = 10;
      tx.reason = 'task_completion';
      tx.idempotencyKey =
        'task_completion:33333333-3333-4333-8333-333333333333';
      tx.metadata = {
        completionStatus: TaskOccurrenceStatus.COMPLETED,
        onTime: true,
        baseXp: 10,
        streakMultiplier: 1.0,
      };

      expect(tx.id).toBe('22222222-2222-4222-8222-222222222222');
      expect(tx.userId).toBe('11111111-1111-4111-8111-111111111111');
      expect(tx.taskOccurrenceId).toBe('33333333-3333-4333-8333-333333333333');
      expect(tx.pointsDelta).toBe(10);
      expect(tx.reason).toBe('task_completion');
      expect(tx.idempotencyKey).toBe(
        'task_completion:33333333-3333-4333-8333-333333333333',
      );
      expect(tx.metadata).toEqual({
        completionStatus: TaskOccurrenceStatus.COMPLETED,
        onTime: true,
        baseXp: 10,
        streakMultiplier: 1.0,
      });
    });

    it('should support negative XP deltas for corrections or reversals without mutating history', () => {
      const tx = new PointTransaction();
      tx.id = '44444444-4444-4444-8444-444444444444';
      tx.userId = '11111111-1111-4111-8111-111111111111';
      tx.taskOccurrenceId = null;
      tx.pointsDelta = -10;
      tx.reason = 'reversal';
      tx.idempotencyKey = 'reversal:22222222-2222-4222-8222-222222222222';
      tx.metadata = {
        originalTransactionId: '22222222-2222-4222-8222-222222222222',
      };

      expect(tx.pointsDelta).toBe(-10);
      expect(tx.reason).toBe('reversal');
      expect(tx.taskOccurrenceId).toBeNull();
    });

    it('should allow transaction without taskOccurrenceId for standalone streak/level rewards', () => {
      const tx = new PointTransaction();
      tx.userId = '11111111-1111-4111-8111-111111111111';
      tx.taskOccurrenceId = null;
      tx.pointsDelta = 25;
      tx.reason = 'streak_bonus';
      tx.idempotencyKey =
        'streak_bonus:11111111-1111-4111-8111-111111111111:2026-10-19';

      expect(tx.taskOccurrenceId).toBeNull();
      expect(tx.pointsDelta).toBe(25);
      expect(tx.reason).toBe('streak_bonus');
    });

    it('should preserve financial history when associated occurrence is deleted (onDelete SET NULL)', () => {
      const occurrence = new TaskOccurrence();
      occurrence.id = '33333333-3333-4333-8333-333333333333';

      const tx = new PointTransaction();
      tx.id = '22222222-2222-4222-8222-222222222222';
      tx.userId = '11111111-1111-4111-8111-111111111111';
      tx.taskOccurrenceId = occurrence.id;
      tx.taskOccurrence = occurrence;
      tx.pointsDelta = 10;
      tx.reason = 'task_completion';

      // Simulating onDelete SET NULL: occurrence is unlinked, but transaction remains intact
      tx.taskOccurrenceId = null;
      tx.taskOccurrence = null;

      expect(tx.id).toBe('22222222-2222-4222-8222-222222222222');
      expect(tx.userId).toBe('11111111-1111-4111-8111-111111111111');
      expect(tx.pointsDelta).toBe(10);
      expect(tx.taskOccurrenceId).toBeNull();
    });
  });
});
