import { Bot, GrammyError } from 'grammy';
import { TasksService } from '@app/core';
import {
  TaskOccurrence,
  TaskOccurrenceStatus,
  TaskPriority,
  TaskType,
  IdentityProvider,
} from '@app/database';

import { TaskSchedulerService } from './task-scheduler.service';

describe('TaskSchedulerService', () => {
  let service: TaskSchedulerService;
  let bot: jest.Mocked<Bot>;
  let tasksService: jest.Mocked<TasksService>;

  beforeEach(() => {
    bot = {
      api: {
        sendMessage: jest.fn().mockResolvedValue({ message_id: 1234 }),
      },
    } as unknown as jest.Mocked<Bot>;

    tasksService = {
      generateDailyOccurrences: jest
        .fn()
        .mockResolvedValue({ generatedCount: 2 }),
      getOccurrencesDueForNotification: jest.fn().mockResolvedValue([]),
      markOccurrenceNotified: jest.fn().mockResolvedValue(undefined),
      markTimedOutOccurrences: jest
        .fn()
        .mockResolvedValue({ timedOutCount: 1 }),
    } as unknown as jest.Mocked<TasksService>;

    service = new TaskSchedulerService(bot, tasksService);
  });

  describe('Lifecycle and Cron Triggers', () => {
    it('onApplicationBootstrap should execute initial occurrence materialization', async () => {
      const processSpy = jest.spyOn(
        service,
        'processDailyOccurrenceGeneration',
      );
      await service.onApplicationBootstrap();

      expect(processSpy).toHaveBeenCalled();
    });

    it('handleHourlyOccurrenceGeneration should trigger daily occurrence generation', async () => {
      const processSpy = jest.spyOn(
        service,
        'processDailyOccurrenceGeneration',
      );
      await service.handleHourlyOccurrenceGeneration();

      expect(processSpy).toHaveBeenCalled();
    });

    it('handleMinuteCron should trigger both notifications and timeouts', async () => {
      const notifySpy = jest.spyOn(service, 'processScheduledNotifications');
      const timeoutSpy = jest.spyOn(service, 'processInactivityTimeouts');

      await service.handleMinuteCron();

      expect(notifySpy).toHaveBeenCalled();
      expect(timeoutSpy).toHaveBeenCalled();
    });
  });

  describe('Daily Occurrence Generation Worker', () => {
    it('should call tasksService.generateDailyOccurrences with catchUpDays = 3', async () => {
      const now = new Date('2026-10-19T10:00:00.000Z');
      await service.processDailyOccurrenceGeneration(now);

      expect(tasksService.generateDailyOccurrences).toHaveBeenCalledWith({
        maxCatchUpDays: 3,
        now,
      });
    });

    it('should catch errors gracefully without throwing', async () => {
      tasksService.generateDailyOccurrences.mockRejectedValueOnce(
        new Error('Database error'),
      );

      await expect(
        service.processDailyOccurrenceGeneration(),
      ).resolves.not.toThrow();
    });
  });

  describe('Scheduled Start Notifications (Telegram Delivery)', () => {
    const mockOccurrence = {
      id: 'occ-1',
      date: '2026-10-19',
      scheduledStartTime: '10:00:00',
      status: TaskOccurrenceStatus.PENDING,
      notifiedAt: null,
      task: {
        id: 'task-1',
        title: 'خرید نان سنگک',
        priority: TaskPriority.HIGH,
        type: TaskType.ONE_TIME,
        isActive: true,
        owner: {
          id: 'user-1',
          identities: [
            {
              provider: IdentityProvider.TELEGRAM,
              providerUserId: '987654321',
            },
          ],
        },
      },
    } as unknown as TaskOccurrence;

    it('should dispatch Telegram notification message with shortcut button and update notifiedAt', async () => {
      tasksService.getOccurrencesDueForNotification.mockResolvedValueOnce([
        mockOccurrence,
      ]);

      await service.processScheduledNotifications();

      expect(bot.api.sendMessage).toHaveBeenCalledWith(
        '987654321',
        expect.stringContaining('خرید نان سنگک'),
        expect.objectContaining({
          parse_mode: 'HTML',
          reply_markup: expect.objectContaining({
            inline_keyboard: expect.arrayContaining([
              expect.arrayContaining([
                expect.objectContaining({
                  text: '📋 مشاهده و مدیریت تسک',
                  callback_data: 'task:view:occ-1',
                }),
              ]),
            ]),
          }),
        }),
      );

      expect(tasksService.markOccurrenceNotified).toHaveBeenCalledWith('occ-1');
    });

    it('should skip notifications if user has no Telegram identity', async () => {
      const occurrenceWithoutTg = {
        ...mockOccurrence,
        task: {
          ...mockOccurrence.task,
          owner: {
            id: 'user-1',
            identities: [
              { provider: IdentityProvider.EMAIL, providerUserId: 'a@b.com' },
            ],
          },
        },
      } as unknown as TaskOccurrence;

      tasksService.getOccurrencesDueForNotification.mockResolvedValueOnce([
        occurrenceWithoutTg,
      ]);

      await service.processScheduledNotifications();

      expect(bot.api.sendMessage).not.toHaveBeenCalled();
      expect(tasksService.markOccurrenceNotified).not.toHaveBeenCalled();
    });

    it('should handle HTTP 403 Forbidden (bot blocked) by marking notified to prevent retry loops', async () => {
      tasksService.getOccurrencesDueForNotification.mockResolvedValueOnce([
        mockOccurrence,
      ]);

      const forbiddenError = new GrammyError(
        'Call to sendMessage failed! (403: Forbidden: bot was blocked by the user)',
        {
          ok: false,
          error_code: 403,
          description: 'Forbidden: bot was blocked by the user',
        },
        'sendMessage',
        {},
      );

      (bot.api.sendMessage as jest.Mock).mockRejectedValueOnce(forbiddenError);

      await service.processScheduledNotifications();

      expect(tasksService.markOccurrenceNotified).toHaveBeenCalledWith('occ-1');
    });

    it('should leave notifiedAt as null on non-403 errors to allow future retry', async () => {
      tasksService.getOccurrencesDueForNotification.mockResolvedValueOnce([
        mockOccurrence,
      ]);

      (bot.api.sendMessage as jest.Mock).mockRejectedValueOnce(
        new Error('Network timeout'),
      );

      await service.processScheduledNotifications();

      expect(tasksService.markOccurrenceNotified).not.toHaveBeenCalled();
    });

    it('should continue processing other occurrences even if one dispatch fails', async () => {
      const mockOccurrence2 = {
        ...mockOccurrence,
        id: 'occ-2',
        task: {
          ...mockOccurrence.task,
          owner: {
            ...mockOccurrence.task.owner,
            identities: [
              {
                provider: IdentityProvider.TELEGRAM,
                providerUserId: '111222333',
              },
            ],
          },
        },
      } as unknown as TaskOccurrence;

      tasksService.getOccurrencesDueForNotification.mockResolvedValueOnce([
        mockOccurrence,
        mockOccurrence2,
      ]);

      (bot.api.sendMessage as jest.Mock)
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce({ message_id: 555 });

      await service.processScheduledNotifications();

      expect(bot.api.sendMessage).toHaveBeenCalledTimes(2);
      expect(tasksService.markOccurrenceNotified).not.toHaveBeenCalledWith(
        'occ-1',
      );
      expect(tasksService.markOccurrenceNotified).toHaveBeenCalledWith('occ-2');
    });
  });

  describe('Thirty-Minute Inactivity Timeout', () => {
    it('should call tasksService.markTimedOutOccurrences and log count', async () => {
      const now = new Date('2026-10-19T10:30:00.000Z');
      await service.processInactivityTimeouts(now);

      expect(tasksService.markTimedOutOccurrences).toHaveBeenCalledWith(now);
    });

    it('should catch errors gracefully without throwing', async () => {
      tasksService.markTimedOutOccurrences.mockRejectedValueOnce(
        new Error('Database timeout'),
      );

      await expect(service.processInactivityTimeouts()).resolves.not.toThrow();
    });
  });
});
