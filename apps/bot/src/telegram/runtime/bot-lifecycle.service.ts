import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Bot, Context } from 'grammy';

@Injectable()
export class BotLifecycleService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(BotLifecycleService.name);

  constructor(private readonly bot: Bot<Context>) {}

  onApplicationBootstrap(): void {
    void this.bot.start().catch((error: unknown) => {
      this.logger.error(
        'Telegram bot polling failed',
        error instanceof Error ? error.stack : String(error),
      );
    });

    this.logger.log('Telegram bot polling started');
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.bot.stop();
      this.logger.log('Telegram bot stopped');
    } catch (error: unknown) {
      this.logger.error(
        'Failed to stop Telegram bot',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
