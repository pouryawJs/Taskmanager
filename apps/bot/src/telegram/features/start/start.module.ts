import { Module } from '@nestjs/common';
import { UsersModule } from '@app/core';

import { BotRuntimeModule } from '../../runtime/bot-runtime.module';
import { TelegramUiModule } from '../../ui/telegram-ui.module';
import { StartFeature } from './start.feature';
import { StartHandler } from './start.handlers';

@Module({
  imports: [BotRuntimeModule, UsersModule, TelegramUiModule],
  providers: [StartFeature, StartHandler],
})
export class StartModule {}
