import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';

import { User } from './user.entity';

export enum IdentityProvider {
  TELEGRAM = 'telegram',
  EMAIL = 'email',
}

@Entity('user_identities')
@Index(
  'UQ_user_identities_provider_external_id',
  ['provider', 'providerUserId'],
  { unique: true },
)
export class UserIdentity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: IdentityProvider,
  })
  provider: IdentityProvider;

  @Column({ type: 'varchar', length: 255 })
  providerUserId: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, (user) => user.identities, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
