import { Context, InputFile } from 'grammy';
import { User, UserSettings } from '@app/database';
import {
  GamificationService,
  GamificationOverview,
  ConsistencyTrendResult,
  UsersService,
} from '@app/core';
import { TelegramUiService } from '../../ui/telegram-ui.service';
import { StartHandler } from './start.handlers';
import { StartFeature } from './start.feature';
import { renderProgressBar } from './start.messages';
import { GamificationChartService } from './gamification-chart.service';

describe('Gamification Telegram UI (Phases 4 & 6)', () => {
  let handler: StartHandler;
  let mockUsersService: jest.Mocked<UsersService>;
  let mockUiService: jest.Mocked<TelegramUiService>;
  let mockGamificationService: jest.Mocked<GamificationService>;
  let mockChartService: jest.Mocked<GamificationChartService>;
  let mockCtx: Partial<Context> & {
    chat: { id: number };
    reply: jest.Mock;
    replyWithPhoto: jest.Mock;
    answerCallbackQuery: jest.Mock;
    callbackQuery?: { data: string; message?: unknown };
  };

  const sampleUser: User = {
    id: 'user-uuid-1',
    telegramId: '12345678',
    displayName: 'پوریا',
    createdAt: new Date(),
    updatedAt: new Date(),
    settings: {
      id: 'settings-1',
      userId: 'user-uuid-1',
      timezone: 'Asia/Tehran',
      onboardingCompleted: true,
      onboardingStep: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as UserSettings,
  } as User;

  const sampleOverview: GamificationOverview = {
    totalXp: 180,
    currentStreak: 4,
    longestStreak: 7,
    lastQualifiedDate: '2026-10-20',
    levelInfo: {
      currentLevel: 2,
      currentLevelXp: 80,
      xpRequiredForNextLevel: 141,
      progressPercentage: 56.7,
      tierTitle: 'شروع‌کننده',
    },
    consistencyScore: {
      score: 85.5,
      isProvisional: false,
      sampleCount: 12,
      completedCount: 10,
      partiallyCompletedCount: 1,
      notCompletedCount: 1,
      skippedCount: 2,
      cancelledCount: 0,
    },
  };

  const sampleTrend: ConsistencyTrendResult = {
    overallScore: 85.5,
    isProvisional: false,
    sampleCount: 12,
    period: 'all',
    buckets: [
      { label: '10/15', score: 80, sampleCount: 3, dateRange: '2026-10-15' },
      { label: '10/16', score: 90, sampleCount: 4, dateRange: '2026-10-16' },
      { label: '10/17', score: 85.5, sampleCount: 5, dateRange: '2026-10-17' },
    ],
  };

  beforeEach(() => {
    mockUsersService = {
      findTelegramUser: jest.fn(),
    } as unknown as jest.Mocked<UsersService>;

    mockUiService = {
      editOrReply: jest.fn().mockResolvedValue(true),
      recordMenuMessage: jest.fn(),
      getMenuMessage: jest.fn(),
      clearMenuMessage: jest.fn(),
      deleteBotMessageSafely: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<TelegramUiService>;

    mockGamificationService = {
      getGamificationOverview: jest.fn().mockResolvedValue(sampleOverview),
      getConsistencyScoreTrend: jest.fn().mockResolvedValue(sampleTrend),
      getUserConsistencyScore: jest.fn(),
      calculateStreakMultiplier: jest.fn().mockReturnValue(1.08),
      calculateLevelMultiplier: jest.fn().mockReturnValue(1.05),
      getRecentPointTransactions: jest.fn().mockResolvedValue([]),
      getTodayCompletedTasksCount: jest.fn().mockResolvedValue(2),
    } as unknown as jest.Mocked<GamificationService>;

    mockChartService = {
      renderConsistencyTrendChart: jest
        .fn()
        .mockResolvedValue(Buffer.from('fake-png-buffer')),
    } as unknown as jest.Mocked<GamificationChartService>;

    handler = new StartHandler(
      mockUsersService,
      mockUiService,
      mockGamificationService,
      mockChartService,
    );

    mockCtx = {
      chat: { id: 1001 },
      from: {
        id: 12345678,
        first_name: 'Pourya',
        is_bot: false,
      },
      reply: jest.fn().mockResolvedValue({ message_id: 1 }),
      replyWithPhoto: jest.fn().mockResolvedValue({ message_id: 2 }),
      answerCallbackQuery: jest.fn().mockResolvedValue(true),
    };
  });

  describe('renderProgressBar', () => {
    it('should render 0% correctly with full empty blocks', () => {
      expect(renderProgressBar(0, 10)).toBe('░░░░░░░░░░ 0%');
    });

    it('should render 40% with 4 filled and 6 empty blocks', () => {
      expect(renderProgressBar(40, 10)).toBe('▓▓▓▓░░░░░░ 40%');
    });

    it('should render 100% with full filled blocks', () => {
      expect(renderProgressBar(100, 10)).toBe('▓▓▓▓▓▓▓▓▓▓ 100%');
    });

    it('should clamp values outside 0-100 range and handle non-finite numbers', () => {
      expect(renderProgressBar(-10, 10)).toBe('░░░░░░░░░░ 0%');
      expect(renderProgressBar(120, 10)).toBe('▓▓▓▓▓▓▓▓▓▓ 100%');
      expect(renderProgressBar(NaN, 10)).toBe('░░░░░░░░░░ 0%');
    });
  });

  describe('Opening Profile Card via Callback (menu:gamification)', () => {
    it('should render photo profile card with level, tier, XP, streak and consistency score in Persian', async () => {
      mockUsersService.findTelegramUser.mockResolvedValueOnce(sampleUser);
      mockCtx.callbackQuery = {
        data: 'menu:gamification',
        message: { message_id: 99 },
      };

      await handler.handleCallbackQuery(mockCtx as Context);

      expect(mockUsersService.findTelegramUser).toHaveBeenCalledWith(
        '12345678',
      );
      expect(
        mockGamificationService.getGamificationOverview,
      ).toHaveBeenCalledWith(sampleUser.id);
      expect(
        mockGamificationService.getConsistencyScoreTrend,
      ).toHaveBeenCalledWith(sampleUser.id, 'all');
      expect(mockChartService.renderConsistencyTrendChart).toHaveBeenCalledWith(
        sampleTrend,
      );

      expect(mockCtx.replyWithPhoto).toHaveBeenCalledWith(
        expect.any(InputFile),
        expect.objectContaining({
          parse_mode: 'HTML',
          caption: expect.stringContaining('🏆 <b>پروفایل و روند پایداری</b>'),
          reply_markup: expect.anything(),
        }),
      );

      const caption = mockCtx.replyWithPhoto.mock.calls[0][1].caption;
      expect(caption).toContain('سطح 2 (شروع‌کننده)');
      expect(caption).toContain('پیشرفت سطح: <b>80 از 141 XP</b>');
      expect(caption).toContain('▓▓▓▓▓▓░░░░ 57%');
      expect(caption).toContain('🔥 زنجیرهٔ استمرار: <b>4 روز</b>');
      expect(caption).toContain('📊 شاخص پایداری: <b>85.5%</b>');
      expect(caption).not.toContain('شاخص موقت');

      // Previous message should be deleted safely
      expect(mockUiService.deleteBotMessageSafely).toHaveBeenCalledWith(
        mockCtx,
        1001,
        99,
      );
      // New message should be recorded
      expect(mockUiService.recordMenuMessage).toHaveBeenCalledWith(1001, 2);
    });

    it('should fall back to editOrReply text message if chart rendering fails', async () => {
      mockUsersService.findTelegramUser.mockResolvedValueOnce(sampleUser);
      mockChartService.renderConsistencyTrendChart.mockRejectedValueOnce(
        new Error('Canvas render failed'),
      );
      mockCtx.callbackQuery = { data: 'menu:gamification' };

      await handler.handleCallbackQuery(mockCtx as Context);

      expect(mockUiService.editOrReply).toHaveBeenCalledWith(
        mockCtx,
        expect.stringContaining('🏆 <b>پروفایل و وضعیت پیشرفت</b>'),
        expect.objectContaining({
          parse_mode: 'HTML',
          reply_markup: expect.anything(),
        }),
      );
      expect(mockCtx.replyWithPhoto).not.toHaveBeenCalled();
    });
  });

  describe('Opening Profile Card via Command (/profile and /stats)', () => {
    it('should handle /profile command and send photo profile', async () => {
      mockUsersService.findTelegramUser.mockResolvedValueOnce(sampleUser);

      await handler.handleProfileCommand(mockCtx as Context);

      expect(mockUsersService.findTelegramUser).toHaveBeenCalledWith(
        '12345678',
      );
      expect(
        mockGamificationService.getGamificationOverview,
      ).toHaveBeenCalledWith(sampleUser.id);
      expect(mockCtx.replyWithPhoto).toHaveBeenCalledWith(
        expect.any(InputFile),
        expect.objectContaining({
          caption: expect.stringContaining('سطح 2 (شروع‌کننده)'),
        }),
      );
    });

    it('should register /profile and /stats commands in StartFeature onModuleInit', () => {
      const mockBot = {
        command: jest.fn(),
        on: jest.fn(),
      } as unknown as Parameters<typeof StartFeature.prototype.constructor>[0];

      const feature = new StartFeature(mockBot, handler);
      feature.onModuleInit();

      expect(mockBot.command).toHaveBeenCalledWith(
        'profile',
        expect.any(Function),
      );
      expect(mockBot.command).toHaveBeenCalledWith(
        'stats',
        expect.any(Function),
      );
    });
  });

  describe('Provisional Consistency Score Handling', () => {
    it('should append provisional notice in caption when isProvisional is true', async () => {
      const provisionalTrend: ConsistencyTrendResult = {
        ...sampleTrend,
        isProvisional: true,
        sampleCount: 3,
        overallScore: 60.0,
      };

      mockUsersService.findTelegramUser.mockResolvedValueOnce(sampleUser);
      mockGamificationService.getConsistencyScoreTrend.mockResolvedValueOnce(
        provisionalTrend,
      );
      mockCtx.callbackQuery = { data: 'menu:gamification' };

      await handler.handleCallbackQuery(mockCtx as Context);

      const caption = mockCtx.replyWithPhoto.mock.calls[0][1].caption;
      expect(caption).toContain(
        '📊 شاخص پایداری: <b>60%</b>\n<i>(شاخص موقت — حداقل ۵ تسک نیاز است)</i>',
      );
    });
  });

  describe('Date Range Filtering (gam:range:7d, 30d, all)', () => {
    it('should fetch trend with 7d and delete previous photo message', async () => {
      mockUsersService.findTelegramUser.mockResolvedValueOnce(sampleUser);
      mockCtx.callbackQuery = {
        data: 'gam:range:7d',
        message: { message_id: 15 },
      };

      await handler.handleCallbackQuery(mockCtx as Context);

      expect(mockCtx.answerCallbackQuery).toHaveBeenCalled();
      expect(
        mockGamificationService.getConsistencyScoreTrend,
      ).toHaveBeenCalledWith(sampleUser.id, '7d');

      expect(mockUiService.deleteBotMessageSafely).toHaveBeenCalledWith(
        mockCtx,
        1001,
        15,
      );
      expect(mockCtx.replyWithPhoto).toHaveBeenCalledWith(
        expect.any(InputFile),
        expect.objectContaining({
          caption: expect.stringContaining('(۷ روز اخیر)'),
        }),
      );
    });

    it('should fetch trend with 30d period', async () => {
      mockUsersService.findTelegramUser.mockResolvedValueOnce(sampleUser);
      mockCtx.callbackQuery = { data: 'gam:range:30d' };

      await handler.handleCallbackQuery(mockCtx as Context);

      expect(
        mockGamificationService.getConsistencyScoreTrend,
      ).toHaveBeenCalledWith(sampleUser.id, '30d');
      expect(mockCtx.replyWithPhoto).toHaveBeenCalledWith(
        expect.any(InputFile),
        expect.objectContaining({
          caption: expect.stringContaining('(۳۰ روز اخیر)'),
        }),
      );
    });

    it('should fetch all-time consistency trend for gam:range:all', async () => {
      mockUsersService.findTelegramUser.mockResolvedValueOnce(sampleUser);
      mockCtx.callbackQuery = { data: 'gam:range:all' };

      await handler.handleCallbackQuery(mockCtx as Context);

      expect(
        mockGamificationService.getConsistencyScoreTrend,
      ).toHaveBeenCalledWith(sampleUser.id, 'all');
      expect(mockCtx.replyWithPhoto).toHaveBeenCalledWith(
        expect.any(InputFile),
        expect.objectContaining({
          caption: expect.stringContaining('(کل دوره)'),
        }),
      );
    });
  });

  describe('Unauthorized or Unregistered User Requests', () => {
    it('should alert unregistered user on callback query', async () => {
      mockUsersService.findTelegramUser.mockResolvedValueOnce(null);
      mockCtx.callbackQuery = { data: 'menu:gamification' };

      await handler.handleCallbackQuery(mockCtx as Context);

      expect(mockCtx.answerCallbackQuery).toHaveBeenCalledWith({
        text: 'لطفاً ابتدا ربات را با دستور /start آغاز کنید.',
        show_alert: true,
      });
      expect(mockCtx.replyWithPhoto).not.toHaveBeenCalled();
      expect(mockUiService.editOrReply).not.toHaveBeenCalled();
    });

    it('should reply with registration instruction when /profile received from unregistered user', async () => {
      mockUsersService.findTelegramUser.mockResolvedValueOnce(null);

      await handler.handleProfileCommand(mockCtx as Context);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        'لطفاً ابتدا ربات را با دستور /start آغاز کنید.',
      );
      expect(mockCtx.replyWithPhoto).not.toHaveBeenCalled();
      expect(mockUiService.editOrReply).not.toHaveBeenCalled();
    });

    it('should ignore /profile command when sender context is missing', async () => {
      delete mockCtx.from;

      await handler.handleProfileCommand(mockCtx as Context);

      expect(mockUsersService.findTelegramUser).not.toHaveBeenCalled();
      expect(mockCtx.reply).not.toHaveBeenCalled();
      expect(mockCtx.replyWithPhoto).not.toHaveBeenCalled();
    });
  });

  describe('Level & XP Progression View (gam:view:level)', () => {
    it('should render detailed level progress, formulas, multipliers, and recent transactions', async () => {
      mockUsersService.findTelegramUser.mockResolvedValueOnce(sampleUser);
      mockGamificationService.getRecentPointTransactions.mockResolvedValueOnce([
        {
          id: 'tx-1',
          userId: sampleUser.id,
          pointsDelta: 10,
          reason: 'task_completion',
          createdAt: new Date('2026-10-21T10:00:00Z'),
          taskOccurrence: {
            task: { title: 'ورزش صبحگاهی' },
          },
        } as unknown as PointTransaction,
      ]);

      mockCtx.callbackQuery = {
        data: 'gam:view:level',
        message: { message_id: 88, photo: [{ file_id: 'photo-1' }] },
      };

      await handler.handleCallbackQuery(mockCtx as Context);

      expect(mockCtx.answerCallbackQuery).toHaveBeenCalled();
      expect(
        mockGamificationService.getGamificationOverview,
      ).toHaveBeenCalledWith(sampleUser.id);
      expect(
        mockGamificationService.getRecentPointTransactions,
      ).toHaveBeenCalledWith(sampleUser.id, 5);

      // Photo cleanup should have been executed
      expect(mockUiService.deleteBotMessageSafely).toHaveBeenCalledWith(
        mockCtx,
        1001,
        88,
      );

      expect(mockUiService.editOrReply).toHaveBeenCalledWith(
        mockCtx,
        expect.stringContaining('🎖 <b>جزئیات سطح و امتیازات (XP)</b>'),
        expect.objectContaining({
          parse_mode: 'HTML',
          reply_markup: expect.anything(),
        }),
      );

      const message = mockUiService.editOrReply.mock.calls[0][1];
      expect(message).toContain('سطح 2 (شروع‌کننده)');
      expect(message).toContain(
        'مجموع امتیازات کل: <b>180 XP</b> (در طول عمر حساب)',
      );
      expect(message).toContain('پیشرفت در سطح فعلی: <b>80 از 141 XP</b>');
      expect(message).toContain('ضریب پیشرفت سطح: <b>1.05x</b>');
      expect(message).toContain('ضریب زنجیره استمرار: <b>1.08x</b>');
      expect(message).toContain('ورزش صبحگاهی');
    });
  });

  describe('Activity & Consistency Deep-Dive View (gam:view:activity, gam:act:*)', () => {
    it('should render activity breakdown and today streak qualification progress for all-time', async () => {
      mockUsersService.findTelegramUser.mockResolvedValueOnce(sampleUser);
      mockCtx.callbackQuery = {
        data: 'gam:view:activity',
        message: { message_id: 89, photo: [{ file_id: 'photo-1' }] },
      };

      await handler.handleCallbackQuery(mockCtx as Context);

      expect(mockCtx.answerCallbackQuery).toHaveBeenCalled();
      expect(
        mockGamificationService.getConsistencyScoreTrend,
      ).toHaveBeenCalledWith(sampleUser.id, 'all');
      expect(
        mockGamificationService.getTodayCompletedTasksCount,
      ).toHaveBeenCalledWith(sampleUser.id);

      expect(mockUiService.editOrReply).toHaveBeenCalledWith(
        mockCtx,
        expect.stringContaining(
          '📊 <b>تحلیل عملکرد و پایداری</b> (کل تاریخچه)',
        ),
        expect.objectContaining({
          parse_mode: 'HTML',
          reply_markup: expect.anything(),
        }),
      );

      const message = mockUiService.editOrReply.mock.calls[0][1];
      expect(message).toContain('شاخص پایداری:</b> <b>85.5%</b>');
      expect(message).toContain('کامل‌شده: <b>10</b>');
      expect(message).toContain('بخشی انجام‌شده: <b>1</b>');
      expect(message).toContain('انجام‌نشده / منقضی: <b>1</b>');
      expect(message).toContain('2 از ۳ تسک لازم');
    });

    it('should filter activity view by 7d timeframe on gam:act:7d', async () => {
      mockUsersService.findTelegramUser.mockResolvedValueOnce(sampleUser);
      mockCtx.callbackQuery = { data: 'gam:act:7d' };

      await handler.handleCallbackQuery(mockCtx as Context);

      expect(
        mockGamificationService.getConsistencyScoreTrend,
      ).toHaveBeenCalledWith(sampleUser.id, '7d');
      expect(mockUiService.editOrReply).toHaveBeenCalledWith(
        mockCtx,
        expect.stringContaining('(۷ روز اخیر)'),
        expect.anything(),
      );
    });

    it('should filter activity view by 30d timeframe on gam:act:30d', async () => {
      mockUsersService.findTelegramUser.mockResolvedValueOnce(sampleUser);
      mockCtx.callbackQuery = { data: 'gam:act:30d' };

      await handler.handleCallbackQuery(mockCtx as Context);

      expect(
        mockGamificationService.getConsistencyScoreTrend,
      ).toHaveBeenCalledWith(sampleUser.id, '30d');
      expect(mockUiService.editOrReply).toHaveBeenCalledWith(
        mockCtx,
        expect.stringContaining('(۳۰ روز اخیر)'),
        expect.anything(),
      );
    });
  });

  describe('Navigation & Back Button', () => {
    it('should navigate back to main menu on task:back:to_menu callback', async () => {
      mockUsersService.findTelegramUser.mockResolvedValueOnce(sampleUser);
      mockCtx.callbackQuery = { data: 'task:back:to_menu' };

      await handler.handleCallbackQuery(mockCtx as Context);

      expect(mockCtx.answerCallbackQuery).toHaveBeenCalled();
      expect(mockUiService.editOrReply).toHaveBeenCalledWith(
        mockCtx,
        expect.stringContaining('به منوی اصلی ربات مدیریت تسک خوش آمدید'),
        expect.objectContaining({
          parse_mode: 'HTML',
          reply_markup: expect.anything(),
        }),
      );
    });

    it('should navigate back to profile on gam:back:profile callback', async () => {
      mockUsersService.findTelegramUser.mockResolvedValueOnce(sampleUser);
      mockCtx.callbackQuery = {
        data: 'gam:back:profile',
        message: { message_id: 77 },
      };

      await handler.handleCallbackQuery(mockCtx as Context);

      expect(mockCtx.answerCallbackQuery).toHaveBeenCalled();
      expect(mockChartService.renderConsistencyTrendChart).toHaveBeenCalledWith(
        sampleTrend,
      );
      expect(mockCtx.replyWithPhoto).toHaveBeenCalledWith(
        expect.any(InputFile),
        expect.objectContaining({
          caption: expect.stringContaining('🏆 <b>پروفایل و روند پایداری</b>'),
        }),
      );
    });
  });
});
