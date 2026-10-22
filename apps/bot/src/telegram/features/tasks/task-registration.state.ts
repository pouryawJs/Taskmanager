import { Injectable } from '@nestjs/common';
import { TaskType } from '@app/database';

export interface TaskRegistrationSession {
  userId: string;
  telegramUserId: string;
  chatId: number;
  taskType: TaskType;
  selectedDate?: string;
  savedCount: number;
  createdTaskTitles: string[];
  processedMessageIds?: number[];
  promptMessageId?: number;
  createdAt: number;
  lastActivityAt: number;
}

@Injectable()
export class TaskRegistrationStateService {
  private readonly sessions = new Map<string, TaskRegistrationSession>();
  private readonly SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

  /**
   * Start or replace a task registration session for a specific Telegram user.
   */
  startSession(
    telegramUserId: string,
    params: {
      userId: string;
      chatId: number;
      taskType: TaskType;
      selectedDate?: string;
      promptMessageId?: number;
    },
  ): TaskRegistrationSession {
    const now = Date.now();
    const session: TaskRegistrationSession = {
      userId: params.userId,
      telegramUserId,
      chatId: params.chatId,
      taskType: params.taskType,
      selectedDate: params.selectedDate,
      promptMessageId: params.promptMessageId,
      savedCount: 0,
      createdTaskTitles: [],
      processedMessageIds: [],
      createdAt: now,
      lastActivityAt: now,
    };
    this.sessions.set(telegramUserId, session);
    return session;
  }

  /**
   * Retrieve active session for a specific Telegram user.
   * Cleans up expired sessions automatically based on last activity.
   */
  getSession(telegramUserId: string): TaskRegistrationSession | undefined {
    const session = this.sessions.get(telegramUserId);
    if (!session) {
      return undefined;
    }

    if (Date.now() - session.lastActivityAt > this.SESSION_TTL_MS) {
      this.sessions.delete(telegramUserId);
      return undefined;
    }

    return session;
  }

  /**
   * Check if a Telegram user currently has an active registration session.
   */
  hasActiveSession(telegramUserId: string): boolean {
    return this.getSession(telegramUserId) !== undefined;
  }

  /**
   * Append successfully created task titles to the session and update counts.
   */
  addCreatedTaskTitles(telegramUserId: string, titles: string[]): void {
    const session = this.getSession(telegramUserId);
    if (session) {
      if (!session.createdTaskTitles) {
        session.createdTaskTitles = [];
      }
      session.createdTaskTitles.push(...titles);
      session.savedCount = session.createdTaskTitles.length;
      session.lastActivityAt = Date.now();
    }
  }

  /**
   * Increment the count of successfully created tasks in the active session
   * and refresh the session's last activity timestamp.
   */
  incrementSavedCount(telegramUserId: string, count = 1): void {
    const session = this.getSession(telegramUserId);
    if (session) {
      session.savedCount += count;
      session.lastActivityAt = Date.now();
    }
  }

  /**
   * Explicitly refresh the session activity timestamp.
   */
  touchSession(telegramUserId: string): void {
    const session = this.getSession(telegramUserId);
    if (session) {
      session.lastActivityAt = Date.now();
    }
  }

  /**
   * Clear and end the registration session for a specific Telegram user.
   */
  clearSession(telegramUserId: string): void {
    this.sessions.delete(telegramUserId);
  }
}
