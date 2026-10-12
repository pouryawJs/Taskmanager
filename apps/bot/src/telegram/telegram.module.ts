import { Module } from '@nestjs/common';

import { BotRuntimeModule } from './runtime/bot-runtime.module';
import { StartModule } from './features/start/start.module';

@Module({
  imports: [BotRuntimeModule, StartModule],
})
export class TelegramModule {}
