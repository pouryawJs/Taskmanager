import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  OneToOne,
} from 'typeorm';

import { UserIdentity } from './user-identity.entity';
import { UserSettings } from './user-settings.entity';
import { Task } from './task.entity';
import { ActivityEvent } from './activity-event.entity';
import { PointTransaction } from './point-transaction.entity';

export enum UserStatus {
  ACTIVE = 'active',
  DISABLED = 'disabled',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  displayName: string | null;

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.ACTIVE,
  })
  status: UserStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => UserIdentity, (identity) => identity.user)
  identities: UserIdentity[];

  @OneToOne(() => UserSettings, (settings) => settings.user)
  settings: UserSettings;

  @OneToMany(() => Task, (task) => task.owner)
  tasks: Task[];

  @OneToMany(() => ActivityEvent, (event) => event.user)
  activityEvents: ActivityEvent[];

  @OneToMany(() => PointTransaction, (transaction) => transaction.user)
  pointTransactions: PointTransaction[];
}
