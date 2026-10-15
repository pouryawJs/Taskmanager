import { Module } from '@nestjs/common';
import { TelegramUiService } from './telegram-ui.service';

@Module({
  providers: [TelegramUiService],
  exports: [TelegramUiService],
})
export class TelegramUiModule {}
