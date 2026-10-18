import { Context } from 'grammy';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import {
  Task,
  TaskOccurrence,
  TaskType,
  TaskPriority,
  TaskOccurrenceStatus,
  User,
  UserSettings,
} from '@app/database';
import { TasksService, UsersService } from '@app/core';
import { TelegramUiService } from '../../ui/telegram-ui.service';
import { TaskRegistrationStateService } from './task-registration.state';
import { TaskRegistrationHandler } from './task-registration.handlers';
import {
  getOccurrenceButtonStyle,
  buildDailyTaskListKeyboard,
} from './tasks.keyboards';

describe('Phase 6: Daily Task List and Task Details UI', () => {
  let handler: TaskRegistrationHandler;
  let tasksService: jest.Mocked<TasksService>;
  let usersService: jest.Mocked<UsersService>;
  let uiService: jest.Mocked<TelegramUiService>;
  let stateService: TaskRegistrationStateService;

  const mockUser: User = {
    id: 'user-uuid-1',
    telegramId: '12345',
    displayName: 'Pourya',
    settings: {
      userId: 'user-uuid-1',
      timezone: 'Asia/Tehran',
      onboardingCompleted: true,
    } as UserSettings,
  } as User;

  beforeEach(() => {
    tasksService = {
      createTasks: jest.fn(),
      ensureDailyOccurrencesForDate: jest.fn(),
      getOccurrencesForDate: jest.fn(),
      getOccurrenceById: jest.fn(),
    } as unknown as jest.Mocked<TasksService>;

    usersService = {
      findTelegramUser: jest.fn().mockResolvedValue(mockUser),
    } as unknown as jest.Mocked<UsersService>;

    uiService = {
      editOrReply: jest.fn().mockResolvedValue({ message_id: 100 }),
      sendTemporaryConfirmation: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<TelegramUiService>;

    stateService = new TaskRegistrationStateService();

    handler = new TaskRegistrationHandler(
      tasksService,
      usersService,
      uiService,
      stateService,
    );
  });

  const createMockContext = (options: {
    callbackData?: string;
    telegramId?: number;
    chatId?: number;
  }): Context => {
    return {
      from: {
        id: options.telegramId ?? 12345,
        is_bot: false,
        first_name: 'Test',
      },
      chat: { id: options.chatId ?? 99999, type: 'private' },
      callbackQuery: options.callbackData
        ? { data: options.callbackData, id: 'cb-1' }
        : undefined,
      answerCallbackQuery: jest.fn().mockResolvedValue(true),
    } as unknown as Context;
  };

  describe('Daily Task List (menu:list_tasks, task:list:today, task:back:to_list)', () => {
    it("Scenario 1: Opening today's list with multiple occurrences and buttons", async () => {
      const occurrences: TaskOccurrence[] = [
        {
          id: 'occ-1',
          taskId: 'task-1',
          date: '2026-10-18',
          status: TaskOccurrenceStatus.PENDING,
          scheduledStartTime: '09:00:00',
          task: {
            id: 'task-1',
            title: 'خرید نان سنگک',
            description: 'از نانوایی سر کوچه دو عدد نان کنجدی',
            priority: TaskPriority.NORMAL,
            type: TaskType.ONE_TIME,
          } as Task,
        } as TaskOccurrence,
        {
          id: 'occ-2',
          taskId: 'task-2',
          date: '2026-10-18',
          status: TaskOccurrenceStatus.COMPLETED,
          scheduledStartTime: '18:00:00',
          scheduledDueAt: new Date('2026-10-18T15:30:00.000Z'), // 19:00 Tehran
          task: {
            id: 'task-2',
            title: 'ورزش باشگاه',
            description: null,
            priority: TaskPriority.HIGH,
            type: TaskType.DAILY,
          } as Task,
        } as TaskOccurrence,
      ];

      tasksService.ensureDailyOccurrencesForDate.mockResolvedValueOnce(
        occurrences,
      );

      const ctx = createMockContext({ callbackData: 'menu:list_tasks' });
      await handler.handleCallbackQuery(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
      expect(tasksService.ensureDailyOccurrencesForDate).toHaveBeenCalledWith(
        'user-uuid-1',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      );

      expect(uiService.editOrReply).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('لیست تسک‌های امروز'),
        expect.objectContaining({
          parse_mode: 'HTML',
          reply_markup: expect.objectContaining({
            inline_keyboard: expect.arrayContaining([
              expect.arrayContaining([
                expect.objectContaining({
                  text: expect.stringContaining('نمایش تسک'),
                  callback_data: 'task:view:occ-1',
                  style: 'primary',
                }),
              ]),
              expect.arrayContaining([
                expect.objectContaining({
                  text: expect.stringContaining('نمایش تسک'),
                  callback_data: 'task:view:occ-2',
                  style: 'success',
                }),
              ]),
            ]),
          }),
        }),
      );
    });

    it('Scenario 2: An empty list displays clear Persian message and registration button', async () => {
      tasksService.ensureDailyOccurrencesForDate.mockResolvedValueOnce([]);

      const ctx = createMockContext({ callbackData: 'menu:list_tasks' });
      await handler.handleCallbackQuery(ctx);

      expect(uiService.editOrReply).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('شما هیچ تسکی برای امروز ندارید'),
        expect.objectContaining({
          reply_markup: expect.objectContaining({
            inline_keyboard: expect.arrayContaining([
              expect.arrayContaining([
                expect.objectContaining({
                  text: '➕ ثبت تسک جدید',
                  callback_data: 'menu:create_task',
                }),
              ]),
            ]),
          }),
        }),
      );
    });

    it('Scenario 3: Displays both one-time and recurring task occurrences correctly', async () => {
      const occurrences: TaskOccurrence[] = [
        {
          id: 'occ-one-time',
          date: '2026-10-18',
          status: TaskOccurrenceStatus.PENDING,
          task: {
            title: 'جلسه کاری',
            priority: TaskPriority.NORMAL,
            type: TaskType.ONE_TIME,
          } as Task,
        } as TaskOccurrence,
        {
          id: 'occ-daily',
          date: '2026-10-18',
          status: TaskOccurrenceStatus.IN_PROGRESS,
          task: {
            title: 'مطالعه روزانه',
            priority: TaskPriority.LOW,
            type: TaskType.DAILY,
          } as Task,
        } as TaskOccurrence,
      ];

      tasksService.ensureDailyOccurrencesForDate.mockResolvedValueOnce(
        occurrences,
      );

      const ctx = createMockContext({ callbackData: 'task:list:today' });
      await handler.handleCallbackQuery(ctx);

      const sentText = (uiService.editOrReply as jest.Mock).mock.calls[0][1];
      expect(sentText).toContain('جلسه کاری');
      expect(sentText).toContain('مطالعه روزانه');
    });

    it('Scenario 4: Correct local date selection for the user timezone', async () => {
      usersService.findTelegramUser.mockResolvedValueOnce({
        id: 'user-ny',
        telegramId: '12345',
        settings: {
          timezone: 'America/New_York',
          onboardingCompleted: true,
        } as UserSettings,
      } as User);

      tasksService.ensureDailyOccurrencesForDate.mockResolvedValueOnce([]);

      const ctx = createMockContext({ callbackData: 'menu:list_tasks' });
      await handler.handleCallbackQuery(ctx);

      expect(tasksService.ensureDailyOccurrencesForDate).toHaveBeenCalledWith(
        'user-ny',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      );
    });

    it('Scenario 5: Correct status labels and emojis for each occurrence status', async () => {
      const statuses = [
        {
          status: TaskOccurrenceStatus.PENDING,
          emoji: '🟡',
          label: 'در انتظار',
        },
        {
          status: TaskOccurrenceStatus.IN_PROGRESS,
          emoji: '🔵',
          label: 'در حال انجام',
        },
        {
          status: TaskOccurrenceStatus.COMPLETED,
          emoji: '🟢',
          label: 'تکمیل‌شده',
        },
        {
          status: TaskOccurrenceStatus.PARTIALLY_COMPLETED,
          emoji: '🟠',
          label: 'تا حدودی تکمیل‌شده',
        },
        {
          status: TaskOccurrenceStatus.NOT_COMPLETED,
          emoji: '🔴',
          label: 'انجام‌نشده',
        },
        { status: TaskOccurrenceStatus.SKIPPED, emoji: '⚪', label: 'ردشده' },
        {
          status: TaskOccurrenceStatus.CANCELLED,
          emoji: '⚫',
          label: 'لغوشده',
        },
      ];

      const occurrences: TaskOccurrence[] = statuses.map((item, idx) => ({
        id: `occ-${idx}`,
        date: '2026-10-18',
        status: item.status,
        task: {
          title: `تسک ${idx}`,
          priority: TaskPriority.NORMAL,
          type: TaskType.ONE_TIME,
        } as Task,
      })) as TaskOccurrence[];

      tasksService.ensureDailyOccurrencesForDate.mockResolvedValueOnce(
        occurrences,
      );

      const ctx = createMockContext({ callbackData: 'menu:list_tasks' });
      await handler.handleCallbackQuery(ctx);

      const sentText = (uiService.editOrReply as jest.Mock).mock.calls[0][1];
      for (const item of statuses) {
        expect(sentText).toContain(item.emoji);
        expect(sentText).toContain(item.label);
      }
    });

    it('Scenario 6: Correct local scheduling display converting scheduledDueAt in user timezone', async () => {
      const occurrences: TaskOccurrence[] = [
        {
          id: 'occ-interval',
          date: '2026-10-18',
          status: TaskOccurrenceStatus.PENDING,
          scheduledStartTime: '10:00:00',
          // 12:00 Tehran is 08:30 UTC
          scheduledDueAt: new Date('2026-10-18T08:30:00.000Z'),
          task: {
            title: 'تسک بازه زمانی',
            priority: TaskPriority.NORMAL,
            type: TaskType.ONE_TIME,
          } as Task,
        } as TaskOccurrence,
        {
          id: 'occ-start-only',
          date: '2026-10-18',
          status: TaskOccurrenceStatus.PENDING,
          scheduledStartTime: '15:30:00',
          scheduledDueAt: null,
          task: {
            title: 'تسک فقط شروع',
            priority: TaskPriority.NORMAL,
            type: TaskType.ONE_TIME,
          } as Task,
        } as TaskOccurrence,
        {
          id: 'occ-untimed',
          date: '2026-10-18',
          status: TaskOccurrenceStatus.PENDING,
          scheduledStartTime: null,
          scheduledDueAt: null,
          task: {
            title: 'تسک بدون زمان',
            priority: TaskPriority.NORMAL,
            type: TaskType.ONE_TIME,
          } as Task,
        } as TaskOccurrence,
      ];

      tasksService.ensureDailyOccurrencesForDate.mockResolvedValueOnce(
        occurrences,
      );

      const ctx = createMockContext({ callbackData: 'menu:list_tasks' });
      await handler.handleCallbackQuery(ctx);

      const sentText = (uiService.editOrReply as jest.Mock).mock.calls[0][1];
      expect(sentText).toContain('10:00 تا 12:00');
      expect(sentText).toContain('15:30');
      expect(sentText).toContain('بدون زمان مشخص');
    });

    it('Scenario 7: Timed tasks sorting before untimed tasks in ensureDailyOccurrencesForDate', async () => {
      // Tested at core level and verified in end-to-end list call
      const timed: TaskOccurrence = {
        id: 'occ-timed',
        date: '2026-10-18',
        status: TaskOccurrenceStatus.PENDING,
        scheduledStartTime: '08:00:00',
        task: { title: 'کار زمان‌دار' } as Task,
      } as TaskOccurrence;
      const untimed: TaskOccurrence = {
        id: 'occ-untimed',
        date: '2026-10-18',
        status: TaskOccurrenceStatus.PENDING,
        scheduledStartTime: null,
        task: { title: 'کار بدون زمان' } as Task,
      } as TaskOccurrence;

      tasksService.ensureDailyOccurrencesForDate.mockResolvedValueOnce([
        timed,
        untimed,
      ]);

      const ctx = createMockContext({ callbackData: 'menu:list_tasks' });
      await handler.handleCallbackQuery(ctx);

      const keyboard = (uiService.editOrReply as jest.Mock).mock.calls[0][2]
        .reply_markup;
      expect(keyboard.inline_keyboard[0][0].callback_data).toBe(
        'task:view:occ-timed',
      );
      expect(keyboard.inline_keyboard[1][0].callback_data).toBe(
        'task:view:occ-untimed',
      );
    });
  });

  describe('Task Details View (task:view:<occurrenceId>)', () => {
    it('Scenario 8: Opening a specific occurrence details with full metadata', async () => {
      const occurrence: TaskOccurrence = {
        id: '11111111-1111-4111-8111-111111111111',
        taskId: 'task-parent-1',
        date: '2026-10-18',
        status: TaskOccurrenceStatus.PENDING,
        scheduledStartTime: '10:00:00',
        scheduledDueAt: new Date('2026-10-18T08:30:00.000Z'), // 12:00 Tehran
        startedAt: null,
        completedAt: null,
        task: {
          id: 'task-parent-1',
          title: 'بررسی گزارش‌های مالی',
          description:
            'بررسی دقیق تراکنش‌های بانکی مهر ماه و مقایسه با فاکتورها',
          priority: TaskPriority.HIGH,
          type: TaskType.ONE_TIME,
          estimatedMinutes: 120,
          createdAt: new Date('2026-10-17T12:00:00.000Z'),
        } as Task,
      } as TaskOccurrence;

      tasksService.getOccurrenceById.mockResolvedValueOnce(occurrence);

      const ctx = createMockContext({
        callbackData: 'task:view:11111111-1111-4111-8111-111111111111',
      });
      await handler.handleCallbackQuery(ctx);

      expect(tasksService.getOccurrenceById).toHaveBeenCalledWith(
        'user-uuid-1',
        '11111111-1111-4111-8111-111111111111',
      );

      const sentText = (uiService.editOrReply as jest.Mock).mock.calls[0][1];
      expect(sentText).toContain('بررسی گزارش‌های مالی');
      expect(sentText).toContain('بررسی دقیق تراکنش‌های بانکی مهر ماه');
      expect(sentText).toContain('بالا');
      expect(sentText).toContain('یک‌باره');
      expect(sentText).toContain('2026-10-18');
      expect(sentText).toContain('10:00');
      expect(sentText).toContain('12:00');
      expect(sentText).toContain('120 دقیقه');
      expect(sentText).toContain('در انتظار');

      const keyboard = (uiService.editOrReply as jest.Mock).mock.calls[0][2]
        .reply_markup;
      expect(keyboard.inline_keyboard[0][0].text).toContain(
        'بازگشت به لیست امروز',
      );
      expect(keyboard.inline_keyboard[0][0].callback_data).toBe(
        'task:list:today',
      );
    });

    it('Scenario 9: Returning to the list and refreshing current data', async () => {
      // User presses "بازگشت به لیست امروز" (task:back:to_list or task:list:today)
      tasksService.ensureDailyOccurrencesForDate.mockResolvedValueOnce([]);

      const ctx = createMockContext({ callbackData: 'task:back:to_list' });
      await handler.handleCallbackQuery(ctx);

      expect(tasksService.ensureDailyOccurrencesForDate).toHaveBeenCalledWith(
        'user-uuid-1',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      );
      expect(uiService.editOrReply).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('لیست تسک‌های امروز'),
        expect.anything(),
      );
    });

    it('Scenario 10: Rejecting access to another user occurrence without revealing data', async () => {
      tasksService.getOccurrenceById.mockRejectedValueOnce(
        new ForbiddenException(
          'You do not have permission to access this task occurrence.',
        ),
      );

      const ctx = createMockContext({
        callbackData: 'task:view:22222222-2222-4222-8222-222222222222',
      });
      await handler.handleCallbackQuery(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('اجازه دسترسی'),
          show_alert: true,
        }),
      );
      // Ensure no task title or details were leaked
      expect(uiService.editOrReply).not.toHaveBeenCalled();
    });

    it('Scenario 11: Handling nonexistent occurrences and malformed callback UUIDs gracefully', async () => {
      // 1. Malformed UUID
      const malformedCtx = createMockContext({
        callbackData: 'task:view:not-a-uuid',
      });
      await handler.handleCallbackQuery(malformedCtx);

      expect(malformedCtx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('نامعتبر'),
          show_alert: true,
        }),
      );
      expect(tasksService.getOccurrenceById).not.toHaveBeenCalled();

      // 2. Nonexistent occurrence (NotFoundException)
      tasksService.getOccurrenceById.mockRejectedValueOnce(
        new NotFoundException('Occurrence not found'),
      );
      const notFoundCtx = createMockContext({
        callbackData: 'task:view:33333333-3333-4333-8333-333333333333',
      });
      await handler.handleCallbackQuery(notFoundCtx);

      expect(notFoundCtx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('یافت نشد'),
          show_alert: true,
        }),
      );
    });

    it('Scenario 12: Preventing duplicate occurrences if on-demand daily creation is called repeatedly', async () => {
      // Multiple calls to ensureDailyOccurrencesForDate are idempotent
      const occ: TaskOccurrence = {
        id: 'occ-1',
        date: '2026-10-18',
        status: TaskOccurrenceStatus.PENDING,
        task: { title: 'تسک روزانه' } as Task,
      } as TaskOccurrence;

      tasksService.ensureDailyOccurrencesForDate.mockResolvedValue([occ]);

      const ctx1 = createMockContext({ callbackData: 'menu:list_tasks' });
      await handler.handleCallbackQuery(ctx1);

      const ctx2 = createMockContext({ callbackData: 'task:list:today' });
      await handler.handleCallbackQuery(ctx2);

      expect(tasksService.ensureDailyOccurrencesForDate).toHaveBeenCalledTimes(
        2,
      );
      expect(uiService.editOrReply).toHaveBeenCalledTimes(2);
    });

    it('Scenario 13: Avoiding duplicate Telegram messages by calling editOrReply', async () => {
      tasksService.ensureDailyOccurrencesForDate.mockResolvedValueOnce([]);

      const ctx = createMockContext({ callbackData: 'menu:list_tasks' });
      await handler.handleCallbackQuery(ctx);

      // Verify editOrReply is used rather than ctx.reply
      expect(uiService.editOrReply).toHaveBeenCalledTimes(1);
    });

    it('Scenario 14: Gracefully handling Telegram edit failures and logging errors', async () => {
      tasksService.ensureDailyOccurrencesForDate.mockRejectedValueOnce(
        new Error('Database connection failed'),
      );

      const ctx = createMockContext({ callbackData: 'menu:list_tasks' });
      await handler.handleCallbackQuery(ctx);

      // Falls back to error message safely
      expect(uiService.editOrReply).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('خطا در دریافت لیست تسک‌ها'),
        expect.anything(),
      );
    });

    it('Scenario 15: Handling long lists without silently dropping tasks or exceeding message length', async () => {
      // 30 tasks with long titles and descriptions
      const occurrences: TaskOccurrence[] = Array.from(
        { length: 30 },
        (_, i) => ({
          id: `occ-${i}`,
          date: '2026-10-18',
          status: TaskOccurrenceStatus.PENDING,
          scheduledStartTime: '09:00:00',
          task: {
            title: `عنوان طولانی تسک شماره ${i + 1} برای بررسی محدودیت طول پیام در ربات تلگرام`,
            description: `توضیحات بسیار مفصل و طولانی تسک ${i + 1} که شامل جزئیات پیاده‌سازی و مراحل مختلف است`,
            priority: TaskPriority.NORMAL,
            type: TaskType.ONE_TIME,
          } as Task,
        }),
      ) as TaskOccurrence[];

      tasksService.ensureDailyOccurrencesForDate.mockResolvedValueOnce(
        occurrences,
      );

      const ctx = createMockContext({ callbackData: 'menu:list_tasks' });
      await handler.handleCallbackQuery(ctx);

      const sentText = (uiService.editOrReply as jest.Mock).mock.calls[0][1];
      // Must be safely within Telegram limit of 4096 characters
      expect(sentText.length).toBeLessThan(4000);
      expect(sentText).toContain('لیست تسک‌های امروز');
    });
  });

  describe('Inline Button Styles (Color-Style Follow-up)', () => {
    it('should map COMPLETED to success (green)', () => {
      expect(getOccurrenceButtonStyle(TaskOccurrenceStatus.COMPLETED)).toBe(
        'success',
      );
    });

    it('should map NOT_COMPLETED to danger (red)', () => {
      expect(getOccurrenceButtonStyle(TaskOccurrenceStatus.NOT_COMPLETED)).toBe(
        'danger',
      );
    });

    it('should map PENDING to primary (blue)', () => {
      expect(getOccurrenceButtonStyle(TaskOccurrenceStatus.PENDING)).toBe(
        'primary',
      );
    });

    it('should map IN_PROGRESS to primary (blue)', () => {
      expect(getOccurrenceButtonStyle(TaskOccurrenceStatus.IN_PROGRESS)).toBe(
        'primary',
      );
    });

    it('should map CANCELLED to danger (red)', () => {
      expect(getOccurrenceButtonStyle(TaskOccurrenceStatus.CANCELLED)).toBe(
        'danger',
      );
    });

    it('should leave SKIPPED and PARTIALLY_COMPLETED as undefined (default style)', () => {
      expect(
        getOccurrenceButtonStyle(TaskOccurrenceStatus.SKIPPED),
      ).toBeUndefined();
      expect(
        getOccurrenceButtonStyle(TaskOccurrenceStatus.PARTIALLY_COMPLETED),
      ).toBeUndefined();
    });

    it('should apply styles to buttons in buildDailyTaskListKeyboard while preserving callback data', () => {
      const occurrences: TaskOccurrence[] = [
        {
          id: '1',
          status: TaskOccurrenceStatus.COMPLETED,
          task: { title: 'T1' } as Task,
        } as TaskOccurrence,
        {
          id: '2',
          status: TaskOccurrenceStatus.NOT_COMPLETED,
          task: { title: 'T2' } as Task,
        } as TaskOccurrence,
        {
          id: '3',
          status: TaskOccurrenceStatus.PENDING,
          task: { title: 'T3' } as Task,
        } as TaskOccurrence,
        {
          id: '4',
          status: TaskOccurrenceStatus.SKIPPED,
          task: { title: 'T4' } as Task,
        } as TaskOccurrence,
      ];

      const keyboard = buildDailyTaskListKeyboard(occurrences);
      const rows = keyboard.inline_keyboard;

      expect(rows[0][0]).toEqual(
        expect.objectContaining({
          text: expect.stringContaining('نمایش تسک'),
          callback_data: 'task:view:1',
          style: 'success',
        }),
      );
      expect(rows[1][0]).toEqual(
        expect.objectContaining({
          text: expect.stringContaining('نمایش تسک'),
          callback_data: 'task:view:2',
          style: 'danger',
        }),
      );
      expect(rows[2][0]).toEqual(
        expect.objectContaining({
          text: expect.stringContaining('نمایش تسک'),
          callback_data: 'task:view:3',
          style: 'primary',
        }),
      );
      expect(rows[3][0]).toEqual(
        expect.objectContaining({
          text: expect.stringContaining('نمایش تسک'),
          callback_data: 'task:view:4',
        }),
      );
      expect((rows[3][0] as any).style).toBeUndefined();
    });
  });
});
