import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Context, InlineKeyboard } from 'grammy';

import { TaskType, TaskPriority, User } from '@app/database';
import {
  TasksService,
  UsersService,
  TaskTextParser,
  CreateTaskDto,
  isValidIsoDate,
  getTodayDateString,
  localDateTimeToUtcDate,
} from '@app/core';

import { TelegramUiService } from '../../ui/telegram-ui.service';
import { TaskRegistrationStateService } from './task-registration.state';
import { TaskEditStateService } from './task-edit.state';
import {
  CHOOSE_TASK_TYPE_MESSAGE,
  CHOOSE_TASK_DATE_MESSAGE,
  buildRegistrationPromptMessage,
  buildTaskSuccessConfirmation,
  buildValidationErrorMessage,
  PERSISTENCE_ERROR_MESSAGE,
  buildRegistrationFinishedMessage,
  buildRegistrationCancelledMessage,
  NON_TEXT_INPUT_MESSAGE,
  buildDailyTaskListMessage,
  buildDailyTaskListEmptyMessage,
  buildTaskOccurrenceDetailsMessage,
  buildTaskStatusMenuMessage,
  buildTaskEditFieldPrompt,
  buildTaskPriorityMenuMessage,
  buildTaskScheduleMenuMessage,
  buildTaskTimeInputPrompt,
  buildConfirmDeactivateMessage,
  buildConfirmDeleteMessage,
  buildDeleteBlockedByHistoryMessage,
} from './tasks.messages';
import {
  taskTypeKeyboard,
  buildCalendarKeyboard,
  registrationModeKeyboard,
  buildDailyTaskListKeyboard,
  buildDailyTaskListEmptyKeyboard,
  taskDetailsKeyboard,
  buildTaskDetailsActionKeyboard,
  buildTaskStatusKeyboard,
  buildTaskEditInfoKeyboard,
  buildTaskPriorityKeyboard,
  buildTaskScheduleKeyboard,
  buildCancelEditKeyboard,
  buildTaskLifecycleMenuKeyboard,
  buildConfirmDeactivateKeyboard,
  buildConfirmDeleteKeyboard,
  buildRecurringScheduleApplyKeyboard,
} from './tasks.keyboards';
import { buildMainMenuMessage } from '../start/start.messages';
import { mainMenuKeyboard } from '../start/start.keyboards';
import { normalizeTimeString } from '@app/core';

@Injectable()
export class TaskRegistrationHandler {
  private readonly logger = new Logger(TaskRegistrationHandler.name);
  private readonly uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  private readonly editStateService: TaskEditStateService;

  constructor(
    private readonly tasksService: TasksService,
    private readonly usersService: UsersService,
    private readonly uiService: TelegramUiService,
    private readonly stateService: TaskRegistrationStateService,
    editStateService?: TaskEditStateService,
  ) {
    this.editStateService = editStateService ?? new TaskEditStateService();
  }

  /**
   * Check whether a Telegram context has an active task registration session.
   */
  hasActiveSession(ctx: Context): boolean {
    if (!ctx.from || !ctx.chat) return false;
    const session = this.stateService.getSession(String(ctx.from.id));
    if (!session) return false;
    return session.chatId === ctx.chat.id;
  }

  /**
   * Check whether a Telegram context has an active task edit session.
   */
  hasActiveEditSession(ctx: Context): boolean {
    if (!ctx.from || !ctx.chat) return false;
    return this.editStateService.hasActiveSession(
      String(ctx.from.id),
      ctx.chat.id,
    );
  }

  /**
   * Explicitly clear any active registration or edit sessions for a Telegram user.
   */
  clearSession(telegramUserId: string): void {
    this.stateService.clearSession(telegramUserId);
    this.editStateService.clearSession(telegramUserId);
  }

