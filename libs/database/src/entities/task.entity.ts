import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
  Check,
} from 'typeorm';

import { User } from './user.entity';
import { TaskOccurrence } from './task-occurrence.entity';

export enum TaskType {
  ONE_TIME = 'one_time',
  DAILY = 'daily',
}

export enum TaskPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
}

@Entity('tasks')
@Index('IDX_tasks_owner_id', ['ownerId'])
@Check(
  'CHK_tasks_estimated_minutes',
  '"estimatedMinutes" IS NULL OR "estimatedMinutes" >= 0',
)
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  ownerId: string;

  @ManyToOne(() => User, (user) => user.tasks, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'ownerId' })
  owner: User;

  @Column({
    type: 'enum',
    enum: TaskType,
    default: TaskType.ONE_TIME,
  })
  type: TaskType;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: 'enum',
    enum: TaskPriority,
    default: TaskPriority.NORMAL,
  })
  priority: TaskPriority;

  @Column({ type: 'time', nullable: true })
  scheduledStartTime: string | null;

  @Column({ type: 'integer', nullable: true })
  estimatedMinutes: number | null;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => TaskOccurrence, (occurrence) => occurrence.task)
  occurrences: TaskOccurrence[];
}
