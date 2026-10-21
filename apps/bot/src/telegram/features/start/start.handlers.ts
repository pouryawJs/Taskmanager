import { Injectable, Logger, Optional } from '@nestjs/common';
import { InputFile } from 'grammy';
import type { Context, NextFunction } from 'grammy';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { OnboardingStep, User } from '@app/database';
import {
  UsersService,
  UpdateDisplayNameDto,
  UpdateTimezoneDto,
  isValidIanaTimezone,
  GamificationService,
} from '@app/core';

import { TelegramUiService } from '../../ui/telegram-ui.service';

import {
  buildWelcomeAndNameMessage,
  PROMPT_CUSTOM_NAME_MESSAGE,
  CONFIRM_NAME_UPDATED,
  CONFIRM_NAME_CONFIRMED,
  buildInvalidNameMessage,
  TIMEZONE_CONFIRM_MESSAGE,
  CONFIRM_TIMEZONE_TEHRAN,
  CHOOSE_TIMEZONE_MESSAGE,
  PROMPT_MANUAL_TIMEZONE_MESSAGE,
  buildConfirmTimezoneUpdated,
  INVALID_TIMEZONE_MESSAGE,
  GAMIFICATION_INTRO_MESSAGE,
  CONFIRM_REGISTRATION_COMPLETED,
  buildMainMenuMessage,
  UNEXPECTED_INPUT_MESSAGE,
  formatGamificationProfileMessage,
  formatGamificationPhotoCaption,
  buildSettingsMessage,
  PROMPT_SETTINGS_NAME_MESSAGE,
  CHOOSE_SETTINGS_TIMEZONE_MESSAGE,
  CONFIRM_SETTINGS_NAME_UPDATED,
} from './start.messages';

import {
  buildNameKeyboard,
  backToSuggestedNameKeyboard,
  timezoneConfirmKeyboard,
  timezonePickerKeyboard,
  backToTimezonePickerKeyboard,
  gamificationKeyboard,
  mainMenuKeyboard,
  buildGamificationKeyboard,
  settingsMenuKeyboard,
  cancelSettingsEditKeyboard,
  settingsTimezonePickerKeyboard,
} from './start.keyboards';

import { GamificationChartService } from './gamification-chart.service';

@Injectable()
export class StartHandler {
  private readonly logger = new Logger(StartHandler.name);
  private readonly awaitingSettingsNameUsers = new Set<string>();

  constructor(
    private readonly usersService: UsersService,
    private readonly uiService: TelegramUiService,
    @Optional()
    private readonly gamificationService?: GamificationService,
    @Optional()
    private readonly chartService?: GamificationChartService,
  ) {}

  /**
   * Handle the /start command.
   */
  async handleStart(ctx: Context): Promise<void> {
    if (!ctx.from) {
      this.logger.warn('Received /start without sender context.');
      return;
    }

    const telegramUserId = String(ctx.from.id);
    const suggestedName = this.extractTelegramProfileName(ctx);

    try {
      const existingUser =
        await this.usersService.findTelegramUser(telegramUserId);

      // User already exists and finished onboarding -> display main menu
      if (existingUser?.settings?.onboardingCompleted) {
        await this.uiService.editOrReply(
          ctx,
          buildMainMenuMessage(existingUser.displayName),
          {
            parse_mode: 'HTML',
            reply_markup: mainMenuKeyboard,
          },
        );
        return;
      }

      // New user -> initiate user record and start at Step 2 (Name)
      if (!existingUser) {
        await this.usersService.initiateTelegramUser(
          telegramUserId,
          suggestedName,
        );
        const msg = await ctx.reply(buildWelcomeAndNameMessage(suggestedName), {
          parse_mode: 'HTML',
          reply_markup: buildNameKeyboard(suggestedName),
        });
        if (ctx.chat?.id && msg?.message_id) {
          this.uiService.recordMenuMessage(ctx.chat.id, msg.message_id);
        }
        return;
      }

      // Interrupted user -> resume from last incomplete step
      await this.resumeIncompleteOnboarding(ctx, existingUser, suggestedName);
    } catch (error: unknown) {
      this.logger.error(
        `Failed to handle /start for Telegram ID ${telegramUserId}`,
        error instanceof Error ? error.stack : String(error),
      );
      await this.sendSafeErrorMessage(ctx);
    }
  }

