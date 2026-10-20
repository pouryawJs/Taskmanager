import { ForbiddenException } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';

import {
  Task,
  TaskOccurrence,
  TaskOccurrenceStatus,
  PointTransaction,
  GamificationProfile,
  User,
  UserSettings,
} from '@app/database';
import { TasksService } from '../tasks/tasks.service';
import { GamificationService } from './gamification.service';
import { BASE_XP_REWARDS } from './constants/gamification.constants';

describe('Phase 2 & 3 Integration — Safe, Immediate, Idempotent XP Awards & Streak Progression', () => {
  let tasksService: TasksService;
  let gamificationService: GamificationService;

  let taskRepo: jest.Mocked<Repository<Task>>;
  let occurrenceRepo: jest.Mocked<Repository<TaskOccurrence>>;
  let userRepo: jest.Mocked<Repository<User>>;
  let settingsRepo: jest.Mocked<Repository<UserSettings>>;
  let pointTxRepo: jest.Mocked<Repository<PointTransaction>>;
  let profileRepo: jest.Mocked<Repository<GamificationProfile>>;

  let transactionsLedger: PointTransaction[];
  let occurrencesStore: Map<string, TaskOccurrence>;
  let tasksStore: Map<string, Task>;
  let profilesStore: Map<string, GamificationProfile>;

  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    transactionsLedger = [];
    occurrencesStore = new Map();
    tasksStore = new Map();
    profilesStore = new Map();

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
      find: jest.fn((opts?: any) => {
        let list = Array.from(occurrencesStore.values()).map((occ) => ({
          ...occ,
          task: tasksStore.get(occ.taskId) || mockTask,
        }));
        if (opts?.where) {
          if (opts.where.date) {
            list = list.filter((o) => o.date === opts.where.date);
          }
          if (opts.where.status) {
            list = list.filter((o) => o.status === opts.where.status);
          }
        }
        return Promise.resolve(list);
      }),
      createQueryBuilder: jest.fn(() => {
        let dateFilter: string | null = null;
        let statusFilter: TaskOccurrenceStatus | null = null;
        let startDateFilter: string | null = null;
        let endDateFilter: string | null = null;
        let ownerIdFilter: string | null = null;

        const qb: any = {
          innerJoin: () => qb,
          innerJoinAndSelect: () => qb,
          where: (clause: string, params: any) => {
            if (params?.userId) ownerIdFilter = params.userId;
            return qb;
          },
          andWhere: (clause: string, params: any) => {
            if (params?.date) dateFilter = params.date;
            if (params?.status) statusFilter = params.status;
            if (params?.startDate) startDateFilter = params.startDate;
            if (params?.endDate) endDateFilter = params.endDate;
            return qb;
          },
          getCount: () => {
            let list = Array.from(occurrencesStore.values()).map((occ) => ({
              ...occ,
              task: tasksStore.get(occ.taskId) || mockTask,
            }));
            if (ownerIdFilter) {
              list = list.filter((o) => o.task?.ownerId === ownerIdFilter);
            }
            if (dateFilter) {
              list = list.filter((o) => o.date === dateFilter);
            }
            if (statusFilter) {
              list = list.filter((o) => o.status === statusFilter);
            }
            const distinct = new Set(list.map((o) => o.id));
            return Promise.resolve(distinct.size);
          },
          getMany: () => {
            let list = Array.from(occurrencesStore.values()).map((occ) => ({
              ...occ,
              task: tasksStore.get(occ.taskId) || mockTask,
            }));
            if (ownerIdFilter) {
              list = list.filter((o) => o.task?.ownerId === ownerIdFilter);
            }
            if (startDateFilter && endDateFilter) {
              list = list.filter(
                (o) => o.date >= startDateFilter! && o.date <= endDateFilter!,
              );
            }
            return Promise.resolve(list);
          },
        };
        return qb;
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

    profileRepo = {
      findOne: jest.fn(({ where }: { where: { userId: string } }) => {
        const p = profilesStore.get(where.userId);
        return Promise.resolve(p ? { ...p } : null);
      }),
      create: jest.fn((dto: Partial<GamificationProfile>) => ({
        id: `profile-${profilesStore.size + 1}`,
        userId: dto.userId || userId,
        currentStreak: 0,
        longestStreak: 0,
        lastQualifiedDate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...dto,
      })),
      save: jest.fn((p: GamificationProfile) => {
        profilesStore.set(p.userId, { ...p });
        return Promise.resolve({ ...p });
      }),
    } as unknown as jest.Mocked<Repository<GamificationProfile>>;

    const mockDataSource = {
      getRepository: jest.fn((entity) => {
        if (entity === Task) return taskRepo;
        if (entity === TaskOccurrence) return occurrenceRepo;
        if (entity === User) return userRepo;
        if (entity === UserSettings) return settingsRepo;
        if (entity === PointTransaction) return pointTxRepo;
        if (entity === GamificationProfile) return profileRepo;
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
          const profilesSnapshot = new Map(
            Array.from(profilesStore.entries()).map(([k, v]) => [k, { ...v }]),
          );

          const mockManager = {
            getRepository: (entity: any) => {
              if (entity === Task) return taskRepo;
              if (entity === TaskOccurrence) return occurrenceRepo;
              if (entity === PointTransaction) return pointTxRepo;
              if (entity === GamificationProfile) return profileRepo;
              if (entity === UserSettings) return settingsRepo;
              if (entity === User) return userRepo;
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
            profilesStore.clear();
            for (const [k, v] of profilesSnapshot.entries()) {
              profilesStore.set(k, v);
            }
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

  describe('Phase 3 Integration — Streak Progression Engine & Dynamic Multipliers', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-20T12:00:00Z')); // 15:30 in Asia/Tehran (local date is 2026-10-20)
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('Threshold Qualification: reaching 1 or 2 completed tasks does not qualify; the 3rd task triggers qualification', async () => {
      const occ1 = {
        id: 'occ-p3-1',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        date: '2026-10-20',
        scheduledStartTime: '09:00',
        scheduledDueAt: new Date('2026-10-20T13:00:00Z'),
      } as TaskOccurrence;
      const occ2 = {
        id: 'occ-p3-2',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        date: '2026-10-20',
        scheduledStartTime: '10:00',
        scheduledDueAt: new Date('2026-10-20T14:00:00Z'),
      } as TaskOccurrence;
      const occ3 = {
        id: 'occ-p3-3',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        date: '2026-10-20',
        scheduledStartTime: '11:00',
        scheduledDueAt: new Date('2026-10-20T15:00:00Z'),
      } as TaskOccurrence;

      occurrencesStore.set(occ1.id, occ1);
      occurrencesStore.set(occ2.id, occ2);
      occurrencesStore.set(occ3.id, occ3);

      // Task 1 completion
      await tasksService.completeOccurrence(userId, occ1.id);
      let profile = profilesStore.get(userId);
      expect(profile?.currentStreak ?? 0).toBe(0);
      expect(profile?.lastQualifiedDate ?? null).toBeNull();
      expect(transactionsLedger[0].pointsDelta).toBe(10);
      expect(transactionsLedger[0].metadata?.streakMultiplier).toBe(1.0);
      expect(transactionsLedger[0].metadata?.currentStreak).toBe(0);

      // Task 2 completion
      await tasksService.completeOccurrence(userId, occ2.id);
      profile = profilesStore.get(userId);
      expect(profile?.currentStreak ?? 0).toBe(0);
      expect(profile?.lastQualifiedDate ?? null).toBeNull();
      expect(transactionsLedger[1].pointsDelta).toBe(10);
      expect(transactionsLedger[1].metadata?.streakMultiplier).toBe(1.0);
      expect(transactionsLedger[1].metadata?.currentStreak).toBe(0);

      // Task 3 completion -> threshold (3) met! Qualifies streak!
      await tasksService.completeOccurrence(userId, occ3.id);
      profile = profilesStore.get(userId);
      expect(profile?.currentStreak).toBe(1);
      expect(profile?.longestStreak).toBe(1);
      expect(profile?.lastQualifiedDate).toBe('2026-10-20');

      // Points awarded with active streak multiplier: 1.0 + 1 * 0.02 = 1.02
      // 10 * 1.02 = 10.2 -> 10 XP
      expect(transactionsLedger[2].pointsDelta).toBe(10);
      expect(transactionsLedger[2].metadata?.currentStreak).toBe(1);
      expect(transactionsLedger[2].metadata?.streakMultiplier).toBe(1.02);
      expect(transactionsLedger[2].metadata?.onTime).toBe(true);
    });

    it('Same-Day Idempotency: 4th and 5th completed tasks on the same date award XP with active multiplier but do NOT increment currentStreak again', async () => {
      // Set profile as already qualified today
      profilesStore.set(userId, {
        id: 'prof-1',
        userId,
        currentStreak: 1,
        longestStreak: 1,
        lastQualifiedDate: '2026-10-20',
      } as GamificationProfile);

      const occ4 = {
        id: 'occ-p3-4',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        date: '2026-10-20',
        scheduledStartTime: '12:00',
        scheduledDueAt: new Date('2026-10-20T16:00:00Z'),
      } as TaskOccurrence;
      const occ5 = {
        id: 'occ-p3-5',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        date: '2026-10-20',
        scheduledStartTime: '13:00',
        scheduledDueAt: new Date('2026-10-20T17:00:00Z'),
      } as TaskOccurrence;

      occurrencesStore.set(occ4.id, occ4);
      occurrencesStore.set(occ5.id, occ5);

      // 4th completion
      await tasksService.completeOccurrence(userId, occ4.id);
      let profile = profilesStore.get(userId);
      expect(profile?.currentStreak).toBe(1);
      expect(transactionsLedger).toHaveLength(1);
      expect(transactionsLedger[0].metadata?.currentStreak).toBe(1);
      expect(transactionsLedger[0].metadata?.streakMultiplier).toBe(1.02);

      // 5th completion
      await tasksService.completeOccurrence(userId, occ5.id);
      profile = profilesStore.get(userId);
      expect(profile?.currentStreak).toBe(1); // Still 1!
      expect(transactionsLedger).toHaveLength(2);
      expect(transactionsLedger[1].metadata?.currentStreak).toBe(1);
      expect(transactionsLedger[1].metadata?.streakMultiplier).toBe(1.02);
    });

    it('Consecutive Progression: qualifying on consecutive days increments currentStreak (1 -> 2) and updates longestStreak', async () => {
      // User qualified on 2026-10-20 with streak 1
      profilesStore.set(userId, {
        id: 'prof-1',
        userId,
        currentStreak: 1,
        longestStreak: 1,
        lastQualifiedDate: '2026-10-20',
      } as GamificationProfile);

      // Advance clock to next day: 2026-10-21
      jest.setSystemTime(new Date('2026-10-21T12:00:00Z'));

      const occ1 = {
        id: 'occ-next-1',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        date: '2026-10-21',
        scheduledDueAt: new Date('2026-10-21T16:00:00Z'),
      } as TaskOccurrence;
      const occ2 = {
        id: 'occ-next-2',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        date: '2026-10-21',
        scheduledDueAt: new Date('2026-10-21T16:00:00Z'),
      } as TaskOccurrence;
      const occ3 = {
        id: 'occ-next-3',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        date: '2026-10-21',
        scheduledDueAt: new Date('2026-10-21T16:00:00Z'),
      } as TaskOccurrence;

      occurrencesStore.set(occ1.id, occ1);
      occurrencesStore.set(occ2.id, occ2);
      occurrencesStore.set(occ3.id, occ3);

      await tasksService.completeOccurrence(userId, occ1.id);
      await tasksService.completeOccurrence(userId, occ2.id);
      await tasksService.completeOccurrence(userId, occ3.id);

      const profile = profilesStore.get(userId);
      expect(profile?.currentStreak).toBe(2);
      expect(profile?.longestStreak).toBe(2);
      expect(profile?.lastQualifiedDate).toBe('2026-10-21');

      // 3rd completion has streak 2 multiplier (1.0 + 2 * 0.02 = 1.04)
      const lastTx = transactionsLedger[2];
      expect(lastTx.metadata?.currentStreak).toBe(2);
      expect(lastTx.metadata?.streakMultiplier).toBe(1.04);
    });

    it('Rest Days Preservation: qualifying after 2 days with zero scheduled occurrences preserves streak (2 -> 3)', async () => {
      // User last qualified on 2026-10-21 with streak 2
      profilesStore.set(userId, {
        id: 'prof-1',
        userId,
        currentStreak: 2,
        longestStreak: 2,
        lastQualifiedDate: '2026-10-21',
      } as GamificationProfile);

      // Fast-forward 3 days to 2026-10-24. No tasks on 2026-10-22 or 2026-10-23
      jest.setSystemTime(new Date('2026-10-24T12:00:00Z'));

      const occ1 = {
        id: 'occ-rest-1',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        date: '2026-10-24',
        scheduledDueAt: new Date('2026-10-24T16:00:00Z'),
      } as TaskOccurrence;
      const occ2 = {
        id: 'occ-rest-2',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        date: '2026-10-24',
        scheduledDueAt: new Date('2026-10-24T16:00:00Z'),
      } as TaskOccurrence;
      const occ3 = {
        id: 'occ-rest-3',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        date: '2026-10-24',
        scheduledDueAt: new Date('2026-10-24T16:00:00Z'),
      } as TaskOccurrence;

      occurrencesStore.set(occ1.id, occ1);
      occurrencesStore.set(occ2.id, occ2);
      occurrencesStore.set(occ3.id, occ3);

      await tasksService.completeOccurrence(userId, occ1.id);
      await tasksService.completeOccurrence(userId, occ2.id);
      await tasksService.completeOccurrence(userId, occ3.id);

      const profile = profilesStore.get(userId);
      expect(profile?.currentStreak).toBe(3); // Preserved & incremented!
      expect(profile?.longestStreak).toBe(3);
      expect(profile?.lastQualifiedDate).toBe('2026-10-24');

      // Multiplier at streak 3: 1.0 + 3 * 0.02 = 1.06
      // 10 * 1.06 = 10.6 -> Math.round(10.6) = 11 XP!
      const lastTx = transactionsLedger[2];
      expect(lastTx.pointsDelta).toBe(11);
      expect(lastTx.metadata?.currentStreak).toBe(3);
      expect(lastTx.metadata?.streakMultiplier).toBe(1.06);
    });

    it('Broken Streak Reset: qualifying after a gap day containing scheduled tasks that were not completed resets streak to 1', async () => {
      // User last qualified on 2026-10-21 with streak 5, longest 5
      profilesStore.set(userId, {
        id: 'prof-1',
        userId,
        currentStreak: 5,
        longestStreak: 5,
        lastQualifiedDate: '2026-10-21',
      } as GamificationProfile);

      // On 2026-10-22 (gap day), user had an occurrence that remained PENDING (not completed)
      const missedOcc = {
        id: 'occ-missed',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        date: '2026-10-22',
      } as TaskOccurrence;
      occurrencesStore.set(missedOcc.id, missedOcc);

      // Fast-forward to 2026-10-23
      jest.setSystemTime(new Date('2026-10-23T12:00:00Z'));

      const occ1 = {
        id: 'occ-brk-1',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        date: '2026-10-23',
        scheduledDueAt: new Date('2026-10-23T16:00:00Z'),
      } as TaskOccurrence;
      const occ2 = {
        id: 'occ-brk-2',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        date: '2026-10-23',
        scheduledDueAt: new Date('2026-10-23T16:00:00Z'),
      } as TaskOccurrence;
      const occ3 = {
        id: 'occ-brk-3',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        date: '2026-10-23',
        scheduledDueAt: new Date('2026-10-23T16:00:00Z'),
      } as TaskOccurrence;

      occurrencesStore.set(occ1.id, occ1);
      occurrencesStore.set(occ2.id, occ2);
      occurrencesStore.set(occ3.id, occ3);

      await tasksService.completeOccurrence(userId, occ1.id);
      await tasksService.completeOccurrence(userId, occ2.id);
      await tasksService.completeOccurrence(userId, occ3.id);

      const profile = profilesStore.get(userId);
      // Reset to 1 because 2026-10-22 had scheduled tasks that weren't completed!
      expect(profile?.currentStreak).toBe(1);
      expect(profile?.longestStreak).toBe(5); // Retains highest historical longest streak
      expect(profile?.lastQualifiedDate).toBe('2026-10-23');

      const lastTx = transactionsLedger[2];
      expect(lastTx.metadata?.currentStreak).toBe(1);
      expect(lastTx.metadata?.streakMultiplier).toBe(1.02);
    });

    it('Multiplier Math & Capping: scales XP and stops increasing once MAXIMUM_MULTIPLIER (1.50) is reached', async () => {
      // User with streak 25 (1.0 + 25 * 0.02 = 1.50)
      profilesStore.set(userId, {
        id: 'prof-1',
        userId,
        currentStreak: 25,
        longestStreak: 25,
        lastQualifiedDate: '2026-10-20',
      } as GamificationProfile);

      const occ = {
        id: 'occ-cap-25',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        date: '2026-10-20',
        scheduledDueAt: new Date('2026-10-20T16:00:00Z'), // on-time (base 10)
      } as TaskOccurrence;
      occurrencesStore.set(occ.id, occ);

      await tasksService.completeOccurrence(userId, occ.id);
      // 10 * 1.50 = 15 XP
      expect(transactionsLedger[0].pointsDelta).toBe(15);
      expect(transactionsLedger[0].metadata?.streakMultiplier).toBe(1.5);
      expect(transactionsLedger[0].metadata?.currentStreak).toBe(25);

      // User with streak 30 (would be 1.60, but capped at 1.50)
      profilesStore.set(userId, {
        id: 'prof-1',
        userId,
        currentStreak: 30,
        longestStreak: 30,
        lastQualifiedDate: '2026-10-20',
      } as GamificationProfile);

      const occ2 = {
        id: 'occ-cap-30',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        date: '2026-10-20',
        scheduledDueAt: new Date('2026-10-20T16:00:00Z'), // on-time (base 10)
      } as TaskOccurrence;
      occurrencesStore.set(occ2.id, occ2);

      await tasksService.completeOccurrence(userId, occ2.id);
      // Still 15 XP because 1.50 is the maximum multiplier
      expect(transactionsLedger[1].pointsDelta).toBe(15);
      expect(transactionsLedger[1].metadata?.streakMultiplier).toBe(1.5);
      expect(transactionsLedger[1].metadata?.currentStreak).toBe(30);
    });

    it('Transactional Rollback: rolls back occurrence update, streak profile update, and point transaction if transaction fails', async () => {
      const occ1 = {
        id: 'occ-rb-1',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.COMPLETED,
        date: '2026-10-20',
      } as TaskOccurrence;
      const occ2 = {
        id: 'occ-rb-2',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.COMPLETED,
        date: '2026-10-20',
      } as TaskOccurrence;
      const occ3 = {
        id: 'occ-rb-3',
        taskId: 'task-1',
        status: TaskOccurrenceStatus.PENDING,
        date: '2026-10-20',
        scheduledDueAt: new Date('2026-10-20T16:00:00Z'),
      } as TaskOccurrence;

      occurrencesStore.set(occ1.id, occ1);
      occurrencesStore.set(occ2.id, occ2);
      occurrencesStore.set(occ3.id, occ3);

      profilesStore.set(userId, {
        id: 'prof-1',
        userId,
        currentStreak: 0,
        longestStreak: 0,
        lastQualifiedDate: null,
      } as GamificationProfile);

      jest
        .spyOn(gamificationService, 'awardTaskOccurrenceXp')
        .mockRejectedValueOnce(new Error('Simulated database write conflict'));

      await expect(
        tasksService.completeOccurrence(userId, occ3.id),
      ).rejects.toThrow('Simulated database write conflict');

      // Occurrence was NOT changed to COMPLETED
      expect(occurrencesStore.get(occ3.id)?.status).toBe(
        TaskOccurrenceStatus.PENDING,
      );
      // Profile streak was NOT incremented
      expect(profilesStore.get(userId)?.currentStreak).toBe(0);
      expect(profilesStore.get(userId)?.lastQualifiedDate).toBeNull();
      // Ledger has NO new transaction
      expect(transactionsLedger).toHaveLength(0);
    });
  });
});
