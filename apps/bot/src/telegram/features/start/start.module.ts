import { Module } from '@nestjs/common';

import { BotRuntimeModule } from '../../runtime/bot-runtime.module';
import { StartFeature } from './start.feature';
import { StartHandler } from './start.handlers';

@Module({
  imports: [BotRuntimeModule],
  providers: [StartFeature, StartHandler],
})
export class StartModule {}
