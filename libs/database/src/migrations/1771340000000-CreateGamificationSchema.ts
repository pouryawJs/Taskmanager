import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGamificationSchema1771340000000 implements MigrationInterface {
  name = 'CreateGamificationSchema1771340000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Ensure point_transactions table exists with indexes and constraints
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

    // 2. Create gamification_profiles table with 1-to-1 relation to users
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
    await queryRunner.query(`DROP TABLE IF EXISTS "gamification_profiles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "point_transactions"`);
  }
}
