import { Module } from '@nestjs/common';
import { UsersModule, TasksModule } from '@app/core';

import { BotRuntimeModule } from '../../runtime/bot-runtime.module';
import { TelegramUiModule } from '../../ui/telegram-ui.module';
import { TaskRegistrationStateService } from './task-registration.state';
import { TaskEditStateService } from './task-edit.state';
import { TaskRegistrationHandler } from './task-registration.handlers';
import { TasksFeature } from './tasks.feature';
import { TaskSchedulerService } from './task-scheduler.service';

@Module({
  imports: [BotRuntimeModule, UsersModule, TasksModule, TelegramUiModule],
  providers: [
    TaskRegistrationStateService,
    TaskEditStateService,
    TaskRegistrationHandler,
    TasksFeature,
    TaskSchedulerService,
  ],
  exports: [
    TaskRegistrationStateService,
    TaskEditStateService,
    TaskRegistrationHandler,
    TaskSchedulerService,
  ],
})
export class TasksBotModule {}
