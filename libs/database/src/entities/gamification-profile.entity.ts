import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
  Check,
} from 'typeorm';

import { User } from './user.entity';

@Entity('gamification_profiles')
@Check('CHK_gamification_profiles_current_streak', '"currentStreak" >= 0')
@Check('CHK_gamification_profiles_longest_streak', '"longestStreak" >= 0')
export class GamificationProfile {
  @PrimaryColumn('uuid')
  userId: string;

  @OneToOne(() => User, (user) => user.gamificationProfile, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({
    type: 'integer',
    default: 0,
  })
  currentStreak: number;

  @Column({
    type: 'integer',
    default: 0,
  })
  longestStreak: number;

  @Column({
    type: 'date',
    nullable: true,
  })
  lastQualifiedDate: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
