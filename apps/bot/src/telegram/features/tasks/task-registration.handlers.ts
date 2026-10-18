import { Injectable, Logger } from '@nestjs/common';
import type { Context } from 'grammy';

import { TaskType, TaskPriority } from '@app/database';
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
} from './tasks.messages';
import {
  taskTypeKeyboard,
  buildCalendarKeyboard,
  registrationModeKeyboard,
} from './tasks.keyboards';
import { buildMainMenuMessage } from '../start/start.messages';
import { mainMenuKeyboard } from '../start/start.keyboards';

@Injectable()
export class TaskRegistrationHandler {
  private readonly logger = new Logger(TaskRegistrationHandler.name);

  constructor(
    private readonly tasksService: TasksService,
    private readonly usersService: UsersService,
    private readonly uiService: TelegramUiService,
    private readonly stateService: TaskRegistrationStateService,
  ) {}

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
   * Explicitly clear any active registration session for a Telegram user.
   */
  clearSession(telegramUserId: string): void {
    this.stateService.clearSession(telegramUserId);
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

      // 2. Ignore no-op calendar clicks
      if (data === 'task:date:noop') {
        await ctx.answerCallbackQuery();
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

        const [yStr, mStr] = navTarget.split('-');
        const year = parseInt(yStr, 10);
        const month = parseInt(mStr, 10);
        const todayDate = getTodayDateString(userTimezone);

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
      const chatId = ctx.chat.id;
      const messageId = ctx.message.message_id;

      // Show line-specific errors in a temporary message (~15s)
      void this.uiService.sendTemporaryConfirmation(
        ctx,
        buildValidationErrorMessage(parseResult.errors),
        15000,
      );

      // Schedule deletion of user's original message after ~15s
      setTimeout(() => {
        void this.uiService.deleteBotMessageSafely(ctx, chatId, messageId);
      }, 15000).unref?.();

      return;
    }

    // 3. Validation succeeded: map drafts to CreateTaskDto
    const targetDate =
      session.taskType === TaskType.ONE_TIME
        ? session.selectedDate!
        : getTodayDateString(userTimezone);

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
      try {
        await ctx.deleteMessage();
      } catch (delError: unknown) {
        this.logger.debug(
          `Failed to delete user message: ${delError instanceof Error ? delError.message : String(delError)}`,
        );
      }

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
   * Handle non-text messages sent during active registration mode.
   */
  handleNonTextMessage(ctx: Context): void {
    void this.uiService.sendTemporaryConfirmation(
      ctx,
      NON_TEXT_INPUT_MESSAGE,
      5000,
    );
  }
}
