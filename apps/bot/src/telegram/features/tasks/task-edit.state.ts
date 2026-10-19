import { Injectable } from '@nestjs/common';

export type TaskEditMode =
  'edit_title' | 'edit_description' | 'edit_time' | 'edit_date';

export interface TaskEditSession {
  userId: string;
  telegramUserId: string;
  chatId: number;
  occurrenceId: string;
  taskId: string;
  mode: TaskEditMode;
  pendingStartTime?: string | null;
  pendingEndTime?: string | null;
  createdAt: number;
  lastActivityAt: number;
}

@Injectable()
export class TaskEditStateService {
  private readonly sessions = new Map<string, TaskEditSession>();
  private readonly SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes TTL

  /**
   * Start or replace an active edit session for a specific Telegram user.
   */
  startSession(
    telegramUserId: string,
    params: {
      userId: string;
      chatId: number;
      occurrenceId: string;
      taskId: string;
      mode: TaskEditMode;
    },
  ): TaskEditSession {
    const now = Date.now();
    const session: TaskEditSession = {
      userId: params.userId,
      telegramUserId,
      chatId: params.chatId,
      occurrenceId: params.occurrenceId,
      taskId: params.taskId,
      mode: params.mode,
      createdAt: now,
      lastActivityAt: now,
    };
    this.sessions.set(telegramUserId, session);
    return session;
  }

  /**
   * Retrieve active edit session, validating TTL and chat isolation.
   */
  getSession(
    telegramUserId: string,
    chatId?: number,
  ): TaskEditSession | undefined {
    const session = this.sessions.get(telegramUserId);
    if (!session) {
      return undefined;
    }

    if (Date.now() - session.lastActivityAt > this.SESSION_TTL_MS) {
      this.sessions.delete(telegramUserId);
      return undefined;
    }

    if (chatId !== undefined && session.chatId !== chatId) {
      return undefined;
    }

    return session;
  }

  /**
   * Check whether a Telegram user has an active, non-expired edit session in the given chat.
   */
  hasActiveSession(telegramUserId: string, chatId?: number): boolean {
    return this.getSession(telegramUserId, chatId) !== undefined;
  }

  /**
   * Refresh session TTL timestamp.
   */
  touchSession(telegramUserId: string): void {
    const session = this.getSession(telegramUserId);
    if (session) {
      session.lastActivityAt = Date.now();
    }
  }

  /**
   * Explicitly end and clear the edit session.
   */
  clearSession(telegramUserId: string): void {
    this.sessions.delete(telegramUserId);
  }
}
