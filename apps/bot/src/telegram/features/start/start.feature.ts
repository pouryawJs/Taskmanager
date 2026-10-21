import { Injectable, OnModuleInit } from '@nestjs/common';
import { Bot, Context } from 'grammy';

import { StartHandler } from './start.handlers';

@Injectable()
export class StartFeature implements OnModuleInit {
  constructor(
    private readonly bot: Bot<Context>,
    private readonly startHandler: StartHandler,
  ) {}

  onModuleInit(): void {
    this.bot.command('start', (ctx) => this.startHandler.handleStart(ctx));
    this.bot.command('profile', (ctx) =>
      this.startHandler.handleProfileCommand(ctx),
    );
    this.bot.command('stats', (ctx) =>
      this.startHandler.handleProfileCommand(ctx),
    );
    this.bot.on('callback_query:data', (ctx, next) =>
      this.startHandler.handleCallbackQuery(ctx, next),
    );
    this.bot.on('message:text', (ctx, next) =>
      this.startHandler.handleTextMessage(ctx, next),
    );
  }
}
