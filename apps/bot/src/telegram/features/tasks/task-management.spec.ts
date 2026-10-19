import { Context } from 'grammy';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
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
import { TaskEditStateService } from './task-edit.state';
import { TaskRegistrationHandler } from './task-registration.handlers';

describe('Phase 7: Task Management Operations & Details Menu', () => {
  let handler: TaskRegistrationHandler;
  let tasksService: jest.Mocked<TasksService>;
  let usersService: jest.Mocked<UsersService>;
  let uiService: jest.Mocked<TelegramUiService>;
  let regStateService: TaskRegistrationStateService;
  let editStateService: TaskEditStateService;

  const validOccId = '11111111-1111-4111-8111-111111111111';
  const validTaskId = '22222222-2222-4222-8222-222222222222';

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

  const createMockOccurrence = (
    overrides?: Partial<TaskOccurrence>,
  ): TaskOccurrence => {
    return {
      id: validOccId,
      taskId: validTaskId,
      date: '2026-10-20',
      status: TaskOccurrenceStatus.PENDING,
      scheduledStartTime: '10:00:00',
      scheduledStartAt: new Date('2026-10-20T06:30:00.000Z'),
      scheduledDueAt: new Date('2026-10-20T08:30:00.000Z'),
      startedAt: null,
      completedAt: null,
      createdAt: new Date('2026-10-18T10:00:00.000Z'),
      task: {
        id: validTaskId,
        ownerId: 'user-uuid-1',
        title: 'بررسی گزارش مالی',
        description: 'توضیحات تست تسک',
        priority: TaskPriority.NORMAL,
        type: TaskType.ONE_TIME,
        scheduledStartTime: '10:00:00',
        estimatedMinutes: 120,
        isActive: true,
      } as Task,
      ...overrides,
    } as TaskOccurrence;
  };

  const createMockContext = (options: {
    callbackData?: string;
    text?: string;
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
      message: options.text
        ? { text: options.text, message_id: 200 }
        : undefined,
      answerCallbackQuery: jest.fn().mockResolvedValue(true),
      reply: jest.fn().mockResolvedValue({ message_id: 201 }),
    } as unknown as Context;
  };

  beforeEach(() => {
    tasksService = {
      createTasks: jest.fn(),
      ensureDailyOccurrencesForDate: jest.fn(),
      getOccurrencesForDate: jest.fn(),
      getOccurrenceById: jest.fn(),
      updateTask: jest.fn(),
      updateOccurrenceSchedule: jest.fn(),
      deleteTask: jest.fn(),
      deactivateTask: jest.fn(),
      startOccurrence: jest.fn(),
      completeOccurrence: jest.fn(),
      partiallyCompleteOccurrence: jest.fn(),
      markOccurrenceNotCompleted: jest.fn(),
      skipOccurrence: jest.fn(),
      cancelOccurrence: jest.fn(),
    } as unknown as jest.Mocked<TasksService>;

    usersService = {
      findTelegramUser: jest.fn().mockResolvedValue(mockUser),
    } as unknown as jest.Mocked<UsersService>;

    uiService = {
      editOrReply: jest.fn().mockResolvedValue({ message_id: 100 }),
      sendTemporaryConfirmation: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<TelegramUiService>;

    regStateService = new TaskRegistrationStateService();
    editStateService = new TaskEditStateService();

    handler = new TaskRegistrationHandler(
      tasksService,
      usersService,
      uiService,
      regStateService,
      editStateService,
    );
  });

  describe('Task Details Menu Expansion', () => {
    it('should display action buttons in details view: status, edit, schedule, priority, delete', async () => {
      const occurrence = createMockOccurrence();
      tasksService.getOccurrenceById.mockResolvedValueOnce(occurrence);

      const ctx = createMockContext({
        callbackData: `task:view:${validOccId}`,
      });
      await handler.handleCallbackQuery(ctx);

      expect(uiService.editOrReply).toHaveBeenCalledTimes(1);
      const call = (uiService.editOrReply as jest.Mock).mock.calls[0];
      const keyboard = call[2].reply_markup;
      const allButtons = keyboard.inline_keyboard.flat();

      const callbacks = allButtons.map((b: any) => b.callback_data);
      expect(callbacks).toContain(`task:act:stat:${validOccId}`);
      expect(callbacks).toContain(`task:act:edit:${validOccId}`);
      expect(callbacks).toContain(`task:act:sched:${validOccId}`);
      expect(callbacks).toContain(`task:act:prio:${validOccId}`);
      expect(callbacks).toContain(`task:act:del:${validOccId}`);
      expect(callbacks).toContain('task:list:today');
    });

    it('should show lifecycle button for daily recurring tasks', async () => {
      const occurrence = createMockOccurrence({
        task: {
          id: validTaskId,
          ownerId: 'user-uuid-1',
          title: 'ورزش روزانه',
          type: TaskType.DAILY,
        } as Task,
      });
      tasksService.getOccurrenceById.mockResolvedValueOnce(occurrence);

      const ctx = createMockContext({
        callbackData: `task:view:${validOccId}`,
      });
      await handler.handleCallbackQuery(ctx);

      const keyboard = (uiService.editOrReply as jest.Mock).mock.calls[0][2]
        .reply_markup;
      const allButtons = keyboard.inline_keyboard.flat();
      const lifecycleBtn = allButtons.find(
        (b: any) => b.callback_data === `task:act:lifecycle:${validOccId}`,
      );
      expect(lifecycleBtn).toBeDefined();
      expect(lifecycleBtn.text).toContain('غیرفعال‌سازی');
    });
  });

  describe('Status Operations', () => {
    it('should open status menu and show valid transitions for pending task', async () => {
      const occurrence = createMockOccurrence({
        status: TaskOccurrenceStatus.PENDING,
      });
      tasksService.getOccurrenceById.mockResolvedValueOnce(occurrence);

      const ctx = createMockContext({
        callbackData: `task:act:stat:${validOccId}`,
      });
      await handler.handleCallbackQuery(ctx);

      const call = (uiService.editOrReply as jest.Mock).mock.calls[0];
      expect(call[1]).toContain('مدیریت وضعیت تسک');
      const allButtons = call[2].reply_markup.inline_keyboard.flat();
      const callbacks = allButtons.map((b: any) => b.callback_data);
      expect(callbacks).toContain(`task:st:${validOccId}:prog`);
      expect(callbacks).toContain(`task:st:${validOccId}:comp`);
      expect(callbacks).toContain(`task:st:${validOccId}:skip`);
      expect(callbacks).toContain(`task:st:${validOccId}:canc`);
    });

    it('should trigger startOccurrence when prog is selected', async () => {
      const occurrence = createMockOccurrence({
        status: TaskOccurrenceStatus.IN_PROGRESS,
      });
      tasksService.startOccurrence.mockResolvedValueOnce(occurrence);
      tasksService.getOccurrenceById.mockResolvedValueOnce(occurrence);

      const ctx = createMockContext({
        callbackData: `task:st:${validOccId}:prog`,
      });
      await handler.handleCallbackQuery(ctx);

      expect(tasksService.startOccurrence).toHaveBeenCalledWith(
        'user-uuid-1',
        validOccId,
      );
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('موفقیت'),
        }),
      );
    });

    it('should trigger completeOccurrence when comp is selected', async () => {
      const occurrence = createMockOccurrence({
        status: TaskOccurrenceStatus.COMPLETED,
      });
      tasksService.completeOccurrence.mockResolvedValueOnce(occurrence);
      tasksService.getOccurrenceById.mockResolvedValueOnce(occurrence);

      const ctx = createMockContext({
        callbackData: `task:st:${validOccId}:comp`,
      });
      await handler.handleCallbackQuery(ctx);

      expect(tasksService.completeOccurrence).toHaveBeenCalledWith(
        'user-uuid-1',
        validOccId,
      );
    });

    it('should trigger skipOccurrence when skip is selected without deactivating parent', async () => {
      const occurrence = createMockOccurrence({
        status: TaskOccurrenceStatus.SKIPPED,
      });
      tasksService.skipOccurrence.mockResolvedValueOnce(occurrence);
      tasksService.getOccurrenceById.mockResolvedValueOnce(occurrence);

      const ctx = createMockContext({
        callbackData: `task:st:${validOccId}:skip`,
      });
      await handler.handleCallbackQuery(ctx);

      expect(tasksService.skipOccurrence).toHaveBeenCalledWith(
        'user-uuid-1',
        validOccId,
      );
      expect(tasksService.deactivateTask).not.toHaveBeenCalled();
    });

    it('should trigger cancelOccurrence when canc is selected', async () => {
      const occurrence = createMockOccurrence({
        status: TaskOccurrenceStatus.CANCELLED,
      });
      tasksService.cancelOccurrence.mockResolvedValueOnce(occurrence);
      tasksService.getOccurrenceById.mockResolvedValueOnce(occurrence);

      const ctx = createMockContext({
        callbackData: `task:st:${validOccId}:canc`,
      });
      await handler.handleCallbackQuery(ctx);

      expect(tasksService.cancelOccurrence).toHaveBeenCalledWith(
        'user-uuid-1',
        validOccId,
      );
    });

    it('should handle terminal state transition error with user alert', async () => {
      tasksService.completeOccurrence.mockRejectedValueOnce(
        new BadRequestException(
          'Cannot change status of completed occurrence.',
        ),
      );

      const ctx = createMockContext({
        callbackData: `task:st:${validOccId}:comp`,
      });
      await handler.handleCallbackQuery(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          show_alert: true,
          text: expect.stringContaining('Cannot change status'),
        }),
      );
    });
  });

  describe('Priority Management', () => {
    it('should open priority menu and update priority when selected', async () => {
      const occurrence = createMockOccurrence();
      tasksService.getOccurrenceById.mockResolvedValue(occurrence);

      // 1. Open priority menu
      const ctxMenu = createMockContext({
        callbackData: `task:act:prio:${validOccId}`,
      });
      await handler.handleCallbackQuery(ctxMenu);

      const call = (uiService.editOrReply as jest.Mock).mock.calls[0];
      expect(call[1]).toContain('تغییر اولویت تسک');

      // 2. Select HIGH priority
      const ctxSet = createMockContext({
        callbackData: `task:pr:${validOccId}:high`,
      });
      await handler.handleCallbackQuery(ctxSet);

      expect(tasksService.updateTask).toHaveBeenCalledWith(
        'user-uuid-1',
        validTaskId,
        { priority: TaskPriority.HIGH },
      );
      expect(ctxSet.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('موفقیت') }),
      );
    });
  });

  describe('Interactive Editing (Title, Description)', () => {
    it('should prompt for new title and successfully update title from user text', async () => {
      const occurrence = createMockOccurrence();
      tasksService.getOccurrenceById.mockResolvedValue(occurrence);

      // 1. Click edit title
      const ctxStart = createMockContext({
        callbackData: `task:ed:${validOccId}:title`,
      });
      await handler.handleCallbackQuery(ctxStart);

      expect(editStateService.hasActiveSession('12345', 99999)).toBe(true);
      expect(uiService.editOrReply).toHaveBeenCalledWith(
        ctxStart,
        expect.stringContaining('ویرایش عنوان'),
        expect.any(Object),
      );

      // 2. User sends new title
      const ctxText = createMockContext({ text: 'عنوان جدید تسک' });
      await handler.handleEditTextInput(ctxText);

      expect(tasksService.updateTask).toHaveBeenCalledWith(
        'user-uuid-1',
        validTaskId,
        { title: 'عنوان جدید تسک' },
      );
      expect(editStateService.hasActiveSession('12345', 99999)).toBe(false);
      expect(ctxText.reply).toHaveBeenCalledWith(
        expect.stringContaining('عنوان تسک با موفقیت بروزرسانی شد'),
      );
    });

    it('should reject empty or overly long title without losing edit state', async () => {
      const occurrence = createMockOccurrence();
      tasksService.getOccurrenceById.mockResolvedValue(occurrence);

      editStateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        occurrenceId: validOccId,
        taskId: validTaskId,
        mode: 'edit_title',
      });

      // User sends empty title
      const ctxEmpty = createMockContext({ text: '   ' });
      await handler.handleEditTextInput(ctxEmpty);

      expect(tasksService.updateTask).not.toHaveBeenCalled();
      expect(editStateService.hasActiveSession('12345', 99999)).toBe(true);
      expect(ctxEmpty.reply).toHaveBeenCalledWith(
        expect.stringContaining('عنوان تسک باید بین ۱ تا ۱۶۰ کاراکتر باشد'),
        expect.any(Object),
      );
    });

    it('should allow clearing description by sending "حذف" or "-"', async () => {
      const occurrence = createMockOccurrence();
      tasksService.getOccurrenceById.mockResolvedValue(occurrence);

      editStateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        occurrenceId: validOccId,
        taskId: validTaskId,
        mode: 'edit_description',
      });

      const ctxClear = createMockContext({ text: 'حذف' });
      await handler.handleEditTextInput(ctxClear);

      expect(tasksService.updateTask).toHaveBeenCalledWith(
        'user-uuid-1',
        validTaskId,
        { description: null },
      );
      expect(editStateService.hasActiveSession('12345', 99999)).toBe(false);
    });

    it('should allow cancelling edit via /cancel command', async () => {
      const occurrence = createMockOccurrence();
      tasksService.getOccurrenceById.mockResolvedValue(occurrence);

      editStateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        occurrenceId: validOccId,
        taskId: validTaskId,
        mode: 'edit_title',
      });

      const ctxCancel = createMockContext({ text: '/cancel' });
      await handler.handleEditTextInput(ctxCancel);

      expect(tasksService.updateTask).not.toHaveBeenCalled();
      expect(editStateService.hasActiveSession('12345', 99999)).toBe(false);
      expect(ctxCancel.reply).toHaveBeenCalledWith(
        expect.stringContaining('لغو شد'),
      );
    });

    it('should enforce user and chat session isolation', () => {
      editStateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        occurrenceId: validOccId,
        taskId: validTaskId,
        mode: 'edit_title',
      });

      // Different chat ID
      expect(editStateService.hasActiveSession('12345', 88888)).toBe(false);

      // Different user ID
      expect(editStateService.hasActiveSession('99999', 99999)).toBe(false);
    });
  });

  describe('Schedule Management', () => {
    it('should clear schedule on clear schedule button', async () => {
      const occurrence = createMockOccurrence();
      tasksService.getOccurrenceById.mockResolvedValue(occurrence);

      const ctx = createMockContext({
        callbackData: `task:sc:${validOccId}:clear`,
      });
      await handler.handleCallbackQuery(ctx);

      expect(tasksService.updateOccurrenceSchedule).toHaveBeenCalledWith(
        'user-uuid-1',
        validOccId,
        { clearSchedule: true, updateTaskDefault: false },
      );
    });

    it('should update start and end time interval for one-time task', async () => {
      const occurrence = createMockOccurrence({
        task: { id: validTaskId, type: TaskType.ONE_TIME } as Task,
      });
      tasksService.getOccurrenceById.mockResolvedValue(occurrence);

      editStateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        occurrenceId: validOccId,
        taskId: validTaskId,
        mode: 'edit_time',
      });

      const ctx = createMockContext({ text: '10:00-11:30' });
      await handler.handleEditTextInput(ctx);

      expect(tasksService.updateOccurrenceSchedule).toHaveBeenCalledWith(
        'user-uuid-1',
        validOccId,
        {
          startTime: '10:00:00',
          endTime: '11:30:00',
        },
      );
      expect(editStateService.hasActiveSession('12345', 99999)).toBe(false);
    });

    it('should prompt for daily task schedule scope and apply to default when selected', async () => {
      const occurrence = createMockOccurrence({
        task: { id: validTaskId, type: TaskType.DAILY } as Task,
      });
      tasksService.getOccurrenceById.mockResolvedValue(occurrence);

      editStateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        occurrenceId: validOccId,
        taskId: validTaskId,
        mode: 'edit_time',
      });

      // 1. Send time text -> prompts for scope
      const ctxText = createMockContext({ text: '09:00' });
      await handler.handleEditTextInput(ctxText);

      expect(ctxText.reply).toHaveBeenCalledWith(
        expect.stringContaining('آیا مایلید این زمان فقط برای امروز اعمال شود'),
        expect.any(Object),
      );

      // 2. Select apply to all days
      const ctxApply = createMockContext({
        callbackData: `task:sc:apply_all:${validOccId}`,
      });
      await handler.handleCallbackQuery(ctxApply);

      expect(tasksService.updateOccurrenceSchedule).toHaveBeenCalledWith(
        'user-uuid-1',
        validOccId,
        {
          startTime: '09:00:00',
          endTime: null,
          updateTaskDefault: true,
        },
      );
      expect(editStateService.hasActiveSession('12345', 99999)).toBe(false);
    });

    it('should reject end time earlier than start time', async () => {
      const occurrence = createMockOccurrence();
      tasksService.getOccurrenceById.mockResolvedValue(occurrence);

      editStateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        occurrenceId: validOccId,
        taskId: validTaskId,
        mode: 'edit_time',
      });

      const ctx = createMockContext({ text: '12:00-10:00' });
      await handler.handleEditTextInput(ctx);

      expect(tasksService.updateOccurrenceSchedule).not.toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('ساعت پایان باید دیرتر از ساعت شروع باشد'),
        expect.any(Object),
      );
    });
  });

  describe('Lifecycle Operations (Deactivate vs Delete)', () => {
    it('should deactivate recurring task with confirmation', async () => {
      const occurrence = createMockOccurrence({
        task: {
          id: validTaskId,
          title: 'وظیفه روزانه',
          type: TaskType.DAILY,
        } as Task,
      });
      tasksService.getOccurrenceById.mockResolvedValue(occurrence);

      // 1. Confirm prompt
      const ctxConfirm = createMockContext({
        callbackData: `task:lc:deact:${validOccId}`,
      });
      await handler.handleCallbackQuery(ctxConfirm);

      expect(uiService.editOrReply).toHaveBeenCalledWith(
        ctxConfirm,
        expect.stringContaining('آیا از غیرفعال کردن تکرار روزانه'),
        expect.any(Object),
      );

      // 2. Confirm execute
      const ctxExecute = createMockContext({
        callbackData: `task:lc:deact_ok:${validOccId}`,
      });
      await handler.handleCallbackQuery(ctxExecute);

      expect(tasksService.deactivateTask).toHaveBeenCalledWith(
        'user-uuid-1',
        validTaskId,
      );
      expect(ctxExecute.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('غیرفعال شد'),
        }),
      );
    });

    it('should block permanent delete when task has history and suggest deactivation', async () => {
      const occurrence = createMockOccurrence({
        task: {
          id: validTaskId,
          title: 'وظیفه دارای سابقه',
          type: TaskType.DAILY,
        } as Task,
      });
      tasksService.getOccurrenceById.mockResolvedValue(occurrence);
      tasksService.deleteTask.mockRejectedValueOnce(
        new BadRequestException('Cannot delete task with completed history'),
      );

      const ctx = createMockContext({
        callbackData: `task:lc:del_ok:${validOccId}`,
      });
      await handler.handleCallbackQuery(ctx);

      expect(uiService.editOrReply).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('امکان حذف وجود ندارد'),
        expect.objectContaining({
          reply_markup: expect.objectContaining({
            inline_keyboard: expect.arrayContaining([
              expect.arrayContaining([
                expect.objectContaining({
                  text: expect.stringContaining('غیرفعال'),
                }),
              ]),
            ]),
          }),
        }),
      );
    });

    it('should safely delete task when it has no history', async () => {
      const occurrence = createMockOccurrence();
      tasksService.getOccurrenceById.mockResolvedValue(occurrence);
      tasksService.deleteTask.mockResolvedValueOnce(undefined);

      const ctx = createMockContext({
        callbackData: `task:lc:del_ok:${validOccId}`,
      });
      await handler.handleCallbackQuery(ctx);

      expect(tasksService.deleteTask).toHaveBeenCalledWith(
        'user-uuid-1',
        validTaskId,
      );
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('حذف گردید') }),
      );
    });
  });

  describe('Security and Ownership Enforcement', () => {
    it('should deny access if user does not own occurrence', async () => {
      tasksService.getOccurrenceById.mockRejectedValueOnce(
        new ForbiddenException('You do not own this task'),
      );

      const ctx = createMockContext({
        callbackData: `task:act:stat:${validOccId}`,
      });
      await handler.handleCallbackQuery(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          show_alert: true,
          text: expect.stringContaining('اجازه دسترسی'),
        }),
      );
    });

    it('should safely reject invalid non-UUID callback payloads', async () => {
      const ctx = createMockContext({
        callbackData: 'task:act:stat:invalid-not-uuid',
      });
      await handler.handleCallbackQuery(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          show_alert: true,
          text: expect.stringContaining('نامعتبر'),
        }),
      );
      expect(tasksService.getOccurrenceById).not.toHaveBeenCalled();
    });
  });
});
