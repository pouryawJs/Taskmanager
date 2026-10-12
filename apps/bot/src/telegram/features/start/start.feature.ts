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
    this.bot.command('start', (ctx) => this.startHandler.handle(ctx));
  }
}
