import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, Context } from 'grammy';

import { BotLifecycleService } from './bot-lifecycle.service';

@Module({
  providers: [
    {
      provide: Bot,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Bot<Context> => {
        const token = configService.get<string>('TELEGRAM_BOT_TOKEN');

        if (!token) {
          throw new Error('TELEGRAM_BOT_TOKEN is not configured');
        }

        return new Bot<Context>(token);
      },
    },
    BotLifecycleService,
  ],
  exports: [Bot],
})
export class BotRuntimeModule {}
