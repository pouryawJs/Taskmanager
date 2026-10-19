import { QueryRunner } from 'typeorm';
import { CreateGamificationSchema1771340000000 } from './1771340000000-CreateGamificationSchema';

describe('CreateGamificationSchema1771340000000 Migration', () => {
  let migration: CreateGamificationSchema1771340000000;
  let mockQueryRunner: jest.Mocked<QueryRunner>;
  let executedQueries: string[];

  beforeEach(() => {
    migration = new CreateGamificationSchema1771340000000();
    executedQueries = [];

    mockQueryRunner = {
      query: jest.fn().mockImplementation((sql: string) => {
        executedQueries.push(sql);
        return Promise.resolve();
      }),
    } as unknown as jest.Mocked<QueryRunner>;
  });

  describe('up()', () => {
    it('should create point_transactions and gamification_profiles tables with required constraints and indexes', async () => {
      await migration.up(mockQueryRunner);

      expect(mockQueryRunner.query).toHaveBeenCalledTimes(4);

      // Verify point_transactions table creation
      const pointTxQuery = executedQueries[0];
      expect(pointTxQuery).toContain(
        'CREATE TABLE IF NOT EXISTS "point_transactions"',
      );
      expect(pointTxQuery).toContain('"pointsDelta" integer NOT NULL');
      expect(pointTxQuery).toContain(
        '"reason" character varying(100) NOT NULL',
      );
      expect(pointTxQuery).toContain('"idempotencyKey" character varying(255)');
      expect(pointTxQuery).toContain(
        'CONSTRAINT "PK_point_transactions_id" PRIMARY KEY ("id")',
      );
      expect(pointTxQuery).toContain(
        'CONSTRAINT "FK_point_transactions_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT',
      );
      expect(pointTxQuery).toContain(
        'CONSTRAINT "FK_point_transactions_taskOccurrenceId" FOREIGN KEY ("taskOccurrenceId") REFERENCES "task_occurrences"("id") ON DELETE SET NULL',
      );
      expect(pointTxQuery).toContain(
        'CONSTRAINT "CHK_point_transactions_nonzero_delta" CHECK ("pointsDelta" <> 0)',
      );

      // Verify indexes
      const userIndexQuery = executedQueries[1];
      expect(userIndexQuery).toContain(
        'CREATE INDEX IF NOT EXISTS "IDX_point_transactions_user_created_at"',
      );
      expect(userIndexQuery).toContain('("userId", "createdAt")');

      const idempotencyIndexQuery = executedQueries[2];
      expect(idempotencyIndexQuery).toContain(
        'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_point_transactions_idempotency_key"',
      );
      expect(idempotencyIndexQuery).toContain('("idempotencyKey")');
      expect(idempotencyIndexQuery).toContain(
        'WHERE "idempotencyKey" IS NOT NULL',
      );

      // Verify gamification_profiles table creation
      const profileQuery = executedQueries[3];
      expect(profileQuery).toContain(
        'CREATE TABLE IF NOT EXISTS "gamification_profiles"',
      );
      expect(profileQuery).toContain('"userId" uuid NOT NULL');
      expect(profileQuery).toContain(
        '"currentStreak" integer NOT NULL DEFAULT 0',
      );
      expect(profileQuery).toContain(
        '"longestStreak" integer NOT NULL DEFAULT 0',
      );
      expect(profileQuery).toContain('"lastQualifiedDate" date');
      expect(profileQuery).toContain(
        'CONSTRAINT "PK_gamification_profiles_userId" PRIMARY KEY ("userId")',
      );
      expect(profileQuery).toContain(
        'CONSTRAINT "FK_gamification_profiles_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE',
      );
      expect(profileQuery).toContain(
        'CONSTRAINT "CHK_gamification_profiles_current_streak" CHECK ("currentStreak" >= 0)',
      );
      expect(profileQuery).toContain(
        'CONSTRAINT "CHK_gamification_profiles_longest_streak" CHECK ("longestStreak" >= 0)',
      );
    });
  });

  describe('down()', () => {
    it('should drop gamification_profiles and point_transactions tables in safe reverse order', async () => {
      await migration.down(mockQueryRunner);

      expect(mockQueryRunner.query).toHaveBeenCalledTimes(2);

      expect(executedQueries[0]).toContain(
        'DROP TABLE IF EXISTS "gamification_profiles"',
      );
      expect(executedQueries[1]).toContain(
        'DROP TABLE IF EXISTS "point_transactions"',
      );
    });
  });
});
