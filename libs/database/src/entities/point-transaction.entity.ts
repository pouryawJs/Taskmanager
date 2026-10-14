import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
} from 'typeorm';

import { User } from './user.entity';
import { TaskOccurrence } from './task-occurrence.entity';

@Entity('point_transactions')
@Index('IDX_point_transactions_user_created_at', ['userId', 'createdAt'])
@Index('UQ_point_transactions_idempotency_key', ['idempotencyKey'], {
  unique: true,
  where: '"idempotencyKey" IS NOT NULL',
})
@Check('CHK_point_transactions_nonzero_delta', '"pointsDelta" <> 0')
export class PointTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, (user) => user.pointTransactions, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid', nullable: true })
  taskOccurrenceId: string | null;

  @ManyToOne(
    () => TaskOccurrence,
    (occurrence) => occurrence.pointTransactions,
    {
      nullable: true,
      onDelete: 'SET NULL',
    },
  )
  @JoinColumn({ name: 'taskOccurrenceId' })
  taskOccurrence: TaskOccurrence | null;

  @Column({ type: 'integer' })
  pointsDelta: number;

  @Column({ type: 'varchar', length: 100 })
  reason: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  idempotencyKey: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
