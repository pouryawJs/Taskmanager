import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { TelegramModule } from './telegram/telegram.module';
import { DatabaseModule } from '@app/database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    DatabaseModule,
    TelegramModule,
  ],
})
export class BotModule {}
