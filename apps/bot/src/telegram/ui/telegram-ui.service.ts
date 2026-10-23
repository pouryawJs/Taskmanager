import { Injectable, Logger } from '@nestjs/common';
import { Context, GrammyError, InlineKeyboard, Keyboard } from 'grammy';
import type {
  Message,
  InlineKeyboardMarkup,
  ReplyKeyboardMarkup,
} from 'grammy/types';
import { persistentReplyKeyboard } from '../features/start/start.keyboards';

export interface EditOrReplyOptions {
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  reply_markup?: InlineKeyboard | InlineKeyboardMarkup;
  disable_web_page_preview?: boolean;
}

@Injectable()
export class TelegramUiService {
  private readonly logger = new Logger(TelegramUiService.name);
  private readonly menuMessageIds = new Map<number, number>();

  /**
   * Record the active menu/wizard message ID for a given chat.
   */
  recordMenuMessage(chatId: number, messageId: number): void {
    this.menuMessageIds.set(chatId, messageId);
  }

  /**
   * Retrieve the active menu/wizard message ID for a given chat.
   */
  getMenuMessage(chatId: number): number | undefined {
    return this.menuMessageIds.get(chatId);
  }

  /**
   * Clear the active menu/wizard message ID for a given chat.
   */
  clearMenuMessage(chatId: number): void {
    this.menuMessageIds.delete(chatId);
  }

  /**
   * Edit the existing message in-place if possible; otherwise send a new message as fallback.
   * Handles "message is not modified", media message replacements, and deletion errors gracefully.
   */
  async editOrReply(
    ctx: Context,
    text: string,
    options?: EditOrReplyOptions,
    customMessageId?: number,
  ): Promise<Message | true | null> {
    const chatId = ctx.chat?.id;

    // 1. Try editing via callbackQuery message context if available and no customMessageId overrides it
    if (ctx.callbackQuery?.message && !customMessageId) {
      const callbackMsg = ctx.callbackQuery.message;
      const callbackMsgId = callbackMsg.message_id;

      // If the callback message is a media message (e.g. photo with chart),
      // editMessageText cannot convert it to a text message. Perform a clean replacement.
      if (this.isMediaMessage(callbackMsg)) {
        this.logger.debug(
          `Callback message ${callbackMsgId} is a media message; replacing with text message.`,
        );
        return this.replaceObsoleteMessageWithReply(
          ctx,
          chatId,
          callbackMsgId,
          text,
          options,
        );
      }

      try {
        const result = await ctx.editMessageText(text, options);
        if (
          chatId &&
          typeof result === 'object' &&
          result &&
          'message_id' in result
        ) {
          this.recordMenuMessage(chatId, (result as Message).message_id);
        } else if (chatId && callbackMsgId) {
          this.recordMenuMessage(chatId, callbackMsgId);
        }
        return result;
      } catch (error: unknown) {
        if (this.isMessageNotModified(error)) {
          this.logger.debug('Message is already up-to-date; edit skipped.');
          return true;
        }

        if (this.isNoTextInMessageError(error)) {
          this.logger.debug(
            `Callback message ${callbackMsgId} has no text to edit (media message); replacing with text message.`,
          );
          return this.replaceObsoleteMessageWithReply(
            ctx,
            chatId,
            callbackMsgId,
            text,
            options,
          );
        }

        if (this.isMessageNotFoundError(error)) {
          this.logger.debug(
            `Callback message ${callbackMsgId} to edit not found; sending fresh message.`,
          );
          return this.replaceObsoleteMessageWithReply(
            ctx,
            chatId,
            callbackMsgId,
            text,
            options,
          );
        }

        // Genuine unexpected error
        this.logger.warn(
          `Failed to edit message via callback context: ${error instanceof Error ? error.message : String(error)}. Falling back to reply.`,
        );
        return this.replaceObsoleteMessageWithReply(
          ctx,
          chatId,
          callbackMsgId,
          text,
          options,
        );
      }
    }

    // 2. Try editing via recorded/custom messageId if chatId is present
    const targetMsgId =
      customMessageId ?? (chatId ? this.getMenuMessage(chatId) : undefined);
    if (chatId && targetMsgId) {
      try {
        const result = await ctx.api.editMessageText(
          chatId,
          targetMsgId,
          text,
          options,
        );
        if (typeof result === 'object' && result && 'message_id' in result) {
          this.recordMenuMessage(chatId, (result as Message).message_id);
        }
        return result;
      } catch (error: unknown) {
        if (this.isMessageNotModified(error)) {
          this.logger.debug('Message is already up-to-date; edit skipped.');
          // When invoked from a message/command without callback context (e.g. /start),
          // the user sent a new message into the chat. If the previous menu message is already
          // identical, Telegram rejects editing it. To ensure the user receives the interface
          // at the bottom of the chat without leaving duplicate menus behind, delete the old menu
          // and fall through to reply with a fresh menu message.
          await this.deleteBotMessageSafely(ctx, chatId, targetMsgId);
          this.clearMenuMessage(chatId);
          return this.sendFallbackReply(ctx, chatId, text, options);
        }

        if (this.isNoTextInMessageError(error)) {
          this.logger.debug(
            `Target message ${targetMsgId} has no text to edit (media message); replacing with text message.`,
          );
          return this.replaceObsoleteMessageWithReply(
            ctx,
            chatId,
            targetMsgId,
            text,
            options,
          );
        }

        if (this.isMessageNotFoundError(error)) {
          this.logger.debug(
            `Target message ${targetMsgId} to edit not found; sending fresh message.`,
          );
          return this.replaceObsoleteMessageWithReply(
            ctx,
            chatId,
            targetMsgId,
            text,
            options,
          );
        }

        // Genuine unexpected error
        this.logger.warn(
          `Failed to edit message ${targetMsgId}: ${error instanceof Error ? error.message : String(error)}. Falling back to reply.`,
        );
        return this.replaceObsoleteMessageWithReply(
          ctx,
          chatId,
          targetMsgId,
          text,
          options,
        );
      }
    }

    // 3. Fallback: send a new message
    return this.sendFallbackReply(ctx, chatId, text, options);
  }

