import {
  GamificationChartService,
  toPersianDigits,
  formatBucketLabel,
} from './gamification-chart.service';
import { ConsistencyTrendResult } from '@app/core';

describe('GamificationChartService (Phase 3)', () => {
  let service: GamificationChartService;

  beforeEach(() => {
    jest.setTimeout(15000);
    service = new GamificationChartService();
  });

  it('should render a valid PNG buffer for 7d trend data', async () => {
    const trend: ConsistencyTrendResult = {
      period: '7d',
      overallScore: 85.0,
      isProvisional: false,
      sampleCount: 5,
      buckets: [
        {
          label: '10/15',
          score: 100,
          sampleCount: 1,
          completedCount: 1,
          partiallyCompletedCount: 0,
          notCompletedCount: 0,
          dateKey: '2026-10-15',
        },
        {
          label: '10/16',
          score: 70,
          sampleCount: 2,
          completedCount: 1,
          partiallyCompletedCount: 1,
          notCompletedCount: 0,
          dateKey: '2026-10-16',
        },
        {
          label: '10/17',
          score: null,
          sampleCount: 0,
          completedCount: 0,
          partiallyCompletedCount: 0,
          notCompletedCount: 0,
          dateKey: '2026-10-17',
        },
        {
          label: '10/18',
          score: 80,
          sampleCount: 2,
          completedCount: 2,
          partiallyCompletedCount: 0,
          notCompletedCount: 0,
          dateKey: '2026-10-18',
        },
        {
          label: '10/19',
          score: null,
          sampleCount: 0,
          completedCount: 0,
          partiallyCompletedCount: 0,
          notCompletedCount: 0,
          dateKey: '2026-10-19',
        },
        {
          label: '10/20',
          score: 90,
          sampleCount: 1,
          completedCount: 1,
          partiallyCompletedCount: 0,
          notCompletedCount: 0,
          dateKey: '2026-10-20',
        },
        {
          label: '10/21',
          score: 85,
          sampleCount: 1,
          completedCount: 1,
          partiallyCompletedCount: 0,
          notCompletedCount: 0,
          dateKey: '2026-10-21',
        },
      ],
    };

    const buffer = await service.renderConsistencyTrendChart(trend);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
    // Check PNG signature: 0x89 0x50 0x4E 0x47
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50);
    expect(buffer[2]).toBe(0x4e);
    expect(buffer[3]).toBe(0x47);
  }, 15000);

  it('should render a valid PNG buffer when all buckets are null (empty history)', async () => {
    const trend: ConsistencyTrendResult = {
      period: '30d',
      overallScore: 0,
      isProvisional: true,
      sampleCount: 0,
      buckets: Array.from({ length: 30 }, (_, i) => ({
        label: `D${i + 1}`,
        score: null,
        sampleCount: 0,
        completedCount: 0,
        partiallyCompletedCount: 0,
        notCompletedCount: 0,
        dateKey: `2026-10-${String(i + 1).padStart(2, '0')}`,
      })),
    };

    const buffer = await service.renderConsistencyTrendChart(trend);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer[0]).toBe(0x89);
  }, 15000);

  it('should format Persian digits correctly with toPersianDigits', () => {
    expect(toPersianDigits(1234567890)).toBe('۱۲۳۴۵۶۷۸۹۰');
    expect(toPersianDigits('Score: 85%')).toBe('Score: ۸۵%');
  });

  it('should format bucket labels cleanly into Persian with formatBucketLabel', () => {
    // 7d: weekday + day
    const label7d = formatBucketLabel('2026-10-16', '10/16', '7d');
    expect(label7d).toContain('۲۴');

    // 30d: month + day
    const label30d = formatBucketLabel('2026-10-16', '10/16', '30d');
    expect(label30d).toContain('مهر');

    // fallback when dateKey is missing
    const fallbackWeekly = formatBucketLabel(undefined, 'W3 (10/15)', 'all');
    expect(fallbackWeekly).toContain('هفته ۳');

    const emptyLabel = formatBucketLabel(undefined, undefined, 'all');
    expect(emptyLabel).toBe('');
  });

  it('should execute warmup successfully without throwing', async () => {
    await expect(service.warmup()).resolves.toBeUndefined();
  });

  it('should render a valid PNG buffer for all-time trend with weekly buckets', async () => {
    const trend: ConsistencyTrendResult = {
      period: 'all',
      startDate: '2026-08-01',
      endDate: '2026-10-22',
      overallScore: 92.0,
      isProvisional: false,
      sampleCount: 60,
      buckets: [
        {
          label: 'W1 (08/01)',
          score: 80,
          sampleCount: 10,
          completedCount: 8,
          partiallyCompletedCount: 2,
          notCompletedCount: 0,
          dateKey: '2026-08-01',
        },
        {
          label: 'W2 (08/08)',
          score: 95,
          sampleCount: 12,
          completedCount: 11,
          partiallyCompletedCount: 1,
          notCompletedCount: 0,
          dateKey: '2026-08-08',
        },
        {
          label: 'W3 (08/15)',
          score: null,
          sampleCount: 0,
          completedCount: 0,
          partiallyCompletedCount: 0,
          notCompletedCount: 0,
          dateKey: '2026-08-15',
        },
      ],
    };

    const buffer = await service.renderConsistencyTrendChart(trend);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer[0]).toBe(0x89);
  });

  it('should propagate errors gracefully if chart rendering throws', async () => {
    const brokenCanvas = {
      renderToBuffer: jest
        .fn()
        .mockRejectedValue(new Error('Canvas native failure')),
    };
    (service as any).chartCanvas = brokenCanvas;

    const trend: ConsistencyTrendResult = {
      period: 'all',
      overallScore: 100,
      isProvisional: false,
      sampleCount: 1,
      buckets: [],
    };

    await expect(service.renderConsistencyTrendChart(trend)).rejects.toThrow(
      'Canvas native failure',
    );
  });
});
