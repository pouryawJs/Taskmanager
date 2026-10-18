import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';

import {
  Task,
  TaskOccurrence,
  TaskType,
  TaskPriority,
  TaskOccurrenceStatus,
  User,
  UserSettings,
} from '@app/database';

import { CreateTaskDto } from './dto/create-task.dto';
import { RescheduleOccurrenceDto } from './dto/reschedule-occurrence.dto';
import {
  isValidIsoDate,
  normalizeTimeString,
  getTodayDateString,
} from './utils/task-date.util';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Create a single one-time or daily recurring task with its initial occurrence atomically.
   */
  async createTask(
    userId: string,
    dto: CreateTaskDto,
  ): Promise<TaskOccurrence> {
    const user = await this.ensureUserExists(userId);
    const userTimezone = user.settings?.timezone || 'Asia/Tehran';

    const title = dto.title?.trim();
    if (!title || title.length === 0) {
      throw new BadRequestException('Task title cannot be empty.');
    }
    if (title.length > 160) {
      throw new BadRequestException('Task title cannot exceed 160 characters.');
    }

    const taskType = dto.type ?? TaskType.ONE_TIME;
    let targetDate = dto.date?.trim();

    if (taskType === TaskType.ONE_TIME) {
      if (!targetDate) {
        throw new BadRequestException(
          'A calendar date is required for one-time tasks.',
        );
      }
    } else {
      if (!targetDate) {
        targetDate = getTodayDateString(userTimezone);
      }
    }

    if (!isValidIsoDate(targetDate)) {
      throw new BadRequestException(
        `'${targetDate}' is not a valid calendar date in YYYY-MM-DD format.`,
      );
    }

    const normalizedStartTime = normalizeTimeString(dto.scheduledStartTime);

    if (dto.estimatedMinutes !== undefined && dto.estimatedMinutes !== null) {
      if (!Number.isInteger(dto.estimatedMinutes) || dto.estimatedMinutes < 0) {
        throw new BadRequestException(
          'Estimated duration must be a non-negative integer.',
        );
      }
    }

    let scheduledDueAt: Date | null = null;
    if (dto.scheduledDueAt) {
      scheduledDueAt =
        dto.scheduledDueAt instanceof Date
          ? dto.scheduledDueAt
          : new Date(dto.scheduledDueAt);
      if (isNaN(scheduledDueAt.getTime())) {
        throw new BadRequestException('Scheduled due at must be a valid date.');
      }
    }

    let scheduledStartAt: Date | null = null;
    if (dto.scheduledStartAt) {
      scheduledStartAt =
        dto.scheduledStartAt instanceof Date
          ? dto.scheduledStartAt
          : new Date(dto.scheduledStartAt);
      if (isNaN(scheduledStartAt.getTime())) {
        throw new BadRequestException(
          'Scheduled start at must be a valid date.',
        );
      }
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const taskRepo = manager.getRepository(Task);
        const occurrenceRepo = manager.getRepository(TaskOccurrence);

        const task = taskRepo.create({
          ownerId: userId,
          title,
          description: dto.description?.trim() || null,
          priority: dto.priority ?? TaskPriority.NORMAL,
          type: taskType,
          scheduledStartTime: normalizedStartTime,
          estimatedMinutes: dto.estimatedMinutes ?? null,
          isActive: true,
        });

        const savedTask = await taskRepo.save(task);

        const occurrence = occurrenceRepo.create({
          taskId: savedTask.id,
          date: targetDate,
          scheduledStartTime: normalizedStartTime,
          scheduledStartAt,
          scheduledDueAt,
          status: TaskOccurrenceStatus.PENDING,
        });

        const savedOccurrence = await occurrenceRepo.save(occurrence);
        savedOccurrence.task = savedTask;

        return savedOccurrence;
      });
    } catch (error: unknown) {
      if (this.isUniqueConstraintViolation(error)) {
        throw new ConflictException(
          `An occurrence for this task already exists on ${targetDate}.`,
        );
      }
      this.logger.error(
        `Failed to create task for user ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Atomically create multiple tasks and their initial occurrences in a single transaction.
   * If any item is invalid or fails, the entire batch is rolled back.
   */
  async createTasks(
    userId: string,
    dtos: CreateTaskDto[],
  ): Promise<TaskOccurrence[]> {
    if (!dtos || dtos.length === 0) {
      throw new BadRequestException('Task list cannot be empty.');
    }

    const user = await this.ensureUserExists(userId);
    const userTimezone = user.settings?.timezone || 'Asia/Tehran';

    const preparedItems = dtos.map((dto) => {
      const title = dto.title?.trim();
      if (!title || title.length === 0) {
        throw new BadRequestException('Task title cannot be empty.');
      }
      if (title.length > 160) {
        throw new BadRequestException(
          'Task title cannot exceed 160 characters.',
        );
      }

      const taskType = dto.type ?? TaskType.ONE_TIME;
      let targetDate = dto.date?.trim();

      if (taskType === TaskType.ONE_TIME) {
        if (!targetDate) {
          throw new BadRequestException(
            'A calendar date is required for one-time tasks.',
          );
        }
      } else {
        if (!targetDate) {
          targetDate = getTodayDateString(userTimezone);
        }
      }

      if (!isValidIsoDate(targetDate)) {
        throw new BadRequestException(
          `'${targetDate}' is not a valid calendar date in YYYY-MM-DD format.`,
        );
      }

      const normalizedStartTime = normalizeTimeString(dto.scheduledStartTime);

      if (dto.estimatedMinutes !== undefined && dto.estimatedMinutes !== null) {
        if (
          !Number.isInteger(dto.estimatedMinutes) ||
          dto.estimatedMinutes < 0
        ) {
          throw new BadRequestException(
            'Estimated duration must be a non-negative integer.',
          );
        }
      }

      let scheduledDueAt: Date | null = null;
      if (dto.scheduledDueAt) {
        scheduledDueAt =
          dto.scheduledDueAt instanceof Date
            ? dto.scheduledDueAt
            : new Date(dto.scheduledDueAt);
        if (isNaN(scheduledDueAt.getTime())) {
          throw new BadRequestException(
            'Scheduled due at must be a valid date.',
          );
        }
      }

      let scheduledStartAt: Date | null = null;
      if (dto.scheduledStartAt) {
        scheduledStartAt =
          dto.scheduledStartAt instanceof Date
            ? dto.scheduledStartAt
            : new Date(dto.scheduledStartAt);
        if (isNaN(scheduledStartAt.getTime())) {
          throw new BadRequestException(
            'Scheduled start at must be a valid date.',
          );
        }
      }

      return {
        title,
        description: dto.description?.trim() || null,
        priority: dto.priority ?? TaskPriority.NORMAL,
        type: taskType,
        date: targetDate,
        scheduledStartTime: normalizedStartTime,
        scheduledStartAt,
        scheduledDueAt,
        estimatedMinutes: dto.estimatedMinutes ?? null,
      };
    });

    try {
      return await this.dataSource.transaction(async (manager) => {
        const taskRepo = manager.getRepository(Task);
        const occurrenceRepo = manager.getRepository(TaskOccurrence);
        const results: TaskOccurrence[] = [];

        for (const item of preparedItems) {
          const task = await taskRepo.save(
            taskRepo.create({
              ownerId: userId,
              title: item.title,
              description: item.description,
              priority: item.priority,
              type: item.type,
              scheduledStartTime: item.scheduledStartTime,
              estimatedMinutes: item.estimatedMinutes,
              isActive: true,
            }),
          );

          const occurrence = await occurrenceRepo.save(
            occurrenceRepo.create({
              taskId: task.id,
              date: item.date,
              scheduledStartTime: item.scheduledStartTime,
              scheduledStartAt: item.scheduledStartAt,
              scheduledDueAt: item.scheduledDueAt,
              status: TaskOccurrenceStatus.PENDING,
            }),
          );

          occurrence.task = task;
          results.push(occurrence);
        }

        return results;
      });
    } catch (error: unknown) {
      this.logger.error(
        `Failed to execute bulk task creation for user ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * List occurrences for a user on a specific calendar date (YYYY-MM-DD).
   * If date is omitted, resolves today's date using the user's timezone.
   */
  async getOccurrencesForDate(
    userId: string,
    date?: string,
  ): Promise<TaskOccurrence[]> {
    await this.ensureUserExists(userId);

    let targetDate = date?.trim();
    if (!targetDate) {
      const timezone = await this.getUserTimezone(userId);
      targetDate = getTodayDateString(timezone);
    } else if (!isValidIsoDate(targetDate)) {
      throw new BadRequestException(
        `'${targetDate}' is not a valid calendar date in YYYY-MM-DD format.`,
      );
    }

    return await this.dataSource.getRepository(TaskOccurrence).find({
      where: {
        date: targetDate,
        task: { ownerId: userId },
      },
      relations: {
        task: true,
      },
      order: {
        scheduledStartTime: 'ASC',
        createdAt: 'ASC',
      },
    });
  }

  /**
   * Retrieve a specific occurrence by ID, enforcing user ownership.
   */
  async getOccurrenceById(
    userId: string,
    occurrenceId: string,
  ): Promise<TaskOccurrence> {
    const occurrence = await this.dataSource
      .getRepository(TaskOccurrence)
      .findOne({
        where: { id: occurrenceId },
        relations: { task: true },
      });

    if (!occurrence) {
      throw new NotFoundException(
        `Task occurrence with ID ${occurrenceId} not found.`,
      );
    }

    if (occurrence.task.ownerId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to access this task occurrence.',
      );
    }

    return occurrence;
  }

  /**
   * Retrieve task definitions owned by the user, with optional filters.
   */
  async getUserTasks(
    userId: string,
    options?: { type?: TaskType; isActive?: boolean },
  ): Promise<Task[]> {
    await this.ensureUserExists(userId);

    const where: { ownerId: string; type?: TaskType; isActive?: boolean } = {
      ownerId: userId,
    };
    if (options?.type !== undefined) {
      where.type = options.type;
    }
    if (options?.isActive !== undefined) {
      where.isActive = options.isActive;
    }

    return await this.dataSource.getRepository(Task).find({
      where,
      order: {
        createdAt: 'DESC',
      },
    });
  }

  /**
   * Retrieve a single task definition by ID, enforcing ownership.
   */
  async getTaskById(userId: string, taskId: string): Promise<Task> {
    const task = await this.dataSource.getRepository(Task).findOne({
      where: { id: taskId },
      relations: { occurrences: true },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found.`);
    }

    if (task.ownerId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to access this task.',
      );
    }

    return task;
  }

  /**
   * Deactivate a recurring task. Historical occurrences are preserved.
   */
  async deactivateTask(userId: string, taskId: string): Promise<Task> {
    const task = await this.getTaskById(userId, taskId);

    task.isActive = false;
    task.archivedAt = new Date();

    return await this.dataSource.getRepository(Task).save(task);
  }

  /**
   * Start an occurrence: updates status to IN_PROGRESS and records startedAt timestamp.
   */
  async startOccurrence(
    userId: string,
    occurrenceId: string,
  ): Promise<TaskOccurrence> {
    const occurrence = await this.getOccurrenceById(userId, occurrenceId);
    this.validateStatusTransition(
      occurrence.status,
      TaskOccurrenceStatus.IN_PROGRESS,
    );

    if (occurrence.status === TaskOccurrenceStatus.IN_PROGRESS) {
      return occurrence;
    }

    occurrence.status = TaskOccurrenceStatus.IN_PROGRESS;
    if (!occurrence.startedAt) {
      occurrence.startedAt = new Date();
    }

    return await this.dataSource.getRepository(TaskOccurrence).save(occurrence);
  }

  /**
   * Complete an occurrence: updates status to COMPLETED and records completedAt timestamp.
   */
  async completeOccurrence(
    userId: string,
    occurrenceId: string,
  ): Promise<TaskOccurrence> {
    const occurrence = await this.getOccurrenceById(userId, occurrenceId);
    this.validateStatusTransition(
      occurrence.status,
      TaskOccurrenceStatus.COMPLETED,
    );

    if (occurrence.status === TaskOccurrenceStatus.COMPLETED) {
      return occurrence;
    }

    const now = new Date();
    occurrence.status = TaskOccurrenceStatus.COMPLETED;
    occurrence.completedAt = now;
    if (!occurrence.startedAt) {
      occurrence.startedAt = now;
    }

    return await this.dataSource.getRepository(TaskOccurrence).save(occurrence);
  }

  /**
   * Mark an occurrence partially completed.
   */
  async partiallyCompleteOccurrence(
    userId: string,
    occurrenceId: string,
  ): Promise<TaskOccurrence> {
    const occurrence = await this.getOccurrenceById(userId, occurrenceId);
    this.validateStatusTransition(
      occurrence.status,
      TaskOccurrenceStatus.PARTIALLY_COMPLETED,
    );

    if (occurrence.status === TaskOccurrenceStatus.PARTIALLY_COMPLETED) {
      return occurrence;
    }

    occurrence.status = TaskOccurrenceStatus.PARTIALLY_COMPLETED;
    if (!occurrence.completedAt) {
      occurrence.completedAt = new Date();
    }

    return await this.dataSource.getRepository(TaskOccurrence).save(occurrence);
  }

  /**
   * Mark an occurrence not completed (e.g. timeout or expired).
   */
  async markOccurrenceNotCompleted(
    userId: string,
    occurrenceId: string,
  ): Promise<TaskOccurrence> {
    const occurrence = await this.getOccurrenceById(userId, occurrenceId);
    this.validateStatusTransition(
      occurrence.status,
      TaskOccurrenceStatus.NOT_COMPLETED,
    );

    if (occurrence.status === TaskOccurrenceStatus.NOT_COMPLETED) {
      return occurrence;
    }

    occurrence.status = TaskOccurrenceStatus.NOT_COMPLETED;

    return await this.dataSource.getRepository(TaskOccurrence).save(occurrence);
  }

  /**
   * Skip an occurrence for its scheduled calendar date.
   * For recurring tasks, parent task and future days remain unaffected.
   */
  async skipOccurrence(
    userId: string,
    occurrenceId: string,
  ): Promise<TaskOccurrence> {
    const occurrence = await this.getOccurrenceById(userId, occurrenceId);
    this.validateStatusTransition(
      occurrence.status,
      TaskOccurrenceStatus.SKIPPED,
    );

    if (occurrence.status === TaskOccurrenceStatus.SKIPPED) {
      return occurrence;
    }

    occurrence.status = TaskOccurrenceStatus.SKIPPED;

    return await this.dataSource.getRepository(TaskOccurrence).save(occurrence);
  }

  /**
   * Explicitly cancel an occurrence.
   */
  async cancelOccurrence(
    userId: string,
    occurrenceId: string,
  ): Promise<TaskOccurrence> {
    const occurrence = await this.getOccurrenceById(userId, occurrenceId);
    this.validateStatusTransition(
      occurrence.status,
      TaskOccurrenceStatus.CANCELLED,
    );

    if (occurrence.status === TaskOccurrenceStatus.CANCELLED) {
      return occurrence;
    }

    occurrence.status = TaskOccurrenceStatus.CANCELLED;

    return await this.dataSource.getRepository(TaskOccurrence).save(occurrence);
  }

  /**
   * Reschedule an occurrence to a new start time of day.
   * If updateTaskDefault is true and task is daily recurring, atomically updates Task default start time.
   */
  async rescheduleOccurrence(
    userId: string,
    occurrenceId: string,
    dto: RescheduleOccurrenceDto,
  ): Promise<TaskOccurrence> {
    const occurrence = await this.getOccurrenceById(userId, occurrenceId);

    if (
      occurrence.status === TaskOccurrenceStatus.COMPLETED ||
      occurrence.status === TaskOccurrenceStatus.CANCELLED
    ) {
      throw new BadRequestException(
        'Cannot reschedule a completed or cancelled task occurrence.',
      );
    }

    const normalizedTime = normalizeTimeString(dto.newStartTime);
    if (!normalizedTime) {
      throw new BadRequestException('A valid start time must be provided.');
    }

    const shouldUpdateDefault =
      dto.updateTaskDefault === true && occurrence.task.type === TaskType.DAILY;

    if (shouldUpdateDefault) {
      return await this.dataSource.transaction(async (manager) => {
        const taskRepo = manager.getRepository(Task);
        const occurrenceRepo = manager.getRepository(TaskOccurrence);

        occurrence.scheduledStartTime = normalizedTime;
        await occurrenceRepo.save(occurrence);

        occurrence.task.scheduledStartTime = normalizedTime;
        await taskRepo.save(occurrence.task);

        return occurrence;
      });
    }

    occurrence.scheduledStartTime = normalizedTime;
    return await this.dataSource.getRepository(TaskOccurrence).save(occurrence);
  }

  /**
   * Create an occurrence for an existing active task on a specific calendar date.
   * Verifies task ownership and prevents duplicate daily occurrences.
   */
  async createOccurrenceForDate(
    userId: string,
    taskId: string,
    date: string,
    scheduledStartTime?: string | null,
  ): Promise<TaskOccurrence> {
    const task = await this.getTaskById(userId, taskId);

    if (!task.isActive) {
      throw new BadRequestException(
        'Cannot create occurrences for an inactive task.',
      );
    }

    const trimmedDate = date?.trim();
    if (!isValidIsoDate(trimmedDate)) {
      throw new BadRequestException(
        `'${date}' is not a valid calendar date in YYYY-MM-DD format.`,
      );
    }

    const existing = await this.dataSource
      .getRepository(TaskOccurrence)
      .findOne({
        where: { taskId, date: trimmedDate },
      });

    if (existing) {
      throw new ConflictException(
        `An occurrence for task ${taskId} on date ${trimmedDate} already exists.`,
      );
    }

    const normalizedTime =
      normalizeTimeString(scheduledStartTime) ?? task.scheduledStartTime;

    try {
      const occurrenceRepo = this.dataSource.getRepository(TaskOccurrence);
      const occurrence = occurrenceRepo.create({
        taskId: task.id,
        date: trimmedDate,
        scheduledStartTime: normalizedTime,
        status: TaskOccurrenceStatus.PENDING,
      });

      const savedOccurrence = await occurrenceRepo.save(occurrence);
      savedOccurrence.task = task;
      return savedOccurrence;
    } catch (error: unknown) {
      if (this.isUniqueConstraintViolation(error)) {
        throw new ConflictException(
          `An occurrence for task ${taskId} on date ${trimmedDate} already exists.`,
        );
      }
      throw error;
    }
  }

  // --- Helper Methods ---

  private async ensureUserExists(userId: string): Promise<User> {
    const user = await this.dataSource.getRepository(User).findOne({
      where: { id: userId },
      relations: { settings: true },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found.`);
    }

    return user;
  }

  private async getUserTimezone(userId: string): Promise<string> {
    const settings = await this.dataSource.getRepository(UserSettings).findOne({
      where: { userId },
    });

    return settings?.timezone || 'Asia/Tehran';
  }

  private validateStatusTransition(
    currentStatus: TaskOccurrenceStatus,
    targetStatus: TaskOccurrenceStatus,
  ): void {
    if (currentStatus === targetStatus) {
      return;
    }

    if (currentStatus === TaskOccurrenceStatus.COMPLETED) {
      throw new BadRequestException(
        'Cannot change the status of an already completed task occurrence.',
      );
    }

    if (currentStatus === TaskOccurrenceStatus.CANCELLED) {
      throw new BadRequestException(
        'Cannot change the status of a cancelled task occurrence.',
      );
    }
  }

  private isUniqueConstraintViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (
        error as QueryFailedError & {
          driverError?: { code?: string };
        }
      ).driverError?.code === '23505'
    );
  }
}
