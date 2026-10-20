import { ForbiddenException } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';

import {
  Task,
  TaskOccurrence,
  TaskOccurrenceStatus,
  PointTransaction,
  User,
  UserSettings,
} from '@app/database';
import { TasksService } from '../tasks/tasks.service';
import { GamificationService } from './gamification.service';
import { BASE_XP_REWARDS } from './constants/gamification.constants';

describe('Phase 2 Integration — Safe, Immediate, Idempotent XP Awards', () => {
  let tasksService: TasksService;
  let gamificationService: GamificationService;

  let taskRepo: jest.Mocked<Repository<Task>>;
  let occurrenceRepo: jest.Mocked<Repository<TaskOccurrence>>;
  let userRepo: jest.Mocked<Repository<User>>;
  let settingsRepo: jest.Mocked<Repository<UserSettings>>;
  let pointTxRepo: jest.Mocked<Repository<PointTransaction>>;

  let transactionsLedger: PointTransaction[];
  let occurrencesStore: Map<string, TaskOccurrence>;
  let tasksStore: Map<string, Task>;

  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    transactionsLedger = [];
    occurrencesStore = new Map();
    tasksStore = new Map();

    const mockTask = {
      id: 'task-1',
      ownerId: userId,
      title: 'Workout session',
      isActive: true,
    } as Task;
    tasksStore.set('task-1', mockTask);

    taskRepo = {
      findOne: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(tasksStore.get(where.id) || null),
      ),
    } as unknown as jest.Mocked<Repository<Task>>;

    occurrenceRepo = {
      findOne: jest.fn(({ where }: { where: { id: string } }) => {
        const occ = occurrencesStore.get(where.id);
        if (occ) {
          return Promise.resolve({
            ...occ,
            task: tasksStore.get(occ.taskId) || mockTask,
          });
        }
        return Promise.resolve(null);
      }),
      save: jest.fn((occ: TaskOccurrence) => {
        occurrencesStore.set(occ.id, { ...occ });
        return Promise.resolve({
          ...occ,
          task: tasksStore.get(occ.taskId) || mockTask,
        });
      }),
    } as unknown as jest.Mocked<Repository<TaskOccurrence>>;

    userRepo = {
      findOne: jest.fn(() => Promise.resolve({ id: userId } as User)),
    } as unknown as jest.Mocked<Repository<User>>;

    settingsRepo = {
      findOne: jest.fn(() =>
        Promise.resolve({ userId, timezone: 'Asia/Tehran' } as UserSettings),
      ),
    } as unknown as jest.Mocked<Repository<UserSettings>>;

    pointTxRepo = {
      find: jest.fn(({ where }: { where: { taskOccurrenceId: string } }) => {
        return Promise.resolve(
          transactionsLedger.filter(
            (tx) => tx.taskOccurrenceId === where.taskOccurrenceId,
          ),
        );
      }),
      create: jest.fn((dto: Partial<PointTransaction>) => ({
        id: `tx-${transactionsLedger.length + 1}`,
        createdAt: new Date(),
        ...dto,
      })),
      save: jest.fn((tx: PointTransaction) => {
        transactionsLedger.push(tx);
        return Promise.resolve(tx);
      }),
    } as unknown as jest.Mocked<Repository<PointTransaction>>;

    const mockDataSource = {
      getRepository: jest.fn((entity) => {
        if (entity === Task) return taskRepo;
        if (entity === TaskOccurrence) return occurrenceRepo;
        if (entity === User) return userRepo;
        if (entity === UserSettings) return settingsRepo;
        if (entity === PointTransaction) return pointTxRepo;
        return null;
      }),
      transaction: jest.fn(
        async (cb: (manager: EntityManager) => Promise<any>) => {
          const occurrencesSnapshot = new Map(
            Array.from(occurrencesStore.entries()).map(([k, v]) => [
              k,
              { ...v },
            ]),
          );
          const ledgerSnapshot = [...transactionsLedger];

          const mockManager = {
            getRepository: (entity: any) => {
              if (entity === Task) return taskRepo;
              if (entity === TaskOccurrence) return occurrenceRepo;
              if (entity === PointTransaction) return pointTxRepo;
              return null;
            },
            createQueryBuilder: () => {
              let insertedValues: any = null;
              let ignoreConflicts = false;

              const qb: any = {
                insert: () => qb,
                into: () => qb,
                values: (vals: any) => {
                  insertedValues = vals;
                  return qb;
                },
                orIgnore: () => {
                  ignoreConflicts = true;
                  return qb;
                },
                execute: () => {
                  // Simulate Postgres UNIQUE constraint on idempotencyKey
                  const conflict = transactionsLedger.find(
                    (tx) =>
                      tx.idempotencyKey &&
                      tx.idempotencyKey === insertedValues?.idempotencyKey,
                  );

                  if (conflict) {
                    if (ignoreConflicts) {
                      // ON CONFLICT DO NOTHING returns 0 inserted rows
                      return Promise.resolve({ identifiers: [], raw: [] });
                    } else {
                      return Promise.reject(
                        new Error(
                          'duplicate key value violates unique constraint',
                        ),
                      );
                    }
                  }

                  const created: PointTransaction = {
                    id: `tx-${transactionsLedger.length + 1}`,
                    userId: insertedValues?.userId || userId,
                    taskOccurrenceId: insertedValues?.taskOccurrenceId || null,
                    pointsDelta: insertedValues?.pointsDelta || 0,
                    reason: insertedValues?.reason || '',
                    idempotencyKey: insertedValues?.idempotencyKey || null,
                    metadata: insertedValues?.metadata || null,
                    createdAt: new Date(),
                  } as PointTransaction;

                  transactionsLedger.push(created);
                  return Promise.resolve({
                    identifiers: [{ id: created.id }],
                    raw: [{ id: created.id }],
                  });
                },
              };
              return qb;
            },
          } as unknown as EntityManager;

          try {
            return await cb(mockManager);
          } catch (err) {
            // Rollback on failure
            occurrencesStore.clear();
            for (const [k, v] of occurrencesSnapshot.entries()) {
              occurrencesStore.set(k, v);
            }
            transactionsLedger.length = 0;
            transactionsLedger.push(...ledgerSnapshot);
            throw err;
          }
        },
      ),
    } as unknown as jest.Mocked<DataSource>;

    gamificationService = new GamificationService(mockDataSource);
    tasksService = new TasksService(mockDataSource, gamificationService);
  });

  describe('Reward Rules', () => {
    it('should award 10 base XP for on-time completion with reliable scheduledDueAt', async () => {
      const occurrence = {
        id: 'occ-on-time',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        scheduledStartTime: '09:00',
        scheduledDueAt: new Date(Date.now() + 3600000), // 1 hour in the future
      } as TaskOccurrence;
      occurrencesStore.set(occurrence.id, occurrence);

      const result = await tasksService.completeOccurrence(
        userId,
        occurrence.id,
      );

      expect(result.status).toBe(TaskOccurrenceStatus.COMPLETED);
      expect(transactionsLedger).toHaveLength(1);
      expect(transactionsLedger[0].pointsDelta).toBe(
        BASE_XP_REWARDS.ON_TIME_COMPLETION,
      ); // 10
      expect(transactionsLedger[0].idempotencyKey).toBe(
        'task_completion:occ-on-time',
      );
      expect(transactionsLedger[0].metadata?.timing).toBe('on_time');
    });

    it('should award 7 base XP for late completion with reliable scheduledDueAt', async () => {
      const occurrence = {
        id: 'occ-late',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        scheduledStartTime: '09:00',
        scheduledDueAt: new Date(Date.now() - 3600000), // 1 hour in the past
      } as TaskOccurrence;
      occurrencesStore.set(occurrence.id, occurrence);

      const result = await tasksService.completeOccurrence(
        userId,
        occurrence.id,
      );

      expect(result.status).toBe(TaskOccurrenceStatus.COMPLETED);
      expect(transactionsLedger).toHaveLength(1);
      expect(transactionsLedger[0].pointsDelta).toBe(
        BASE_XP_REWARDS.LATE_COMPLETION,
      ); // 7
      expect(transactionsLedger[0].idempotencyKey).toBe(
        'task_completion:occ-late',
      );
      expect(transactionsLedger[0].metadata?.timing).toBe('late');
    });

    it('should award 7 base XP for completion when scheduledDueAt is null without inferring deadline from scheduledStartTime', async () => {
      const occurrence = {
        id: 'occ-no-due',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        scheduledStartTime: '08:00', // Has scheduledStartTime, but NO scheduledDueAt
        scheduledDueAt: null,
      } as TaskOccurrence;
      occurrencesStore.set(occurrence.id, occurrence);

      const result = await tasksService.completeOccurrence(
        userId,
        occurrence.id,
      );

      expect(result.status).toBe(TaskOccurrenceStatus.COMPLETED);
      expect(transactionsLedger).toHaveLength(1);
      expect(transactionsLedger[0].pointsDelta).toBe(
        BASE_XP_REWARDS.NO_DEADLINE_COMPLETION,
      ); // 7
      expect(transactionsLedger[0].idempotencyKey).toBe(
        'task_completion:occ-no-due',
      );
      expect(transactionsLedger[0].metadata?.timing).toBe('no_deadline');
    });

    it('should award 4 base XP for partial completion', async () => {
      const occurrence = {
        id: 'occ-partial',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        scheduledStartTime: '09:00',
        scheduledDueAt: new Date(Date.now() + 3600000),
      } as TaskOccurrence;
      occurrencesStore.set(occurrence.id, occurrence);

      const result = await tasksService.partiallyCompleteOccurrence(
        userId,
        occurrence.id,
      );

      expect(result.status).toBe(TaskOccurrenceStatus.PARTIALLY_COMPLETED);
      expect(transactionsLedger).toHaveLength(1);
      expect(transactionsLedger[0].pointsDelta).toBe(
        BASE_XP_REWARDS.PARTIAL_COMPLETION,
      ); // 4
      expect(transactionsLedger[0].idempotencyKey).toBe(
        'task_partial_completion:occ-partial',
      );
      expect(transactionsLedger[0].metadata?.timing).toBe('partial');
    });

    it('should not award XP for intermediate or zero-XP outcomes (start, not completed, skipped, cancelled)', async () => {
      const occ = {
        id: 'occ-ineligible',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
      } as TaskOccurrence;
      occurrencesStore.set(occ.id, occ);

      await tasksService.startOccurrence(userId, occ.id);
      expect(transactionsLedger).toHaveLength(0);

      await tasksService.skipOccurrence(userId, occ.id);
      expect(transactionsLedger).toHaveLength(0);

      const occ2 = {
        id: 'occ-cancel',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
      } as TaskOccurrence;
      occurrencesStore.set(occ2.id, occ2);

      await tasksService.cancelOccurrence(userId, occ2.id);
      expect(transactionsLedger).toHaveLength(0);

      const occ3 = {
        id: 'occ-not-comp',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
      } as TaskOccurrence;
      occurrencesStore.set(occ3.id, occ3);

      await tasksService.markOccurrenceNotCompleted(userId, occ3.id);
      expect(transactionsLedger).toHaveLength(0);
    });
  });

  describe('Idempotency & Concurrency', () => {
    it('should never award duplicate XP when completeOccurrence is called repeatedly', async () => {
      const occurrence = {
        id: 'occ-dup',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        scheduledDueAt: new Date(Date.now() + 3600000),
      } as TaskOccurrence;
      occurrencesStore.set(occurrence.id, occurrence);

      // Call 1: Completes and awards 10 XP
      await tasksService.completeOccurrence(userId, occurrence.id);
      expect(transactionsLedger).toHaveLength(1);
      expect(transactionsLedger[0].pointsDelta).toBe(10);

      // Call 2: Repeated call on already completed occurrence
      await tasksService.completeOccurrence(userId, occurrence.id);
      expect(transactionsLedger).toHaveLength(1); // Still 1

      // Call 3: Another repeated call
      await tasksService.completeOccurrence(userId, occurrence.id);
      expect(transactionsLedger).toHaveLength(1); // Still 1
    });

    it('should safely handle concurrent award attempts without duplicating XP or aborting transaction', async () => {
      const occurrence = {
        id: 'occ-concurrent',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        scheduledDueAt: new Date(Date.now() + 3600000),
      } as TaskOccurrence;
      occurrencesStore.set(occurrence.id, occurrence);

      // Simulate 3 concurrent completion requests
      const results = await Promise.all([
        tasksService.completeOccurrence(userId, occurrence.id),
        tasksService.completeOccurrence(userId, occurrence.id),
        tasksService.completeOccurrence(userId, occurrence.id),
      ]);

      expect(results).toHaveLength(3);
      // Exactly 1 XP transaction must exist in the ledger
      expect(transactionsLedger).toHaveLength(1);
      expect(transactionsLedger[0].pointsDelta).toBe(10);
      expect(transactionsLedger[0].idempotencyKey).toBe(
        'task_completion:occ-concurrent',
      );
    });

    it('should award only delta XP (6 XP) when upgrading from partial completion to on-time full completion', async () => {
      const occurrence = {
        id: 'occ-upgrade',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        scheduledDueAt: new Date(Date.now() + 3600000),
      } as TaskOccurrence;
      occurrencesStore.set(occurrence.id, occurrence);

      // Step 1: Partially complete -> 4 XP awarded
      await tasksService.partiallyCompleteOccurrence(userId, occurrence.id);
      expect(transactionsLedger).toHaveLength(1);
      expect(transactionsLedger[0].pointsDelta).toBe(4);
      expect(transactionsLedger[0].idempotencyKey).toBe(
        'task_partial_completion:occ-upgrade',
      );

      // Step 2: Fully complete on-time -> 6 XP delta awarded (10 total)
      await tasksService.completeOccurrence(userId, occurrence.id);
      expect(transactionsLedger).toHaveLength(2);
      expect(transactionsLedger[1].pointsDelta).toBe(6);
      expect(transactionsLedger[1].idempotencyKey).toBe(
        'task_completion:occ-upgrade',
      );

      const totalXp = transactionsLedger.reduce(
        (sum, tx) => sum + tx.pointsDelta,
        0,
      );
      expect(totalXp).toBe(10);

      // Step 3: Repeated completion call -> 0 extra XP
      await tasksService.completeOccurrence(userId, occurrence.id);
      expect(transactionsLedger).toHaveLength(2);
    });
  });

  describe('Transaction Safety & Failure Recovery', () => {
    it('should roll back occurrence update if awarding XP fails unexpectedly', async () => {
      const occurrence = {
        id: 'occ-fail',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        scheduledDueAt: new Date(Date.now() + 3600000),
      } as TaskOccurrence;
      occurrencesStore.set(occurrence.id, occurrence);

      jest
        .spyOn(gamificationService, 'awardTaskOccurrenceXp')
        .mockRejectedValueOnce(new Error('Database disk full error'));

      await expect(
        tasksService.completeOccurrence(userId, occurrence.id),
      ).rejects.toThrow('Database disk full error');

      // Ledger has no transactions
      expect(transactionsLedger).toHaveLength(0);
    });

    it('should allow retry after failure to succeed cleanly', async () => {
      const occurrence = {
        id: 'occ-retry',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        scheduledDueAt: new Date(Date.now() + 3600000),
      } as TaskOccurrence;
      occurrencesStore.set(occurrence.id, occurrence);

      // 1. First attempt fails
      const awardSpy = jest.spyOn(gamificationService, 'awardTaskOccurrenceXp');
      awardSpy.mockRejectedValueOnce(new Error('Transient connection error'));

      await expect(
        tasksService.completeOccurrence(userId, occurrence.id),
      ).rejects.toThrow('Transient connection error');

      expect(transactionsLedger).toHaveLength(0);

      // 2. Retry attempt succeeds
      const result = await tasksService.completeOccurrence(
        userId,
        occurrence.id,
      );
      expect(result.status).toBe(TaskOccurrenceStatus.COMPLETED);
      expect(transactionsLedger).toHaveLength(1);
      expect(transactionsLedger[0].pointsDelta).toBe(10);
    });
  });

  describe('Ownership Boundaries', () => {
    it('should reject completion and award no XP if occurrence is not owned by the user', async () => {
      const occurrence = {
        id: 'occ-forbidden',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
      } as TaskOccurrence;
      occurrencesStore.set(occurrence.id, occurrence);

      await expect(
        tasksService.completeOccurrence(otherUserId, occurrence.id),
      ).rejects.toThrow(ForbiddenException);

      expect(transactionsLedger).toHaveLength(0);
    });

    it('should reject partial completion and award no XP if occurrence is not owned by the user', async () => {
      const occurrence = {
        id: 'occ-forbidden-2',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
      } as TaskOccurrence;
      occurrencesStore.set(occurrence.id, occurrence);

      await expect(
        tasksService.partiallyCompleteOccurrence(otherUserId, occurrence.id),
      ).rejects.toThrow(ForbiddenException);

      expect(transactionsLedger).toHaveLength(0);
    });
  });
});
