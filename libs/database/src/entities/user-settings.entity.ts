import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
  Check,
} from 'typeorm';

import { User } from './user.entity';

export enum OnboardingStep {
  NAME = 'NAME',
  AWAITING_CUSTOM_NAME = 'AWAITING_CUSTOM_NAME',
  TIMEZONE = 'TIMEZONE',
  AWAITING_CUSTOM_TIMEZONE = 'AWAITING_CUSTOM_TIMEZONE',
  GAMIFICATION = 'GAMIFICATION',
  COMPLETED = 'COMPLETED',
}

@Entity('user_settings')
@Check('CHK_user_settings_reminder_minutes', '"reminderBeforeMinutes" >= 0')
export class UserSettings {
  @PrimaryColumn('uuid')
  userId: string;

  @OneToOne(() => User, (user) => user.settings, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({
    type: 'varchar',
    length: 64,
    default: 'Asia/Tehran',
  })
  timezone: string;

  @Column({
    type: 'boolean',
    default: true,
  })
  notificationsEnabled: boolean;

  @Column({
    type: 'integer',
    default: 10,
  })
  reminderBeforeMinutes: number;

  @Column({
    type: 'enum',
    enum: OnboardingStep,
    default: OnboardingStep.NAME,
  })
  onboardingStep: OnboardingStep;

  @Column({
    type: 'boolean',
    default: false,
  })
  onboardingCompleted: boolean;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