  /**
   * Handle inline callback queries related to task creation and registration mode.
   */
  async handleCallbackQuery(ctx: Context): Promise<void> {
    if (!ctx.from || !ctx.callbackQuery?.data) {
      return;
    }

    const data = ctx.callbackQuery.data;
    const telegramUserId = String(ctx.from.id);

    try {
      // 1. Validate that the user exists and has completed onboarding
      const user = await this.usersService.findTelegramUser(telegramUserId);
      if (!user || !user.settings?.onboardingCompleted) {
        await ctx.answerCallbackQuery({
          text: 'لطفاً ابتدا با دستور /start ثبت‌نام خود را تکمیل کنید.',
          show_alert: true,
        });
        return;
      }

      const userTimezone = user.settings?.timezone || 'Asia/Tehran';

      // 2. Ignore no-op calendar clicks and handle disabled past date clicks
      if (data === 'task:date:noop') {
        await ctx.answerCallbackQuery();
        return;
      }

      if (data === 'task:date:past') {
        await ctx.answerCallbackQuery({
          text: 'امکان انتخاب تاریخ گذشته وجود ندارد.',
          show_alert: true,
        });
        return;
      }

      // 3. Entry point from Main Menu: 'menu:create_task' or 'task:menu:choose_type'
      if (data === 'menu:create_task' || data === 'task:menu:choose_type') {
        await ctx.answerCallbackQuery();
        await this.uiService.editOrReply(ctx, CHOOSE_TASK_TYPE_MESSAGE, {
          parse_mode: 'HTML',
          reply_markup: taskTypeKeyboard,
        });
        return;
      }

      // 3.1. Daily Task List entry point: 'menu:list_tasks', 'task:list:today', 'task:back:to_list'
      if (
        data === 'menu:list_tasks' ||
        data === 'task:list:today' ||
        data === 'task:back:to_list'
      ) {
        this.stateService.clearSession(telegramUserId);
        await this.handleListTodayTasks(ctx, user);
        return;
      }

      // 3.2. View Task Details: 'task:view:<occurrenceId>'
      if (data.startsWith('task:view:')) {
        const occurrenceId = data.replace('task:view:', '');
        await this.handleViewTaskDetails(ctx, user, occurrenceId);
        return;
      }

      // 3.3. Phase 7 Action Handlers
      if (data.startsWith('task:act:stat:')) {
        const occurrenceId = data.replace('task:act:stat:', '');
        await this.handleStatusMenu(ctx, user, occurrenceId);
        return;
      }

      if (data.startsWith('task:st:')) {
        const parts = data.split(':');
        const occurrenceId = parts[2];
        const statusCode = parts[3];
        await this.handleSetStatus(ctx, user, occurrenceId, statusCode);
        return;
      }

      if (data.startsWith('task:act:prio:')) {
        const occurrenceId = data.replace('task:act:prio:', '');
        await this.handlePriorityMenu(ctx, user, occurrenceId);
        return;
      }

      if (data.startsWith('task:pr:')) {
        const parts = data.split(':');
        const occurrenceId = parts[2];
        const level = parts[3];
        await this.handleSetPriority(ctx, user, occurrenceId, level);
        return;
      }

      if (data.startsWith('task:act:edit:')) {
        const occurrenceId = data.replace('task:act:edit:', '');
        await this.handleEditInfoMenu(ctx, user, occurrenceId);
        return;
      }

      if (data.startsWith('task:ed:canc:')) {
        const occurrenceId = data.replace('task:ed:canc:', '');
        await this.handleCancelEdit(ctx, user, occurrenceId);
        return;
      }

      if (data.startsWith('task:ed:')) {
        const parts = data.split(':');
        const occurrenceId = parts[2];
        const field = parts[3] as 'title' | 'desc';
        await this.handleStartEditField(ctx, user, occurrenceId, field);
        return;
      }

      if (data.startsWith('task:act:sched:')) {
        const occurrenceId = data.replace('task:act:sched:', '');
        await this.handleScheduleMenu(ctx, user, occurrenceId);
        return;
      }

      if (data.startsWith('task:sc:')) {
        const parts = data.split(':');
        const actionOrOcc = parts[2];
        if (actionOrOcc === 'apply_today' || actionOrOcc === 'apply_all') {
          const occurrenceId = parts[3];
          await this.handleRecurringScheduleApply(
            ctx,
            user,
            occurrenceId,
            actionOrOcc === 'apply_today' ? 'today' : 'all',
          );
          return;
        }

        const occurrenceId = parts[2];
        const subAction = parts[3];
        if (subAction === 'clear') {
          await this.handleClearSchedule(ctx, user, occurrenceId);
          return;
        }
        if (subAction === 'time') {
          await this.handleStartEditTime(ctx, user, occurrenceId);
          return;
        }
        if (subAction === 'date') {
          await this.handleStartEditDate(ctx, user, occurrenceId);
          return;
        }
      }

      if (data.startsWith('task:act:lifecycle:')) {
        const occurrenceId = data.replace('task:act:lifecycle:', '');
        await this.handleLifecycleMenu(ctx, user, occurrenceId);
        return;
      }

      if (data.startsWith('task:lc:deact_ok:')) {
        const occurrenceId = data.replace('task:lc:deact_ok:', '');
        await this.handleDeactivateExecute(ctx, user, occurrenceId);
        return;
      }

      if (data.startsWith('task:lc:deact:')) {
        const occurrenceId = data.replace('task:lc:deact:', '');
        await this.handleDeactivateConfirm(ctx, user, occurrenceId);
        return;
      }

      if (data.startsWith('task:act:del:') || data.startsWith('task:lc:del:')) {
        const occurrenceId = data.replace(/^task:(act|lc):del:/, '');
        await this.handleDeleteConfirm(ctx, user, occurrenceId);
        return;
      }

      if (data.startsWith('task:lc:del_ok:')) {
        const occurrenceId = data.replace('task:lc:del_ok:', '');
        await this.handleDeleteExecute(ctx, user, occurrenceId);
        return;
      }

      // 4. Return to Main Menu
      if (data === 'task:back:to_menu') {
        this.stateService.clearSession(telegramUserId);
        await ctx.answerCallbackQuery();
        await this.uiService.editOrReply(
          ctx,
          buildMainMenuMessage(user.displayName),
          {
            parse_mode: 'HTML',
            reply_markup: mainMenuKeyboard,
          },
        );
        return;
      }

      // 5. Return to Task Type selection
      if (data === 'task:back:to_type') {
        this.stateService.clearSession(telegramUserId);
        await ctx.answerCallbackQuery();
        await this.uiService.editOrReply(ctx, CHOOSE_TASK_TYPE_MESSAGE, {
          parse_mode: 'HTML',
          reply_markup: taskTypeKeyboard,
        });
        return;
      }

      // 6. User chooses 'One-Time' task -> Show Calendar
      if (data === 'task:type:one_time') {
        const todayDate = getTodayDateString(userTimezone);
        const [yearStr, monthStr] = todayDate.split('-');
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);

        await ctx.answerCallbackQuery();
        await this.uiService.editOrReply(ctx, CHOOSE_TASK_DATE_MESSAGE, {
          parse_mode: 'HTML',
          reply_markup: buildCalendarKeyboard(year, month, todayDate),
        });
        return;
      }

      // 7. Calendar month navigation: 'task:date:nav:YYYY-MM'
      if (data.startsWith('task:date:nav:')) {
        const navTarget = data.replace('task:date:nav:', '');
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(navTarget)) {
          await ctx.answerCallbackQuery({
            text: 'تاریخ نامعتبر است.',
            show_alert: true,
          });
          return;
        }

        const todayDate = getTodayDateString(userTimezone);
        const currentYearMonth = todayDate.slice(0, 7);
        if (navTarget < currentYearMonth) {
          await ctx.answerCallbackQuery({
            text: 'امکان مشاهده ماه‌های گذشته وجود ندارد.',
            show_alert: true,
          });
          return;
        }

        const [yStr, mStr] = navTarget.split('-');
        const year = parseInt(yStr, 10);
        const month = parseInt(mStr, 10);

        await ctx.answerCallbackQuery();
        await this.uiService.editOrReply(ctx, CHOOSE_TASK_DATE_MESSAGE, {
          parse_mode: 'HTML',
          reply_markup: buildCalendarKeyboard(year, month, todayDate),
        });
        return;
      }

      // 8. Calendar date selected: 'task:date:select:YYYY-MM-DD'
      if (data.startsWith('task:date:select:')) {
        const selectedDate = data.replace('task:date:select:', '');
        if (!isValidIsoDate(selectedDate)) {
          await ctx.answerCallbackQuery({
            text: 'تاریخ انتخابی نامعتبر است.',
            show_alert: true,
          });
          return;
        }

        const todayDate = getTodayDateString(userTimezone);
        if (selectedDate < todayDate) {
          await ctx.answerCallbackQuery({
            text: 'امکان ثبت تسک برای تاریخ‌های گذشته وجود ندارد.',
            show_alert: true,
          });
          return;
        }

        // Start active registration session for ONE_TIME task
        this.stateService.startSession(telegramUserId, {
          userId: user.id,
          chatId: ctx.chat!.id,
          taskType: TaskType.ONE_TIME,
          selectedDate,
        });

        await ctx.answerCallbackQuery();
        await this.uiService.editOrReply(
          ctx,
          buildRegistrationPromptMessage(TaskType.ONE_TIME, selectedDate),
          {
            parse_mode: 'HTML',
            reply_markup: registrationModeKeyboard,
          },
        );
        return;
      }

