import { Context } from 'grammy';
import { OnboardingStep, User, UserSettings } from '@app/database';
import { UsersService } from '@app/core';
import { TelegramUiService } from '../../ui/telegram-ui.service';
import { StartHandler } from './start.handlers';
import {
  TIMEZONE_CONFIRM_MESSAGE,
  GAMIFICATION_INTRO_MESSAGE,
  CHOOSE_TIMEZONE_MESSAGE,
  PROMPT_CUSTOM_NAME_MESSAGE,
  PROMPT_MANUAL_TIMEZONE_MESSAGE,
  CONFIRM_NAME_CONFIRMED,
  CONFIRM_NAME_UPDATED,
  CONFIRM_TIMEZONE_TEHRAN,
  CONFIRM_REGISTRATION_COMPLETED,
  UNEXPECTED_INPUT_MESSAGE,
} from './start.messages';

describe('StartHandler', () => {
  let handler: StartHandler;
  let mockUsersService: jest.Mocked<UsersService>;
  let mockUiService: jest.Mocked<TelegramUiService>;
  let mockCtx: Partial<Context> & {
    chat: { id: number };
    reply: jest.Mock;
    answerCallbackQuery: jest.Mock;
  };

  beforeEach(() => {
    mockUsersService = {
      findTelegramUser: jest.fn(),
      initiateTelegramUser: jest.fn(),
      updateDisplayName: jest.fn(),
      updateTimezone: jest.fn(),
      setOnboardingStep: jest.fn(),
      completeOnboarding: jest.fn(),
      registerTelegramUser: jest.fn(),
    } as unknown as jest.Mocked<UsersService>;

    mockUiService = {
      recordMenuMessage: jest.fn(),
      getMenuMessage: jest.fn(),
      clearMenuMessage: jest.fn(),
      editOrReply: jest.fn().mockResolvedValue(true),
      sendTemporaryConfirmation: jest
        .fn()
        .mockResolvedValue({ message_id: 99 }),
    } as unknown as jest.Mocked<TelegramUiService>;

    handler = new StartHandler(mockUsersService, mockUiService);

    mockCtx = {
      chat: { id: 1001 },
      from: {
        id: 12345678,
        first_name: 'John',
        last_name: 'Doe',
        is_bot: false,
      },
      reply: jest.fn().mockResolvedValue({ message_id: 1 }),
      answerCallbackQuery: jest.fn().mockResolvedValue(true),
    };
  });

  describe('handleStart (Requirements 1, 2, 8)', () => {
    it('(Req 1) should initiate registration for a new user and prompt for display name', async () => {
      mockUsersService.findTelegramUser.mockResolvedValue(null);
      mockUsersService.initiateTelegramUser.mockResolvedValue({
        user: {
          id: 'u-new',
          displayName: 'John Doe',
          settings: { onboardingStep: OnboardingStep.NAME },
        } as User,
        isNew: true,
      });

      await handler.handleStart(mockCtx as Context);

      expect(mockUsersService.initiateTelegramUser).toHaveBeenCalledWith(
        '12345678',
        'John Doe',
      );
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('John Doe'),
        expect.objectContaining({ parse_mode: 'HTML' }),
      );
      expect(mockUiService.recordMenuMessage).toHaveBeenCalledWith(1001, 1);
    });

    it('(Req 2) should show main menu directly when user has already completed onboarding', async () => {
      const completedUser = {
        id: 'u-existing',
        displayName: 'Registered User',
        settings: {
          onboardingCompleted: true,
          onboardingStep: OnboardingStep.COMPLETED,
        } as UserSettings,
      } as User;

      mockUsersService.findTelegramUser.mockResolvedValue(completedUser);

      await handler.handleStart(mockCtx as Context);

      expect(mockUsersService.initiateTelegramUser).not.toHaveBeenCalled();
      expect(mockUiService.editOrReply).toHaveBeenCalledWith(
        mockCtx,
        expect.stringContaining('Registered User'),
        expect.objectContaining({
          parse_mode: 'HTML',
          reply_markup: expect.anything(),
        }),
      );
    });

    it('should consistently display main menu on repeated /start calls for completed user', async () => {
      const completedUser = {
        id: 'u-existing',
        displayName: 'Registered User',
        settings: {
          onboardingCompleted: true,
          onboardingStep: OnboardingStep.COMPLETED,
        } as UserSettings,
      } as User;

      mockUsersService.findTelegramUser.mockResolvedValue(completedUser);

      // First call
      await handler.handleStart(mockCtx as Context);
      // Second call
      await handler.handleStart(mockCtx as Context);

      expect(mockUiService.editOrReply).toHaveBeenCalledTimes(2);
      expect(mockUiService.editOrReply).toHaveBeenLastCalledWith(
        mockCtx,
        expect.stringContaining('Registered User'),
        expect.objectContaining({
          parse_mode: 'HTML',
          reply_markup: expect.anything(),
        }),
      );
    });

    it('(Req 8) should resume interrupted registration from TIMEZONE step in-place', async () => {
      const interruptedUser = {
        id: 'u-interrupted',
        displayName: 'John',
        settings: {
          onboardingCompleted: false,
          onboardingStep: OnboardingStep.TIMEZONE,
        } as UserSettings,
      } as User;

      mockUsersService.findTelegramUser.mockResolvedValue(interruptedUser);

      await handler.handleStart(mockCtx as Context);

      expect(mockUiService.editOrReply).toHaveBeenCalledWith(
        mockCtx,
        TIMEZONE_CONFIRM_MESSAGE,
        expect.objectContaining({ parse_mode: 'HTML' }),
      );
    });

    it('(Req 8) should resume interrupted registration from GAMIFICATION step in-place', async () => {
      const interruptedUser = {
        id: 'u-interrupted',
        displayName: 'John',
        settings: {
          onboardingCompleted: false,
          onboardingStep: OnboardingStep.GAMIFICATION,
        } as UserSettings,
      } as User;

      mockUsersService.findTelegramUser.mockResolvedValue(interruptedUser);

      await handler.handleStart(mockCtx as Context);

      expect(mockUiService.editOrReply).toHaveBeenCalledWith(
        mockCtx,
        GAMIFICATION_INTRO_MESSAGE,
        expect.objectContaining({ parse_mode: 'HTML' }),
      );
    });
  });

  describe('Callback queries & in-place editing (Requirements 1, 2, 3, 5, 6, 11)', () => {
    it('(Req 3) should accept suggested display name, edit to timezone confirm, and send temporary confirmation', async () => {
      const user = {
        id: 'u-1',
        displayName: 'John Doe',
        settings: { onboardingStep: OnboardingStep.NAME },
      } as User;
      mockUsersService.findTelegramUser.mockResolvedValue(user);

      mockCtx.callbackQuery = { data: 'onboard:name:suggested' } as any;

      await handler.handleCallbackQuery(mockCtx as Context);

      expect(mockUsersService.updateDisplayName).toHaveBeenCalledWith(
        'u-1',
        'John Doe',
        OnboardingStep.TIMEZONE,
      );
      expect(mockUiService.editOrReply).toHaveBeenCalledWith(
        mockCtx,
        TIMEZONE_CONFIRM_MESSAGE,
        expect.objectContaining({ parse_mode: 'HTML' }),
      );
      expect(mockUiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        mockCtx,
        CONFIRM_NAME_CONFIRMED,
        10000,
      );
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalled();
    });

    it('should edit to custom name prompt on onboard:name:custom', async () => {
      const user = {
        id: 'u-1',
        displayName: 'John',
        settings: { onboardingStep: OnboardingStep.NAME },
      } as User;
      mockUsersService.findTelegramUser.mockResolvedValue(user);

      mockCtx.callbackQuery = { data: 'onboard:name:custom' } as any;

      await handler.handleCallbackQuery(mockCtx as Context);

      expect(mockUsersService.setOnboardingStep).toHaveBeenCalledWith(
        'u-1',
        OnboardingStep.AWAITING_CUSTOM_NAME,
      );
      expect(mockUiService.editOrReply).toHaveBeenCalledWith(
        mockCtx,
        PROMPT_CUSTOM_NAME_MESSAGE,
        expect.objectContaining({ parse_mode: 'HTML' }),
      );
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalled();
    });

    it('(Req 5) should confirm default Asia/Tehran, edit to gamification intro, and send temporary confirmation', async () => {
      const user = {
        id: 'u-1',
        settings: { onboardingStep: OnboardingStep.TIMEZONE },
      } as User;
      mockUsersService.findTelegramUser.mockResolvedValue(user);

      mockCtx.callbackQuery = { data: 'onboard:tz:confirm_tehran' } as any;

      await handler.handleCallbackQuery(mockCtx as Context);

      expect(mockUsersService.updateTimezone).toHaveBeenCalledWith(
        'u-1',
        'Asia/Tehran',
        OnboardingStep.GAMIFICATION,
      );
      expect(mockUiService.editOrReply).toHaveBeenCalledWith(
        mockCtx,
        GAMIFICATION_INTRO_MESSAGE,
        expect.objectContaining({ parse_mode: 'HTML' }),
      );
      expect(mockUiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        mockCtx,
        CONFIRM_TIMEZONE_TEHRAN,
        10000,
      );
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalled();
    });

    it('(Req 6) should edit to timezone picker on onboard:tz:choose_other', async () => {
      const user = {
        id: 'u-1',
        settings: { onboardingStep: OnboardingStep.TIMEZONE },
      } as User;
      mockUsersService.findTelegramUser.mockResolvedValue(user);

      mockCtx.callbackQuery = { data: 'onboard:tz:choose_other' } as any;

      await handler.handleCallbackQuery(mockCtx as Context);

      expect(mockUiService.editOrReply).toHaveBeenCalledWith(
        mockCtx,
        CHOOSE_TIMEZONE_MESSAGE,
        expect.objectContaining({ parse_mode: 'HTML' }),
      );
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalled();
    });

    it('(Req 6) should update with selected alternative timezone from picker, edit in-place, and send confirmation', async () => {
      const user = {
        id: 'u-1',
        settings: { onboardingStep: OnboardingStep.TIMEZONE },
      } as User;
      mockUsersService.findTelegramUser.mockResolvedValue(user);

      mockCtx.callbackQuery = { data: 'onboard:tz:set:Europe/London' } as any;

      await handler.handleCallbackQuery(mockCtx as Context);

      expect(mockUsersService.updateTimezone).toHaveBeenCalledWith(
        'u-1',
        'Europe/London',
        OnboardingStep.GAMIFICATION,
      );
      expect(mockUiService.editOrReply).toHaveBeenCalledWith(
        mockCtx,
        GAMIFICATION_INTRO_MESSAGE,
        expect.objectContaining({ parse_mode: 'HTML' }),
      );
      expect(mockUiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        mockCtx,
        expect.stringContaining('Europe/London'),
        10000,
      );
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalled();
    });

    it('should edit to manual timezone prompt on onboard:tz:manual_prompt', async () => {
      const user = {
        id: 'u-1',
        settings: { onboardingStep: OnboardingStep.TIMEZONE },
      } as User;
      mockUsersService.findTelegramUser.mockResolvedValue(user);

      mockCtx.callbackQuery = { data: 'onboard:tz:manual_prompt' } as any;

      await handler.handleCallbackQuery(mockCtx as Context);

      expect(mockUsersService.setOnboardingStep).toHaveBeenCalledWith(
        'u-1',
        OnboardingStep.AWAITING_CUSTOM_TIMEZONE,
      );
      expect(mockUiService.editOrReply).toHaveBeenCalledWith(
        mockCtx,
        PROMPT_MANUAL_TIMEZONE_MESSAGE,
        expect.objectContaining({ parse_mode: 'HTML' }),
      );
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalled();
    });

    it('(Req 11 & Step 5) should complete onboarding, edit to main menu in-place, and send temporary confirmation', async () => {
      const user = {
        id: 'u-1',
        displayName: 'John',
        settings: { onboardingStep: OnboardingStep.GAMIFICATION },
      } as User;
      mockUsersService.findTelegramUser.mockResolvedValue(user);
      mockUsersService.completeOnboarding.mockResolvedValue({
        ...user,
        settings: { onboardingCompleted: true } as UserSettings,
      });

      mockCtx.callbackQuery = { data: 'onboard:gamification:complete' } as any;

      await handler.handleCallbackQuery(mockCtx as Context);

      expect(mockUsersService.completeOnboarding).toHaveBeenCalledWith('u-1');
      expect(mockUiService.editOrReply).toHaveBeenCalledWith(
        mockCtx,
        expect.stringContaining('John'),
        expect.objectContaining({ parse_mode: 'HTML' }),
      );
      expect(mockUiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        mockCtx,
        CONFIRM_REGISTRATION_COMPLETED,
        10000,
      );
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalled();
    });

    it('(Req 9) should handle repeated clicks safely if already completed', async () => {
      const completedUser = {
        id: 'u-1',
        displayName: 'John',
        settings: { onboardingCompleted: true },
      } as User;
      mockUsersService.findTelegramUser.mockResolvedValue(completedUser);

      mockCtx.callbackQuery = { data: 'onboard:name:suggested' } as any;

      await handler.handleCallbackQuery(mockCtx as Context);

      expect(mockUsersService.updateDisplayName).not.toHaveBeenCalled();
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalledWith({
        text: 'ثبت‌نام شما قبلاً تکمیل شده است.',
      });
      expect(mockUiService.editOrReply).toHaveBeenCalledWith(
        mockCtx,
        expect.stringContaining('John'),
        expect.anything(),
      );
    });
  });

  describe('Text messages & in-place update (Requirements 4, 7, 12)', () => {
    it('(Req 4) should accept valid custom display name, edit previous prompt to timezone step, and send temporary confirmation', async () => {
      const user = {
        id: 'u-1',
        settings: {
          onboardingStep: OnboardingStep.AWAITING_CUSTOM_NAME,
          onboardingCompleted: false,
        },
      } as User;
      mockUsersService.findTelegramUser.mockResolvedValue(user);

      mockCtx.message = { text: 'Alex Wonder' } as any;

      await handler.handleTextMessage(mockCtx as Context);

      expect(mockUsersService.updateDisplayName).toHaveBeenCalledWith(
        'u-1',
        'Alex Wonder',
        OnboardingStep.TIMEZONE,
      );
      expect(mockUiService.editOrReply).toHaveBeenCalledWith(
        mockCtx,
        TIMEZONE_CONFIRM_MESSAGE,
        expect.objectContaining({ parse_mode: 'HTML' }),
      );
      expect(mockUiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        mockCtx,
        CONFIRM_NAME_UPDATED,
        10000,
      );
    });

    it('(Req 4) should reject invalid custom display name (whitespace only) with temporary error', async () => {
      const user = {
        id: 'u-1',
        settings: {
          onboardingStep: OnboardingStep.AWAITING_CUSTOM_NAME,
          onboardingCompleted: false,
        },
      } as User;
      mockUsersService.findTelegramUser.mockResolvedValue(user);

      mockCtx.message = { text: '    ' } as any;

      await handler.handleTextMessage(mockCtx as Context);

      expect(mockUsersService.updateDisplayName).not.toHaveBeenCalled();
      expect(mockUiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        mockCtx,
        expect.stringContaining('نام نمایشی وارد شده نامعتبر است'),
        10000,
      );
    });

    it('(Req 7) should accept valid manual IANA timezone, edit previous prompt in-place, and send temporary confirmation', async () => {
      const user = {
        id: 'u-1',
        settings: {
          onboardingStep: OnboardingStep.AWAITING_CUSTOM_TIMEZONE,
          onboardingCompleted: false,
        },
      } as User;
      mockUsersService.findTelegramUser.mockResolvedValue(user);

      mockCtx.message = { text: 'Europe/Amsterdam' } as any;

      await handler.handleTextMessage(mockCtx as Context);

      expect(mockUsersService.updateTimezone).toHaveBeenCalledWith(
        'u-1',
        'Europe/Amsterdam',
        OnboardingStep.GAMIFICATION,
      );
      expect(mockUiService.editOrReply).toHaveBeenCalledWith(
        mockCtx,
        GAMIFICATION_INTRO_MESSAGE,
        expect.objectContaining({ parse_mode: 'HTML' }),
      );
      expect(mockUiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        mockCtx,
        expect.stringContaining('Europe/Amsterdam'),
        10000,
      );
    });

    it('(Req 7) should reject invalid manual timezone with temporary error', async () => {
      const user = {
        id: 'u-1',
        settings: {
          onboardingStep: OnboardingStep.AWAITING_CUSTOM_TIMEZONE,
          onboardingCompleted: false,
        },
      } as User;
      mockUsersService.findTelegramUser.mockResolvedValue(user);

      mockCtx.message = { text: '+03:30' } as any;

      await handler.handleTextMessage(mockCtx as Context);

      expect(mockUsersService.updateTimezone).not.toHaveBeenCalled();
      expect(mockUiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        mockCtx,
        expect.stringContaining('شناسه منطقه زمانی نامعتبر است'),
        10000,
      );
    });

    it('(Req 12) should handle unexpected text during button-only steps with temporary warning', async () => {
      const user = {
        id: 'u-1',
        settings: {
          onboardingStep: OnboardingStep.TIMEZONE,
          onboardingCompleted: false,
        },
      } as User;
      mockUsersService.findTelegramUser.mockResolvedValue(user);

      mockCtx.message = { text: 'Hello bot!' } as any;

      await handler.handleTextMessage(mockCtx as Context);

      expect(mockUiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        mockCtx,
        UNEXPECTED_INPUT_MESSAGE,
        5000,
      );
    });
  });

  describe('Settings Management (menu:settings, settings:*)', () => {
    it('should open settings overview on menu:settings callback', async () => {
      const user = {
        id: 'u-sett',
        displayName: 'پوریا',
        settings: {
          timezone: 'Asia/Tehran',
          onboardingCompleted: true,
        },
      } as User;
      mockUsersService.findTelegramUser.mockResolvedValue(user);
      mockCtx.callbackQuery = { data: 'menu:settings' } as any;

      await handler.handleCallbackQuery(mockCtx as Context);

      expect(mockCtx.answerCallbackQuery).toHaveBeenCalled();
      expect(mockUiService.editOrReply).toHaveBeenCalledWith(
        mockCtx,
        expect.stringContaining('تنظیمات حساب کاربری'),
        expect.objectContaining({ parse_mode: 'HTML' }),
      );
    });

    it('should allow user to initiate and submit display name update from settings', async () => {
      const user = {
        id: 'u-sett',
        displayName: 'پوریا',
        settings: {
          timezone: 'Asia/Tehran',
          onboardingCompleted: true,
        },
      } as User;
      mockUsersService.findTelegramUser.mockResolvedValue(user);
      mockUsersService.updateDisplayName.mockResolvedValue({
        ...user,
        displayName: 'علی احمدی',
      });

      // 1. Click edit name
      mockCtx.callbackQuery = { data: 'settings:edit_name' } as any;
      await handler.handleCallbackQuery(mockCtx as Context);

      expect(mockUiService.editOrReply).toHaveBeenCalledWith(
        mockCtx,
        expect.stringContaining('ویرایش نام نمایشی'),
        expect.anything(),
      );

      // 2. Send new name text
      mockCtx.message = { text: 'علی احمدی' } as any;
      (mockCtx as any).deleteMessage = jest.fn().mockResolvedValue(true);

      await handler.handleTextMessage(mockCtx as Context);

      expect(mockUsersService.updateDisplayName).toHaveBeenCalledWith(
        'u-sett',
        'علی احمدی',
        OnboardingStep.COMPLETED,
      );
      expect(mockUiService.sendTemporaryConfirmation).toHaveBeenCalledWith(
        mockCtx,
        expect.stringContaining('نام نمایشی شما با موفقیت بروزرسانی شد'),
        7000,
      );
    });

    it('should allow user to change timezone from settings', async () => {
      const user = {
        id: 'u-sett',
        displayName: 'پوریا',
        settings: {
          timezone: 'Asia/Tehran',
          onboardingCompleted: true,
        },
      } as User;
      mockUsersService.findTelegramUser.mockResolvedValue(user);
      mockUsersService.updateTimezone.mockResolvedValue({
        ...user,
        settings: { ...user.settings, timezone: 'Europe/London' },
      });

      // 1. Open TZ picker
      mockCtx.callbackQuery = { data: 'settings:edit_tz' } as any;
      await handler.handleCallbackQuery(mockCtx as Context);

      expect(mockUiService.editOrReply).toHaveBeenCalledWith(
        mockCtx,
        expect.stringContaining('تغییر منطقه زمانی'),
        expect.anything(),
      );

      // 2. Select TZ
      mockCtx.callbackQuery = {
        data: 'settings:tz:set:Europe/London',
      } as any;
      await handler.handleCallbackQuery(mockCtx as Context);

      expect(mockUsersService.updateTimezone).toHaveBeenCalledWith(
        'u-sett',
        'Europe/London',
        OnboardingStep.COMPLETED,
      );
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Europe/London'),
        }),
      );
    });
  });
});