  /**
   * Send a fresh replacement message and safely delete the obsolete source message.
   * Delivers the new message first so that deletion failure never blocks message delivery.
   */
  private async replaceObsoleteMessageWithReply(
    ctx: Context,
    chatId: number | undefined,
    obsoleteMessageId: number | undefined,
    text: string,
    options?: EditOrReplyOptions,
  ): Promise<Message | null> {
    try {
      const msg = await ctx.reply(text, options);
      if (chatId && msg?.message_id) {
        this.recordMenuMessage(chatId, msg.message_id);
      }
      if (
        chatId &&
        obsoleteMessageId &&
        msg?.message_id &&
        obsoleteMessageId !== msg.message_id
      ) {
        await this.deleteBotMessageSafely(ctx, chatId, obsoleteMessageId);
      }
      return msg;
    } catch (error: unknown) {
      this.logger.error(
        `Failed to send fallback reply: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async sendFallbackReply(
    ctx: Context,
    chatId: number | undefined,
    text: string,
    options?: EditOrReplyOptions,
  ): Promise<Message | null> {
    try {
      const msg = await ctx.reply(text, options);
      if (chatId && msg?.message_id) {
        this.recordMenuMessage(chatId, msg.message_id);
      }
      return msg;
    } catch (error: unknown) {
      this.logger.error(
        `Failed to send fallback reply: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Send a temporary confirmation message that automatically deletes itself after delayMs (default ~10 seconds).
   * Executes deletion asynchronously without blocking the handler.
   */
  async sendTemporaryConfirmation(
    ctx: Context,
    text: string,
    delayMs = 10000,
    replyMarkup?: Keyboard | ReplyKeyboardMarkup,
  ): Promise<Message | null> {
    const chatId = ctx.chat?.id;
    if (!chatId) return null;

    try {
      const options: {
        parse_mode: 'HTML';
        reply_markup?: Keyboard | ReplyKeyboardMarkup;
      } = { parse_mode: 'HTML' };
      if (replyMarkup) {
        options.reply_markup = replyMarkup;
      }
      const msg = await ctx.reply(text, options);

      // Asynchronous non-blocking deletion
      setTimeout(() => {
        void this.deleteBotMessageSafely(ctx, chatId, msg.message_id);
      }, delayMs).unref?.();

      return msg;
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to send temporary confirmation: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Send or restore the persistent reply keyboard as a permanent message.
   * This is never auto-deleted so Telegram clients retain the custom reply keyboard
   * permanently in chat history, including across app restarts.
   */
  async sendPersistentReplyKeyboard(
    ctx: Context,
    text: string,
    keyboard: Keyboard = persistentReplyKeyboard,
  ): Promise<Message | null> {
    const chatId = ctx.chat?.id;
    if (!chatId) return null;

    try {
      return await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to send persistent reply keyboard: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Safely delete a bot-owned message without throwing unhandled exceptions.
   */
  async deleteBotMessageSafely(
    ctx: Context,
    chatId: number,
    messageId: number,
  ): Promise<void> {
    try {
      await ctx.api.deleteMessage(chatId, messageId);
      this.logger.debug(
        `Successfully auto-deleted temporary message ${messageId} in chat ${chatId}`,
      );
    } catch (error: unknown) {
      // The message may have been manually deleted or expired; ignore gracefully
      this.logger.debug(
        `Auto-delete for message ${messageId} skipped/failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Helper to identify Telegram "message is not modified" error.
   */
  isMessageNotModified(error: unknown): boolean {
    if (error instanceof GrammyError) {
      return (
        error.error_code === 400 &&
        error.description.toLowerCase().includes('message is not modified')
      );
    }
    const errStr = String(error).toLowerCase();
    return errStr.includes('message is not modified');
  }

  /**
   * Helper to identify Telegram "there is no text in the message to edit" error.
   * Occurs when attempting to edit a media message (e.g. photo/chart) using editMessageText.
   */
  isNoTextInMessageError(error: unknown): boolean {
    if (error instanceof GrammyError) {
      return (
        error.error_code === 400 &&
        error.description
          .toLowerCase()
          .includes('there is no text in the message to edit')
      );
    }
    const errStr = String(error).toLowerCase();
    return errStr.includes('there is no text in the message to edit');
  }

  /**
   * Helper to identify Telegram "message to edit not found" error.
   */
  isMessageNotFoundError(error: unknown): boolean {
    if (error instanceof GrammyError) {
      return (
        error.error_code === 400 &&
        error.description.toLowerCase().includes('message to edit not found')
      );
    }
    const errStr = String(error).toLowerCase();
    return errStr.includes('message to edit not found');
  }

  /**
   * Check if a message object represents a media message (photo, video, animation, document, etc.)
   * that cannot be edited via editMessageText.
   */
  isMediaMessage(message: unknown): boolean {
    if (!message || typeof message !== 'object') return false;
    const msg = message as Record<string, unknown>;
    return Boolean(
      msg.photo ||
      msg.video ||
      msg.animation ||
      msg.document ||
      msg.audio ||
      msg.voice ||
      msg.video_note ||
      msg.sticker ||
      ('caption' in msg && !('text' in msg)),
    );
  }
}
