import { Test, TestingModule } from '@nestjs/testing';
import {
  DataSource,
  QueryFailedError,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';

import { GamificationProfile, PointTransaction } from '@app/database';
import { GamificationService } from './gamification.service';

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
});
