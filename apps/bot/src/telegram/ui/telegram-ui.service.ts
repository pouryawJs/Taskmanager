import { Injectable, Logger } from '@nestjs/common';
import { Context, GrammyError, InlineKeyboard } from 'grammy';
import type { Message, InlineKeyboardMarkup } from 'grammy/types';

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
   * Handles "message is not modified" and deletion errors gracefully.
   */
  async editOrReply(
    ctx: Context,
    text: string,
    options?: EditOrReplyOptions,
    customMessageId?: number,
  ): Promise<Message | true | null> {
    const chatId = ctx.chat?.id;

    // 1. Try editing via callbackQuery message context if available
    if (ctx.callbackQuery?.message) {
      try {
        const result = await ctx.editMessageText(text, options);
        if (
          chatId &&
          typeof result === 'object' &&
          result &&
          'message_id' in result
        ) {
          this.recordMenuMessage(chatId, (result as Message).message_id);
        } else if (chatId && ctx.callbackQuery.message.message_id) {
          this.recordMenuMessage(chatId, ctx.callbackQuery.message.message_id);
        }
        return result;
      } catch (error: unknown) {
        if (this.isMessageNotModified(error)) {
          this.logger.debug('Message is already up-to-date; edit skipped.');
          return true;
        }
        this.logger.warn(
          `Failed to edit message via callback context: ${error instanceof Error ? error.message : String(error)}. Falling back to reply.`,
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
          return true;
        }
        this.logger.warn(
          `Failed to edit message ${targetMsgId}: ${error instanceof Error ? error.message : String(error)}. Falling back to reply.`,
        );
      }
    }

    // 3. Fallback: send a new message
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
  ): Promise<Message | null> {
    const chatId = ctx.chat?.id;
    if (!chatId) return null;

    try {
      const msg = await ctx.reply(text, { parse_mode: 'HTML' });

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
}
