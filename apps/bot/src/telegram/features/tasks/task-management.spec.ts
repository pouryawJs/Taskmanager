import { Context } from 'grammy';
import {
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
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
import {
  buildTaskNotificationKeyboard,
  buildTaskDetailsActionKeyboard,
  buildTaskStatusKeyboard,
  buildConfirmDeleteKeyboard,
} from './tasks.keyboards';
import { mainMenuKeyboard } from '../start/start.keyboards';

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
    callbackMessageId?: number;
  }): Context => {
    return {
      from: {
        id: options.telegramId ?? 12345,
        is_bot: false,
        first_name: 'Test',
      },
      chat: { id: options.chatId ?? 99999, type: 'private' },
      callbackQuery: options.callbackData
        ? {
            data: options.callbackData,
            id: 'cb-1',
            message: options.callbackMessageId
              ? ({ message_id: options.callbackMessageId } as any)
              : undefined,
          }
        : undefined,
      message: options.text
        ? { text: options.text, message_id: 200 }
        : undefined,
      answerCallbackQuery: jest.fn().mockResolvedValue(true),
      reply: jest.fn().mockResolvedValue({ message_id: 201 }),
      deleteMessage: jest.fn().mockResolvedValue(true),
      api: {
        deleteMessage: jest.fn().mockResolvedValue(true),
      },
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
      deleteBotMessageSafely: jest.fn().mockResolvedValue(undefined),
      recordMenuMessage: jest.fn(),
      getMenuMessage: jest.fn().mockReturnValue(100),
      clearMenuMessage: jest.fn(),
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
      expect(ctxText.deleteMessage).toHaveBeenCalled();
      expect(uiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        ctxText,
        expect.stringContaining('عنوان تسک با موفقیت بروزرسانی شد'),
        7000,
      );
      expect(uiService.editOrReply).toHaveBeenCalled();
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
      expect(uiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        ctxEmpty,
        expect.stringContaining('عنوان تسک باید بین ۱ تا ۱۶۰ کاراکتر باشد'),
        10000,
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
      expect(ctxClear.deleteMessage).toHaveBeenCalled();
      expect(uiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        ctxClear,
        expect.stringContaining('توضیحات تسک حذف گردید'),
        7000,
      );
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
      expect(ctxCancel.deleteMessage).toHaveBeenCalled();
      expect(uiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        ctxCancel,
        expect.stringContaining('لغو شد'),
        7000,
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
      expect(ctx.deleteMessage).toHaveBeenCalled();
      expect(uiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('زمان‌بندی تسک با موفقیت ذخیره شد'),
        7000,
      );
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

      expect(ctxText.deleteMessage).toHaveBeenCalled();
      expect(uiService.editOrReply).toHaveBeenCalledWith(
        ctxText,
        expect.stringContaining('زمان‌بندی جدید'),
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
      expect(uiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('ساعت پایان باید دیرتر از ساعت شروع باشد'),
        10000,
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

  describe('Auto-delete messages in task editing flows (8 Core Scenarios)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    // 1. ویرایش موفق عنوان و حذف پیام‌های موقت
    it('Scenario 1: Successful title edit deletes user message immediately and sends temporary confirmation', async () => {
      const occurrence = createMockOccurrence();
      tasksService.getOccurrenceById.mockResolvedValue(occurrence);

      editStateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        occurrenceId: validOccId,
        taskId: validTaskId,
        mode: 'edit_title',
      });

      const ctx = createMockContext({ text: 'عنوان بازبینی شده' });
      await handler.handleEditTextInput(ctx);

      // User message deleted immediately
      expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);

      // Bot confirmation sent with ~7s delay
      expect(uiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('عنوان تسک با موفقیت بروزرسانی شد'),
        7000,
      );

      // Task details card refreshed in-place
      expect(uiService.editOrReply).toHaveBeenCalledWith(
        ctx,
        expect.any(String),
        expect.any(Object),
      );
      expect(editStateService.hasActiveSession('12345', 99999)).toBe(false);
    });

    // 2. ویرایش موفق توضیحات و حذف پیام‌های موقت
    it('Scenario 2: Successful description edit deletes user message immediately and sends temporary confirmation', async () => {
      const occurrence = createMockOccurrence();
      tasksService.getOccurrenceById.mockResolvedValue(occurrence);

      editStateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        occurrenceId: validOccId,
        taskId: validTaskId,
        mode: 'edit_description',
      });

      const ctx = createMockContext({ text: 'توضیحات تکمیلی جدید' });
      await handler.handleEditTextInput(ctx);

      expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);
      expect(uiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('توضیحات تسک با موفقیت بروزرسانی شد'),
        7000,
      );
      expect(tasksService.updateTask).toHaveBeenCalledWith(
        'user-uuid-1',
        validTaskId,
        { description: 'توضیحات تکمیلی جدید' },
      );
      expect(uiService.editOrReply).toHaveBeenCalled();
      expect(editStateService.hasActiveSession('12345', 99999)).toBe(false);
    });

    // 3. ویرایش موفق زمان‌بندی و حذف پیام‌های موقت
    it('Scenario 3: Successful schedule edit (time and date) deletes user message immediately and sends temporary confirmation', async () => {
      const occurrence = createMockOccurrence();
      tasksService.getOccurrenceById.mockResolvedValue(occurrence);

      // 3A: Time edit
      editStateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        occurrenceId: validOccId,
        taskId: validTaskId,
        mode: 'edit_time',
      });

      const ctxTime = createMockContext({ text: '08:30-09:45' });
      await handler.handleEditTextInput(ctxTime);

      expect(ctxTime.deleteMessage).toHaveBeenCalledTimes(1);
      expect(uiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        ctxTime,
        expect.stringContaining('زمان‌بندی تسک با موفقیت ذخیره شد'),
        7000,
      );
      expect(tasksService.updateOccurrenceSchedule).toHaveBeenCalledWith(
        'user-uuid-1',
        validOccId,
        { startTime: '08:30:00', endTime: '09:45:00' },
      );

      // 3B: Date edit (one-time task)
      editStateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        occurrenceId: validOccId,
        taskId: validTaskId,
        mode: 'edit_date',
      });

      const ctxDate = createMockContext({ text: '2026-10-25' });
      await handler.handleEditTextInput(ctxDate);

      expect(ctxDate.deleteMessage).toHaveBeenCalledTimes(1);
      expect(uiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        ctxDate,
        expect.stringContaining('تاریخ تسک با موفقیت تغییر یافت'),
        7000,
      );
      expect(tasksService.updateOccurrenceSchedule).toHaveBeenCalledWith(
        'user-uuid-1',
        validOccId,
        { date: '2026-10-25' },
      );
      expect(editStateService.hasActiveSession('12345', 99999)).toBe(false);
    });

    // 4. ورودی نامعتبر و حذف پیام کاربر و پیام خطای بات
    it('Scenario 4: Invalid input sends temporary error and schedules user message deletion with matching delay', async () => {
      const occurrence = createMockOccurrence();
      tasksService.getOccurrenceById.mockResolvedValue(occurrence);

      editStateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        occurrenceId: validOccId,
        taskId: validTaskId,
        mode: 'edit_title',
      });

      const ctxInvalid = createMockContext({
        text: 'a'.repeat(161),
        chatId: 99999,
      });
      await handler.handleEditTextInput(ctxInvalid);

      // Immediate deletion was NOT called because error messages remain visible for a delay
      expect(ctxInvalid.deleteMessage).not.toHaveBeenCalled();

      // Bot error sent as temporary confirmation with 10s delay
      expect(uiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        ctxInvalid,
        expect.stringContaining('عنوان تسک باید بین ۱ تا ۱۶۰ کاراکتر باشد'),
        10000,
      );

      // Before timer fires, user message has not been deleted
      expect(uiService.deleteBotMessageSafely).not.toHaveBeenCalled();

      // Fast-forward 10 seconds
      jest.advanceTimersByTime(10000);

      // User message is deleted via deleteBotMessageSafely after 10s
      expect(uiService.deleteBotMessageSafely).toHaveBeenCalledWith(
        ctxInvalid,
        99999,
        200,
      );
    });

    // 5. ارسال مجدد ورودی پس از خطای اعتبارسنجی
    it('Scenario 5: Re-submitting valid input after validation error succeeds without breaking flow', async () => {
      const occurrence = createMockOccurrence();
      tasksService.getOccurrenceById.mockResolvedValue(occurrence);

      editStateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        occurrenceId: validOccId,
        taskId: validTaskId,
        mode: 'edit_time',
      });

      // 1. First send invalid time format
      const ctxInvalid = createMockContext({ text: 'invalid-time-format' });
      await handler.handleEditTextInput(ctxInvalid);

      expect(tasksService.updateOccurrenceSchedule).not.toHaveBeenCalled();
      expect(uiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        ctxInvalid,
        expect.stringContaining('فرمت زمان واردشده نامعتبر است'),
        10000,
      );
      // Session is still active
      expect(editStateService.hasActiveSession('12345', 99999)).toBe(true);

      // 2. User retries with valid time
      const ctxValid = createMockContext({ text: '11:00-12:00' });
      await handler.handleEditTextInput(ctxValid);

      expect(ctxValid.deleteMessage).toHaveBeenCalledTimes(1);
      expect(tasksService.updateOccurrenceSchedule).toHaveBeenCalledWith(
        'user-uuid-1',
        validOccId,
        { startTime: '11:00:00', endTime: '12:00:00' },
      );
      expect(uiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        ctxValid,
        expect.stringContaining('زمان‌بندی تسک با موفقیت ذخیره شد'),
        7000,
      );
      expect(editStateService.hasActiveSession('12345', 99999)).toBe(false);
    });

    // 6. شکست حذف پیام بدون اختلال در جریان ویرایش
    it('Scenario 6: Message deletion failure does not disrupt or crash edit flow', async () => {
      const occurrence = createMockOccurrence();
      tasksService.getOccurrenceById.mockResolvedValue(occurrence);

      editStateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        occurrenceId: validOccId,
        taskId: validTaskId,
        mode: 'edit_title',
      });

      const ctx = createMockContext({ text: 'عنوان با خطای حذف' });
      (ctx.deleteMessage as jest.Mock).mockRejectedValueOnce(
        new Error('Telegram: message can not be deleted'),
      );

      // Should not throw
      await expect(handler.handleEditTextInput(ctx)).resolves.not.toThrow();

      // Edit logic executed cleanly despite deletion error
      expect(tasksService.updateTask).toHaveBeenCalledWith(
        'user-uuid-1',
        validTaskId,
        { title: 'عنوان با خطای حذف' },
      );
      expect(uiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('عنوان تسک با موفقیت بروزرسانی شد'),
        7000,
      );
      expect(editStateService.hasActiveSession('12345', 99999)).toBe(false);
    });

    // 7. باقیماندن منوی اصلی و پیام‌های دائمی
    it('Scenario 7: Permanent menu and task card messages remain intact and are not deleted', async () => {
      const occurrence = createMockOccurrence();
      tasksService.getOccurrenceById.mockResolvedValue(occurrence);

      // Menu message ID is 100
      uiService.recordMenuMessage(99999, 100);

      editStateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        occurrenceId: validOccId,
        taskId: validTaskId,
        mode: 'edit_title',
      });

      const ctx = createMockContext({ text: 'تست حفظ منو' });
      await handler.handleEditTextInput(ctx);

      // Menu card was updated via editOrReply
      expect(uiService.editOrReply).toHaveBeenCalled();

      // Menu message ID 100 was NOT targeted for deletion
      expect(uiService.deleteBotMessageSafely).not.toHaveBeenCalledWith(
        expect.anything(),
        99999,
        100,
      );
      expect(uiService.getMenuMessage(99999)).toBe(100);
    });

    // 8. لغو یا خروج از جریان ویرایش
    it('Scenario 8: Cancellation via /cancel or inline button cleans up sessions and deletes temporary messages', async () => {
      const occurrence = createMockOccurrence();
      tasksService.getOccurrenceById.mockResolvedValue(occurrence);

      // 8A: Cancel via /cancel text command
      editStateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        occurrenceId: validOccId,
        taskId: validTaskId,
        mode: 'edit_title',
      });

      const ctxTextCancel = createMockContext({ text: '/cancel' });
      await handler.handleEditTextInput(ctxTextCancel);

      expect(ctxTextCancel.deleteMessage).toHaveBeenCalledTimes(1);
      expect(uiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        ctxTextCancel,
        expect.stringContaining('ویرایش لغو شد'),
        7000,
      );
      expect(editStateService.hasActiveSession('12345', 99999)).toBe(false);
      expect(uiService.editOrReply).toHaveBeenCalled();

      // 8B: Cancel via inline button
      editStateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        occurrenceId: validOccId,
        taskId: validTaskId,
        mode: 'edit_description',
      });

      const ctxButtonCancel = createMockContext({
        callbackData: `task:ed:canc:${validOccId}`,
      });
      await handler.handleCallbackQuery(ctxButtonCancel);

      expect(editStateService.hasActiveSession('12345', 99999)).toBe(false);
      expect(ctxButtonCancel.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('لغو') }),
      );
      expect(uiService.editOrReply).toHaveBeenCalled();
    });

    // Extra: Non-text message during active edit mode
    it('Scenario 9: Non-text message during active edit session deletes user message and sends temporary warning', () => {
      editStateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        occurrenceId: validOccId,
        taskId: validTaskId,
        mode: 'edit_title',
      });

      const ctxNonText = {
        from: { id: 12345 },
        chat: { id: 99999 },
        message: { message_id: 333 },
      } as unknown as Context;

      handler.handleNonTextMessage(ctxNonText);

      expect(uiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        ctxNonText,
        expect.stringContaining('پیام متنی'),
        5000,
      );

      jest.advanceTimersByTime(5000);
      expect(uiService.deleteBotMessageSafely).toHaveBeenCalledWith(
        ctxNonText,
        99999,
        333,
      );
      expect(editStateService.hasActiveSession('12345', 99999)).toBe(true);
    });
  });

  describe('Task Notification Shortcuts & Direct Actions', () => {
    it('Notification keyboard contains all three expected actions with correct callback data and styles', () => {
      const keyboard = buildTaskNotificationKeyboard(validOccId);
      const rows = keyboard.inline_keyboard;

      expect(rows.length).toBe(2);

      // Row 1: View / Manage
      expect(rows[0].length).toBe(1);
      expect(rows[0][0].text).toContain('مشاهده و مدیریت تسک');
      expect(rows[0][0].callback_data).toBe(`task:view:${validOccId}`);
      expect((rows[0][0] as any).style).toBe('primary');

      // Row 2: Start and Cancel
      expect(rows[1].length).toBe(2);
      expect(rows[1][0].text).toContain('شروع کار');
      expect(rows[1][0].callback_data).toBe(`task:notif:start:${validOccId}`);
      expect((rows[1][0] as any).style).toBe('success');

      expect(rows[1][1].text).toContain('لغو تسک');
      expect(rows[1][1].callback_data).toBe(`task:notif:canc:${validOccId}`);
      expect((rows[1][1] as any).style).toBe('danger');
    });

    it('task:view opens existing task menu without changing task status', async () => {
      const occurrence = createMockOccurrence({
        status: TaskOccurrenceStatus.PENDING,
      });
      tasksService.getOccurrenceById.mockResolvedValueOnce(occurrence);

      const ctx = createMockContext({
        callbackData: `task:view:${validOccId}`,
      });
      await handler.handleCallbackQuery(ctx);

      expect(tasksService.startOccurrence).not.toHaveBeenCalled();
      expect(tasksService.cancelOccurrence).not.toHaveBeenCalled();
      expect(uiService.editOrReply).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('جزئیات تسک'),
        expect.objectContaining({ parse_mode: 'HTML' }),
      );
    });

    it('task:notif:start successfully transitions task, acknowledges callback toast, and opens task menu', async () => {
      const updatedOccurrence = createMockOccurrence({
        status: TaskOccurrenceStatus.IN_PROGRESS,
      });
      tasksService.startOccurrence.mockResolvedValueOnce(updatedOccurrence);
      tasksService.getOccurrenceById.mockResolvedValueOnce(updatedOccurrence);

      const ctx = createMockContext({
        callbackData: `task:notif:start:${validOccId}`,
      });
      await handler.handleCallbackQuery(ctx);

      expect(tasksService.startOccurrence).toHaveBeenCalledWith(
        'user-uuid-1',
        validOccId,
      );
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('در حال انجام'),
        }),
      );
      // Opens task menu reflecting updated state
      expect(uiService.editOrReply).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('جزئیات تسک'),
        expect.any(Object),
      );
    });

    it('task:notif:canc successfully cancels task, deletes notification message, and shows toast feedback without chat message', async () => {
      const cancelledOccurrence = createMockOccurrence({
        status: TaskOccurrenceStatus.CANCELLED,
      });
      tasksService.cancelOccurrence.mockResolvedValueOnce(cancelledOccurrence);

      const ctx = createMockContext({
        callbackData: `task:notif:canc:${validOccId}`,
        callbackMessageId: 789,
      });
      await handler.handleCallbackQuery(ctx);

      expect(tasksService.cancelOccurrence).toHaveBeenCalledWith(
        'user-uuid-1',
        validOccId,
      );
      // Callback toast shown
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('لغو'),
        }),
      );
      // Notification message is deleted
      expect(uiService.deleteBotMessageSafely).toHaveBeenCalledWith(
        ctx,
        99999,
        789,
      );
      // No extra chat message sent
      expect(ctx.reply).not.toHaveBeenCalled();
    });

    it('task:notif:start with invalid/ineligible transition displays error and keeps task unchanged', async () => {
      tasksService.startOccurrence.mockRejectedValueOnce(
        new BadRequestException(
          'Cannot change the status of an already completed task occurrence.',
        ),
      );

      const ctx = createMockContext({
        callbackData: `task:notif:start:${validOccId}`,
      });
      await handler.handleCallbackQuery(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Cannot change the status'),
          show_alert: true,
        }),
      );
      expect(uiService.editOrReply).not.toHaveBeenCalled();
    });

    it('task:notif:canc with invalid/ineligible transition displays error and does not delete notification', async () => {
      tasksService.cancelOccurrence.mockRejectedValueOnce(
        new BadRequestException(
          'Cannot change the status of an already completed task occurrence.',
        ),
      );

      const ctx = createMockContext({
        callbackData: `task:notif:canc:${validOccId}`,
        callbackMessageId: 789,
      });
      await handler.handleCallbackQuery(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Cannot change the status'),
          show_alert: true,
        }),
      );
      expect(uiService.deleteBotMessageSafely).not.toHaveBeenCalled();
    });

    it('rejects unauthorized callback safely without deleting notification or modifying state', async () => {
      tasksService.startOccurrence.mockRejectedValueOnce(
        new ForbiddenException('You do not have access to this occurrence.'),
      );

      const ctx = createMockContext({
        callbackData: `task:notif:start:${validOccId}`,
      });
      await handler.handleCallbackQuery(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('اجازه دسترسی'),
          show_alert: true,
        }),
      );
    });

    it('handles NotFoundException when task does not exist', async () => {
      tasksService.startOccurrence.mockRejectedValueOnce(
        new NotFoundException('Task occurrence not found.'),
      );

      const ctx = createMockContext({
        callbackData: `task:notif:start:${validOccId}`,
      });
      await handler.handleCallbackQuery(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('یافت نشد'),
          show_alert: true,
        }),
      );
    });

    it('handles unexpected Telegram deletion error safely without failing cancellation', async () => {
      const cancelledOccurrence = createMockOccurrence({
        status: TaskOccurrenceStatus.CANCELLED,
      });
      tasksService.cancelOccurrence.mockResolvedValueOnce(cancelledOccurrence);
      uiService.deleteBotMessageSafely.mockRejectedValueOnce(
        new Error('Telegram 400: message to delete not found'),
      );

      const ctx = createMockContext({
        callbackData: `task:notif:canc:${validOccId}`,
        callbackMessageId: 789,
      });

      await expect(handler.handleCallbackQuery(ctx)).resolves.not.toThrow();
      expect(tasksService.cancelOccurrence).toHaveBeenCalledWith(
        'user-uuid-1',
        validOccId,
      );
      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    });

    it('rejects invalid occurrenceId format safely', async () => {
      const ctx = createMockContext({
        callbackData: 'task:notif:start:not-a-uuid',
      });
      await handler.handleCallbackQuery(ctx);

      expect(tasksService.startOccurrence).not.toHaveBeenCalled();
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'شناسه تسک نامعتبر است.',
          show_alert: true,
        }),
      );
    });
  });

  describe('Semantic Inline Keyboard Styles', () => {
    it('applies semantic styles to Task Details Action Keyboard (primary status, danger delete)', () => {
      const occurrence = createMockOccurrence();
      const keyboard = buildTaskDetailsActionKeyboard(occurrence);
      const allButtons = keyboard.inline_keyboard.flat();

      const statusBtn = allButtons.find((b: any) =>
        b.callback_data.startsWith('task:act:stat:'),
      );
      expect((statusBtn as any).style).toBe('primary');

      const delBtn = allButtons.find((b: any) =>
        b.callback_data.startsWith('task:act:del:'),
      );
      expect((delBtn as any).style).toBe('danger');
    });

    it('applies semantic styles to Task Status Keyboard (success for progress/comp, danger for canc)', () => {
      const occurrence = createMockOccurrence({
        status: TaskOccurrenceStatus.PENDING,
      });
      const keyboard = buildTaskStatusKeyboard(occurrence);
      const allButtons = keyboard.inline_keyboard.flat();

      const startBtn = allButtons.find((b: any) =>
        b.callback_data.endsWith(':prog'),
      );
      expect((startBtn as any).style).toBe('success');

      const compBtn = allButtons.find((b: any) =>
        b.callback_data.endsWith(':comp'),
      );
      expect((compBtn as any).style).toBe('success');

      const cancBtn = allButtons.find((b: any) =>
        b.callback_data.endsWith(':canc'),
      );
      expect((cancBtn as any).style).toBe('danger');

      const skipBtn = allButtons.find((b: any) =>
        b.callback_data.endsWith(':skip'),
      );
      expect((skipBtn as any).style).toBeUndefined();
    });

    it('applies danger style to confirmation delete keyboard', () => {
      const keyboard = buildConfirmDeleteKeyboard(validOccId);
      const confirmBtn = keyboard.inline_keyboard[0][0];
      expect((confirmBtn as any).style).toBe('danger');
    });

    it('applies semantic styles to main menu (success for create, primary for today tasks)', () => {
      const allButtons = mainMenuKeyboard.inline_keyboard.flat();

      const createBtn = allButtons.find(
        (b: any) => b.callback_data === 'menu:create_task',
      );
      expect((createBtn as any).style).toBe('success');

      const listBtn = allButtons.find(
        (b: any) => b.callback_data === 'menu:list_tasks',
      );
      expect((listBtn as any).style).toBe('primary');

      const settingsBtn = allButtons.find(
        (b: any) => b.callback_data === 'menu:settings',
      );
      expect((settingsBtn as any).style).toBeUndefined();
    });
  });
});
