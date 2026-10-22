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

    it('Requirement 1: edits regular text message successfully without sending duplicate message', async () => {
      mockCtx.callbackQuery = {
        message: { message_id: 10, text: 'Old Text', chat: { id: 1001 } },
      } as any;

      await service.editOrReply(mockCtx as Context, 'Updated Text');

      expect(mockCtx.editMessageText).toHaveBeenCalledWith(
        'Updated Text',
        undefined,
      );
      expect(mockCtx.reply).not.toHaveBeenCalled();
      expect(mockCtx.api.deleteMessage).not.toHaveBeenCalled();
      expect(service.getMenuMessage(1001)).toBe(10);
    });

    it('Requirement 2 & 3: replaces incompatible media message (e.g. photo with chart) and deletes obsolete message', async () => {
      mockCtx.callbackQuery = {
        message: {
          message_id: 146,
          photo: [{ file_id: 'photo-1' }],
          caption: 'Consistency Chart',
          chat: { id: 1001 },
        },
      } as any;

      const result = await service.editOrReply(
        mockCtx as Context,
        'Main Menu Content',
      );

      // Does not call editMessageText since it is known to be media
      expect(mockCtx.editMessageText).not.toHaveBeenCalled();
      // Sends new replacement message
      expect(mockCtx.reply).toHaveBeenCalledWith(
        'Main Menu Content',
        undefined,
      );
      // Deletes obsolete photo message 146
      expect(mockCtx.api.deleteMessage).toHaveBeenCalledWith(1001, 146);
      // New message 42 is recorded
      expect(service.getMenuMessage(1001)).toBe(42);
      expect(result).toEqual({ message_id: 42 });
    });

    it('Requirement 2b: handles "there is no text in the message to edit" error from Telegram API safely with replacement', async () => {
      mockCtx.callbackQuery = {
        message: { message_id: 146, chat: { id: 1001 } },
      } as any;

      const grammyError = new GrammyError(
        "Call to 'editMessageText' failed! (400: Bad Request: there is no text in the message to edit)",
        {
          ok: false,
          error_code: 400,
          description: 'Bad Request: there is no text in the message to edit',
        },
        'editMessageText',
        {},
      );
      mockCtx.editMessageText.mockRejectedValue(grammyError);

      const result = await service.editOrReply(
        mockCtx as Context,
        'Main Menu Content',
      );

      expect(mockCtx.reply).toHaveBeenCalledWith(
        'Main Menu Content',
        undefined,
      );
      expect(mockCtx.api.deleteMessage).toHaveBeenCalledWith(1001, 146);
      expect(service.getMenuMessage(1001)).toBe(42);
      expect(result).toEqual({ message_id: 42 });
    });

    it('Requirement 4: failure to delete old message does not prevent the replacement message from being sent', async () => {
      mockCtx.callbackQuery = {
        message: {
          message_id: 146,
          photo: [{ file_id: 'photo-1' }],
          chat: { id: 1001 },
        },
      } as any;
      mockCtx.api.deleteMessage.mockRejectedValue(
        new Error('400: Bad Request: message to delete not found'),
      );

      const result = await service.editOrReply(
        mockCtx as Context,
        'Main Menu Content',
      );

      expect(mockCtx.reply).toHaveBeenCalledWith(
        'Main Menu Content',
        undefined,
      );
      expect(service.getMenuMessage(1001)).toBe(42);
      expect(result).toEqual({ message_id: 42 });
    });

    it('Requirement 5: expected edit limitations do not emit warning logs', async () => {
      const warnSpy = jest.spyOn((service as any).logger, 'warn');

      // Case A: Media message
      mockCtx.callbackQuery = {
        message: {
          message_id: 146,
          photo: [{ file_id: 'photo-1' }],
          chat: { id: 1001 },
        },
      } as any;
      await service.editOrReply(mockCtx as Context, 'Menu Text');

      // Case B: No text error
      const grammyErrorNoText = new GrammyError(
        "Call to 'editMessageText' failed! (400: Bad Request: there is no text in the message to edit)",
        {
          ok: false,
          error_code: 400,
          description: 'Bad Request: there is no text in the message to edit',
        },
        'editMessageText',
        {},
      );
      mockCtx.callbackQuery = {
        message: { message_id: 147, chat: { id: 1001 } },
      } as any;
      mockCtx.editMessageText.mockRejectedValueOnce(grammyErrorNoText);
      await service.editOrReply(mockCtx as Context, 'Menu Text');

      // Case C: Message not found
      const grammyErrorNotFound = new GrammyError(
        "Call to 'editMessageText' failed! (400: Bad Request: message to edit not found)",
        {
          ok: false,
          error_code: 400,
          description: 'Bad Request: message to edit not found',
        },
        'editMessageText',
        {},
      );
      mockCtx.callbackQuery = {
        message: { message_id: 148, chat: { id: 1001 } },
      } as any;
      mockCtx.editMessageText.mockRejectedValueOnce(grammyErrorNotFound);
      await service.editOrReply(mockCtx as Context, 'Menu Text');

      // Case D: Message is not modified
      const grammyErrorNotModified = new GrammyError(
        "Call to 'editMessageText' failed! (400: Bad Request: message is not modified)",
        {
          ok: false,
          error_code: 400,
          description: 'Bad Request: message is not modified',
        },
        'editMessageText',
        {},
      );
      mockCtx.callbackQuery = {
        message: { message_id: 149, chat: { id: 1001 } },
      } as any;
      mockCtx.editMessageText.mockRejectedValueOnce(grammyErrorNotModified);
      await service.editOrReply(mockCtx as Context, 'Menu Text');

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('Requirement 6: unexpected edit failures retain diagnostics and follow intended error handling path', async () => {
      const warnSpy = jest.spyOn((service as any).logger, 'warn');
      mockCtx.callbackQuery = {
        message: { message_id: 10, chat: { id: 1001 } },
      } as any;
      mockCtx.editMessageText.mockRejectedValue(
        new Error('502 Bad Gateway: Telegram server connection timeout'),
      );

      const result = await service.editOrReply(
        mockCtx as Context,
        'Fallback Text',
      );

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('502 Bad Gateway'),
      );
      expect(mockCtx.reply).toHaveBeenCalledWith('Fallback Text', undefined);
      expect(mockCtx.api.deleteMessage).toHaveBeenCalledWith(1001, 10);
      expect(result).toEqual({ message_id: 42 });
    });

    it('Requirement 7: replacement message preserves intended options and keyboard', async () => {
      mockCtx.callbackQuery = {
        message: {
          message_id: 146,
          photo: [{ file_id: 'photo-1' }],
          chat: { id: 1001 },
        },
      } as any;
      const options = {
        parse_mode: 'HTML' as const,
        reply_markup: {
          inline_keyboard: [[{ text: 'Home', callback_data: 'home' }]],
        },
      };

      await service.editOrReply(
        mockCtx as Context,
        'Menu with Keyboard',
        options,
      );

      expect(mockCtx.reply).toHaveBeenCalledWith('Menu with Keyboard', options);
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

    it('should delete old menu message and send fresh reply when "message is not modified" occurs without callbackQuery (e.g. on /start)', async () => {
      service.recordMenuMessage(1001, 77);

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
      mockCtx.api.editMessageText.mockRejectedValue(grammyError);

      const result = await service.editOrReply(
        mockCtx as Context,
        'Main Menu Content',
      );

      // Old message should have been safely deleted
      expect(mockCtx.api.deleteMessage).toHaveBeenCalledWith(1001, 77);
      // Fresh message should be sent at the bottom
      expect(mockCtx.reply).toHaveBeenCalledWith(
        'Main Menu Content',
        undefined,
      );
      // New message ID recorded
      expect(service.getMenuMessage(1001)).toBe(42);
      expect(result).toEqual({ message_id: 42 });
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
