import { Injectable, Logger } from '@nestjs/common';
import type { Context } from 'grammy';

import { START_MESSAGE } from './start.messages';
import { startKeyboard } from './start.keyboards';

@Injectable()
export class StartHandler {
  private readonly logger = new Logger(StartHandler.name);

  async handle(ctx: Context): Promise<void> {
    if (!ctx.from) {
      this.logger.warn('Received /start without sender information');
      return;
    }

    await ctx.reply(START_MESSAGE, {
      parse_mode: 'HTML',
      reply_markup: startKeyboard,
    });
  }
}
