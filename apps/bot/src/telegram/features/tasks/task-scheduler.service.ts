import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Bot, GrammyError } from 'grammy';
import { TasksService } from '@app/core';
import { IdentityProvider } from '@app/database';

import { buildTaskNotificationMessage } from './tasks.messages';
import { buildTaskNotificationKeyboard } from './tasks.keyboards';

@Injectable()
export class TaskSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TaskSchedulerService.name);

  constructor(
    private readonly bot: Bot,
    private readonly tasksService: TasksService,
  ) {}

  /**
   * Run initial occurrence materialization immediately when application starts.
   */
  async onApplicationBootstrap(): Promise<void> {
    this.logger.log(
      'Bootstrapping task scheduler: running initial daily occurrence materialization.',
    );
    await this.processDailyOccurrenceGeneration();
  }

  /**
   * Hourly job to materialize daily occurrences for all active daily recurring tasks.
   * Runs at minute 0 of every hour.
   * Catches up to 3 days in the past if server was offline.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleHourlyOccurrenceGeneration(): Promise<void> {
    await this.processDailyOccurrenceGeneration();
  }

  /**
   * Minute cron to detect scheduled task start times and handle 30-minute inactivity timeouts.
   * Runs every minute (* * * * *).
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleMinuteCron(): Promise<void> {
    await this.processScheduledNotifications();
    await this.processInactivityTimeouts();
  }

  /**
   * Generates daily occurrences for active daily recurring tasks across user timezones.
   * Enforces catch-up policy up to 3 days in the past.
   */
  async processDailyOccurrenceGeneration(now?: Date): Promise<void> {
    try {
      const result = await this.tasksService.generateDailyOccurrences({
        maxCatchUpDays: 3,
        now,
      });
      if (result.generatedCount > 0) {
        this.logger.log(
          `Generated ${result.generatedCount} daily task occurrence(s).`,
        );
      }
    } catch (error: unknown) {
      this.logger.error(
        `Failed to run daily occurrence generation: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Detects scheduled occurrences whose start time has arrived today in user's timezone,
   * and dispatches Persian notification messages via Telegram with an interactive view button.
   */
  async processScheduledNotifications(now?: Date): Promise<void> {
    try {
      const eligibleOccurrences =
        await this.tasksService.getOccurrencesDueForNotification(now);

      for (const occurrence of eligibleOccurrences) {
        const telegramIdentity = occurrence.task?.owner?.identities?.find(
          (identity) => identity.provider === IdentityProvider.TELEGRAM,
        );

        if (!telegramIdentity?.providerUserId) {
          this.logger.warn(
            `Occurrence ${occurrence.id} belongs to user without Telegram identity. Skipping notification.`,
          );
          continue;
        }

        const telegramChatId = telegramIdentity.providerUserId;
        const messageText = buildTaskNotificationMessage(occurrence);
        const keyboard = buildTaskNotificationKeyboard(occurrence.id);

        try {
          await this.bot.api.sendMessage(telegramChatId, messageText, {
            parse_mode: 'HTML',
            reply_markup: keyboard,
          });

          await this.tasksService.markOccurrenceNotified(occurrence.id);
          this.logger.debug(
            `Notification sent for occurrence ${occurrence.id} to Telegram user ${telegramChatId}.`,
          );
        } catch (error: unknown) {
          if (error instanceof GrammyError && error.error_code === 403) {
            // User blocked the bot (HTTP 403 Forbidden). Mark notifiedAt to avoid infinite retries.
            this.logger.warn(
              `User ${telegramChatId} has blocked the bot (HTTP 403 Forbidden). Marking occurrence ${occurrence.id} as notified.`,
            );
            await this.tasksService.markOccurrenceNotified(occurrence.id);
          } else {
            // Other error (network failure, rate limit, etc.) - leave notifiedAt as null for retry.
            this.logger.error(
              `Failed to send notification for occurrence ${occurrence.id} to user ${telegramChatId}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
      }
    } catch (error: unknown) {
      this.logger.error(
        `Failed to process scheduled notifications: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Marks unacknowledged scheduled occurrences as NOT_COMPLETED 30 minutes after scheduledStartTime.
   */
  async processInactivityTimeouts(now?: Date): Promise<void> {
    try {
      const result = await this.tasksService.markTimedOutOccurrences(now);
      if (result.timedOutCount > 0) {
        this.logger.log(
          `Timed out ${result.timedOutCount} unacknowledged scheduled occurrence(s) to NOT_COMPLETED.`,
        );
      }
    } catch (error: unknown) {
      this.logger.error(
        `Failed to process inactivity timeouts: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
