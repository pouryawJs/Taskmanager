import { Test, TestingModule } from '@nestjs/testing';
import {
  DataSource,
  EntityManager,
  QueryFailedError,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';

import {
  GamificationProfile,
  PointTransaction,
  TaskOccurrence,
  TaskOccurrenceStatus,
} from '@app/database';
import {
  GamificationService,
  TaskOccurrenceSummary,
} from './gamification.service';
import {
  BASE_XP_REWARDS,
  GAMIFICATION_TRANSACTION_REASONS,
} from './constants/gamification.constants';

describe('GamificationService (Phase 1)', () => {
  let service: GamificationService;
  let dataSource: jest.Mocked<DataSource>;
  let profileRepo: jest.Mocked<Repository<GamificationProfile>>;
  let pointTxRepo: jest.Mocked<Repository<PointTransaction>>;
  let occurrenceRepo: jest.Mocked<Repository<TaskOccurrence>>;
  let queryBuilder: jest.Mocked<SelectQueryBuilder<PointTransaction>>;

  const mockUserId = '11111111-1111-4111-8111-111111111111';

  beforeEach(async () => {
    queryBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn(),
    } as unknown as jest.Mocked<SelectQueryBuilder<PointTransaction>>;

    profileRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<GamificationProfile>>;

    pointTxRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    } as unknown as jest.Mocked<Repository<PointTransaction>>;

    occurrenceRepo = {
      createQueryBuilder: jest.fn(() => ({
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
      find: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<Repository<TaskOccurrence>>;

    dataSource = {
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === GamificationProfile) return profileRepo;
        if (entity === PointTransaction) return pointTxRepo;
        if (entity === TaskOccurrence) return occurrenceRepo;
        throw new Error(`Unexpected entity: ${entity.name}`);
      }),
    } as unknown as jest.Mocked<DataSource>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GamificationService,
        {
          provide: DataSource,
          useValue: dataSource,
        },
      ],
    }).compile();

    service = module.get<GamificationService>(GamificationService);
  });

  describe('getProfile', () => {
    it('should return null when profile does not exist', async () => {
      profileRepo.findOne.mockResolvedValue(null);

      const result = await service.getProfile(mockUserId);

      expect(result).toBeNull();
      expect(profileRepo.findOne).toHaveBeenCalledWith({
        where: { userId: mockUserId },
      });
    });

    it('should return the existing profile when found', async () => {
      const existingProfile = new GamificationProfile();
      existingProfile.userId = mockUserId;
      existingProfile.currentStreak = 4;
      existingProfile.longestStreak = 10;
      existingProfile.lastQualifiedDate = '2026-10-18';

      profileRepo.findOne.mockResolvedValue(existingProfile);

      const result = await service.getProfile(mockUserId);

      expect(result).toBe(existingProfile);
      expect(result?.currentStreak).toBe(4);
      expect(result?.longestStreak).toBe(10);
    });
  });

  describe('getOrCreateProfile', () => {
    it('should return existing profile if one already exists', async () => {
      const existingProfile = new GamificationProfile();
      existingProfile.userId = mockUserId;
      existingProfile.currentStreak = 2;

      profileRepo.findOne.mockResolvedValue(existingProfile);

      const result = await service.getOrCreateProfile(mockUserId);

      expect(result).toBe(existingProfile);
      expect(profileRepo.create).not.toHaveBeenCalled();
      expect(profileRepo.save).not.toHaveBeenCalled();
    });

    it('should create and save a new profile with 0 streaks if none exists', async () => {
      profileRepo.findOne.mockResolvedValue(null);

      const newProfile = new GamificationProfile();
      newProfile.userId = mockUserId;
      newProfile.currentStreak = 0;
      newProfile.longestStreak = 0;
      newProfile.lastQualifiedDate = null;

      profileRepo.create.mockReturnValue(newProfile);
      profileRepo.save.mockResolvedValue(newProfile);

      const result = await service.getOrCreateProfile(mockUserId);

      expect(result).toBe(newProfile);
      expect(profileRepo.create).toHaveBeenCalledWith({
        userId: mockUserId,
        currentStreak: 0,
        longestStreak: 0,
        lastQualifiedDate: null,
      });
      expect(profileRepo.save).toHaveBeenCalledWith(newProfile);
    });

    it('should handle PostgreSQL unique constraint violation (23505) and return existing profile', async () => {
      const existingProfile = new GamificationProfile();
      existingProfile.userId = mockUserId;
      existingProfile.currentStreak = 1;

      // 1. Initial check returns null
      profileRepo.findOne
        .mockResolvedValueOnce(null)
        // 2. Subsequent check after caught 23505 returns existing profile
        .mockResolvedValueOnce(existingProfile);

      const newProfile = new GamificationProfile();
      profileRepo.create.mockReturnValue(newProfile);

      const uniqueError = new QueryFailedError(
        'INSERT INTO ...',
        [],
        new Error('duplicate key value'),
      );
      (
        uniqueError as unknown as { driverError: { code: string } }
      ).driverError = {
        code: '23505',
      };

      profileRepo.save.mockRejectedValue(uniqueError);

      const result = await service.getOrCreateProfile(mockUserId);

      expect(result).toBe(existingProfile);
      expect(profileRepo.findOne).toHaveBeenCalledTimes(2);
    });

    it('should rethrow non-unique database errors', async () => {
      profileRepo.findOne.mockResolvedValue(null);
      const newProfile = new GamificationProfile();
      profileRepo.create.mockReturnValue(newProfile);

      const dbError = new Error('Connection lost');
      profileRepo.save.mockRejectedValue(dbError);

      await expect(service.getOrCreateProfile(mockUserId)).rejects.toThrow(
        'Connection lost',
      );
    });
  });

  describe('getUserTotalXp (Authoritative XP Ledger Summation)', () => {
    it('should return authoritative sum of all pointsDelta transactions', async () => {
      queryBuilder.getRawOne.mockResolvedValue({ total: '75' });

      const totalXp = await service.getUserTotalXp(mockUserId);

      expect(totalXp).toBe(75);
      expect(pointTxRepo.createQueryBuilder).toHaveBeenCalledWith('pt');
      expect(queryBuilder.select).toHaveBeenCalledWith(
        'COALESCE(SUM(pt.pointsDelta), 0)',
        'total',
      );
      expect(queryBuilder.where).toHaveBeenCalledWith('pt.userId = :userId', {
        userId: mockUserId,
      });
    });

    it('should return 0 when user has no transactions in the ledger', async () => {
      queryBuilder.getRawOne.mockResolvedValue({ total: '0' });

      const totalXp = await service.getUserTotalXp(mockUserId);

      expect(totalXp).toBe(0);
    });

    it('should return 0 when query returns null or NaN', async () => {
      queryBuilder.getRawOne.mockResolvedValue(null);

      const totalXp = await service.getUserTotalXp(mockUserId);

      expect(totalXp).toBe(0);
    });
  });

  describe('getGamificationOverview', () => {
    it('should return combined state of total XP from ledger and persistent streak metrics', async () => {
      const profile = new GamificationProfile();
      profile.userId = mockUserId;
      profile.currentStreak = 6;
      profile.longestStreak = 14;
      profile.lastQualifiedDate = '2026-10-18';

      profileRepo.findOne.mockResolvedValue(profile);
      queryBuilder.getRawOne.mockResolvedValue({ total: '120' });

      const overview = await service.getGamificationOverview(mockUserId);

      expect(overview).toEqual({
        totalXp: 120,
        currentStreak: 6,
        longestStreak: 14,
        lastQualifiedDate: '2026-10-18',
        levelInfo: {
          currentLevel: 2,
          currentLevelXp: 70,
          xpRequiredForNextLevel: 75,
          progressPercentage: 93.3,
          tierTitle: 'شروعکننده',
        },
        consistencyScore: {
          score: 0,
          isProvisional: true,
          sampleCount: 0,
          completedCount: 0,
          partiallyCompletedCount: 0,
          notCompletedCount: 0,
          skippedCount: 0,
          cancelledCount: 0,
        },
      });
    });
  });

  describe('Phase 2 — calculateOccurrenceCompletionXp', () => {
    it('should award 10 base XP for on-time completion when completedAt <= scheduledDueAt', () => {
      const occurrence = {
        id: 'occ-1',
        status: TaskOccurrenceStatus.COMPLETED,
        scheduledStartTime: '09:00',
        scheduledDueAt: new Date('2026-10-25T10:00:00.000Z'),
        completedAt: new Date('2026-10-25T09:55:00.000Z'),
      } as TaskOccurrence;

      const result = service.calculateOccurrenceCompletionXp(occurrence);

      expect(result).toEqual({
        targetXp: BASE_XP_REWARDS.ON_TIME_COMPLETION,
        timing: 'on_time',
        isEligible: true,
      });
      expect(result.targetXp).toBe(10);
    });

    it('should award 7 base XP for late completion when completedAt > scheduledDueAt', () => {
      const occurrence = {
        id: 'occ-2',
        status: TaskOccurrenceStatus.COMPLETED,
        scheduledStartTime: '09:00',
        scheduledDueAt: new Date('2026-10-25T10:00:00.000Z'),
        completedAt: new Date('2026-10-25T10:05:00.000Z'),
      } as TaskOccurrence;

      const result = service.calculateOccurrenceCompletionXp(occurrence);

      expect(result).toEqual({
        targetXp: BASE_XP_REWARDS.LATE_COMPLETION,
        timing: 'late',
        isEligible: true,
      });
      expect(result.targetXp).toBe(7);
    });

    it('should award 7 base XP for completion when scheduledDueAt is null without inferring deadline from scheduledStartTime', () => {
      const occurrence = {
        id: 'occ-3',
        status: TaskOccurrenceStatus.COMPLETED,
        scheduledStartTime: '09:00', // Has scheduledStartTime, but NO scheduledDueAt
        scheduledDueAt: null,
        completedAt: new Date('2026-10-25T15:00:00.000Z'),
      } as TaskOccurrence;

      const result = service.calculateOccurrenceCompletionXp(occurrence);

      expect(result).toEqual({
        targetXp: BASE_XP_REWARDS.NO_DEADLINE_COMPLETION,
        timing: 'no_deadline',
        isEligible: true,
      });
      expect(result.targetXp).toBe(7);
    });

    it('should award 4 base XP for partial completion', () => {
      const occurrence = {
        id: 'occ-4',
        status: TaskOccurrenceStatus.PARTIALLY_COMPLETED,
        scheduledStartTime: '09:00',
        scheduledDueAt: new Date('2026-10-25T10:00:00.000Z'),
        completedAt: new Date('2026-10-25T09:30:00.000Z'),
      } as TaskOccurrence;

      const result = service.calculateOccurrenceCompletionXp(occurrence);

      expect(result).toEqual({
        targetXp: BASE_XP_REWARDS.PARTIAL_COMPLETION,
        timing: 'partial',
        isEligible: true,
      });
      expect(result.targetXp).toBe(4);
    });

    it.each([
      TaskOccurrenceStatus.PENDING,
      TaskOccurrenceStatus.IN_PROGRESS,
      TaskOccurrenceStatus.NOT_COMPLETED,
      TaskOccurrenceStatus.SKIPPED,
      TaskOccurrenceStatus.CANCELLED,
    ])('should award 0 XP for %s status', (status) => {
      const occurrence = {
        id: 'occ-5',
        status,
        scheduledDueAt: new Date('2026-10-25T10:00:00.000Z'),
      } as TaskOccurrence;

      const result = service.calculateOccurrenceCompletionXp(occurrence);

      expect(result).toEqual({
        targetXp: 0,
        timing: 'ineligible',
        isEligible: false,
      });
    });
  });

  describe('Phase 2 — buildTaskOccurrenceIdempotencyKey', () => {
    it('should format full completion idempotency key as task_completion:<id>', () => {
      const key = service.buildTaskOccurrenceIdempotencyKey(
        'occ-uuid-1',
        TaskOccurrenceStatus.COMPLETED,
      );
      expect(key).toBe('task_completion:occ-uuid-1');
    });

    it('should format partial completion idempotency key as task_partial_completion:<id>', () => {
      const key = service.buildTaskOccurrenceIdempotencyKey(
        'occ-uuid-2',
        TaskOccurrenceStatus.PARTIALLY_COMPLETED,
      );
      expect(key).toBe('task_partial_completion:occ-uuid-2');
    });
  });

  describe('Phase 2 — awardTaskOccurrenceXp (Safe, Immediate, Idempotent XP Awards)', () => {
    let mockManager: EntityManager;
    let mockInsertQueryBuilder: any;
    let mockTxRepo: any;

    beforeEach(() => {
      mockInsertQueryBuilder = {
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orIgnore: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({
          identifiers: [{ id: 'tx-uuid-1' }],
          raw: [{ id: 'tx-uuid-1' }],
        }),
      };

      mockTxRepo = {
        find: jest.fn().mockResolvedValue([]),
        create: jest.fn((dto) => dto),
        save: jest.fn((tx) => Promise.resolve({ id: 'tx-uuid-1', ...tx })),
      };

      mockManager = {
        getRepository: jest.fn((entity) => {
          if (entity === PointTransaction) return mockTxRepo;
          return null;
        }),
        createQueryBuilder: jest.fn().mockReturnValue(mockInsertQueryBuilder),
      } as unknown as EntityManager;
    });

    it('should not award XP or insert transaction for ineligible outcomes (e.g. skipped or cancelled)', async () => {
      const occurrence = {
        id: 'occ-10',
        status: TaskOccurrenceStatus.SKIPPED,
      } as TaskOccurrence;

      const result = await service.awardTaskOccurrenceXp(
        mockManager,
        occurrence,
        mockUserId,
      );

      expect(result.awarded).toBe(false);
      expect(result.pointsDelta).toBe(0);
      expect(mockManager.createQueryBuilder).not.toHaveBeenCalled();
      expect(mockTxRepo.find).not.toHaveBeenCalled();
    });

    it('should award 10 base XP for on-time completion using ON CONFLICT DO NOTHING', async () => {
      const occurrence = {
        id: 'occ-11',
        status: TaskOccurrenceStatus.COMPLETED,
        scheduledDueAt: new Date('2026-10-25T10:00:00.000Z'),
        completedAt: new Date('2026-10-25T09:50:00.000Z'),
      } as TaskOccurrence;

      const result = await service.awardTaskOccurrenceXp(
        mockManager,
        occurrence,
        mockUserId,
      );

      expect(result.awarded).toBe(true);
      expect(result.pointsDelta).toBe(10);
      expect(result.timing).toBe('on_time');
      expect(result.idempotencyKey).toBe('task_completion:occ-11');

      expect(mockInsertQueryBuilder.values).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUserId,
          taskOccurrenceId: 'occ-11',
          pointsDelta: 10,
          reason: GAMIFICATION_TRANSACTION_REASONS.TASK_COMPLETION,
          idempotencyKey: 'task_completion:occ-11',
          metadata: expect.objectContaining({
            timing: 'on_time',
            targetXp: 10,
            alreadyAwardedXp: 0,
            streakMultiplier: 1.0,
          }),
        }),
      );
      expect(mockInsertQueryBuilder.orIgnore).toHaveBeenCalled();
    });

    it('should award 7 base XP for late completion', async () => {
      const occurrence = {
        id: 'occ-12',
        status: TaskOccurrenceStatus.COMPLETED,
        scheduledDueAt: new Date('2026-10-25T10:00:00.000Z'),
        completedAt: new Date('2026-10-25T10:15:00.000Z'),
      } as TaskOccurrence;

      const result = await service.awardTaskOccurrenceXp(
        mockManager,
        occurrence,
        mockUserId,
      );

      expect(result.awarded).toBe(true);
      expect(result.pointsDelta).toBe(7);
      expect(result.timing).toBe('late');
      expect(mockInsertQueryBuilder.values).toHaveBeenCalledWith(
        expect.objectContaining({
          pointsDelta: 7,
          metadata: expect.objectContaining({ timing: 'late', targetXp: 7 }),
        }),
      );
    });

    it('should award 7 base XP for deadline-less completion', async () => {
      const occurrence = {
        id: 'occ-13',
        status: TaskOccurrenceStatus.COMPLETED,
        scheduledStartTime: '08:00',
        scheduledDueAt: null,
        completedAt: new Date('2026-10-25T18:00:00.000Z'),
      } as TaskOccurrence;

      const result = await service.awardTaskOccurrenceXp(
        mockManager,
        occurrence,
        mockUserId,
      );

      expect(result.awarded).toBe(true);
      expect(result.pointsDelta).toBe(7);
      expect(result.timing).toBe('no_deadline');
      expect(mockInsertQueryBuilder.values).toHaveBeenCalledWith(
        expect.objectContaining({
          pointsDelta: 7,
          metadata: expect.objectContaining({
            timing: 'no_deadline',
            targetXp: 7,
          }),
        }),
      );
    });

    it('should award 4 base XP for partial completion', async () => {
      const occurrence = {
        id: 'occ-14',
        status: TaskOccurrenceStatus.PARTIALLY_COMPLETED,
        completedAt: new Date('2026-10-25T12:00:00.000Z'),
      } as TaskOccurrence;

      const result = await service.awardTaskOccurrenceXp(
        mockManager,
        occurrence,
        mockUserId,
      );

      expect(result.awarded).toBe(true);
      expect(result.pointsDelta).toBe(4);
      expect(result.timing).toBe('partial');
      expect(result.idempotencyKey).toBe('task_partial_completion:occ-14');
    });

    it('should award only the remaining delta (6 XP) when transitioning from partial to on-time completion', async () => {
      // Occurrence already had a partial transaction of 4 XP
      mockTxRepo.find.mockResolvedValue([
        {
          id: 'prev-tx-1',
          taskOccurrenceId: 'occ-15',
          pointsDelta: 4,
          idempotencyKey: 'task_partial_completion:occ-15',
        },
      ]);

      const occurrence = {
        id: 'occ-15',
        status: TaskOccurrenceStatus.COMPLETED,
        scheduledDueAt: new Date('2026-10-25T10:00:00.000Z'),
        completedAt: new Date('2026-10-25T09:45:00.000Z'),
      } as TaskOccurrence;

      const result = await service.awardTaskOccurrenceXp(
        mockManager,
        occurrence,
        mockUserId,
      );

      expect(result.awarded).toBe(true);
      expect(result.pointsDelta).toBe(6); // 10 target - 4 already awarded = 6 delta
      expect(result.idempotencyKey).toBe('task_completion:occ-15');
      expect(mockInsertQueryBuilder.values).toHaveBeenCalledWith(
        expect.objectContaining({
          pointsDelta: 6,
          metadata: expect.objectContaining({
            alreadyAwardedXp: 4,
            targetXp: 10,
          }),
        }),
      );
    });

    it('should be idempotent and not award extra XP if occurrence was already awarded full XP', async () => {
      mockTxRepo.find.mockResolvedValue([
        {
          id: 'prev-tx-1',
          taskOccurrenceId: 'occ-16',
          pointsDelta: 10,
          idempotencyKey: 'task_completion:occ-16',
        },
      ]);

      const occurrence = {
        id: 'occ-16',
        status: TaskOccurrenceStatus.COMPLETED,
        scheduledDueAt: new Date('2026-10-25T10:00:00.000Z'),
        completedAt: new Date('2026-10-25T09:45:00.000Z'),
      } as TaskOccurrence;

      const result = await service.awardTaskOccurrenceXp(
        mockManager,
        occurrence,
        mockUserId,
      );

      expect(result.awarded).toBe(false);
      expect(result.pointsDelta).toBe(0);
      expect(mockInsertQueryBuilder.execute).not.toHaveBeenCalled();
    });

    it('should safely handle concurrent conflict (ON CONFLICT DO NOTHING) without aborting the transaction', async () => {
      // Simulate ON CONFLICT DO NOTHING where PostgreSQL ignored duplicate insert: 0 rows returned
      mockInsertQueryBuilder.execute.mockResolvedValue({
        identifiers: [],
        raw: [],
      });

      const occurrence = {
        id: 'occ-17',
        status: TaskOccurrenceStatus.COMPLETED,
        scheduledDueAt: new Date('2026-10-25T10:00:00.000Z'),
        completedAt: new Date('2026-10-25T09:45:00.000Z'),
      } as TaskOccurrence;

      const result = await service.awardTaskOccurrenceXp(
        mockManager,
        occurrence,
        mockUserId,
      );

      expect(result.awarded).toBe(false);
      expect(result.pointsDelta).toBe(0);
    });

    it('should propagate unexpected database errors to ensure atomic transaction rollback', async () => {
      mockInsertQueryBuilder.execute.mockRejectedValue(
        new Error('Fatal database connection error'),
      );

      const occurrence = {
        id: 'occ-18',
        status: TaskOccurrenceStatus.COMPLETED,
        scheduledDueAt: new Date('2026-10-25T10:00:00.000Z'),
        completedAt: new Date('2026-10-25T09:45:00.000Z'),
      } as TaskOccurrence;

      await expect(
        service.awardTaskOccurrenceXp(mockManager, occurrence, mockUserId),
      ).rejects.toThrow('Fatal database connection error');
    });

    it('should use repository save fallback when query builder is not available', async () => {
      delete mockManager.createQueryBuilder;

      const occurrence = {
        id: 'occ-19',
        status: TaskOccurrenceStatus.COMPLETED,
        scheduledDueAt: new Date('2026-10-25T10:00:00.000Z'),
        completedAt: new Date('2026-10-25T09:45:00.000Z'),
      } as TaskOccurrence;

      const result = await service.awardTaskOccurrenceXp(
        mockManager,
        occurrence,
        mockUserId,
      );

      expect(result.awarded).toBe(true);
      expect(result.pointsDelta).toBe(10);
      expect(mockTxRepo.create).toHaveBeenCalled();
      expect(mockTxRepo.save).toHaveBeenCalled();
    });
  });

  describe('Phase 3 — calculateStreakMultiplier', () => {
    it('should return baseline multiplier 1.0 for 0 or negative streaks', () => {
      expect(service.calculateStreakMultiplier(0)).toBe(1.0);
      expect(service.calculateStreakMultiplier(-5)).toBe(1.0);
    });

    it('should return 1.02 for streak of 1', () => {
      expect(service.calculateStreakMultiplier(1)).toBe(1.02);
    });

    it('should return 1.06 for streak of 3', () => {
      expect(service.calculateStreakMultiplier(3)).toBe(1.06);
    });

    it('should return 1.50 at maximum cap when streak is 25', () => {
      expect(service.calculateStreakMultiplier(25)).toBe(1.5);
    });

    it('should cap multiplier at MAXIMUM_MULTIPLIER (1.50) when streak exceeds 25', () => {
      expect(service.calculateStreakMultiplier(30)).toBe(1.5);
      expect(service.calculateStreakMultiplier(100)).toBe(1.5);
    });
  });

  describe('Phase 3 — evaluateStreakProgression', () => {
    let mockTxManager: EntityManager;
    let mockProfileRepo: any;
    let mockOccRepo: any;
    let mockUserSettingsRepo: any;

    const testUserId = 'user-streak-test';
    const fakeToday = new Date('2026-10-20T12:00:00.000Z'); // 2026-10-20

    beforeEach(() => {
      mockProfileRepo = {
        save: jest.fn((p) => Promise.resolve(p)),
      };

      mockOccRepo = {
        createQueryBuilder: jest.fn(() => ({
          innerJoin: jest.fn().mockReturnThis(),
          innerJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getCount: jest.fn().mockResolvedValue(0),
          getMany: jest.fn().mockResolvedValue([]),
        })),
        find: jest.fn().mockResolvedValue([]),
      };

      mockUserSettingsRepo = {
        findOne: jest.fn().mockResolvedValue({ timezone: 'UTC' }),
      };

      mockTxManager = {
        getRepository: jest.fn((entity) => {
          if (entity === GamificationProfile) return mockProfileRepo;
          if (entity === TaskOccurrence) return mockOccRepo;
          if (entity === UserSettings) return mockUserSettingsRepo;
          return null;
        }),
      } as unknown as EntityManager;
    });

    it('should not advance streak if completed task count today is less than 3', async () => {
      const profile = {
        userId: testUserId,
        currentStreak: 2,
        longestStreak: 5,
        lastQualifiedDate: '2026-10-19',
      } as GamificationProfile;

      // Mock 2 completed tasks today
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(2),
      };
      mockOccRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.evaluateStreakProgression(
        mockTxManager,
        testUserId,
        profile,
        fakeToday,
      );

      expect(result.currentStreak).toBe(2);
      expect(result.lastQualifiedDate).toBe('2026-10-19');
      expect(mockProfileRepo.save).not.toHaveBeenCalled();
    });

    it('should qualify day and advance initial streak (1) when 3 tasks are completed', async () => {
      const profile = {
        userId: testUserId,
        currentStreak: 0,
        longestStreak: 0,
        lastQualifiedDate: null,
      } as GamificationProfile;

      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(3),
      };
      mockOccRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.evaluateStreakProgression(
        mockTxManager,
        testUserId,
        profile,
        fakeToday,
      );

      expect(result.currentStreak).toBe(1);
      expect(result.longestStreak).toBe(1);
      expect(result.lastQualifiedDate).toBe('2026-10-20');
      expect(mockProfileRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          currentStreak: 1,
          longestStreak: 1,
          lastQualifiedDate: '2026-10-20',
        }),
      );
    });

    it('should be idempotent and not increment streak multiple times on the same date', async () => {
      const profile = {
        userId: testUserId,
        currentStreak: 4,
        longestStreak: 7,
        lastQualifiedDate: '2026-10-20', // Already qualified today
      } as GamificationProfile;

      const result = await service.evaluateStreakProgression(
        mockTxManager,
        testUserId,
        profile,
        fakeToday,
      );

      expect(result.currentStreak).toBe(4);
      expect(mockOccRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(mockProfileRepo.save).not.toHaveBeenCalled();
    });

    it('should increment streak on consecutive qualifying day (1 -> 2 -> 3)', async () => {
      const profile = {
        userId: testUserId,
        currentStreak: 2,
        longestStreak: 2,
        lastQualifiedDate: '2026-10-19', // Yesterday in UTC
      } as GamificationProfile;

      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(3),
      };
      mockOccRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.evaluateStreakProgression(
        mockTxManager,
        testUserId,
        profile,
        fakeToday,
      );

      expect(result.currentStreak).toBe(3);
      expect(result.longestStreak).toBe(3);
      expect(result.lastQualifiedDate).toBe('2026-10-20');
      expect(mockProfileRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          currentStreak: 3,
          longestStreak: 3,
        }),
      );
    });

    it('should preserve and advance streak when gap days were rest days (zero scheduled occurrences)', async () => {
      const profile = {
        userId: testUserId,
        currentStreak: 2,
        longestStreak: 4,
        lastQualifiedDate: '2026-10-17', // 3 days ago: gap is 2026-10-18 and 2026-10-19
      } as GamificationProfile;

      // 1. Today has 3 completed occurrences
      const countQb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(3),
      };

      // 2. Gap query returns 0 occurrences (rest days)
      const gapQb = {
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };

      mockOccRepo.createQueryBuilder
        .mockReturnValueOnce(countQb)
        .mockReturnValueOnce(gapQb);

      const result = await service.evaluateStreakProgression(
        mockTxManager,
        testUserId,
        profile,
        fakeToday,
      );

      expect(result.currentStreak).toBe(3); // Preserved and incremented: 2 + 1 = 3
      expect(result.longestStreak).toBe(4);
      expect(result.lastQualifiedDate).toBe('2026-10-20');
    });

    it('should reset streak to 1 when gap days had scheduled tasks that were not completed', async () => {
      const profile = {
        userId: testUserId,
        currentStreak: 5,
        longestStreak: 5,
        lastQualifiedDate: '2026-10-17', // Gap has 2026-10-18 and 2026-10-19
      } as GamificationProfile;

      const countQb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(3),
      };

      // Gap had 1 occurrence on 2026-10-18 that was NOT completed (missed commitment)
      const gapQb = {
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'gap-occ-1',
            date: '2026-10-18',
            status: TaskOccurrenceStatus.NOT_COMPLETED,
            task: { ownerId: testUserId },
          },
        ]),
      };

      mockOccRepo.createQueryBuilder
        .mockReturnValueOnce(countQb)
        .mockReturnValueOnce(gapQb);

      const result = await service.evaluateStreakProgression(
        mockTxManager,
        testUserId,
        profile,
        fakeToday,
      );

      expect(result.currentStreak).toBe(1); // Reset to 1
      expect(result.longestStreak).toBe(5); // Historical record preserved
      expect(result.lastQualifiedDate).toBe('2026-10-20');
    });
  });

  describe('Phase 3 — Dynamic Streak Multiplier XP Scaling', () => {
    let mockManager: EntityManager;
    let mockInsertQueryBuilder: any;
    let mockTxRepo: any;
    let mockProfileRepo: any;

    beforeEach(() => {
      mockInsertQueryBuilder = {
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orIgnore: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({
          identifiers: [{ id: 'tx-scaled-1' }],
          raw: [{ id: 'tx-scaled-1' }],
        }),
      };

      mockTxRepo = {
        find: jest.fn().mockResolvedValue([]),
        create: jest.fn((dto) => dto),
        save: jest.fn((tx) => Promise.resolve({ id: 'tx-scaled-1', ...tx })),
      };

      mockProfileRepo = {
        findOne: jest.fn().mockResolvedValue({
          userId: mockUserId,
          currentStreak: 3, // Streak 3 gives multiplier 1.06
          longestStreak: 5,
          lastQualifiedDate: '2026-10-25',
        }),
        create: jest.fn((p) => p),
        save: jest.fn((p) => Promise.resolve(p)),
      };

      mockManager = {
        getRepository: jest.fn((entity) => {
          if (entity === PointTransaction) return mockTxRepo;
          if (entity === GamificationProfile) return mockProfileRepo;
          return null;
        }),
        createQueryBuilder: jest.fn().mockReturnValue(mockInsertQueryBuilder),
      } as unknown as EntityManager;
    });

    it('should scale on-time completion XP using active streak multiplier (streak 3 -> 1.06 -> 11 XP)', async () => {
      const occurrence = {
        id: 'occ-scaled-ontime',
        status: TaskOccurrenceStatus.COMPLETED,
        scheduledDueAt: new Date('2026-10-25T10:00:00.000Z'),
        completedAt: new Date('2026-10-25T09:50:00.000Z'),
      } as TaskOccurrence;

      const result = await service.awardTaskOccurrenceXp(
        mockManager,
        occurrence,
        mockUserId,
      );

      expect(result.awarded).toBe(true);
      // Math.round(10 * 1.06) = 11
      expect(result.pointsDelta).toBe(11);

      expect(mockInsertQueryBuilder.values).toHaveBeenCalledWith(
        expect.objectContaining({
          pointsDelta: 11,
          metadata: expect.objectContaining({
            baseXp: 10,
            targetXp: 11,
            streakMultiplier: 1.06,
            currentStreak: 3,
            onTime: true,
          }),
        }),
      );
    });

    it('should award base XP (4) without streak multiplier for partial completion', async () => {
      const occurrence = {
        id: 'occ-partial-no-mult',
        status: TaskOccurrenceStatus.PARTIALLY_COMPLETED,
        completedAt: new Date('2026-10-25T09:50:00.000Z'),
      } as TaskOccurrence;

      const result = await service.awardTaskOccurrenceXp(
        mockManager,
        occurrence,
        mockUserId,
      );

      expect(result.awarded).toBe(true);
      expect(result.pointsDelta).toBe(4);

      expect(mockInsertQueryBuilder.values).toHaveBeenCalledWith(
        expect.objectContaining({
          pointsDelta: 4,
          metadata: expect.objectContaining({
            baseXp: 4,
            targetXp: 4,
            streakMultiplier: 1.0,
          }),
        }),
      );
    });
  });

  describe('Phase 4 — User Level Progression & Mathematical XP Curve', () => {
    describe('calculateLevelInfo', () => {
      it('0 XP returns Level 1, 0% progress, and tier title شروعکننده', () => {
        const info = service.calculateLevelInfo(0);
        expect(info).toEqual({
          currentLevel: 1,
          currentLevelXp: 0,
          xpRequiredForNextLevel: 50,
          progressPercentage: 0,
          tierTitle: 'شروعکننده',
        });
      });

      it('negative or nullish XP safely returns Level 1, 0% progress', () => {
        const infoNeg = service.calculateLevelInfo(-100);
        expect(infoNeg.currentLevel).toBe(1);
        expect(infoNeg.currentLevelXp).toBe(0);
        expect(infoNeg.progressPercentage).toBe(0);
        expect(infoNeg.tierTitle).toBe('شروعکننده');
      });

      it('exact boundary transitions: reaching threshold advances cleanly to Level 2 with 0% progress', () => {
        // 49 XP is still Level 1
        const info49 = service.calculateLevelInfo(49);
        expect(info49.currentLevel).toBe(1);
        expect(info49.currentLevelXp).toBe(49);
        expect(info49.progressPercentage).toBe(98);

        // 50 XP transitions to Level 2
        const info50 = service.calculateLevelInfo(50);
        expect(info50.currentLevel).toBe(2);
        expect(info50.currentLevelXp).toBe(0);
        expect(info50.xpRequiredForNextLevel).toBe(75);
        expect(info50.progressPercentage).toBe(0);
        expect(info50.tierTitle).toBe('شروعکننده');

        // 124 XP is still Level 2
        const info124 = service.calculateLevelInfo(124);
        expect(info124.currentLevel).toBe(2);
        expect(info124.currentLevelXp).toBe(74);

        // 125 XP transitions to Level 3
        const info125 = service.calculateLevelInfo(125);
        expect(info125.currentLevel).toBe(3);
        expect(info125.currentLevelXp).toBe(0);
        expect(info125.xpRequiredForNextLevel).toBe(100);
      });

      it('monotonic progression across higher levels (testing Level 5, 10, 20, 35) without errors or infinite loops', () => {
        // Level 5 requires 50 + 75 + 100 + 125 = 350 XP
        const infoL5 = service.calculateLevelInfo(350);
        expect(infoL5.currentLevel).toBe(5);
        expect(infoL5.currentLevelXp).toBe(0);
        expect(infoL5.tierTitle).toBe('شروعکننده');

        // Level 10 requires 1350 XP
        const infoL10 = service.calculateLevelInfo(1350);
        expect(infoL10.currentLevel).toBe(10);
        expect(infoL10.currentLevelXp).toBe(0);
        expect(infoL10.tierTitle).toBe('سازنده عادت');

        // Level 20 requires 5225 XP
        const infoL20 = service.calculateLevelInfo(5225);
        expect(infoL20.currentLevel).toBe(20);
        expect(infoL20.currentLevelXp).toBe(0);
        expect(infoL20.tierTitle).toBe('پایدار');

        // Level 35 requires 15725 XP
        const infoL35 = service.calculateLevelInfo(15725);
        expect(infoL35.currentLevel).toBe(35);
        expect(infoL35.currentLevelXp).toBe(0);
        expect(infoL35.tierTitle).toBe('استاد استمرار');
      });

      it('progressPercentage stays strictly within [0, 100]', () => {
        const testPoints = [0, 1, 25, 49, 50, 51, 100, 349, 350, 10000];
        for (const xp of testPoints) {
          const info = service.calculateLevelInfo(xp);
          expect(info.progressPercentage).toBeGreaterThanOrEqual(0);
          expect(info.progressPercentage).toBeLessThanOrEqual(100);
        }
      });

      it('tier titles accurately map to all 4 defined level ranges', () => {
        // Levels 1–5: شروعکننده
        expect(service.calculateLevelInfo(0).tierTitle).toBe('شروعکننده'); // L1
        expect(service.calculateLevelInfo(350).tierTitle).toBe('شروعکننده'); // L5

        // Levels 6–15: سازنده عادت
        expect(service.calculateLevelInfo(500).tierTitle).toBe('سازنده عادت'); // L6
        expect(service.calculateLevelInfo(1350).tierTitle).toBe('سازنده عادت'); // L10
        expect(service.calculateLevelInfo(3200).tierTitle).toBe('سازنده عادت'); // L15

        // Levels 16–30: پایدار
        expect(service.calculateLevelInfo(3625).tierTitle).toBe('پایدار'); // L16
        expect(service.calculateLevelInfo(5225).tierTitle).toBe('پایدار'); // L20
        expect(service.calculateLevelInfo(11825).tierTitle).toBe('پایدار'); // L30

        // Levels 31+: استاد استمرار
        expect(service.calculateLevelInfo(12625).tierTitle).toBe(
          'استاد استمرار',
        ); // L31
        expect(service.calculateLevelInfo(15725).tierTitle).toBe(
          'استاد استمرار',
        ); // L35
        expect(service.calculateLevelInfo(50000).tierTitle).toBe(
          'استاد استمرار',
        ); // L60+
      });
    });

    describe('calculateLevelMultiplier', () => {
      it('should calculate level-based multiplier and cap at MAX_LEVEL_MULTIPLIER (2.0)', () => {
        expect(service.calculateLevelMultiplier(1)).toBe(1.0);
        expect(service.calculateLevelMultiplier(2)).toBe(1.01);
        expect(service.calculateLevelMultiplier(11)).toBe(1.1);
        expect(service.calculateLevelMultiplier(101)).toBe(2.0);
        expect(service.calculateLevelMultiplier(150)).toBe(2.0); // capped at 2.0
      });
    });

    describe('getUserLevelInfo', () => {
      it('should fetch total XP from ledger and return derived level info', async () => {
        queryBuilder.getRawOne.mockResolvedValue({ total: '500' }); // L6
        const levelInfo = await service.getUserLevelInfo(mockUserId);
        expect(levelInfo.currentLevel).toBe(6);
        expect(levelInfo.tierTitle).toBe('سازنده عادت');
      });
    });
  });

  describe('Phase 5 — Consistency Score & Historical Performance Engine', () => {
    describe('calculateConsistencyScore', () => {
      it('clean zero-handling on empty history (returns 0 score, provisional true, no exceptions)', () => {
        const result = service.calculateConsistencyScore([]);
        expect(result).toEqual({
          score: 0,
          isProvisional: true,
          sampleCount: 0,
          completedCount: 0,
          partiallyCompletedCount: 0,
          notCompletedCount: 0,
          skippedCount: 0,
          cancelledCount: 0,
        });
      });

      it('100% on-time completion yields 100 score', () => {
        const occurrences: TaskOccurrenceSummary[] = [
          {
            status: TaskOccurrenceStatus.COMPLETED,
            completedAt: new Date('2026-10-20T09:00:00Z'),
            scheduledDueAt: new Date('2026-10-20T10:00:00Z'),
          },
          {
            status: TaskOccurrenceStatus.COMPLETED,
            completedAt: new Date('2026-10-20T11:00:00Z'),
            scheduledDueAt: new Date('2026-10-20T12:00:00Z'),
          },
          {
            status: TaskOccurrenceStatus.COMPLETED,
            completedAt: new Date('2026-10-20T13:00:00Z'),
            scheduledDueAt: new Date('2026-10-20T14:00:00Z'),
          },
          {
            status: TaskOccurrenceStatus.COMPLETED,
            completedAt: new Date('2026-10-20T15:00:00Z'),
            scheduledDueAt: new Date('2026-10-20T16:00:00Z'),
          },
          {
            status: TaskOccurrenceStatus.COMPLETED,
            completedAt: new Date('2026-10-20T17:00:00Z'),
            scheduledDueAt: new Date('2026-10-20T18:00:00Z'),
          },
        ];

        const result = service.calculateConsistencyScore(occurrences);
        expect(result.score).toBe(100);
        expect(result.isProvisional).toBe(false);
        expect(result.sampleCount).toBe(5);
        expect(result.completedCount).toBe(5);
      });

      it('SKIPPED and CANCELLED occurrences do not reduce the score (neutral exclusion)', () => {
        const occurrences: TaskOccurrenceSummary[] = [
          {
            status: TaskOccurrenceStatus.COMPLETED,
            completedAt: new Date('2026-10-20T09:00:00Z'),
            scheduledDueAt: new Date('2026-10-20T10:00:00Z'),
          },
          {
            status: TaskOccurrenceStatus.COMPLETED,
            completedAt: new Date('2026-10-20T11:00:00Z'),
            scheduledDueAt: new Date('2026-10-20T12:00:00Z'),
          },
          {
            status: TaskOccurrenceStatus.COMPLETED,
            completedAt: new Date('2026-10-20T13:00:00Z'),
            scheduledDueAt: new Date('2026-10-20T14:00:00Z'),
          },
          {
            status: TaskOccurrenceStatus.COMPLETED,
            completedAt: new Date('2026-10-20T15:00:00Z'),
            scheduledDueAt: new Date('2026-10-20T16:00:00Z'),
          },
          {
            status: TaskOccurrenceStatus.COMPLETED,
            completedAt: new Date('2026-10-20T17:00:00Z'),
            scheduledDueAt: new Date('2026-10-20T18:00:00Z'),
          },
          { status: TaskOccurrenceStatus.SKIPPED },
          { status: TaskOccurrenceStatus.CANCELLED },
        ];

        const result = service.calculateConsistencyScore(occurrences);
        // 5 eligible on-time completed: (5.0 / 5) * 100 = 100
        expect(result.score).toBe(100);
        expect(result.sampleCount).toBe(5);
        expect(result.completedCount).toBe(5);
        expect(result.skippedCount).toBe(1);
        expect(result.cancelledCount).toBe(1);
        expect(result.isProvisional).toBe(false);
      });

      it('NOT_COMPLETED occurrences reduce the score proportionally', () => {
        // 3 on-time (3.0), 2 not completed (0.0) -> (3.0 / 5) * 100 = 60
        const occurrences: TaskOccurrenceSummary[] = [
          {
            status: TaskOccurrenceStatus.COMPLETED,
            completedAt: new Date('2026-10-20T09:00:00Z'),
            scheduledDueAt: new Date('2026-10-20T10:00:00Z'),
          },
          {
            status: TaskOccurrenceStatus.COMPLETED,
            completedAt: new Date('2026-10-20T11:00:00Z'),
            scheduledDueAt: new Date('2026-10-20T12:00:00Z'),
          },
          {
            status: TaskOccurrenceStatus.COMPLETED,
            completedAt: new Date('2026-10-20T13:00:00Z'),
            scheduledDueAt: new Date('2026-10-20T14:00:00Z'),
          },
          { status: TaskOccurrenceStatus.NOT_COMPLETED },
          { status: TaskOccurrenceStatus.NOT_COMPLETED },
        ];

        const result = service.calculateConsistencyScore(occurrences);
        expect(result.score).toBe(60);
        expect(result.sampleCount).toBe(5);
        expect(result.completedCount).toBe(3);
        expect(result.notCompletedCount).toBe(2);
        expect(result.isProvisional).toBe(false);
      });

      it('late completion awards 0.8 weight and partial completion awards 0.5 weight', () => {
        // 2 on-time (2.0), 1 late (0.8), 1 partial (0.5), 1 not completed (0.0) -> (3.3 / 5) * 100 = 66.0
        const occurrences: TaskOccurrenceSummary[] = [
          {
            status: TaskOccurrenceStatus.COMPLETED,
            completedAt: new Date('2026-10-20T09:00:00Z'),
            scheduledDueAt: new Date('2026-10-20T10:00:00Z'),
          },
          {
            status: TaskOccurrenceStatus.COMPLETED,
            completedAt: new Date('2026-10-20T09:00:00Z'),
            scheduledDueAt: new Date('2026-10-20T10:00:00Z'),
          },
          {
            status: TaskOccurrenceStatus.COMPLETED,
            completedAt: new Date('2026-10-20T11:00:00Z'), // late
            scheduledDueAt: new Date('2026-10-20T10:00:00Z'),
          },
          {
            status: TaskOccurrenceStatus.PARTIALLY_COMPLETED,
          },
          {
            status: TaskOccurrenceStatus.NOT_COMPLETED,
          },
        ];

        const result = service.calculateConsistencyScore(occurrences);
        expect(result.score).toBe(66);
        expect(result.sampleCount).toBe(5);
        expect(result.completedCount).toBe(3);
        expect(result.partiallyCompletedCount).toBe(1);
        expect(result.notCompletedCount).toBe(1);
      });

      it('isProvisional correctly flags histories with fewer than MIN_SAMPLE_SIZE items', () => {
        // 4 on-time completed (< 5)
        const occurrences: TaskOccurrenceSummary[] = [
          {
            status: TaskOccurrenceStatus.COMPLETED,
            completedAt: new Date('2026-10-20T09:00:00Z'),
            scheduledDueAt: new Date('2026-10-20T10:00:00Z'),
          },
          {
            status: TaskOccurrenceStatus.COMPLETED,
            completedAt: new Date('2026-10-20T09:00:00Z'),
            scheduledDueAt: new Date('2026-10-20T10:00:00Z'),
          },
          {
            status: TaskOccurrenceStatus.COMPLETED,
            completedAt: new Date('2026-10-20T09:00:00Z'),
            scheduledDueAt: new Date('2026-10-20T10:00:00Z'),
          },
          {
            status: TaskOccurrenceStatus.COMPLETED,
            completedAt: new Date('2026-10-20T09:00:00Z'),
            scheduledDueAt: new Date('2026-10-20T10:00:00Z'),
          },
        ];

        const result = service.calculateConsistencyScore(occurrences);
        expect(result.score).toBe(100);
        expect(result.sampleCount).toBe(4);
        expect(result.isProvisional).toBe(true);
      });
    });

    describe('getUserConsistencyScore with Date Range Filtering', () => {
      it('queries occurrences with date range filtering when startDate and endDate are provided', async () => {
        const mockOccQb = {
          innerJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([
            {
              status: TaskOccurrenceStatus.COMPLETED,
              completedAt: new Date('2026-10-05T10:00:00Z'),
              scheduledDueAt: new Date('2026-10-05T11:00:00Z'),
            },
          ]),
        };
        occurrenceRepo.createQueryBuilder.mockReturnValue(
          mockOccQb as unknown as SelectQueryBuilder<TaskOccurrence>,
        );

        const result = await service.getUserConsistencyScore(mockUserId, {
          startDate: '2026-10-01',
          endDate: '2026-10-15',
        });

        expect(mockOccQb.where).toHaveBeenCalledWith('task.ownerId = :userId', {
          userId: mockUserId,
        });
        expect(mockOccQb.andWhere).toHaveBeenCalledWith(
          'occ.date BETWEEN :startDate AND :endDate',
          {
            startDate: '2026-10-01',
            endDate: '2026-10-15',
          },
        );
        expect(result.score).toBe(100);
        expect(result.sampleCount).toBe(1);
        expect(result.isProvisional).toBe(true);
      });
    });
  });
});
