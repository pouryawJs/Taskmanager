import { Module } from '@nestjs/common';

import { BotRuntimeModule } from './runtime/bot-runtime.module';
import { TasksBotModule } from './features/tasks/tasks.module';
import { StartModule } from './features/start/start.module';

@Module({
  imports: [BotRuntimeModule, TasksBotModule, StartModule],
})
export class TelegramModule {}
