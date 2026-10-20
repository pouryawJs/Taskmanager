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
import { GamificationService } from './gamification.service';
import {
  BASE_XP_REWARDS,
  GAMIFICATION_TRANSACTION_REASONS,
} from './constants/gamification.constants';

describe('GamificationService (Phase 1)', () => {
  let service: GamificationService;
  let dataSource: jest.Mocked<DataSource>;
  let profileRepo: jest.Mocked<Repository<GamificationProfile>>;
  let pointTxRepo: jest.Mocked<Repository<PointTransaction>>;
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

    dataSource = {
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === GamificationProfile) return profileRepo;
        if (entity === PointTransaction) return pointTxRepo;
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
});
