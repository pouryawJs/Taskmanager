import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { ChartConfiguration, Chart, Plugin, ScriptableContext } from 'chart.js';
import { ConsistencyTrendResult } from '@app/core';

/**
 * Converts ASCII digits (0-9) to standard Persian digits (۰-۹).
 */
export function toPersianDigits(num: number | string): string {
  const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return String(num).replace(/[0-9]/g, (w) => persianDigits[+w]);
}

/**
 * Formats a trend bucket label into clean, localized Persian text.
 * - '7d': Weekday name + day of month (e.g. جمعه ۲۴)
 * - '30d': Day of month + Jalali month name (e.g. ۲۴ مهر)
 * - 'all' or fallback: Jalali month + year or fallback label with Persian digits.
 */
export function formatBucketLabel(
  dateKey?: string,
  fallbackLabel?: string,
  period?: string,
): string {
  if (dateKey) {
    try {
      const d = new Date(dateKey + 'T12:00:00Z');
      if (!isNaN(d.getTime())) {
        if (period === '7d') {
          const weekday = new Intl.DateTimeFormat('fa-IR', {
            weekday: 'short',
            timeZone: 'Asia/Tehran',
          }).format(d);
          const day = new Intl.DateTimeFormat('fa-IR', {
            day: 'numeric',
            timeZone: 'Asia/Tehran',
          }).format(d);
          return `\u202B${weekday} ${day}\u202C`;
        } else if (period === '30d') {
          return `\u202B${new Intl.DateTimeFormat('fa-IR', {
            month: 'short',
            day: 'numeric',
            timeZone: 'Asia/Tehran',
          }).format(d)}\u202C`;
        } else {
          return `\u202B${new Intl.DateTimeFormat('fa-IR', {
            month: 'short',
            year: '2-digit',
            timeZone: 'Asia/Tehran',
          }).format(d)}\u202C`;
        }
      }
    } catch {
      // Graceful fallback below
    }
  }

  if (!fallbackLabel) return '';

  // If fallback is weekly format like W1 (10/15)
  if (fallbackLabel.startsWith('W')) {
    const weekMatch = fallbackLabel.match(/^W(\d+)/);
    if (weekMatch) {
      return `\u202Bهفته ${toPersianDigits(weekMatch[1])}\u202C`;
    }
  }

  return toPersianDigits(fallbackLabel);
}

@Injectable()
export class GamificationChartService implements OnModuleInit {
  private readonly logger = new Logger(GamificationChartService.name);
  private readonly chartCanvas: ChartJSNodeCanvas;
  private readonly width = 840;
  private readonly height = 450;

  constructor() {
    this.chartCanvas = new ChartJSNodeCanvas({
      width: this.width,
      height: this.height,
      backgroundColour: '#0d131d',
    });
  }

  /**
   * Pre-warm the native canvas (Cairo/Pango) and Chart.js runtime during bot startup.
   * Completely eliminates the 600ms+ cold-start latency for the first user request.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.warmup();
      this.logger.log('GamificationChartService canvas engine pre-warmed.');
    } catch (err: unknown) {
      this.logger.warn(
        `Pre-warming chart canvas encountered non-fatal notice: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Performs a lightweight 1-point render to initialize the C++ library in memory.
   */
  async warmup(): Promise<void> {
    const dummyConfig: ChartConfiguration<'line'> = {
      type: 'line',
      data: {
        labels: ['0'],
        datasets: [{ data: [100] }],
      },
      options: {
        responsive: false,
        animation: false,
      },
    };
    await this.chartCanvas.renderToBuffer(dummyConfig);
  }

