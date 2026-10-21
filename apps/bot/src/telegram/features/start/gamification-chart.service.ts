import { Injectable, Logger } from '@nestjs/common';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { ChartConfiguration } from 'chart.js';
import { ConsistencyTrendResult } from '@app/core';

@Injectable()
export class GamificationChartService {
  private readonly logger = new Logger(GamificationChartService.name);
  private readonly chartCanvas: ChartJSNodeCanvas;

  constructor() {
    this.chartCanvas = new ChartJSNodeCanvas({
      width: 800,
      height: 420,
      backgroundColour: '#181b20',
    });
  }

  /**
   * Generates a high-resolution, premium dark-themed PNG chart buffer representing
   * the user's Consistency Score trend over the selected period.
   * Gaps (missing data) are cleanly preserved without drawing misleading zeroes.
   */
  async renderConsistencyTrendChart(
    trend: ConsistencyTrendResult,
  ): Promise<Buffer> {
    const labels = trend.buckets.map((b) => b.label);
    const dataPoints = trend.buckets.map((b) => b.score);

    const periodTitle =
      trend.period === '7d'
        ? 'Last 7 Days'
        : trend.period === '30d'
          ? 'Last 30 Days'
          : 'All-Time History';

    const configuration: ChartConfiguration<'line'> = {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Consistency Score (%)',
            data: dataPoints,
            borderColor: '#38bdf8',
            backgroundColor: 'rgba(56, 189, 248, 0.08)',
            fill: true,
            borderWidth: 3,
            tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: '#38bdf8',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 1.5,
            spanGaps: false,
          },
        ],
      },
      options: {
        responsive: false,
        animation: false,
        plugins: {
          legend: {
            display: false,
          },
          title: {
            display: true,
            text: `Consistency Score Trend (${periodTitle})`,
            color: '#f1f5f9',
            font: {
              size: 16,
              weight: 'bold',
              family: "'Segoe UI', 'Roboto', 'Arial', sans-serif",
            },
            padding: {
              top: 14,
              bottom: 20,
            },
          },
        },
        scales: {
          y: {
            min: 0,
            max: 100,
            ticks: {
              stepSize: 25,
              color: '#94a3b8',
              font: {
                size: 12,
                family: "'Segoe UI', 'Roboto', 'Arial', sans-serif",
              },
              callback: (value) => `${value}%`,
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.08)',
            },
            border: {
              display: false,
            },
          },
          x: {
            ticks: {
              color: '#94a3b8',
              font: {
                size: 11,
                family: "'Segoe UI', 'Roboto', 'Arial', sans-serif",
              },
              maxRotation: 45,
              minRotation: 0,
              autoSkip: true,
              maxTicksLimit: 15,
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.04)',
            },
            border: {
              display: false,
            },
          },
        },
      },
    };

    try {
      return await this.chartCanvas.renderToBuffer(configuration);
    } catch (error: unknown) {
      this.logger.error(
        `Failed to render consistency trend chart: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }
}