      // 9. User chooses 'Daily' task -> Start registration immediately
      if (data === 'task:type:daily') {
        this.stateService.startSession(telegramUserId, {
          userId: user.id,
          chatId: ctx.chat!.id,
          taskType: TaskType.DAILY,
        });

        await ctx.answerCallbackQuery();
        await this.uiService.editOrReply(
          ctx,
          buildRegistrationPromptMessage(TaskType.DAILY),
          {
            parse_mode: 'HTML',
            reply_markup: registrationModeKeyboard,
          },
        );
        return;
      }

      // 10. Finish registration: 'task:reg:finish'
      if (data === 'task:reg:finish') {
        const session = this.stateService.getSession(telegramUserId);
        const savedCount = session?.savedCount ?? 0;
        this.stateService.clearSession(telegramUserId);

        await ctx.answerCallbackQuery();
        await this.uiService.editOrReply(
          ctx,
          buildRegistrationFinishedMessage(savedCount),
          {
            parse_mode: 'HTML',
            reply_markup: mainMenuKeyboard,
          },
        );
        return;
      }

      // 11. Back from registration mode: 'task:reg:back'
      if (data === 'task:reg:back') {
        const session = this.stateService.getSession(telegramUserId);
        const savedCount = session?.savedCount ?? 0;
        const taskType = session?.taskType;
        this.stateService.clearSession(telegramUserId);

        await ctx.answerCallbackQuery();

        if (taskType === TaskType.ONE_TIME) {
          // Return to calendar date picker
          const todayDate = getTodayDateString(userTimezone);
          const [yearStr, monthStr] = todayDate.split('-');
          await this.uiService.editOrReply(
            ctx,
            buildRegistrationCancelledMessage(savedCount) +
              '\n\n' +
              CHOOSE_TASK_DATE_MESSAGE,
            {
              parse_mode: 'HTML',
              reply_markup: buildCalendarKeyboard(
                parseInt(yearStr, 10),
                parseInt(monthStr, 10),
                todayDate,
              ),
            },
          );
        } else {
          // Return to Task Type picker
          await this.uiService.editOrReply(
            ctx,
            buildRegistrationCancelledMessage(savedCount) +
              '\n\n' +
              CHOOSE_TASK_TYPE_MESSAGE,
            {
              parse_mode: 'HTML',
              reply_markup: taskTypeKeyboard,
            },
          );
        }
        return;
      }