  /**
   * Generates a high-resolution, premium dark-themed PNG chart buffer representing
   * the user's Consistency Score trend over the selected period with full Persian localization.
   *
   * Visual Features:
   * - Deep slate inner card with subtle rounded border and gradient area fill.
   * - RTL Persian title, subtitle, and Jalali date axis.
   * - Overall score stat badge with color coding (cyan for settled, amber for provisional).
   * - Exact percentage callout pills for 7-day view.
   * - Informative empty-state handling for new accounts or inactive periods.
   * - Gaps (missing data) cleanly preserved without drawing misleading zeroes.
   */
  async renderConsistencyTrendChart(
    trend: ConsistencyTrendResult,
  ): Promise<Buffer> {
    const labels = trend.buckets.map((b) =>
      formatBucketLabel(b.dateKey, b.label, trend.period),
    );
    const dataPoints = trend.buckets.map((b) => b.score);
    const hasData = dataPoints.some((p) => p !== null && p !== undefined);

    const periodSubtitle =
      trend.period === '7d'
        ? '\u202B۷ روز اخیر\u202C'
        : trend.period === '30d'
          ? '\u202B۳۰ روز اخیر\u202C'
          : '\u202Bکل تاریخچه فعالیت\u202C';

    const overallScoreFormatted =
      trend.overallScore !== null && trend.overallScore !== undefined
        ? `${toPersianDigits(trend.overallScore.toFixed(0))}٪`
        : '۰٪';

    const isProvisional = trend.isProvisional;
    const chartWidth = this.width;
    const chartHeight = this.height;

    // Per-render scoped plugin for thread/concurrency-safe custom canvas drawing
    const customDashboardPlugin: Plugin<'line'> = {
      id: 'customDashboard',
      beforeDraw(chart: Chart<'line'>) {
        const { ctx, chartArea } = chart;
        if (!chartArea) return;

        ctx.save();

        // 1. Inner Card container
        const margin = 14;
        const cardX = margin;
        const cardY = margin;
        const cardW = chartWidth - margin * 2;
        const cardH = chartHeight - margin * 2;
        const radius = 16;

        ctx.beginPath();
        ctx.roundRect(cardX, cardY, cardW, cardH, radius);
        ctx.fillStyle = '#111827';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.stroke();

        // 2. Persian Header (Right-aligned in RTL)
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 20px "Segoe UI", Tahoma, Arial, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('\u202Bروند شاخص پایداری\u202C', chartWidth - 40, 52);

        // Subtitle / Period
        ctx.fillStyle = '#94a3b8';
        ctx.font = '13px "Segoe UI", Tahoma, Arial, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(periodSubtitle, chartWidth - 40, 75);

        // 3. Stat Badge (Overall Score) on Left side
        const badgeX = 36;
        const badgeY = 34;
        const badgeW = isProvisional ? 185 : 155;
        const badgeH = 40;
        const badgeRadius = 10;

        ctx.beginPath();
        ctx.roundRect(badgeX, badgeY, badgeW, badgeH, badgeRadius);
        ctx.fillStyle = isProvisional
          ? 'rgba(245, 158, 11, 0.12)'
          : 'rgba(56, 189, 248, 0.12)';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = isProvisional
          ? 'rgba(245, 158, 11, 0.35)'
          : 'rgba(56, 189, 248, 0.35)';
        ctx.stroke();

        ctx.fillStyle = isProvisional ? '#fbbf24' : '#38bdf8';
        ctx.font = 'bold 14px "Segoe UI", Tahoma, Arial, sans-serif';
        ctx.textAlign = 'center';
        const badgeText = isProvisional
          ? `\u202Bشاخص: ${overallScoreFormatted} (موقت)\u202C`
          : `\u202Bشاخص کل: ${overallScoreFormatted}\u202C`;
        ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + 25);

        // 4. Empty State Message if no data points
        if (!hasData) {
          ctx.fillStyle = '#94a3b8';
          ctx.font = 'bold 15px "Segoe UI", Tahoma, Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(
            '\u202Bهنوز تسکی در این بازه تکمیل نشده است\u202C',
            chartWidth / 2,
            210,
          );

          ctx.fillStyle = '#64748b';
          ctx.font = '13px "Segoe UI", Tahoma, Arial, sans-serif';
          ctx.fillText(
            '\u202Bبا تکمیل تسک‌های روزانه، شاخص پایداری شما در اینجا رسم می‌شود.\u202C',
            chartWidth / 2,
            235,
          );
        }

        ctx.restore();
      },
      afterDatasetsDraw(chart: Chart<'line'>) {
        if (!hasData) return;
        // Draw point value callouts for 7d trend so values are visible at a glance
        if (trend.period !== '7d') return;
        const { ctx, chartArea } = chart;
        const meta = chart.getDatasetMeta(0);
        if (!meta) return;

        ctx.save();
        ctx.font = 'bold 12px "Segoe UI", Tahoma, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        meta.data.forEach((element, index: number) => {
          const val = dataPoints[index];
          if (val === null || val === undefined) return;
          const x = element.x;
          const y = element.y;

          const valText = `${toPersianDigits(Math.round(val))}٪`;
          const textWidth = ctx.measureText(valText).width;
          const pillW = textWidth + 12;
          const pillH = 19;

          // Position pill above point, or below point if point is close to top of chartArea
          const isNearTop = y - chartArea.top < 35;
          const pillY = isNearTop ? y + 14 : y - 24;

          // Clamp pillX within card bounds
          const minX = 40;
          const maxX = chartWidth - 40 - pillW;
          const pillX = Math.max(minX, Math.min(maxX, x - pillW / 2));

          ctx.beginPath();
          ctx.roundRect(pillX, pillY, pillW, pillH, 6);
          ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
          ctx.stroke();

          ctx.fillStyle = '#f1f5f9';
          ctx.fillText(valText, pillX + pillW / 2, pillY + pillH / 2);
        });
        ctx.restore();
      },
    };

    const configuration: ChartConfiguration<'line'> = {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'شاخص پایداری',
            data: dataPoints,
            borderColor: '#38bdf8',
            backgroundColor: (context: ScriptableContext<'line'>) => {
              const chart = context.chart;
              const { ctx, chartArea } = chart;
              if (!chartArea) return 'rgba(56, 189, 248, 0.08)';
              const gradient = ctx.createLinearGradient(
                0,
                chartArea.top,
                0,
                chartArea.bottom,
              );
              gradient.addColorStop(0, 'rgba(56, 189, 248, 0.32)');
              gradient.addColorStop(0.7, 'rgba(56, 189, 248, 0.08)');
              gradient.addColorStop(1, 'rgba(56, 189, 248, 0.00)');
              return gradient;
            },
            fill: true,
            borderWidth: 3.5,
            tension: 0.35,
            pointRadius:
              trend.period === '7d' ? 5 : trend.period === '30d' ? 3.5 : 2.5,
            pointHoverRadius: 6,
            pointBackgroundColor: '#0f172a',
            pointBorderColor: '#38bdf8',
            pointBorderWidth: 2.5,
            spanGaps: false,
          },
        ],
      },
      options: {
        responsive: false,
        animation: false,
        layout: {
          padding: {
            top: 105,
            bottom: 25,
            left: 20,
            right: 35,
          },
        },
        plugins: {
          legend: {
            display: false,
          },
          title: {
            display: false,
          },
        },
        scales: {
          y: {
            min: 0,
            max: 100,
            position: 'left',
            ticks: {
              stepSize: 25,
              color: '#94a3b8',
              font: {
                size: 12,
                family: "'Segoe UI', Tahoma, Arial, sans-serif",
              },
              callback: (value) => `${toPersianDigits(value)}٪`,
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.07)',
            },
            border: {
              display: false,
            },
          },
          x: {
            ticks: {
              color: '#cbd5e1',
              font: {
                size: trend.period === '7d' ? 12 : 11,
                family: "'Segoe UI', Tahoma, Arial, sans-serif",
              },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: trend.period === '7d' ? 7 : 10,
            },
            grid: {
              display: false,
            },
            border: {
              display: false,
            },
          },
        },
      },
      plugins: [customDashboardPlugin],
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
