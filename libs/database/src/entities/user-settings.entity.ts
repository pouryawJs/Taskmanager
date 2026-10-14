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
    default: 'UTC',
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

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
