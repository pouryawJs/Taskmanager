import { Test, TestingModule } from '@nestjs/testing';
import { Bot } from 'grammy';
import { BotLifecycleService } from './runtime/bot-lifecycle.service';

describe('BotLifecycleService', () => {
  let service: BotLifecycleService;
  let mockBot: { start: jest.Mock; stop: jest.Mock };

  beforeEach(async () => {
    mockBot = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BotLifecycleService,
        {
          provide: Bot,
          useValue: mockBot,
        },
      ],
    }).compile();

    service = module.get<BotLifecycleService>(BotLifecycleService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should start bot polling on application bootstrap', () => {
    service.onApplicationBootstrap();
    expect(mockBot.start).toHaveBeenCalled();
  });

  it('should stop bot polling on module destroy', async () => {
    await service.onModuleDestroy();
    expect(mockBot.stop).toHaveBeenCalled();
  });
});