  /**
   * Handle inline callback queries related to onboarding and main menu.
   */
  async handleCallbackQuery(ctx: Context, next?: NextFunction): Promise<void> {
    if (!ctx.from || !ctx.callbackQuery?.data) {
      if (next) await next();
      return;
    }

    const data = ctx.callbackQuery.data;
    const isOurCallback =
      data.startsWith('onboard:') ||
      data.startsWith('menu:') ||
      data.startsWith('settings:') ||
      data.startsWith('gam:') ||
      data === 'task:back:to_menu' ||
      data === 'GET_INFORMATION';

    if (!isOurCallback) {
      if (next) await next();
      return;
    }

    const telegramUserId = String(ctx.from.id);

    try {
      const user = await this.usersService.findTelegramUser(telegramUserId);

      // Legacy GET_INFORMATION button handler
      if (data === 'GET_INFORMATION') {
        await ctx.answerCallbackQuery();
        await this.handleStart(ctx);
        return;
      }

      if (!user) {
        await ctx.answerCallbackQuery({
          text: 'لطفاً ابتدا ربات را با دستور /start آغاز کنید.',
          show_alert: true,
        });
        return;
      }

      // Settings interactions
      if (data.startsWith('settings:')) {
        await this.handleSettingsCallback(ctx, user, data);
        return;
      }

      // Menu interactions
      if (data.startsWith('menu:')) {
        await this.handleMenuCallback(ctx, user, data);
        return;
      }

      // Gamification range filtering
      if (data.startsWith('gam:')) {
        await this.handleGamificationCallback(ctx, user, data);
        return;
      }

      // Return to main menu fallback
      if (data === 'task:back:to_menu') {
        this.awaitingSettingsNameUsers.delete(telegramUserId);
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

      // If user has already completed onboarding, handle safely
      if (user.settings?.onboardingCompleted) {
        await ctx.answerCallbackQuery({
          text: 'ثبت‌نام شما قبلاً تکمیل شده است.',
        });
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

      // Onboarding callback interactions
      await this.handleOnboardingCallback(ctx, user, data);
    } catch (error: unknown) {
      this.logger.error(
        `Failed to handle callback query '${data}' for Telegram ID ${telegramUserId}`,
        error instanceof Error ? error.stack : String(error),
      );
      try {
        await ctx.answerCallbackQuery({
          text: 'خطایی رخ داد. لطفاً دوباره تلاش کنید.',
          show_alert: true,
        });
      } catch {
        // Ignored in case callback query expired
      }
    }
  }

  /**
   * Handle text messages during onboarding or settings (e.g. custom name or custom timezone).
   */
  async handleTextMessage(ctx: Context, next?: NextFunction): Promise<void> {
    if (!ctx.from || !ctx.message?.text) {
      if (next) await next();
      return;
    }

    // Ignore commands (let command handlers process them)
    if (ctx.message.text.startsWith('/')) {
      if (next) await next();
      return;
    }

    const telegramUserId = String(ctx.from.id);

    try {
      const user = await this.usersService.findTelegramUser(telegramUserId);

      // Handle active settings display name input
      if (user && this.awaitingSettingsNameUsers.has(telegramUserId)) {
        await this.processSettingsNameInput(ctx, user, ctx.message.text);
        return;
      }

      // If user is not in onboarding, pass through to next middleware
      if (!user || user.settings?.onboardingCompleted) {
        if (next) await next();
        return;
      }

      const step = user.settings?.onboardingStep;

      // Handle custom display name input
      if (step === OnboardingStep.AWAITING_CUSTOM_NAME) {
        await this.processCustomNameInput(ctx, user, ctx.message.text);
        return;
      }

      // Handle custom timezone input
      if (step === OnboardingStep.AWAITING_CUSTOM_TIMEZONE) {
        await this.processCustomTimezoneInput(ctx, user, ctx.message.text);
        return;
      }

      // Unexpected text during button-only onboarding steps
      void this.uiService.sendTemporaryConfirmation(
        ctx,
        UNEXPECTED_INPUT_MESSAGE,
        5000,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Failed to handle text message for Telegram ID ${telegramUserId}`,
        error instanceof Error ? error.stack : String(error),
      );
      await this.sendSafeErrorMessage(ctx);
    }
  }

  // --- Private Helpers ---

  private async handleOnboardingCallback(
    ctx: Context,
    user: User,
    data: string,
  ): Promise<void> {
    // 1. Confirm suggested name
    if (data === 'onboard:name:suggested') {
      const suggestedName =
        user.displayName || this.extractTelegramProfileName(ctx) || 'کاربر';
      await this.usersService.updateDisplayName(
        user.id,
        suggestedName,
        OnboardingStep.TIMEZONE,
      );
      await ctx.answerCallbackQuery();

      // Edit main interaction message in-place
      await this.uiService.editOrReply(ctx, TIMEZONE_CONFIRM_MESSAGE, {
        parse_mode: 'HTML',
        reply_markup: timezoneConfirmKeyboard,
      });

      // Send self-deleting temporary confirmation message (~10s)
      void this.uiService.sendTemporaryConfirmation(
        ctx,
        CONFIRM_NAME_CONFIRMED,
        10000,
      );
      return;
    }

    // 2. Request custom name
    if (data === 'onboard:name:custom') {
      await this.usersService.setOnboardingStep(
        user.id,
        OnboardingStep.AWAITING_CUSTOM_NAME,
      );
      await ctx.answerCallbackQuery();

      // Edit main interaction message in-place to custom name prompt
      await this.uiService.editOrReply(ctx, PROMPT_CUSTOM_NAME_MESSAGE, {
        parse_mode: 'HTML',
        reply_markup: backToSuggestedNameKeyboard,
      });
      return;
    }

    // 2b. Back to suggested name
    if (data === 'onboard:name:back_to_suggested') {
      await this.usersService.setOnboardingStep(user.id, OnboardingStep.NAME);
      await ctx.answerCallbackQuery();

      const suggestedName =
        user.displayName || this.extractTelegramProfileName(ctx);
      await this.uiService.editOrReply(
        ctx,
        buildWelcomeAndNameMessage(suggestedName),
        {
          parse_mode: 'HTML',
          reply_markup: buildNameKeyboard(suggestedName),
        },
      );
      return;
    }

    // 3. Confirm default Asia/Tehran timezone
    if (data === 'onboard:tz:confirm_tehran') {
      await this.usersService.updateTimezone(
        user.id,
        'Asia/Tehran',
        OnboardingStep.GAMIFICATION,
      );
      await ctx.answerCallbackQuery();

      // Edit main interaction message in-place to Gamification intro
      await this.uiService.editOrReply(ctx, GAMIFICATION_INTRO_MESSAGE, {
        parse_mode: 'HTML',
        reply_markup: gamificationKeyboard,
      });

      // Send self-deleting temporary confirmation message (~10s)
      void this.uiService.sendTemporaryConfirmation(
        ctx,
        CONFIRM_TIMEZONE_TEHRAN,
        10000,
      );
      return;
    }

    // 4. Request timezone picker
    if (data === 'onboard:tz:choose_other') {
      await ctx.answerCallbackQuery();
      await this.uiService.editOrReply(ctx, CHOOSE_TIMEZONE_MESSAGE, {
        parse_mode: 'HTML',
        reply_markup: timezonePickerKeyboard,
      });
      return;
    }

    // 5. Back to Tehran confirm
    if (data === 'onboard:tz:back_to_tehran') {
      await ctx.answerCallbackQuery();
      await this.uiService.editOrReply(ctx, TIMEZONE_CONFIRM_MESSAGE, {
        parse_mode: 'HTML',
        reply_markup: timezoneConfirmKeyboard,
      });
      return;
    }

    // 6. Select predefined timezone from picker
    if (data.startsWith('onboard:tz:set:')) {
      const selectedTz = data.slice('onboard:tz:set:'.length).trim();
      if (!isValidIanaTimezone(selectedTz)) {
        await ctx.answerCallbackQuery({
          text: 'منطقه زمانی نامعتبر است.',
          show_alert: true,
        });
        return;
      }
      await this.usersService.updateTimezone(
        user.id,
        selectedTz,
        OnboardingStep.GAMIFICATION,
      );
      await ctx.answerCallbackQuery();

      // Edit main interaction message in-place to Gamification intro
      await this.uiService.editOrReply(ctx, GAMIFICATION_INTRO_MESSAGE, {
        parse_mode: 'HTML',
        reply_markup: gamificationKeyboard,
      });

      // Send self-deleting temporary confirmation message (~10s)
      void this.uiService.sendTemporaryConfirmation(
        ctx,
        buildConfirmTimezoneUpdated(selectedTz),
        10000,
      );
      return;
    }

    // 7. Request manual timezone entry
    if (data === 'onboard:tz:manual_prompt') {
      await this.usersService.setOnboardingStep(
        user.id,
        OnboardingStep.AWAITING_CUSTOM_TIMEZONE,
      );
      await ctx.answerCallbackQuery();
      await this.uiService.editOrReply(ctx, PROMPT_MANUAL_TIMEZONE_MESSAGE, {
        parse_mode: 'HTML',
        reply_markup: backToTimezonePickerKeyboard,
      });
      return;
    }

    // 8. Gamification acknowledgement / completion
    if (data === 'onboard:gamification:complete') {
      const updatedUser = await this.usersService.completeOnboarding(user.id);
      await ctx.answerCallbackQuery();

      // Edit main interaction message in-place to Main Menu
      await this.uiService.editOrReply(
        ctx,
        buildMainMenuMessage(updatedUser.displayName),
        {
          parse_mode: 'HTML',
          reply_markup: mainMenuKeyboard,
        },
      );

      // Send self-deleting temporary confirmation message (~10s)
      void this.uiService.sendTemporaryConfirmation(
        ctx,
        CONFIRM_REGISTRATION_COMPLETED,
        10000,
      );
      return;
    }

    // Unrecognized onboarding callback
    await ctx.answerCallbackQuery();
  }

  private async processCustomNameInput(
    ctx: Context,
    user: User,
    rawText: string,
  ): Promise<void> {
    const dto = plainToInstance(UpdateDisplayNameDto, { displayName: rawText });
    const errors = await validate(dto);

    if (errors.length > 0) {
      const firstConstraint = Object.values(errors[0].constraints ?? {})[0];
      void this.uiService.sendTemporaryConfirmation(
        ctx,
        buildInvalidNameMessage(firstConstraint),
        10000,
      );
      return;
    }

    await this.usersService.updateDisplayName(
      user.id,
      dto.displayName,
      OnboardingStep.TIMEZONE,
    );

    // Edit the existing prompt message in-place to Timezone step
    await this.uiService.editOrReply(ctx, TIMEZONE_CONFIRM_MESSAGE, {
      parse_mode: 'HTML',
      reply_markup: timezoneConfirmKeyboard,
    });

    // Send self-deleting temporary confirmation (~10s)
    void this.uiService.sendTemporaryConfirmation(
      ctx,
      CONFIRM_NAME_UPDATED,
      10000,
    );
  }

  private async processCustomTimezoneInput(
    ctx: Context,
    user: User,
    rawText: string,
  ): Promise<void> {
    const dto = plainToInstance(UpdateTimezoneDto, { timezone: rawText });
    const errors = await validate(dto);

    if (errors.length > 0) {
      void this.uiService.sendTemporaryConfirmation(
        ctx,
        INVALID_TIMEZONE_MESSAGE,
        10000,
      );
      return;
    }

    await this.usersService.updateTimezone(
      user.id,
      dto.timezone,
      OnboardingStep.GAMIFICATION,
    );

    // Edit the existing prompt message in-place to Gamification step
    await this.uiService.editOrReply(ctx, GAMIFICATION_INTRO_MESSAGE, {
      parse_mode: 'HTML',
      reply_markup: gamificationKeyboard,
    });

    // Send self-deleting temporary confirmation (~10s)
    void this.uiService.sendTemporaryConfirmation(
      ctx,
      buildConfirmTimezoneUpdated(dto.timezone),
      10000,
    );
  }

  private async resumeIncompleteOnboarding(
    ctx: Context,
    user: User,
    suggestedName?: string | null,
  ): Promise<void> {
    const step = user.settings?.onboardingStep ?? OnboardingStep.NAME;

    switch (step) {
      case OnboardingStep.NAME:
      case OnboardingStep.AWAITING_CUSTOM_NAME: {
        const nameToOffer = user.displayName || suggestedName;
        await this.uiService.editOrReply(
          ctx,
          buildWelcomeAndNameMessage(nameToOffer),
          {
            parse_mode: 'HTML',
            reply_markup: buildNameKeyboard(nameToOffer),
          },
        );
        break;
      }

      case OnboardingStep.TIMEZONE:
      case OnboardingStep.AWAITING_CUSTOM_TIMEZONE: {
        await this.uiService.editOrReply(ctx, TIMEZONE_CONFIRM_MESSAGE, {
          parse_mode: 'HTML',
          reply_markup: timezoneConfirmKeyboard,
        });
        break;
      }

      case OnboardingStep.GAMIFICATION: {
        await this.uiService.editOrReply(ctx, GAMIFICATION_INTRO_MESSAGE, {
          parse_mode: 'HTML',
          reply_markup: gamificationKeyboard,
        });
        break;
      }

      case OnboardingStep.COMPLETED: {
        await this.uiService.editOrReply(
          ctx,
          buildMainMenuMessage(user.displayName),
          {
            parse_mode: 'HTML',
            reply_markup: mainMenuKeyboard,
          },
        );
        break;
      }
    }
  }

  private async handleMenuCallback(
    ctx: Context,
    user: User,
    data: string,
  ): Promise<void> {
    if (data === 'menu:gamification') {
      await ctx.answerCallbackQuery();
      await this.renderGamificationProfile(ctx, user, 'all');
    } else if (data === 'menu:settings') {
      this.awaitingSettingsNameUsers.delete(String(ctx.from?.id));
      await ctx.answerCallbackQuery();
      await this.uiService.editOrReply(
        ctx,
        buildSettingsMessage(user.displayName, user.settings?.timezone),
        {
          parse_mode: 'HTML',
          reply_markup: settingsMenuKeyboard,
        },
      );
    } else {
      await ctx.answerCallbackQuery();
    }
  }

  private async handleSettingsCallback(
    ctx: Context,
    user: User,
    data: string,
  ): Promise<void> {
    const telegramUserId = String(ctx.from?.id);

    if (data === 'settings:edit_name') {
      this.awaitingSettingsNameUsers.add(telegramUserId);
      await ctx.answerCallbackQuery();
      await this.uiService.editOrReply(
        ctx,
        `👤 <b>ویرایش نام نمایشی</b>\n\nنام فعلی شما: <b>${user.displayName || 'کاربر'}</b>\n\n` +
          PROMPT_SETTINGS_NAME_MESSAGE,
        {
          parse_mode: 'HTML',
          reply_markup: cancelSettingsEditKeyboard,
        },
      );
      return;
    }

    if (data === 'settings:edit_tz') {
      this.awaitingSettingsNameUsers.delete(telegramUserId);
      await ctx.answerCallbackQuery();
      await this.uiService.editOrReply(
        ctx,
        `🌐 <b>تغییر منطقه زمانی</b>\n\nمنطقه زمانی فعلی: <code>${user.settings?.timezone ?? 'Asia/Tehran'}</code>\n\n` +
          CHOOSE_SETTINGS_TIMEZONE_MESSAGE,
        {
          parse_mode: 'HTML',
          reply_markup: settingsTimezonePickerKeyboard,
        },
      );
      return;
    }

    if (data.startsWith('settings:tz:set:')) {
      const selectedTz = data.slice('settings:tz:set:'.length).trim();
      if (!isValidIanaTimezone(selectedTz)) {
        await ctx.answerCallbackQuery({
          text: 'منطقه زمانی انتخابی نامعتبر است.',
          show_alert: true,
        });
        return;
      }

      await this.usersService.updateTimezone(
        user.id,
        selectedTz,
        OnboardingStep.COMPLETED,
      );
      await ctx.answerCallbackQuery({
        text: `✅ منطقه زمانی روی ${selectedTz} تنظیم شد.`,
      });

      await this.uiService.editOrReply(
        ctx,
        buildSettingsMessage(user.displayName, selectedTz),
        {
          parse_mode: 'HTML',
          reply_markup: settingsMenuKeyboard,
        },
      );
      return;
    }

    await ctx.answerCallbackQuery();
  }

  private async processSettingsNameInput(
    ctx: Context,
    user: User,
    rawText: string,
  ): Promise<void> {
    const telegramUserId = String(ctx.from?.id);
    const dto = plainToInstance(UpdateDisplayNameDto, {
      displayName: rawText.trim(),
    });
    const errors = await validate(dto);

    if (errors.length > 0) {
      const firstConstraint = Object.values(errors[0].constraints ?? {})[0];
      void this.uiService.sendTemporaryConfirmation(
        ctx,
        buildInvalidNameMessage(firstConstraint),
        10000,
      );
      return;
    }

    this.awaitingSettingsNameUsers.delete(telegramUserId);
    const updatedUser = await this.usersService.updateDisplayName(
      user.id,
      dto.displayName,
      OnboardingStep.COMPLETED,
    );

    try {
      await ctx.deleteMessage();
    } catch {
      // Ignore
    }

    void this.uiService.sendTemporaryConfirmation(
      ctx,
      CONFIRM_SETTINGS_NAME_UPDATED,
      7000,
    );

    await this.uiService.editOrReply(
      ctx,
      buildSettingsMessage(updatedUser.displayName, user.settings?.timezone),
      {
        parse_mode: 'HTML',
        reply_markup: settingsMenuKeyboard,
      },
    );
  }

  /**
   * Handle /profile and /stats commands.
   */
  async handleProfileCommand(ctx: Context): Promise<void> {
    if (!ctx.from) return;
    const telegramUserId = String(ctx.from.id);

    try {
      const user = await this.usersService.findTelegramUser(telegramUserId);
      if (!user) {
        await ctx.reply('لطفاً ابتدا ربات را با دستور /start آغاز کنید.');
        return;
      }

      await this.renderGamificationProfile(ctx, user, 'all');
    } catch (error: unknown) {
      this.logger.error(
        `Failed to handle profile command for Telegram ID ${telegramUserId}`,
        error instanceof Error ? error.stack : String(error),
      );
      await this.sendSafeErrorMessage(ctx);
    }
  }

  private async handleGamificationCallback(
    ctx: Context,
    user: User,
    data: string,
  ): Promise<void> {
    await ctx.answerCallbackQuery();
    if (data === 'gam:range:7d') {
      await this.renderGamificationProfile(ctx, user, '7d');
    } else if (data === 'gam:range:30d') {
      await this.renderGamificationProfile(ctx, user, '30d');
    } else if (data === 'gam:range:all') {
      await this.renderGamificationProfile(ctx, user, 'all');
    }
  }

  private async renderGamificationProfile(
    ctx: Context,
    user: User,
    range: '7d' | '30d' | 'all' = 'all',
  ): Promise<void> {
    if (!this.gamificationService) {
      await this.uiService.editOrReply(
        ctx,
        '⚠️ سرویس گیمیفیکیشن در دسترس نیست.',
        { parse_mode: 'HTML', reply_markup: mainMenuKeyboard },
      );
      return;
    }

    const [overview, trend] = await Promise.all([
      this.gamificationService.getGamificationOverview(user.id),
      this.gamificationService.getConsistencyScoreTrend(user.id, range),
    ]);

    const completedCount =
      range === 'all'
        ? overview.consistencyScore.completedCount
        : trend.buckets.reduce((sum, b) => sum + (b.completedCount ?? 0), 0);
    const partiallyCompletedCount =
      range === 'all'
        ? overview.consistencyScore.partiallyCompletedCount
        : trend.buckets.reduce(
            (sum, b) => sum + (b.partiallyCompletedCount ?? 0),
            0,
          );
    const notCompletedCount =
      range === 'all'
        ? overview.consistencyScore.notCompletedCount
        : trend.buckets.reduce((sum, b) => sum + (b.notCompletedCount ?? 0), 0);

    const keyboard = buildGamificationKeyboard(range);
    const caption = formatGamificationPhotoCaption({
      displayName: user.displayName,
      overview,
      consistencyScore: {
        score: trend.overallScore,
        isProvisional: trend.isProvisional,
        sampleCount: trend.sampleCount,
        completedCount,
        partiallyCompletedCount,
        notCompletedCount,
        skippedCount: 0,
        cancelledCount: 0,
      },
      period: range,
    });

    if (this.chartService) {
      try {
        const chartBuffer =
          await this.chartService.renderConsistencyTrendChart(trend);
        const inputFile = new InputFile(
          chartBuffer,
          `consistency-${range}.png`,
        );

        const chatId = ctx.chat?.id;
        const prevMsgId =
          ctx.callbackQuery?.message?.message_id ||
          (chatId ? this.uiService.getMenuMessage(chatId) : undefined);

        const newMsg = await ctx.replyWithPhoto(inputFile, {
          caption,
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });

        if (chatId && newMsg?.message_id) {
          if (prevMsgId && prevMsgId !== newMsg.message_id) {
            await this.uiService.deleteBotMessageSafely(ctx, chatId, prevMsgId);
          }
          this.uiService.recordMenuMessage(chatId, newMsg.message_id);
        }
        return;
      } catch (err: unknown) {
        this.logger.warn(
          `Failed to render or send photo profile, falling back to text: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Text fallback if chart rendering or photo sending is unavailable/fails
    const streakMultiplier = this.gamificationService.calculateStreakMultiplier(
      overview.currentStreak,
    );
    const rangeTitle =
      range === '7d'
        ? '۷ روز اخیر'
        : range === '30d'
          ? '۳۰ روز اخیر'
          : 'کل تاریخچه';

    const message = formatGamificationProfileMessage({
      displayName: user.displayName,
      overview,
      streakMultiplier,
      consistencyScore: {
        score: trend.overallScore,
        isProvisional: trend.isProvisional,
        sampleCount: trend.sampleCount,
        completedCount,
        partiallyCompletedCount,
        notCompletedCount,
        skippedCount: 0,
        cancelledCount: 0,
      },
      rangeTitle,
    });

    await this.uiService.editOrReply(ctx, message, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }

  private extractTelegramProfileName(ctx: Context): string | null {
    if (!ctx.from) return null;
    const parts = [ctx.from.first_name, ctx.from.last_name]
      .filter((p): p is string => Boolean(p && p.trim().length > 0))
      .map((p) => p.trim());
    return parts.length > 0 ? parts.join(' ') : null;
  }

  private async sendSafeErrorMessage(ctx: Context): Promise<void> {
    try {
      await ctx.reply(
        '⚠️ متاسفانه خطایی در ارتباط رخ داد. لطفاً چند لحظه بعد مجدداً تلاش کنید یا دستور /start را ارسال کنید.',
      );
    } catch {
      // Ignored if unable to reach Telegram API
    }
  }
}
