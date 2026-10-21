import { Module } from '@nestjs/common';
import { GamificationModule, UsersModule } from '@app/core';

import { BotRuntimeModule } from '../../runtime/bot-runtime.module';
import { TelegramUiModule } from '../../ui/telegram-ui.module';
import { StartFeature } from './start.feature';
import { StartHandler } from './start.handlers';
import { GamificationChartService } from './gamification-chart.service';

@Module({
  imports: [
    BotRuntimeModule,
    UsersModule,
    TelegramUiModule,
    GamificationModule,
  ],
  providers: [StartFeature, StartHandler, GamificationChartService],
  exports: [GamificationChartService],
})
export class StartModule {}
