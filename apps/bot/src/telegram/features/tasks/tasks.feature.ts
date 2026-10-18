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
    // 0. Ensure /start cleans up any active task registration session before passing to StartFeature
    this.bot.command('start', async (ctx, next) => {
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

    // 2. Intercept text messages when user has an active task registration session
    this.bot.on('message:text', async (ctx, next) => {
      if (ctx.message?.text?.startsWith('/')) {
        await next();
        return;
      }

      if (this.handler.hasActiveSession(ctx)) {
        await this.handler.handleTextMessage(ctx);
        return;
      }

      await next();
    });

    // 3. Handle non-text messages during active registration session
    this.bot.on('message', async (ctx, next) => {
      if (this.handler.hasActiveSession(ctx) && !ctx.message?.text) {
        this.handler.handleNonTextMessage(ctx);
        return;
      }
      await next();
    });
  }
}
