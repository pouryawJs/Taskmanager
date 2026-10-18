import { Bot, Context } from 'grammy';
import { TaskType, TaskPriority, User, UserSettings } from '@app/database';
import { TasksService, UsersService } from '@app/core';

import { TelegramUiService } from '../../ui/telegram-ui.service';
import { TaskRegistrationStateService } from './task-registration.state';
import { TaskRegistrationHandler } from './task-registration.handlers';
import { TasksFeature } from './tasks.feature';

describe('TaskRegistrationHandler & Flow (Phase 5)', () => {
  let handler: TaskRegistrationHandler;
  let stateService: TaskRegistrationStateService;
  let tasksService: jest.Mocked<TasksService>;
  let usersService: jest.Mocked<UsersService>;
  let uiService: jest.Mocked<TelegramUiService>;

  const mockUser: User = {
    id: 'user-uuid-1',
    displayName: 'Pourya',
    settings: {
      userId: 'user-uuid-1',
      timezone: 'Asia/Tehran',
      onboardingCompleted: true,
    } as UserSettings,
  } as User;

  const mockUserNy: User = {
    id: 'user-uuid-ny',
    displayName: 'John',
    settings: {
      userId: 'user-uuid-ny',
      timezone: 'America/New_York',
      onboardingCompleted: true,
    } as UserSettings,
  } as User;

  beforeEach(() => {
    stateService = new TaskRegistrationStateService();

    tasksService = {
      createTasks: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<TasksService>;

    usersService = {
      findTelegramUser: jest.fn().mockResolvedValue(mockUser),
    } as unknown as jest.Mocked<UsersService>;

    uiService = {
      editOrReply: jest.fn().mockResolvedValue(true),
      sendTemporaryConfirmation: jest.fn().mockResolvedValue(null),
      deleteBotMessageSafely: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<TelegramUiService>;

    handler = new TaskRegistrationHandler(
      tasksService,
      usersService,
      uiService,
      stateService,
    );
  });

  const createMockContext = (options: {
    text?: string;
    callbackData?: string;
    telegramId?: number;
    chatId?: number;
    messageId?: number;
  }): Context => {
    const telegramId = options.telegramId ?? 12345;
    const chatId = options.chatId ?? 99999;
    const messageId = options.messageId ?? 42;

    return {
      from: { id: telegramId, is_bot: false, first_name: 'Test' },
      chat: { id: chatId, type: 'private' },
      message: options.text
        ? { message_id: messageId, text: options.text }
        : undefined,
      callbackQuery: options.callbackData
        ? { data: options.callbackData, id: 'cb-1' }
        : undefined,
      answerCallbackQuery: jest.fn().mockResolvedValue(true),
      deleteMessage: jest.fn().mockResolvedValue(true),
      api: {
        deleteMessage: jest.fn().mockResolvedValue(true),
      },
    } as unknown as Context;
  };

  describe('Step A: Choose Task Type & Calendar Flow', () => {
    it('should show task type choices when user clicks menu:create_task', async () => {
      const ctx = createMockContext({ callbackData: 'menu:create_task' });

      await handler.handleCallbackQuery(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
      expect(uiService.editOrReply).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('ثبت تسک جدید'),
        expect.objectContaining({ reply_markup: expect.anything() }),
      );
    });

    it('should open calendar picker when user selects one-time task', async () => {
      const ctx = createMockContext({ callbackData: 'task:type:one_time' });

      await handler.handleCallbackQuery(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
      expect(uiService.editOrReply).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('انتخاب تاریخ برای تسک یک‌باره'),
        expect.objectContaining({ reply_markup: expect.anything() }),
      );
    });

    it('should navigate calendar months when nav callback is triggered', async () => {
      const ctx = createMockContext({ callbackData: 'task:date:nav:2026-11' });

      await handler.handleCallbackQuery(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
      expect(uiService.editOrReply).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('انتخاب تاریخ برای تسک یک‌باره'),
        expect.anything(),
      );
    });

    it('should reject invalid calendar navigation callback data', async () => {
      const ctx = createMockContext({ callbackData: 'task:date:nav:invalid' });

      await handler.handleCallbackQuery(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('نامعتبر') }),
      );
    });

    it('should start ONE_TIME registration session when calendar date is selected', async () => {
      const ctx = createMockContext({
        callbackData: 'task:date:select:2026-10-25',
      });

      await handler.handleCallbackQuery(ctx);

      expect(stateService.hasActiveSession('12345')).toBe(true);
      const session = stateService.getSession('12345');
      expect(session?.taskType).toBe(TaskType.ONE_TIME);
      expect(session?.selectedDate).toBe('2026-10-25');
      expect(uiService.editOrReply).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('حالت ثبت تسک فعال شد'),
        expect.anything(),
      );
    });

    it('should reject invalid calendar date selection', async () => {
      const ctx = createMockContext({
        callbackData: 'task:date:select:2026-02-31',
      });

      await handler.handleCallbackQuery(ctx);

      expect(stateService.hasActiveSession('12345')).toBe(false);
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('نامعتبر') }),
      );
    });

    it('should start DAILY registration session immediately when user selects daily task', async () => {
      const ctx = createMockContext({ callbackData: 'task:type:daily' });

      await handler.handleCallbackQuery(ctx);

      expect(stateService.hasActiveSession('12345')).toBe(true);
      const session = stateService.getSession('12345');
      expect(session?.taskType).toBe(TaskType.DAILY);
      expect(session?.selectedDate).toBeUndefined();
      expect(uiService.editOrReply).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('حالت ثبت تسک فعال شد'),
        expect.anything(),
      );
    });
  });

  describe('Step C & D: Process Text Messages & Task Persistence', () => {
    beforeEach(() => {
      // Start an active ONE_TIME session for testing text processing
      stateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        taskType: TaskType.ONE_TIME,
        selectedDate: '2026-10-20',
      });
    });

    it('Requirement 1: Successful registration of a single untimed task', async () => {
      const ctx = createMockContext({ text: 'Buy groceries' });

      await handler.handleTextMessage(ctx);

      expect(tasksService.createTasks).toHaveBeenCalledWith('user-uuid-1', [
        {
          title: 'Buy groceries',
          type: TaskType.ONE_TIME,
          date: '2026-10-20',
          scheduledStartTime: undefined,
          scheduledDueAt: undefined,
          priority: TaskPriority.NORMAL,
        },
      ]);
      expect(ctx.deleteMessage).toHaveBeenCalled();
      expect(uiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('با موفقیت ثبت شد'),
        7000,
      );
      expect(stateService.getSession('12345')?.savedCount).toBe(1);
    });

    it('Requirement 2: Successful registration of a task with a start time', async () => {
      const ctx = createMockContext({ text: 'Exercise at 18:00' });

      await handler.handleTextMessage(ctx);

      expect(tasksService.createTasks).toHaveBeenCalledWith('user-uuid-1', [
        expect.objectContaining({
          title: 'Exercise',
          scheduledStartTime: '18:00:00',
          scheduledDueAt: undefined,
        }),
      ]);
    });

    it('Requirement 3: Successful registration of a task with start and end times', async () => {
      const ctx = createMockContext({ text: 'Study from 09:00 to 10:30' });

      await handler.handleTextMessage(ctx);

      expect(tasksService.createTasks).toHaveBeenCalledWith('user-uuid-1', [
        expect.objectContaining({
          title: 'Study',
          scheduledStartTime: '09:00:00',
          scheduledDueAt: expect.any(Date),
        }),
      ]);
    });

    it('Requirement 4: Multiple tasks in one message', async () => {
      const ctx = createMockContext({
        text: 'Task 1\nTask 2\nTask 3',
      });

      await handler.handleTextMessage(ctx);

      expect(tasksService.createTasks).toHaveBeenCalledWith(
        'user-uuid-1',
        expect.arrayContaining([
          expect.objectContaining({ title: 'Task 1' }),
          expect.objectContaining({ title: 'Task 2' }),
          expect.objectContaining({ title: 'Task 3' }),
        ]),
      );
      expect(stateService.getSession('12345')?.savedCount).toBe(3);
    });

    it('Requirement 5: Mixed message containing timed and untimed tasks', async () => {
      const ctx = createMockContext({
        text: 'Read book\nWorkout at 17:00\nWork session from 09:00 to 11:00',
      });

      await handler.handleTextMessage(ctx);

      expect(tasksService.createTasks).toHaveBeenCalledWith('user-uuid-1', [
        expect.objectContaining({
          title: 'Read book',
          scheduledStartTime: undefined,
          scheduledDueAt: undefined,
        }),
        expect.objectContaining({
          title: 'Workout',
          scheduledStartTime: '17:00:00',
          scheduledDueAt: undefined,
        }),
        expect.objectContaining({
          title: 'Work session',
          scheduledStartTime: '09:00:00',
          scheduledDueAt: expect.any(Date),
        }),
      ]);
    });

    it('Requirement 6: A message with one invalid line creates no tasks from that message', async () => {
      const ctx = createMockContext({
        text: 'Valid task 1\nInvalid task at 25:99\nValid task 2',
      });

      await handler.handleTextMessage(ctx);

      expect(tasksService.createTasks).not.toHaveBeenCalled();
      expect(uiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('سطر 2'),
        15000,
      );
      // User message should NOT be deleted immediately
      expect(ctx.deleteMessage).not.toHaveBeenCalled();
    });

    it('Requirement 7: A failed later message does not affect tasks saved by an earlier message', async () => {
      // First message: valid
      const ctx1 = createMockContext({ text: 'Task 1\nTask 2' });
      await handler.handleTextMessage(ctx1);
      expect(stateService.getSession('12345')?.savedCount).toBe(2);

      // Second message: invalid line
      const ctx2 = createMockContext({ text: 'Broken at 99:99' });
      await handler.handleTextMessage(ctx2);
      expect(tasksService.createTasks).toHaveBeenCalledTimes(1);
      // Count remains 2
      expect(stateService.getSession('12345')?.savedCount).toBe(2);
    });

    it('Requirement 8: One-time tasks use the selected date', async () => {
      stateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        taskType: TaskType.ONE_TIME,
        selectedDate: '2026-12-05',
      });

      const ctx = createMockContext({ text: 'Doctor appointment' });
      await handler.handleTextMessage(ctx);

      expect(tasksService.createTasks).toHaveBeenCalledWith('user-uuid-1', [
        expect.objectContaining({
          date: '2026-12-05',
          type: TaskType.ONE_TIME,
        }),
      ]);
    });

    it('Requirement 9: Daily tasks use the correct initial date and recurring-task behavior', async () => {
      stateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        taskType: TaskType.DAILY,
      });

      const ctx = createMockContext({ text: 'Morning meditation' });
      await handler.handleTextMessage(ctx);

      expect(tasksService.createTasks).toHaveBeenCalledWith('user-uuid-1', [
        expect.objectContaining({
          type: TaskType.DAILY,
          date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      ]);
    });

    it('Requirement 10: Scheduled end time is not silently lost and is mapped correctly', async () => {
      const ctx = createMockContext({
        text: 'Class from 10:00 to 12:00',
      });

      await handler.handleTextMessage(ctx);

      expect(tasksService.createTasks).toHaveBeenCalledWith('user-uuid-1', [
        expect.objectContaining({
          scheduledStartTime: '10:00:00',
          scheduledDueAt: expect.any(Date),
        }),
      ]);
    });

    it('Requirement 11: User timezone is respected when converting date/time to timestamps', async () => {
      usersService.findTelegramUser.mockResolvedValueOnce(mockUserNy);

      stateService.startSession('54321', {
        userId: 'user-uuid-ny',
        chatId: 99999,
        taskType: TaskType.ONE_TIME,
        selectedDate: '2026-10-20',
      });

      const ctx = createMockContext({
        telegramId: 54321,
        text: 'Team sync from 10:00 to 12:00',
      });

      await handler.handleTextMessage(ctx);

      // In New York (UTC-4 in October), 12:00 local time = 16:00:00 UTC
      expect(tasksService.createTasks).toHaveBeenCalledWith('user-uuid-ny', [
        expect.objectContaining({
          scheduledDueAt: new Date('2026-10-20T16:00:00.000Z'),
        }),
      ]);
    });

    it('Requirement 15: Persistence failures do not produce false success messages or duplicate writes', async () => {
      tasksService.createTasks.mockRejectedValueOnce(
        new Error('Database transaction failed'),
      );

      const ctx = createMockContext({ text: 'Failing task' });
      await handler.handleTextMessage(ctx);

      expect(uiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('خطا در ذخیره‌سازی تسک‌ها'),
        15000,
      );
      expect(stateService.getSession('12345')?.savedCount).toBe(0);
      expect(ctx.deleteMessage).not.toHaveBeenCalled();
    });

    it('Requirement 16: Message-deletion failures do not cause task creation to be repeated', async () => {
      const ctx = createMockContext({ text: 'Task with del error' });
      (ctx.deleteMessage as jest.Mock).mockRejectedValueOnce(
        new Error('Message cannot be deleted'),
      );

      await handler.handleTextMessage(ctx);

      // Still calls createTasks only once
      expect(tasksService.createTasks).toHaveBeenCalledTimes(1);
      expect(uiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('با موفقیت ثبت شد'),
        7000,
      );
      expect(stateService.getSession('12345')?.savedCount).toBe(1);
    });
  });

  describe('Step E: Finish and Back Behavior', () => {
    it('Requirement 12: Finish exits registration mode without deleting saved tasks', async () => {
      stateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        taskType: TaskType.DAILY,
      });
      stateService.incrementSavedCount('12345', 4);

      const ctx = createMockContext({ callbackData: 'task:reg:finish' });
      await handler.handleCallbackQuery(ctx);

      expect(stateService.hasActiveSession('12345')).toBe(false);
      expect(uiService.editOrReply).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('مجموع تسک‌های ثبت‌شده در این نشست: <b>4</b>'),
        expect.anything(),
      );
    });

    it('Requirement 12 (Back): Back exits registration mode without deleting saved tasks', async () => {
      stateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        taskType: TaskType.DAILY,
      });
      stateService.incrementSavedCount('12345', 3);

      const ctx = createMockContext({ callbackData: 'task:reg:back' });
      await handler.handleCallbackQuery(ctx);

      expect(stateService.hasActiveSession('12345')).toBe(false);
      expect(uiService.editOrReply).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('3 تسک ثبت‌شده قبلی ذخیره باقی ماندند'),
        expect.anything(),
      );
    });
  });

  describe('User Isolation and Middleware Safety', () => {
    it('Requirement 14: Different users cannot interfere with one another registration state', async () => {
      // User A starts ONE_TIME session
      stateService.startSession('100', {
        userId: 'uuid-a',
        chatId: 100,
        taskType: TaskType.ONE_TIME,
        selectedDate: '2026-10-25',
      });

      // User B starts DAILY session
      stateService.startSession('200', {
        userId: 'uuid-b',
        chatId: 200,
        taskType: TaskType.DAILY,
      });

      // User A submits task
      const ctxA = createMockContext({
        telegramId: 100,
        text: 'User A task',
      });
      usersService.findTelegramUser.mockResolvedValueOnce({
        id: 'uuid-a',
        displayName: 'User A',
        settings: { timezone: 'Asia/Tehran' } as UserSettings,
      } as User);
      await handler.handleTextMessage(ctxA);

      expect(tasksService.createTasks).toHaveBeenCalledWith('uuid-a', [
        expect.objectContaining({
          title: 'User A task',
          type: TaskType.ONE_TIME,
          date: '2026-10-25',
        }),
      ]);

      // User B submits task
      const ctxB = createMockContext({
        telegramId: 200,
        text: 'User B daily task',
      });
      usersService.findTelegramUser.mockResolvedValueOnce({
        id: 'uuid-b',
        displayName: 'User B',
        settings: { timezone: 'Asia/Tehran' } as UserSettings,
      } as User);
      await handler.handleTextMessage(ctxB);

      expect(tasksService.createTasks).toHaveBeenCalledWith('uuid-b', [
        expect.objectContaining({
          title: 'User B daily task',
          type: TaskType.DAILY,
        }),
      ]);

      // User A finishes; User B remains active
      stateService.clearSession('100');
      expect(stateService.hasActiveSession('100')).toBe(false);
      expect(stateService.hasActiveSession('200')).toBe(true);
    });

    it('Requirement 13: TasksFeature middleware prevents text from passing to onboarding handler during active registration', async () => {
      const mockBot = {
        command: jest.fn(),
        on: jest.fn(),
      };

      const feature = new TasksFeature(
        mockBot as unknown as Bot<Context>,
        handler,
      );
      feature.onModuleInit();

      // Find the message:text handler registered by TasksFeature
      const messageTextCall = mockBot.on.mock.calls.find(
        (call) => call[0] === 'message:text',
      );
      expect(messageTextCall).toBeDefined();
      const middlewareFn = messageTextCall[1];

      const nextFn = jest.fn();

      // Case 1: User has an active registration session -> middleware does NOT call next()
      stateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        taskType: TaskType.DAILY,
      });
      const activeCtx = createMockContext({
        telegramId: 12345,
        text: 'Some active task',
      });
      await middlewareFn(activeCtx, nextFn);
      expect(nextFn).not.toHaveBeenCalled();

      // Case 2: User has NO active session -> middleware DOES call next()
      stateService.clearSession('12345');
      const inactiveCtx = createMockContext({
        telegramId: 12345,
        text: 'Some general text',
      });
      await middlewareFn(inactiveCtx, nextFn);
      expect(nextFn).toHaveBeenCalledTimes(1);

      // Case 3: Text is a command (e.g. /start) -> middleware DOES call next()
      stateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        taskType: TaskType.DAILY,
      });
      const commandCtx = createMockContext({
        telegramId: 12345,
        text: '/start',
      });
      await middlewareFn(commandCtx, nextFn);
      expect(nextFn).toHaveBeenCalledTimes(2);
    });

    it('should ignore messages from the same user sent in a different chat context', () => {
      stateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        taskType: TaskType.DAILY,
      });

      // Context in private chat 99999
      const privateCtx = createMockContext({
        telegramId: 12345,
        chatId: 99999,
        text: 'Private task',
      });
      expect(handler.hasActiveSession(privateCtx)).toBe(true);

      // Context from same user in group chat -55555
      const groupCtx = createMockContext({
        telegramId: 12345,
        chatId: -55555,
        text: 'Group message',
      });
      expect(handler.hasActiveSession(groupCtx)).toBe(false);
    });

    it('should expire and purge sessions idle for longer than TTL (2 hours)', () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      stateService.startSession('12345', {
        userId: 'user-uuid-1',
        chatId: 99999,
        taskType: TaskType.DAILY,
      });

      expect(stateService.hasActiveSession('12345')).toBe(true);

      // Advance time by 2 hours + 1 second
      jest.spyOn(Date, 'now').mockReturnValue(now + 2 * 60 * 60 * 1000 + 1000);

      // Session should now be expired and cleaned up
      expect(stateService.hasActiveSession('12345')).toBe(false);
      expect(stateService.getSession('12345')).toBeUndefined();

      jest.restoreAllMocks();
    });
  });
});
