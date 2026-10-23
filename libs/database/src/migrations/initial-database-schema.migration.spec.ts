import { QueryRunner } from 'typeorm';
import { InitialDatabaseSchema1771360000000 } from './1771360000000-InitialDatabaseSchema';

describe('InitialDatabaseSchema1771360000000 Migration', () => {
  let migration: InitialDatabaseSchema1771360000000;
  let mockQueryRunner: jest.Mocked<QueryRunner>;
  let executedQueries: string[];

  beforeEach(() => {
    migration = new InitialDatabaseSchema1771360000000();
    executedQueries = [];

    mockQueryRunner = {
      query: jest.fn().mockImplementation((sql: string) => {
        executedQueries.push(sql);
        return Promise.resolve();
      }),
    } as unknown as jest.Mocked<QueryRunner>;
  });

  describe('up()', () => {
    it('should create all required PostgreSQL ENUM types safely', async () => {
      await migration.up(mockQueryRunner);

      const allQueriesJoined = executedQueries.join('\n');

      expect(allQueriesJoined).toContain('"public"."users_status_enum"');
      expect(allQueriesJoined).toContain("'active', 'disabled'");

      expect(allQueriesJoined).toContain(
        '"public"."user_identities_provider_enum"',
      );
      expect(allQueriesJoined).toContain("'telegram', 'email'");

      expect(allQueriesJoined).toContain(
        '"public"."user_settings_onboardingstep_enum"',
      );
      expect(allQueriesJoined).toContain("'NAME'");
      expect(allQueriesJoined).toContain("'COMPLETED'");

      expect(allQueriesJoined).toContain('"public"."tasks_type_enum"');
      expect(allQueriesJoined).toContain("'one_time', 'daily'");

      expect(allQueriesJoined).toContain('"public"."tasks_priority_enum"');
      expect(allQueriesJoined).toContain("'low', 'normal', 'high'");

      expect(allQueriesJoined).toContain(
        '"public"."task_occurrences_status_enum"',
      );
      expect(allQueriesJoined).toContain("'pending'");
      expect(allQueriesJoined).toContain("'completed'");
      expect(allQueriesJoined).toContain("'partially_completed'");

      expect(allQueriesJoined).toContain(
        '"public"."activity_events_eventtype_enum"',
      );
      expect(allQueriesJoined).toContain("'task_created'");
      expect(allQueriesJoined).toContain("'task_archived'");
    });

    it('should create all 8 domain tables with required constraints, defaults, and foreign keys', async () => {
      await migration.up(mockQueryRunner);

      const allQueriesJoined = executedQueries.join('\n');

      // Table 1: users
      expect(allQueriesJoined).toContain('CREATE TABLE IF NOT EXISTS "users"');
      expect(allQueriesJoined).toContain(
        'CONSTRAINT "PK_users_id" PRIMARY KEY ("id")',
      );

      // Table 2: user_identities
      expect(allQueriesJoined).toContain(
        'CREATE TABLE IF NOT EXISTS "user_identities"',
      );
      expect(allQueriesJoined).toContain(
        'CONSTRAINT "PK_user_identities_id" PRIMARY KEY ("id")',
      );
      expect(allQueriesJoined).toContain(
        'CONSTRAINT "FK_user_identities_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE',
      );
      expect(allQueriesJoined).toContain(
        'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_user_identities_provider_external_id"',
      );

      // Table 3: user_settings
      expect(allQueriesJoined).toContain(
        'CREATE TABLE IF NOT EXISTS "user_settings"',
      );
      expect(allQueriesJoined).toContain(
        'CONSTRAINT "PK_user_settings_userId" PRIMARY KEY ("userId")',
      );
      expect(allQueriesJoined).toContain(
        'CONSTRAINT "FK_user_settings_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE',
      );
      expect(allQueriesJoined).toContain(
        'CONSTRAINT "CHK_user_settings_reminder_minutes" CHECK ("reminderBeforeMinutes" >= 0)',
      );
      expect(allQueriesJoined).toContain(
        '"calendarType" character varying(20) NOT NULL DEFAULT \'gregorian\'',
      );

      // Table 4: tasks
      expect(allQueriesJoined).toContain('CREATE TABLE IF NOT EXISTS "tasks"');
      expect(allQueriesJoined).toContain(
        'CONSTRAINT "PK_tasks_id" PRIMARY KEY ("id")',
      );
      expect(allQueriesJoined).toContain(
        'CONSTRAINT "FK_tasks_ownerId" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT',
      );
      expect(allQueriesJoined).toContain(
        'CONSTRAINT "CHK_tasks_estimated_minutes" CHECK ("estimatedMinutes" IS NULL OR "estimatedMinutes" >= 0)',
      );
      expect(allQueriesJoined).toContain(
        'CREATE INDEX IF NOT EXISTS "IDX_tasks_owner_id"',
      );

      // Table 5: task_occurrences
      expect(allQueriesJoined).toContain(
        'CREATE TABLE IF NOT EXISTS "task_occurrences"',
      );
      expect(allQueriesJoined).toContain(
        'CONSTRAINT "PK_task_occurrences_id" PRIMARY KEY ("id")',
      );
      expect(allQueriesJoined).toContain(
        'CONSTRAINT "FK_task_occurrences_taskId" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE RESTRICT',
      );
      expect(allQueriesJoined).toContain(
        'CONSTRAINT "CHK_occurrences_scheduled_time_order"',
      );
      expect(allQueriesJoined).toContain(
        'CREATE INDEX IF NOT EXISTS "IDX_occurrences_task_status"',
      );
      expect(allQueriesJoined).toContain(
        'CREATE INDEX IF NOT EXISTS "IDX_occurrences_scheduled_due_at"',
      );
      expect(allQueriesJoined).toContain(
        'CREATE INDEX IF NOT EXISTS "IDX_occurrences_date"',
      );
      expect(allQueriesJoined).toContain(
        'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_task_occurrences_task_date"',
      );

      // Table 6: activity_events
      expect(allQueriesJoined).toContain(
        'CREATE TABLE IF NOT EXISTS "activity_events"',
      );
      expect(allQueriesJoined).toContain(
        'CONSTRAINT "PK_activity_events_id" PRIMARY KEY ("id")',
      );
      expect(allQueriesJoined).toContain(
        'CONSTRAINT "FK_activity_events_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT',
      );
      expect(allQueriesJoined).toContain(
        'CREATE INDEX IF NOT EXISTS "IDX_activity_events_user_occurred_at"',
      );
      expect(allQueriesJoined).toContain(
        'CREATE INDEX IF NOT EXISTS "IDX_activity_events_entity"',
      );

      // Table 7: point_transactions
      expect(allQueriesJoined).toContain(
        'CREATE TABLE IF NOT EXISTS "point_transactions"',
      );
      expect(allQueriesJoined).toContain(
        'CONSTRAINT "PK_point_transactions_id" PRIMARY KEY ("id")',
      );
      expect(allQueriesJoined).toContain(
        'CONSTRAINT "FK_point_transactions_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT',
      );
      expect(allQueriesJoined).toContain(
        'CONSTRAINT "FK_point_transactions_taskOccurrenceId" FOREIGN KEY ("taskOccurrenceId") REFERENCES "task_occurrences"("id") ON DELETE SET NULL',
      );
      expect(allQueriesJoined).toContain(
        'CONSTRAINT "CHK_point_transactions_nonzero_delta" CHECK ("pointsDelta" <> 0)',
      );
      expect(allQueriesJoined).toContain(
        'CREATE INDEX IF NOT EXISTS "IDX_point_transactions_user_created_at"',
      );
      expect(allQueriesJoined).toContain(
        'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_point_transactions_idempotency_key"',
      );

      // Table 8: gamification_profiles
      expect(allQueriesJoined).toContain(
        'CREATE TABLE IF NOT EXISTS "gamification_profiles"',
      );
      expect(allQueriesJoined).toContain(
        'CONSTRAINT "PK_gamification_profiles_userId" PRIMARY KEY ("userId")',
      );
      expect(allQueriesJoined).toContain(
        'CONSTRAINT "FK_gamification_profiles_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE',
      );
      expect(allQueriesJoined).toContain(
        'CONSTRAINT "CHK_gamification_profiles_current_streak" CHECK ("currentStreak" >= 0)',
      );
      expect(allQueriesJoined).toContain(
        'CONSTRAINT "CHK_gamification_profiles_longest_streak" CHECK ("longestStreak" >= 0)',
      );
    });
  });

  describe('down()', () => {
    it('should drop all 8 tables in reverse foreign key order followed by enum types', async () => {
      await migration.down(mockQueryRunner);

      const allQueriesJoined = executedQueries.join('\n');

      // Verify reverse drop order: dependent tables first
      const profileDropIdx = executedQueries.findIndex((q) =>
        q.includes('DROP TABLE IF EXISTS "gamification_profiles"'),
      );
      const pointTxDropIdx = executedQueries.findIndex((q) =>
        q.includes('DROP TABLE IF EXISTS "point_transactions"'),
      );
      const activityDropIdx = executedQueries.findIndex((q) =>
        q.includes('DROP TABLE IF EXISTS "activity_events"'),
      );
      const occDropIdx = executedQueries.findIndex((q) =>
        q.includes('DROP TABLE IF EXISTS "task_occurrences"'),
      );
      const taskDropIdx = executedQueries.findIndex((q) =>
        q.includes('DROP TABLE IF EXISTS "tasks"'),
      );
      const settingsDropIdx = executedQueries.findIndex((q) =>
        q.includes('DROP TABLE IF EXISTS "user_settings"'),
      );
      const identitiesDropIdx = executedQueries.findIndex((q) =>
        q.includes('DROP TABLE IF EXISTS "user_identities"'),
      );
      const usersDropIdx = executedQueries.findIndex((q) =>
        q.includes('DROP TABLE IF EXISTS "users"'),
      );

      expect(profileDropIdx).toBeGreaterThanOrEqual(0);
      expect(pointTxDropIdx).toBeGreaterThanOrEqual(0);
      expect(activityDropIdx).toBeGreaterThan(pointTxDropIdx);
      expect(occDropIdx).toBeGreaterThan(activityDropIdx);
      expect(taskDropIdx).toBeGreaterThan(occDropIdx);
      expect(settingsDropIdx).toBeGreaterThan(taskDropIdx);
      expect(identitiesDropIdx).toBeGreaterThan(settingsDropIdx);
      expect(usersDropIdx).toBeGreaterThan(identitiesDropIdx);

      // Verify enum drops happen after tables
      const enumDropIdx = executedQueries.findIndex((q) =>
        q.includes('DROP TYPE IF EXISTS "public"."users_status_enum"'),
      );
      expect(enumDropIdx).toBeGreaterThan(usersDropIdx);

      expect(allQueriesJoined).toContain(
        'DROP TYPE IF EXISTS "public"."activity_events_eventtype_enum"',
      );
      expect(allQueriesJoined).toContain(
        'DROP TYPE IF EXISTS "public"."task_occurrences_status_enum"',
      );
      expect(allQueriesJoined).toContain(
        'DROP TYPE IF EXISTS "public"."tasks_priority_enum"',
      );
      expect(allQueriesJoined).toContain(
        'DROP TYPE IF EXISTS "public"."tasks_type_enum"',
      );
      expect(allQueriesJoined).toContain(
        'DROP TYPE IF EXISTS "public"."user_settings_onboardingstep_enum"',
      );
      expect(allQueriesJoined).toContain(
        'DROP TYPE IF EXISTS "public"."user_identities_provider_enum"',
      );
      expect(allQueriesJoined).toContain(
        'DROP TYPE IF EXISTS "public"."users_status_enum"',
      );
    });
  });
});
