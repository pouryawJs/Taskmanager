import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCalendarTypeToUserSettings1771350000000 implements MigrationInterface {
  name = 'AddCalendarTypeToUserSettings1771350000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_settings"
      ADD COLUMN IF NOT EXISTS "calendarType" character varying(20) NOT NULL DEFAULT 'gregorian'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_settings"
      DROP COLUMN IF EXISTS "calendarType"
    `);
  }
}
