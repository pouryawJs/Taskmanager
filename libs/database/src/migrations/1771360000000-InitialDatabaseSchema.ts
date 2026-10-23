import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialDatabaseSchema1771360000000 implements MigrationInterface {
  name = 'InitialDatabaseSchema1771360000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create custom PostgreSQL ENUM types
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."users_status_enum" AS ENUM ('active', 'disabled');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."user_identities_provider_enum" AS ENUM ('telegram', 'email');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."user_settings_onboardingstep_enum" AS ENUM (
          'NAME',
          'AWAITING_CUSTOM_NAME',
          'TIMEZONE',
          'AWAITING_CUSTOM_TIMEZONE',
          'GAMIFICATION',
          'COMPLETED'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."tasks_type_enum" AS ENUM ('one_time', 'daily');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."tasks_priority_enum" AS ENUM ('low', 'normal', 'high');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."task_occurrences_status_enum" AS ENUM (
          'pending',
          'in_progress',
          'completed',
          'partially_completed',
          'not_completed',
          'skipped',
          'cancelled'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."activity_events_eventtype_enum" AS ENUM (
          'task_created',
          'task_started',
          'task_completed',
          'task_skipped',
          'task_archived'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    // 2. Table: users
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "displayName" character varying(100),
        "status" "public"."users_status_enum" NOT NULL DEFAULT 'active',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id")
      )
    `);

    // 3. Table: user_identities
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_identities" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "provider" "public"."user_identities_provider_enum" NOT NULL,
        "providerUserId" character varying(255) NOT NULL,
        "userId" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_identities_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_identities_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_user_identities_provider_external_id"
      ON "user_identities" ("provider", "providerUserId")
    `);

    // 4. Table: user_settings
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_settings" (
        "userId" uuid NOT NULL,
        "calendarType" character varying(20) NOT NULL DEFAULT 'gregorian',
        "timezone" character varying(64) NOT NULL DEFAULT 'Asia/Tehran',
        "notificationsEnabled" boolean NOT NULL DEFAULT true,
        "reminderBeforeMinutes" integer NOT NULL DEFAULT 10,
        "onboardingStep" "public"."user_settings_onboardingstep_enum" NOT NULL DEFAULT 'NAME',
        "onboardingCompleted" boolean NOT NULL DEFAULT false,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_settings_userId" PRIMARY KEY ("userId"),
        CONSTRAINT "FK_user_settings_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_user_settings_reminder_minutes" CHECK ("reminderBeforeMinutes" >= 0)
      )
    `);

    // 5. Table: tasks
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tasks" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "ownerId" uuid NOT NULL,
        "type" "public"."tasks_type_enum" NOT NULL DEFAULT 'one_time',
        "title" character varying(160) NOT NULL,
        "description" text,
        "priority" "public"."tasks_priority_enum" NOT NULL DEFAULT 'normal',
        "scheduledStartTime" TIME,
        "estimatedMinutes" integer,
        "isActive" boolean NOT NULL DEFAULT true,
        "archivedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tasks_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tasks_ownerId" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_tasks_estimated_minutes" CHECK ("estimatedMinutes" IS NULL OR "estimatedMinutes" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tasks_owner_id"
      ON "tasks" ("ownerId")
    `);

    // 6. Table: task_occurrences
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_occurrences" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "taskId" uuid NOT NULL,
        "date" date NOT NULL,
        "scheduledStartTime" TIME,
        "status" "public"."task_occurrences_status_enum" NOT NULL DEFAULT 'pending',
        "scheduledStartAt" TIMESTAMP WITH TIME ZONE,
        "scheduledDueAt" TIMESTAMP WITH TIME ZONE,
        "startedAt" TIMESTAMP WITH TIME ZONE,
        "completedAt" TIMESTAMP WITH TIME ZONE,
        "notifiedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_task_occurrences_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_task_occurrences_taskId" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_occurrences_scheduled_time_order" CHECK (
          "scheduledStartAt" IS NULL OR "scheduledDueAt" IS NULL OR "scheduledDueAt" >= "scheduledStartAt"
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_occurrences_task_status"
      ON "task_occurrences" ("taskId", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_occurrences_scheduled_due_at"
      ON "task_occurrences" ("scheduledDueAt")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_occurrences_date"
      ON "task_occurrences" ("date")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_task_occurrences_task_date"
      ON "task_occurrences" ("taskId", "date")
    `);

    // 7. Table: activity_events
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "activity_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "eventType" "public"."activity_events_eventtype_enum" NOT NULL,
        "entityType" character varying(50) NOT NULL,
        "entityId" uuid,
        "metadata" jsonb,
        "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_activity_events_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_activity_events_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_activity_events_user_occurred_at"
      ON "activity_events" ("userId", "occurredAt")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_activity_events_entity"
      ON "activity_events" ("entityType", "entityId")
    `);

    // 8. Table: point_transactions
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "point_transactions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "taskOccurrenceId" uuid,
        "pointsDelta" integer NOT NULL,
        "reason" character varying(100) NOT NULL,
        "idempotencyKey" character varying(255),
        "metadata" jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_point_transactions_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_point_transactions_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_point_transactions_taskOccurrenceId" FOREIGN KEY ("taskOccurrenceId") REFERENCES "task_occurrences"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_point_transactions_nonzero_delta" CHECK ("pointsDelta" <> 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_point_transactions_user_created_at"
      ON "point_transactions" ("userId", "createdAt")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_point_transactions_idempotency_key"
      ON "point_transactions" ("idempotencyKey")
      WHERE "idempotencyKey" IS NOT NULL
    `);

    // 9. Table: gamification_profiles
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "gamification_profiles" (
        "userId" uuid NOT NULL,
        "currentStreak" integer NOT NULL DEFAULT 0,
        "longestStreak" integer NOT NULL DEFAULT 0,
        "lastQualifiedDate" date,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_gamification_profiles_userId" PRIMARY KEY ("userId"),
        CONSTRAINT "FK_gamification_profiles_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_gamification_profiles_current_streak" CHECK ("currentStreak" >= 0),
        CONSTRAINT "CHK_gamification_profiles_longest_streak" CHECK ("longestStreak" >= 0)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables in reverse order of foreign-key dependencies
    await queryRunner.query(`DROP TABLE IF EXISTS "gamification_profiles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "point_transactions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "activity_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "task_occurrences"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tasks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_settings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_identities"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);

    // Drop PostgreSQL ENUM types
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."activity_events_eventtype_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."task_occurrences_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."tasks_priority_enum"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."tasks_type_enum"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."user_settings_onboardingstep_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."user_identities_provider_enum"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."users_status_enum"`);
  }
}
