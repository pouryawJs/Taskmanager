import { GamificationChartService } from './gamification-chart.service';
import { ConsistencyTrendResult } from '@app/core';

describe('GamificationChartService (Phase 3)', () => {
  let service: GamificationChartService;

  beforeEach(() => {
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
  });

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
