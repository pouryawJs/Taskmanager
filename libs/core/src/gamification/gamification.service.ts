import { Injectable, Logger } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';

import { GamificationProfile, PointTransaction } from '@app/database';

export interface GamificationOverview {
  totalXp: number;
  currentStreak: number;
  longestStreak: number;
  lastQualifiedDate: string | null;
}

@Injectable()
export class GamificationService {
  private readonly logger = new Logger(GamificationService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Retrieve the user's gamification profile if it exists.
   */
  async getProfile(userId: string): Promise<GamificationProfile | null> {
    return await this.dataSource.getRepository(GamificationProfile).findOne({
      where: { userId },
    });
  }

  /**
   * Retrieve or idempotently create the user's gamification profile.
   * Handles PostgreSQL concurrency race condition (23505) gracefully.
   */
  async getOrCreateProfile(userId: string): Promise<GamificationProfile> {
    const existing = await this.getProfile(userId);
    if (existing) {
      return existing;
    }

    const repo = this.dataSource.getRepository(GamificationProfile);
    const profile = repo.create({
      userId,
      currentStreak: 0,
      longestStreak: 0,
      lastQualifiedDate: null,
    });

    try {
      return await repo.save(profile);
    } catch (error: unknown) {
      if (this.isUniqueConstraintViolation(error)) {
        this.logger.debug(
          `Concurrent profile creation detected for user ${userId}. Loading existing profile.`,
        );
        const loaded = await this.getProfile(userId);
        if (loaded) {
          return loaded;
        }
      }

      this.logger.error(
        `Failed to create gamification profile for user ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Authoritatively calculate the user's total accumulated XP by summing
   * all pointsDelta entries in the immutable PointTransaction ledger.
   * Returns 0 if no transactions exist.
   */
  async getUserTotalXp(userId: string): Promise<number> {
    const result = await this.dataSource
      .getRepository(PointTransaction)
      .createQueryBuilder('pt')
      .select('COALESCE(SUM(pt.pointsDelta), 0)', 'total')
      .where('pt.userId = :userId', { userId })
      .getRawOne<{ total: string | number }>();

    const total = result?.total ? Number(result.total) : 0;
    return isNaN(total) ? 0 : total;
  }

  /**
   * Retrieve a consolidated overview of the user's gamification state:
   * authoritative total XP from the ledger and persistent streak metrics.
   */
  async getGamificationOverview(userId: string): Promise<GamificationOverview> {
    const [profile, totalXp] = await Promise.all([
      this.getOrCreateProfile(userId),
      this.getUserTotalXp(userId),
    ]);

    return {
      totalXp,
      currentStreak: profile.currentStreak,
      longestStreak: profile.longestStreak,
      lastQualifiedDate: profile.lastQualifiedDate,
    };
  }

  /**
   * Check if an error represents a PostgreSQL unique constraint violation (error code '23505').
   */
  private isUniqueConstraintViolation(error: unknown): boolean {
    if (error instanceof QueryFailedError) {
      const driverError = error.driverError as { code?: string } | undefined;
      return driverError?.code === '23505';
    }
    return false;
  }
}
