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

import { Task } from './task.entity';
import { PointTransaction } from './point-transaction.entity';

export enum TaskOccurrenceStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  SKIPPED = 'skipped',
  CANCELLED = 'cancelled',
}

@Entity('task_occurrences')
@Index('IDX_occurrences_task_status', ['taskId', 'status'])
@Index('IDX_occurrences_scheduled_due_at', ['scheduledDueAt'])
@Check(
  'CHK_occurrences_scheduled_time_order',
  '"scheduledStartAt" IS NULL OR "scheduledDueAt" IS NULL OR "scheduledDueAt" >= "scheduledStartAt"',
)
export class TaskOccurrence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  taskId: string;

  @ManyToOne(() => Task, (task) => task.occurrences, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'taskId' })
  task: Task;

  @Column({
    type: 'enum',
    enum: TaskOccurrenceStatus,
    default: TaskOccurrenceStatus.PENDING,
  })
  status: TaskOccurrenceStatus;

  @Column({ type: 'timestamptz', nullable: true })
  scheduledStartAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  scheduledDueAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(
    () => PointTransaction,
    (transaction) => transaction.taskOccurrence,
  )
  pointTransactions: PointTransaction[];
}