      // Unknown callback
      await ctx.answerCallbackQuery();
    } catch (error: unknown) {
      this.logger.error(
        `Failed to handle task callback '${data}' for Telegram ID ${telegramUserId}`,
        error instanceof Error ? error.stack : String(error),
      );
      try {
        await ctx.answerCallbackQuery({
          text: 'خطایی رخ داد. لطفاً دوباره تلاش کنید.',
          show_alert: true,
        });
      } catch {
        // Ignored
      }
    }
  }

  /**
   * Handle text messages during active task registration mode.
   */
  async handleTextMessage(ctx: Context): Promise<void> {
    if (!ctx.from || !ctx.message?.text || !ctx.chat) {
      return;
    }

    // Ignore commands (e.g. /start) so command handlers can process them
    if (ctx.message.text.startsWith('/')) {
      return;
    }

    const telegramUserId = String(ctx.from.id);
    const session = this.stateService.getSession(telegramUserId);

    if (!session) {
      return;
    }

    const user = await this.usersService.findTelegramUser(telegramUserId);
    const userTimezone = user?.settings?.timezone || 'Asia/Tehran';

    // 1. Parse incoming message using the deterministic task text parser
    const parseResult = TaskTextParser.tryParse(ctx.message.text);

    // 2. Validation failed: all-or-nothing error handling
    if (!parseResult.success) {
      // Show line-specific errors in a temporary message (~15s) and schedule user message deletion
      this.sendTemporaryError(
        ctx,
        buildValidationErrorMessage(parseResult.errors),
        15000,
      );

      return;
    }

    // 3. Validation succeeded: map drafts to CreateTaskDto
    const todayDate = getTodayDateString(userTimezone);
    const targetDate =
      session.taskType === TaskType.ONE_TIME
        ? session.selectedDate!
        : todayDate;

    if (session.taskType === TaskType.ONE_TIME && targetDate < todayDate) {
      void this.uiService.sendTemporaryConfirmation(
        ctx,
        '⚠️ امکان ثبت تسک برای تاریخ‌های گذشته وجود ندارد.',
        10000,
      );
      return;
    }

    const dtos: CreateTaskDto[] = parseResult.tasks.map((draft) => {
      let scheduledDueAt: Date | undefined = undefined;

      if (draft.scheduledEndTime) {
        scheduledDueAt = localDateTimeToUtcDate(
          targetDate,
          draft.scheduledEndTime,
          userTimezone,
        );
      }

      return {
        title: draft.title,
        type: session.taskType,
        date: targetDate,
        scheduledStartTime: draft.scheduledStartTime ?? undefined,
        scheduledDueAt,
        priority: TaskPriority.NORMAL,
      };
    });

    // 4. Atomically persist all tasks together
    try {
      await this.tasksService.createTasks(session.userId, dtos);

      // Successfully saved: update session stats
      this.stateService.incrementSavedCount(telegramUserId, dtos.length);

      // Attempt immediate deletion of user's original message
      await this.deleteUserMessageImmediate(ctx);

      // Send self-deleting confirmation message (~7s)
      void this.uiService.sendTemporaryConfirmation(
        ctx,
        buildTaskSuccessConfirmation(dtos.length),
        7000,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Failed to persist tasks for user ${session.userId} in registration session`,
        error instanceof Error ? error.stack : String(error),
      );

      // Show temporary error message (~15s) without deleting user's message immediately
      void this.uiService.sendTemporaryConfirmation(
        ctx,
        PERSISTENCE_ERROR_MESSAGE,
        15000,
      );
    }
  }

  /**
   * Handle non-text messages sent during active registration or edit mode.
   */
  handleNonTextMessage(ctx: Context): void {
    this.scheduleUserMessageDeletion(ctx, 5000);
    void this.uiService.sendTemporaryConfirmation(
      ctx,
      NON_TEXT_INPUT_MESSAGE,
      5000,
    );
  }

  /**
   * Immediately delete user's incoming message safely without throwing unhandled errors.
   */
  private async deleteUserMessageImmediate(ctx: Context): Promise<void> {
    try {
      await ctx.deleteMessage();
    } catch (delError: unknown) {
      this.logger.debug(
        `Failed to delete user message: ${delError instanceof Error ? delError.message : String(delError)}`,
      );
    }
  }

  /**
   * Schedule user's incoming message for deletion after delayMs.
   */
  private scheduleUserMessageDeletion(
    ctx: Context,
    delayMs: number = 10000,
  ): void {
    const chatId = ctx.chat?.id;
    const messageId = ctx.message?.message_id;
    if (!chatId || !messageId) return;

    setTimeout(() => {
      void this.uiService.deleteBotMessageSafely(ctx, chatId, messageId);
    }, delayMs).unref?.();
  }

  /**
   * Send a temporary error response and schedule the user's triggering message for deletion after the same delay.
   */
  private sendTemporaryError(
    ctx: Context,
    text: string,
    delayMs: number = 10000,
  ): void {
    void this.uiService.sendTemporaryConfirmation(ctx, text, delayMs);
    this.scheduleUserMessageDeletion(ctx, delayMs);
  }

  /**
   * Displays today's task occurrences for the user in their local timezone.
   * Ensures active recurring tasks have occurrences generated idempotently.
   */
  async handleListTodayTasks(ctx: Context, user: User): Promise<void> {
    try {
      await ctx.answerCallbackQuery();
    } catch {
      // Ignore if callback query is already answered or expired
    }

    const userTimezone = user.settings?.timezone || 'Asia/Tehran';
    const todayDate = getTodayDateString(userTimezone);

    try {
      // On-demand idempotent occurrence generation and retrieval
      const occurrences = await this.tasksService.ensureDailyOccurrencesForDate(
        user.id,
        todayDate,
      );

      if (!occurrences || occurrences.length === 0) {
        const emptyMessage = buildDailyTaskListEmptyMessage(todayDate);
        await this.uiService.editOrReply(ctx, emptyMessage, {
          parse_mode: 'HTML',
          reply_markup: buildDailyTaskListEmptyKeyboard(),
        });
        return;
      }

      const listMessage = buildDailyTaskListMessage(
        occurrences,
        todayDate,
        userTimezone,
      );
      await this.uiService.editOrReply(ctx, listMessage, {
        parse_mode: 'HTML',
        reply_markup: buildDailyTaskListKeyboard(occurrences),
      });
    } catch (error: unknown) {
      this.logger.error(
        `Failed to retrieve daily task list for user ${user.id}:`,
        error instanceof Error ? error.stack : String(error),
      );
      await this.uiService.editOrReply(
        ctx,
        '❌ <b>خطا در دریافت لیست تسک‌ها</b>\n\nمتأسفانه در دریافت اطلاعات تسک‌های امروز خطایی رخ داد. لطفاً مجدداً تلاش کنید.',
        {
          parse_mode: 'HTML',
          reply_markup: buildDailyTaskListEmptyKeyboard(),
        },
      );
    }
  }

  /**
   * Displays full details of a specific task occurrence for an authorized user.
   */
  async handleViewTaskDetails(
    ctx: Context,
    user: User,
    occurrenceId: string,
  ): Promise<void> {
    try {
      await ctx.answerCallbackQuery();
    } catch {
      // Ignore
    }

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(occurrenceId)) {
      try {
        await ctx.answerCallbackQuery({
          text: 'شناسه تسک نامعتبر است.',
          show_alert: true,
        });
      } catch {
        // Ignore
      }
      return;
    }

    const userTimezone = user.settings?.timezone || 'Asia/Tehran';

    try {
      const occurrence = await this.tasksService.getOccurrenceById(
        user.id,
        occurrenceId,
      );

      const detailsMessage = buildTaskOccurrenceDetailsMessage(
        occurrence,
        userTimezone,
      );

      await this.uiService.editOrReply(ctx, detailsMessage, {
        parse_mode: 'HTML',
        reply_markup: buildTaskDetailsActionKeyboard(occurrence),
      });
    } catch (error: unknown) {
      if (error instanceof ForbiddenException) {
        // Enforce strict ownership: do NOT reveal task details
        try {
          await ctx.answerCallbackQuery({
            text: '⛔️ شما اجازه دسترسی به این تسک را ندارید.',
            show_alert: true,
          });
        } catch {
          await this.uiService.editOrReply(
            ctx,
            '⛔️ <b>خطای دسترسی</b>\n\nشما اجازه دسترسی به این تسک را ندارید.',
            {
              parse_mode: 'HTML',
              reply_markup: taskDetailsKeyboard,
            },
          );
        }
        return;
      }

      if (error instanceof NotFoundException) {
        try {
          await ctx.answerCallbackQuery({
            text: '⚠️ تسک مورد نظر یافت نشد یا ممکن است حذف شده باشد.',
            show_alert: true,
          });
        } catch {
          await this.uiService.editOrReply(
            ctx,
            '⚠️ <b>تسک یافت نشد</b>\n\nتسک مورد نظر یافت نشد یا ممکن است حذف شده باشد.',
            {
              parse_mode: 'HTML',
              reply_markup: taskDetailsKeyboard,
            },
          );
        }
        return;
      }

      this.logger.error(
        `Failed to retrieve occurrence details for ${occurrenceId}:`,
        error instanceof Error ? error.stack : String(error),
      );
      await this.uiService.editOrReply(
        ctx,
        '❌ <b>خطا در نمایش تسک</b>\n\nمتأسفانه در دریافت جزئیات تسک خطایی رخ داد.',
        {
          parse_mode: 'HTML',
          reply_markup: taskDetailsKeyboard,
        },
      );
    }
  }

  // --- Phase 7 Action Submenu Handlers ---

  async handleStatusMenu(
    ctx: Context,
    user: User,
    occurrenceId: string,
  ): Promise<void> {
    if (!this.uuidRegex.test(occurrenceId)) {
      await ctx.answerCallbackQuery({
        text: 'شناسه تسک نامعتبر است.',
        show_alert: true,
      });
      return;
    }

    try {
      await ctx.answerCallbackQuery();
      const occurrence = await this.tasksService.getOccurrenceById(
        user.id,
        occurrenceId,
      );
      const text = buildTaskStatusMenuMessage(occurrence);
      const keyboard = buildTaskStatusKeyboard(occurrence);
      await this.uiService.editOrReply(ctx, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (error: unknown) {
      await this.handleTaskError(ctx, error, occurrenceId);
    }
  }

  async handleSetStatus(
    ctx: Context,
    user: User,
    occurrenceId: string,
    statusCode: string,
  ): Promise<void> {
    if (!this.uuidRegex.test(occurrenceId)) {
      await ctx.answerCallbackQuery({
        text: 'شناسه تسک نامعتبر است.',
        show_alert: true,
      });
      return;
    }

    try {
      if (statusCode === 'prog') {
        await this.tasksService.startOccurrence(user.id, occurrenceId);
      } else if (statusCode === 'comp') {
        await this.tasksService.completeOccurrence(user.id, occurrenceId);
      } else if (statusCode === 'part') {
        await this.tasksService.partiallyCompleteOccurrence(
          user.id,
          occurrenceId,
        );
      } else if (statusCode === 'not') {
        await this.tasksService.markOccurrenceNotCompleted(
          user.id,
          occurrenceId,
        );
      } else if (statusCode === 'skip') {
        await this.tasksService.skipOccurrence(user.id, occurrenceId);
      } else if (statusCode === 'canc') {
        await this.tasksService.cancelOccurrence(user.id, occurrenceId);
      } else {
        await ctx.answerCallbackQuery({
          text: 'عملیات نامعتبر است.',
          show_alert: true,
        });
        return;
      }

      let toastText = '✅ وضعیت تسک با موفقیت تغییر یافت.';
      if (statusCode === 'prog') {
        toastText = '▶️ وضعیت تسک با موفقیت به «در حال انجام» تغییر یافت.';
      } else if (statusCode === 'comp') {
        toastText =
          '🎉 تسک با موفقیت تکمیل شد و امتیاز (XP) به حساب شما افزوده شد!';
      } else if (statusCode === 'part') {
        toastText = '🟠 وضعیت تسک با موفقیت به «تکمیل جزئی» تغییر یافت.';
      } else if (statusCode === 'not') {
        toastText = '🔴 وضعیت تسک با موفقیت به «انجام‌نشده» تغییر یافت.';
      } else if (statusCode === 'skip') {
        toastText = '⏭ تسک برای امروز با موفقیت رد شد.';
      } else if (statusCode === 'canc') {
        toastText = '✖️ تسک با موفقیت لغو گردید.';
      }

      await ctx.answerCallbackQuery({
        text: toastText,
      });
      await this.handleViewTaskDetails(ctx, user, occurrenceId);
    } catch (error: unknown) {
      if (error instanceof ForbiddenException) {
        await ctx.answerCallbackQuery({
          text: '⛔️ شما اجازه دسترسی به این تسک را ندارید.',
          show_alert: true,
        });
        return;
      }
      const msg =
        error instanceof Error ? error.message : 'خطا در تغییر وضعیت تسک.';
      await ctx.answerCallbackQuery({ text: msg, show_alert: true });
    }
  }

  async handlePriorityMenu(
    ctx: Context,
    user: User,
    occurrenceId: string,
  ): Promise<void> {
    if (!this.uuidRegex.test(occurrenceId)) {
      await ctx.answerCallbackQuery({
        text: 'شناسه تسک نامعتبر است.',
        show_alert: true,
      });
      return;
    }

    try {
      await ctx.answerCallbackQuery();
      const occurrence = await this.tasksService.getOccurrenceById(
        user.id,
        occurrenceId,
      );
      const text = buildTaskPriorityMenuMessage(occurrence);
      const keyboard = buildTaskPriorityKeyboard(occurrence);
      await this.uiService.editOrReply(ctx, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (error: unknown) {
      await this.handleTaskError(ctx, error, occurrenceId);
    }
  }

  async handleSetPriority(
    ctx: Context,
    user: User,
    occurrenceId: string,
    level: string,
  ): Promise<void> {
    if (!this.uuidRegex.test(occurrenceId)) {
      await ctx.answerCallbackQuery({
        text: 'شناسه تسک نامعتبر است.',
        show_alert: true,
      });
      return;
    }

    const priorityMap: Record<string, TaskPriority> = {
      high: TaskPriority.HIGH,
      normal: TaskPriority.NORMAL,
      low: TaskPriority.LOW,
    };
    const priority = priorityMap[level];
    if (!priority) {
      await ctx.answerCallbackQuery({
        text: 'اولویت نامعتبر است.',
        show_alert: true,
      });
      return;
    }

    try {
      const occurrence = await this.tasksService.getOccurrenceById(
        user.id,
        occurrenceId,
      );
      await this.tasksService.updateTask(user.id, occurrence.taskId, {
        priority,
      });
      await ctx.answerCallbackQuery({
        text: '✅ اولویت تسک با موفقیت تغییر یافت.',
      });
      await this.handleViewTaskDetails(ctx, user, occurrenceId);
    } catch (error: unknown) {
      await this.handleTaskError(ctx, error, occurrenceId);
    }
  }

  async handleEditInfoMenu(
    ctx: Context,
    user: User,
    occurrenceId: string,
  ): Promise<void> {
    if (!this.uuidRegex.test(occurrenceId)) {
      await ctx.answerCallbackQuery({
        text: 'شناسه تسک نامعتبر است.',
        show_alert: true,
      });
      return;
    }

    try {
      await ctx.answerCallbackQuery();
      const occurrence = await this.tasksService.getOccurrenceById(
        user.id,
        occurrenceId,
      );
      const keyboard = buildTaskEditInfoKeyboard(occurrence);
      await this.uiService.editOrReply(
        ctx,
        '✏️ <b>ویرایش مشخصات تسک</b>\n\nفیلد مورد نظر برای ویرایش را انتخاب کنید:',
        {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        },
      );
    } catch (error: unknown) {
      await this.handleTaskError(ctx, error, occurrenceId);
    }
  }

  async handleStartEditField(
    ctx: Context,
    user: User,
    occurrenceId: string,
    field: 'title' | 'desc',
  ): Promise<void> {
    if (!this.uuidRegex.test(occurrenceId)) {
      await ctx.answerCallbackQuery({
        text: 'شناسه تسک نامعتبر است.',
        show_alert: true,
      });
      return;
    }

    try {
      await ctx.answerCallbackQuery();
      const occurrence = await this.tasksService.getOccurrenceById(
        user.id,
        occurrenceId,
      );
      const mode = field === 'title' ? 'edit_title' : 'edit_description';
      this.editStateService.startSession(String(ctx.from?.id), {
        userId: user.id,
        chatId: ctx.chat?.id || 0,
        occurrenceId,
        taskId: occurrence.taskId,
        mode,
      });

      const prompt = buildTaskEditFieldPrompt(
        field === 'title' ? 'title' : 'description',
        field === 'title' ? occurrence.task.title : occurrence.task.description,
      );
      const keyboard = buildCancelEditKeyboard(occurrenceId);
      await this.uiService.editOrReply(ctx, prompt, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (error: unknown) {
      await this.handleTaskError(ctx, error, occurrenceId);
    }
  }

  async handleCancelEdit(
    ctx: Context,
    user: User,
    occurrenceId: string,
  ): Promise<void> {
    this.editStateService.clearSession(String(ctx.from?.id));
    await ctx.answerCallbackQuery({ text: 'ویرایش لغو گردید.' });
    await this.handleViewTaskDetails(ctx, user, occurrenceId);
  }

  async handleScheduleMenu(
    ctx: Context,
    user: User,
    occurrenceId: string,
  ): Promise<void> {
    if (!this.uuidRegex.test(occurrenceId)) {
      await ctx.answerCallbackQuery({
        text: 'شناسه تسک نامعتبر است.',
        show_alert: true,
      });
      return;
    }

    const userTimezone = user.settings?.timezone || 'Asia/Tehran';

    try {
      await ctx.answerCallbackQuery();
      const occurrence = await this.tasksService.getOccurrenceById(
        user.id,
        occurrenceId,
      );
      const text = buildTaskScheduleMenuMessage(occurrence, userTimezone);
      const keyboard = buildTaskScheduleKeyboard(occurrence);
      await this.uiService.editOrReply(ctx, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (error: unknown) {
      await this.handleTaskError(ctx, error, occurrenceId);
    }
  }

  async handleClearSchedule(
    ctx: Context,
    user: User,
    occurrenceId: string,
  ): Promise<void> {
    if (!this.uuidRegex.test(occurrenceId)) {
      await ctx.answerCallbackQuery({
        text: 'شناسه تسک نامعتبر است.',
        show_alert: true,
      });
      return;
    }

    try {
      const occurrence = await this.tasksService.getOccurrenceById(
        user.id,
        occurrenceId,
      );
      await this.tasksService.updateOccurrenceSchedule(user.id, occurrenceId, {
        clearSchedule: true,
        updateTaskDefault: occurrence.task?.type === TaskType.DAILY,
      });
      await ctx.answerCallbackQuery({ text: '✅ زمان‌بندی تسک حذف شد.' });
      await this.handleViewTaskDetails(ctx, user, occurrenceId);
    } catch (error: unknown) {
      await this.handleTaskError(ctx, error, occurrenceId);
    }
  }

  async handleStartEditTime(
    ctx: Context,
    user: User,
    occurrenceId: string,
  ): Promise<void> {
    if (!this.uuidRegex.test(occurrenceId)) {
      await ctx.answerCallbackQuery({
        text: 'شناسه تسک نامعتبر است.',
        show_alert: true,
      });
      return;
    }

    const userTimezone = user.settings?.timezone || 'Asia/Tehran';

    try {
      await ctx.answerCallbackQuery();
      const occurrence = await this.tasksService.getOccurrenceById(
        user.id,
        occurrenceId,
      );
      this.editStateService.startSession(String(ctx.from?.id), {
        userId: user.id,
        chatId: ctx.chat?.id || 0,
        occurrenceId,
        taskId: occurrence.taskId,
        mode: 'edit_time',
      });

      const prompt = buildTaskTimeInputPrompt(userTimezone);
      const keyboard = buildCancelEditKeyboard(occurrenceId);
      await this.uiService.editOrReply(ctx, prompt, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (error: unknown) {
      await this.handleTaskError(ctx, error, occurrenceId);
    }
  }

  async handleStartEditDate(
    ctx: Context,
    user: User,
    occurrenceId: string,
  ): Promise<void> {
    if (!this.uuidRegex.test(occurrenceId)) {
      await ctx.answerCallbackQuery({
        text: 'شناسه تسک نامعتبر است.',
        show_alert: true,
      });
      return;
    }

    const userTimezone = user.settings?.timezone || 'Asia/Tehran';

    try {
      await ctx.answerCallbackQuery();
      const occurrence = await this.tasksService.getOccurrenceById(
        user.id,
        occurrenceId,
      );
      this.editStateService.startSession(String(ctx.from?.id), {
        userId: user.id,
        chatId: ctx.chat?.id || 0,
        occurrenceId,
        taskId: occurrence.taskId,
        mode: 'edit_date',
      });

      const todayDate = getTodayDateString(userTimezone);
      const prompt =
        `📅 <b>تغییر تاریخ تسک یک‌باره</b>\n\n` +
        `تاریخ فعلی: <code>${occurrence.date}</code>\n` +
        `امروز در منطقه زمانی شما: <code>${todayDate}</code>\n\n` +
        `لطفاً تاریخ جدید را با فرمت <code>YYYY-MM-DD</code> ارسال کنید (مثلاً <code>${todayDate}</code>):`;
      const keyboard = buildCancelEditKeyboard(occurrenceId);
      await this.uiService.editOrReply(ctx, prompt, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (error: unknown) {
      await this.handleTaskError(ctx, error, occurrenceId);
    }
  }

  async handleRecurringScheduleApply(
    ctx: Context,
    user: User,
    occurrenceId: string,
    applyScope: 'today' | 'all',
  ): Promise<void> {
    const session = this.editStateService.getSession(
      String(ctx.from?.id),
      ctx.chat?.id,
    );
    if (!session || session.occurrenceId !== occurrenceId) {
      await ctx.answerCallbackQuery({
        text: 'نشست ویرایش منقضی شده است.',
        show_alert: true,
      });
      return;
    }

    try {
      await this.tasksService.updateOccurrenceSchedule(user.id, occurrenceId, {
        startTime: session.pendingStartTime,
        endTime: session.pendingEndTime,
        updateTaskDefault: applyScope === 'all',
      });
      this.editStateService.clearSession(String(ctx.from?.id));
      await ctx.answerCallbackQuery({
        text: '✅ زمان‌بندی با موفقیت ذخیره شد.',
      });
      await this.handleViewTaskDetails(ctx, user, occurrenceId);
    } catch (error: unknown) {
      await this.handleTaskError(ctx, error, occurrenceId);
    }
  }

  async handleLifecycleMenu(
    ctx: Context,
    user: User,
    occurrenceId: string,
  ): Promise<void> {
    if (!this.uuidRegex.test(occurrenceId)) {
      await ctx.answerCallbackQuery({
        text: 'شناسه تسک نامعتبر است.',
        show_alert: true,
      });
      return;
    }

    try {
      await ctx.answerCallbackQuery();
      const occurrence = await this.tasksService.getOccurrenceById(
        user.id,
        occurrenceId,
      );
      const keyboard = buildTaskLifecycleMenuKeyboard(occurrence);
      await this.uiService.editOrReply(
        ctx,
        `⚙️ <b>مدیریت چرخه حیات تسک روزانه</b>\n\n` +
          `• <b>غیرفعال‌سازی (پیشنهادی):</b> از فردا این تسک دیگر ایجاد نخواهد شد اما تاریخچه و سوابق آن حفظ می‌شود.\n` +
          `• <b>حذف دائم:</b> تنها در صورتی ممکن است که هیچ سابقه تکمیل یا امتیازی ثبت نشده باشد.`,
        {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        },
      );
    } catch (error: unknown) {
      await this.handleTaskError(ctx, error, occurrenceId);
    }
  }

  async handleDeactivateConfirm(
    ctx: Context,
    user: User,
    occurrenceId: string,
  ): Promise<void> {
    if (!this.uuidRegex.test(occurrenceId)) {
      await ctx.answerCallbackQuery({
        text: 'شناسه تسک نامعتبر است.',
        show_alert: true,
      });
      return;
    }

    try {
      await ctx.answerCallbackQuery();
      const occurrence = await this.tasksService.getOccurrenceById(
        user.id,
        occurrenceId,
      );
      const text = buildConfirmDeactivateMessage(occurrence.task.title);
      const keyboard = buildConfirmDeactivateKeyboard(occurrenceId);
      await this.uiService.editOrReply(ctx, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (error: unknown) {
      await this.handleTaskError(ctx, error, occurrenceId);
    }
  }

  async handleDeactivateExecute(
    ctx: Context,
    user: User,
    occurrenceId: string,
  ): Promise<void> {
    if (!this.uuidRegex.test(occurrenceId)) {
      await ctx.answerCallbackQuery({
        text: 'شناسه تسک نامعتبر است.',
        show_alert: true,
      });
      return;
    }

    try {
      const occurrence = await this.tasksService.getOccurrenceById(
        user.id,
        occurrenceId,
      );
      await this.tasksService.deactivateTask(user.id, occurrence.taskId);
      await ctx.answerCallbackQuery({
        text: '✅ تکرار روزانه این تسک غیرفعال شد.',
      });
      await this.handleListTodayTasks(ctx, user);
    } catch (error: unknown) {
      await this.handleTaskError(ctx, error, occurrenceId);
    }
  }

  async handleDeleteConfirm(
    ctx: Context,
    user: User,
    occurrenceId: string,
  ): Promise<void> {
    if (!this.uuidRegex.test(occurrenceId)) {
      await ctx.answerCallbackQuery({
        text: 'شناسه تسک نامعتبر است.',
        show_alert: true,
      });
      return;
    }

    try {
      await ctx.answerCallbackQuery();
      const occurrence = await this.tasksService.getOccurrenceById(
        user.id,
        occurrenceId,
      );
      const text = buildConfirmDeleteMessage(occurrence.task.title);
      const keyboard = buildConfirmDeleteKeyboard(occurrenceId);
      await this.uiService.editOrReply(ctx, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (error: unknown) {
      await this.handleTaskError(ctx, error, occurrenceId);
    }
  }

  async handleDeleteExecute(
    ctx: Context,
    user: User,
    occurrenceId: string,
  ): Promise<void> {
    if (!this.uuidRegex.test(occurrenceId)) {
      await ctx.answerCallbackQuery({
        text: 'شناسه تسک نامعتبر است.',
        show_alert: true,
      });
      return;
    }

    try {
      const occurrence = await this.tasksService.getOccurrenceById(
        user.id,
        occurrenceId,
      );
      try {
        await this.tasksService.deleteTask(user.id, occurrence.taskId);
        await ctx.answerCallbackQuery({ text: '✅ تسک با موفقیت حذف گردید.' });
        await this.handleListTodayTasks(ctx, user);
      } catch (err: unknown) {
        if (err instanceof BadRequestException) {
          await ctx.answerCallbackQuery();
          const message = buildDeleteBlockedByHistoryMessage(
            occurrence.task.title,
          );
          const keyboard = new InlineKeyboard()
            .text(
              '🛑 غیرفعال کردن تکرار روزانه',
              `task:lc:deact:${occurrence.id}`,
            )
            .row()
            .text('🔙 بازگشت به مشخصات تسک', `task:view:${occurrence.id}`);
          await this.uiService.editOrReply(ctx, message, {
            parse_mode: 'HTML',
            reply_markup: keyboard,
          });
          return;
        }
        throw err;
      }
    } catch (error: unknown) {
      await this.handleTaskError(ctx, error, occurrenceId);
    }
  }

  async handleEditTextInput(ctx: Context): Promise<void> {
    if (!ctx.from || !ctx.message?.text) {
      return;
    }

    const telegramUserId = String(ctx.from.id);
    const session = this.editStateService.getSession(
      telegramUserId,
      ctx.chat?.id,
    );
    if (!session) {
      return;
    }

    const text = ctx.message.text.trim();
    if (text === '/cancel') {
      this.editStateService.clearSession(telegramUserId);
      await this.deleteUserMessageImmediate(ctx);
      void this.uiService.sendTemporaryConfirmation(
        ctx,
        '❌ ویرایش لغو شد.',
        7000,
      );
      const user = await this.usersService.findTelegramUser(telegramUserId);
      if (user) {
        await this.handleViewTaskDetails(ctx, user, session.occurrenceId);
      }
      return;
    }

    const user = await this.usersService.findTelegramUser(telegramUserId);
    if (!user) {
      this.editStateService.clearSession(telegramUserId);
      return;
    }

    const userTimezone = user.settings?.timezone || 'Asia/Tehran';

    try {
      if (session.mode === 'edit_title') {
        if (text.length === 0 || text.length > 160) {
          this.sendTemporaryError(
            ctx,
            '❌ عنوان تسک باید بین ۱ تا ۱۶۰ کاراکتر باشد. لطفاً مجدداً ارسال کنید:',
            10000,
          );
          return;
        }

        await this.tasksService.updateTask(user.id, session.taskId, {
          title: text,
        });
        this.editStateService.clearSession(telegramUserId);
        await this.deleteUserMessageImmediate(ctx);
        void this.uiService.sendTemporaryConfirmation(
          ctx,
          '✅ عنوان تسک با موفقیت بروزرسانی شد.',
          7000,
        );
        await this.handleViewTaskDetails(ctx, user, session.occurrenceId);
        return;
      }

      if (session.mode === 'edit_description') {
        const isClearing =
          text === 'حذف' || text === '-' || text.toLowerCase() === '/skip';
        const newDescription = isClearing ? null : text;

        if (!isClearing && text.length > 1000) {
          this.sendTemporaryError(
            ctx,
            '❌ توضیحات تسک نمی‌تواند بیش از ۱۰۰۰ کاراکتر باشد. لطفاً مجدداً ارسال کنید:',
            10000,
          );
          return;
        }

        await this.tasksService.updateTask(user.id, session.taskId, {
          description: newDescription,
        });
        this.editStateService.clearSession(telegramUserId);
        await this.deleteUserMessageImmediate(ctx);
        void this.uiService.sendTemporaryConfirmation(
          ctx,
          isClearing
            ? '✅ توضیحات تسک حذف گردید.'
            : '✅ توضیحات تسک با موفقیت بروزرسانی شد.',
          7000,
        );
        await this.handleViewTaskDetails(ctx, user, session.occurrenceId);
        return;
      }

      if (session.mode === 'edit_time') {
        let startTimeStr: string | null = null;
        let endTimeStr: string | null = null;

        if (text.includes('-')) {
          const parts = text.split('-').map((s) => s.trim());
          startTimeStr = parts[0];
          endTimeStr = parts[1];
        } else if (text.includes('تا')) {
          const parts = text.split('تا').map((s) => s.trim());
          startTimeStr = parts[0];
          endTimeStr = parts[1];
        } else {
          startTimeStr = text;
        }

        let normalizedStart: string | null = null;
        let normalizedEnd: string | null = null;

        try {
          normalizedStart = normalizeTimeString(startTimeStr);
          normalizedEnd = endTimeStr ? normalizeTimeString(endTimeStr) : null;
        } catch {
          this.sendTemporaryError(
            ctx,
            '❌ فرمت زمان واردشده نامعتبر است. فرمت صحیح: <code>HH:mm</code> یا <code>HH:mm-HH:mm</code> (مثال: <code>09:30</code> یا <code>10:00-11:30</code>):',
            10000,
          );
          return;
        }

        if (!normalizedStart) {
          this.sendTemporaryError(
            ctx,
            '❌ لطفاً یک زمان معتبر ارسال کنید (مثال: <code>09:30</code> یا <code>10:00-11:30</code>):',
            10000,
          );
          return;
        }

        if (normalizedStart && normalizedEnd) {
          if (normalizedEnd <= normalizedStart) {
            this.sendTemporaryError(
              ctx,
              '❌ ساعت پایان باید دیرتر از ساعت شروع باشد. لطفاً مجدداً ارسال کنید:\n<i>مثال: 10:00-11:30</i>',
              10000,
            );
            return;
          }
        }

        const occurrence = await this.tasksService.getOccurrenceById(
          user.id,
          session.occurrenceId,
        );

        if (occurrence.task.type === TaskType.DAILY) {
          session.pendingStartTime = normalizedStart;
          session.pendingEndTime = normalizedEnd;
          this.editStateService.touchSession(telegramUserId);

          await this.deleteUserMessageImmediate(ctx);

          const timeDisplay = normalizedEnd
            ? `${normalizedStart} تا ${normalizedEnd}`
            : `${normalizedStart}`;

          await this.uiService.editOrReply(
            ctx,
            `⏰ زمان‌بندی جدید: <b>${timeDisplay}</b>\n\nآیا مایلید این زمان فقط برای امروز اعمال شود یا پیش‌فرض تسک برای همه روزها تغییر کند؟`,
            {
              parse_mode: 'HTML',
              reply_markup: buildRecurringScheduleApplyKeyboard(
                session.occurrenceId,
              ),
            },
          );
          return;
        }

        await this.tasksService.updateOccurrenceSchedule(
          user.id,
          session.occurrenceId,
          {
            startTime: normalizedStart,
            endTime: normalizedEnd,
          },
        );
        this.editStateService.clearSession(telegramUserId);
        await this.deleteUserMessageImmediate(ctx);
        void this.uiService.sendTemporaryConfirmation(
          ctx,
          '✅ زمان‌بندی تسک با موفقیت ذخیره شد.',
          7000,
        );
        await this.handleViewTaskDetails(ctx, user, session.occurrenceId);
        return;
      }

      if (session.mode === 'edit_date') {
        const todayDate = getTodayDateString(userTimezone);
        if (!isValidIsoDate(text)) {
          this.sendTemporaryError(
            ctx,
            '❌ تاریخ واردشده نامعتبر است. فرمت صحیح: <code>YYYY-MM-DD</code> (مثلاً <code>' +
              todayDate +
              '</code>):',
            10000,
          );
          return;
        }

        if (text < todayDate) {
          this.sendTemporaryError(
            ctx,
            `❌ امکان انتقال تسک به تاریخ‌های گذشته وجود ندارد. حداقل تاریخ مجاز: <code>${todayDate}</code>`,
            10000,
          );
          return;
        }

        await this.tasksService.updateOccurrenceSchedule(
          user.id,
          session.occurrenceId,
          {
            date: text,
          },
        );
        this.editStateService.clearSession(telegramUserId);
        await this.deleteUserMessageImmediate(ctx);
        void this.uiService.sendTemporaryConfirmation(
          ctx,
          '✅ تاریخ تسک با موفقیت تغییر یافت.',
          7000,
        );
        await this.handleViewTaskDetails(ctx, user, session.occurrenceId);
        return;
      }
    } catch (error: unknown) {
      this.logger.error(
        `Failed to handle edit input: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.sendTemporaryError(
        ctx,
        `❌ خطا در ذخیره تغییرات: ${error instanceof Error ? error.message : 'لطفاً مجدداً تلاش کنید.'}`,
        10000,
      );
    }
  }

  private async handleTaskError(
    ctx: Context,
    error: unknown,
    occurrenceId: string,
  ): Promise<void> {
    if (error instanceof ForbiddenException) {
      await ctx.answerCallbackQuery({
        text: '⛔️ شما اجازه دسترسی به این تسک را ندارید.',
        show_alert: true,
      });
      return;
    }
    if (error instanceof NotFoundException) {
      await ctx.answerCallbackQuery({
        text: '⚠️ تسک مورد نظر یافت نشد یا حذف شده است.',
        show_alert: true,
      });
      return;
    }
    this.logger.error(
      `Error processing task ${occurrenceId}:`,
      error instanceof Error ? error.stack : String(error),
    );
    await ctx.answerCallbackQuery({
      text: error instanceof Error ? error.message : 'خطایی در پردازش رخ داد.',
      show_alert: true,
    });
  }
}
