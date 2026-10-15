import { Context, GrammyError } from 'grammy';
import { TelegramUiService } from './telegram-ui.service';

describe('TelegramUiService', () => {
  let service: TelegramUiService;
  let mockCtx: Partial<Context> & {
    chat: { id: number };
    reply: jest.Mock;
    editMessageText: jest.Mock;
    api: {
      editMessageText: jest.Mock;
      deleteMessage: jest.Mock;
    };
  };

  beforeEach(() => {
    jest.useFakeTimers();
    service = new TelegramUiService();

    mockCtx = {
      chat: { id: 1001 },
      reply: jest.fn().mockResolvedValue({ message_id: 42 }),
      editMessageText: jest.fn().mockResolvedValue(true),
      api: {
        editMessageText: jest.fn().mockResolvedValue(true),
        deleteMessage: jest.fn().mockResolvedValue(true),
      },
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('editOrReply', () => {
    it('should edit message via ctx.editMessageText when callbackQuery message is present', async () => {
      mockCtx.callbackQuery = {
        message: { message_id: 10, chat: { id: 1001 } },
      } as any;

      await service.editOrReply(mockCtx as Context, 'Updated Text');

      expect(mockCtx.editMessageText).toHaveBeenCalledWith(
        'Updated Text',
        undefined,
      );
      expect(mockCtx.reply).not.toHaveBeenCalled();
      expect(service.getMenuMessage(1001)).toBe(10);
    });

    it('should handle "message is not modified" error gracefully and not send fallback reply', async () => {
      mockCtx.callbackQuery = {
        message: { message_id: 10, chat: { id: 1001 } },
      } as any;

      const grammyError = new GrammyError(
        "Call to 'editMessageText' failed! (400: Bad Request: message is not modified)",
        {
          ok: false,
          error_code: 400,
          description: 'Bad Request: message is not modified',
        },
        'editMessageText',
        {},
      );
      mockCtx.editMessageText.mockRejectedValue(grammyError);

      const result = await service.editOrReply(mockCtx as Context, 'Same Text');

      expect(result).toBe(true);
      expect(mockCtx.reply).not.toHaveBeenCalled();
    });

    it('should fall back to reply when editing fails with unexpected error', async () => {
      mockCtx.callbackQuery = {
        message: { message_id: 10, chat: { id: 1001 } },
      } as any;
      mockCtx.editMessageText.mockRejectedValue(
        new Error('Message to edit not found'),
      );

      await service.editOrReply(mockCtx as Context, 'Fallback Text');

      expect(mockCtx.reply).toHaveBeenCalledWith('Fallback Text', undefined);
      expect(service.getMenuMessage(1001)).toBe(42);
    });

    it('should edit via api.editMessageText when target message is recorded and no callbackQuery', async () => {
      service.recordMenuMessage(1001, 77);

      await service.editOrReply(mockCtx as Context, 'Edited via API');

      expect(mockCtx.api.editMessageText).toHaveBeenCalledWith(
        1001,
        77,
        'Edited via API',
        undefined,
      );
      expect(mockCtx.reply).not.toHaveBeenCalled();
    });

    it('should reply when no callback query or recorded message exists', async () => {
      await service.editOrReply(mockCtx as Context, 'Fresh Menu');

      expect(mockCtx.reply).toHaveBeenCalledWith('Fresh Menu', undefined);
      expect(service.getMenuMessage(1001)).toBe(42);
    });
  });

  describe('sendTemporaryConfirmation & auto-deletion', () => {
    it('should send confirmation and schedule deletion after ~10 seconds', async () => {
      const result = await service.sendTemporaryConfirmation(
        mockCtx as Context,
        '✅ Operation succeeded',
        10000,
      );

      expect(result).toEqual({ message_id: 42 });
      expect(mockCtx.reply).toHaveBeenCalledWith('✅ Operation succeeded', {
        parse_mode: 'HTML',
      });

      // Deletion should NOT have been called immediately
      expect(mockCtx.api.deleteMessage).not.toHaveBeenCalled();

      // Fast-forward 10 seconds
      jest.advanceTimersByTime(10000);
      await Promise.resolve();

      expect(mockCtx.api.deleteMessage).toHaveBeenCalledWith(1001, 42);
    });

    it('should handle deletion failure gracefully without throwing or crashing', async () => {
      mockCtx.api.deleteMessage.mockRejectedValue(
        new Error('Message already deleted'),
      );

      await service.sendTemporaryConfirmation(
        mockCtx as Context,
        '✅ Test',
        10000,
      );

      // Fast-forward 10 seconds
      expect(() => {
        jest.advanceTimersByTime(10000);
      }).not.toThrow();
    });
  });

  describe('Menu message tracking', () => {
    it('should store and clear menu message IDs', () => {
      service.recordMenuMessage(123, 456);
      expect(service.getMenuMessage(123)).toBe(456);

      service.clearMenuMessage(123);
      expect(service.getMenuMessage(123)).toBeUndefined();
    });
  });
});
