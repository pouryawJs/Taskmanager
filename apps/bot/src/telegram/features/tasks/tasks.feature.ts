import { Injectable, OnModuleInit } from '@nestjs/common';
import { Bot, Context } from 'grammy';
import { TaskRegistrationHandler } from './task-registration.handlers';

@Injectable()
export class TasksFeature implements OnModuleInit {
  constructor(
    private readonly bot: Bot<Context>,
    private readonly handler: TaskRegistrationHandler,
  ) {}

  onModuleInit(): void {
    // 0. Ensure /start, /profile, and /stats clean up any active task registration session before passing to StartFeature
    this.bot.command(['start', 'profile', 'stats'], async (ctx, next) => {
      if (ctx.from) {
        this.handler.clearSession(String(ctx.from.id));
      }
      await next();
    });

    // 1. Intercept task registration callbacks
    this.bot.on('callback_query:data', async (ctx, next) => {
      const data = ctx.callbackQuery?.data;
      if (
        data === 'menu:create_task' ||
        data === 'menu:list_tasks' ||
        (data && data.startsWith('task:'))
      ) {
        await this.handler.handleCallbackQuery(ctx);
        return;
      }
      await next();
    });

    // 2. Intercept text messages when user has an active task registration session or edit session
    this.bot.on('message:text', async (ctx, next) => {
      if (ctx.message?.text?.startsWith('/start')) {
        await next();
        return;
      }

      const text = ctx.message?.text?.trim();
      const isPersistentShortcut =
        text === 'منوی اصلی' ||
        text === 'پروفایل' ||
        text === 'وضعیت پیشرفت و امتیازات' ||
        text === '🏆 وضعیت پیشرفت و امتیازات' ||
        text === 'وضعیت پیشرفت و امتیاز ها' ||
        text === '🏆 وضعیت پیشرفت و امتیاز ها';

      if (isPersistentShortcut) {
        if (ctx.from) {
          this.handler.clearSession(String(ctx.from.id));
        }
        await next();
        return;
      }

      if (this.handler.hasActiveSession(ctx)) {
        if (ctx.message?.text?.startsWith('/')) {
          await next();
          return;
        }
        await this.handler.handleTextMessage(ctx);
        return;
      }

      if (this.handler.hasActiveEditSession(ctx)) {
        await this.handler.handleEditTextInput(ctx);
        return;
      }

      await next();
    });

    // 3. Handle non-text messages during active registration session or edit session
    this.bot.on('message', async (ctx, next) => {
      if (
        (this.handler.hasActiveSession(ctx) ||
          this.handler.hasActiveEditSession(ctx)) &&
        !ctx.message?.text
      ) {
        this.handler.handleNonTextMessage(ctx);
        return;
      }
      await next();
    });
  }
}
