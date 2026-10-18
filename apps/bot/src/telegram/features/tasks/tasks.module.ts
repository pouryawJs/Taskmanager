import { Module } from '@nestjs/common';
import { UsersModule, TasksModule } from '@app/core';

import { BotRuntimeModule } from '../../runtime/bot-runtime.module';
import { TelegramUiModule } from '../../ui/telegram-ui.module';
import { TaskRegistrationStateService } from './task-registration.state';
import { TaskRegistrationHandler } from './task-registration.handlers';
import { TasksFeature } from './tasks.feature';

@Module({
  imports: [BotRuntimeModule, UsersModule, TasksModule, TelegramUiModule],
  providers: [
    TaskRegistrationStateService,
    TaskRegistrationHandler,
    TasksFeature,
  ],
  exports: [TaskRegistrationStateService, TaskRegistrationHandler],
})
export class TasksBotModule {}
