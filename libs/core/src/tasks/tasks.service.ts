import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { DataSource, QueryFailedError, IsNull, Not } from 'typeorm';

import {
  Task,
  TaskOccurrence,
  TaskType,
  TaskPriority,
  TaskOccurrenceStatus,
  PointTransaction,
  User,
  UserSettings,
} from '@app/database';

import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { RescheduleOccurrenceDto } from './dto/reschedule-occurrence.dto';
import { UpdateOccurrenceScheduleDto } from './dto/update-occurrence-schedule.dto';
import {
  isValidIsoDate,
  normalizeTimeString,
  getTodayDateString,
  addDaysToIsoDate,
  localDateTimeToUtcDate,
  formatUtcToLocalTime,
} from './utils/task-date.util';
import { GamificationService } from '../gamification/gamification.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly gamificationService: GamificationService,
  ) {}

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

    const todayDate = getTodayDateString(userTimezone);
    if (taskType === TaskType.ONE_TIME && targetDate < todayDate) {
      throw new BadRequestException(
        `Cannot schedule a one-time task in the past ('${targetDate}' < '${todayDate}' in ${userTimezone}).`,
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

      const todayDate = getTodayDateString(userTimezone);
      if (taskType === TaskType.ONE_TIME && targetDate < todayDate) {
        throw new BadRequestException(
          `Cannot schedule a one-time task in the past ('${targetDate}' < '${todayDate}' in ${userTimezone}).`,
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

    const occurrences = await this.dataSource
      .getRepository(TaskOccurrence)
      .find({
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

    return this.sortOccurrences(occurrences);
  }

  /**
   * Idempotently ensures that active daily recurring tasks have an occurrence for the specified
   * calendar date (defaults to today in the user's timezone).
   *
   * Preserves the unique (taskId, date) constraint and historical occurrences.
   * Concurrency-safe against race conditions.
   * Returns all occurrences (one-time + daily) for the user on that date, sorted.
   */
  async ensureDailyOccurrencesForDate(
    userId: string,
    date?: string,
  ): Promise<TaskOccurrence[]> {
    await this.ensureUserExists(userId);

    const timezone = await this.getUserTimezone(userId);
    let targetDate = date?.trim();
    if (!targetDate) {
      targetDate = getTodayDateString(timezone);
    } else if (!isValidIsoDate(targetDate)) {
      throw new BadRequestException(
        `'${targetDate}' is not a valid calendar date in YYYY-MM-DD format.`,
      );
    }

    // 1. Fetch all active daily tasks owned by the user
    const dailyTasks = await this.dataSource.getRepository(Task).find({
      where: {
        ownerId: userId,
        type: TaskType.DAILY,
        isActive: true,
      },
      relations: {
        occurrences: true,
      },
    });

    // 2. Fetch existing occurrences for this date and user
    const existingOccurrences = await this.dataSource
      .getRepository(TaskOccurrence)
      .find({
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

    const existingTaskIds = new Set(existingOccurrences.map((o) => o.taskId));
    const occurrenceRepo = this.dataSource.getRepository(TaskOccurrence);

    // 3. For each active daily task, ensure an occurrence exists on targetDate
    for (const task of dailyTasks) {
      if (existingTaskIds.has(task.id)) {
        continue;
      }

      // Determine task start date: earliest existing occurrence date or task creation date
      let taskStartDate: string | null = null;
      if (task.occurrences && task.occurrences.length > 0) {
        const sortedDates = task.occurrences.map((o) => o.date).sort();
        taskStartDate = sortedDates[0];
      } else if (task.createdAt) {
        taskStartDate = getTodayDateString(timezone, new Date(task.createdAt));
      }

      // Do not generate occurrences before the task was scheduled/created
      if (taskStartDate && targetDate < taskStartDate) {
        continue;
      }

      // Calculate scheduledDueAt if task previously had an occurrence with scheduledDueAt
      let scheduledDueAt: Date | null = null;
      if (task.occurrences && task.occurrences.length > 0) {
        const templateOcc = task.occurrences.find(
          (o) => o.scheduledDueAt !== null && o.scheduledDueAt !== undefined,
        );
        if (templateOcc && templateOcc.scheduledDueAt) {
          try {
            const localEndTime = formatUtcToLocalTime(
              templateOcc.scheduledDueAt,
              timezone,
            );
            scheduledDueAt = localDateTimeToUtcDate(
              targetDate,
              localEndTime,
              timezone,
            );
          } catch (err: unknown) {
            this.logger.debug(
              `Failed to compute scheduledDueAt for daily task ${task.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }

      const newOccurrence = occurrenceRepo.create({
        taskId: task.id,
        date: targetDate,
        scheduledStartTime: task.scheduledStartTime,
        scheduledDueAt,
        status: TaskOccurrenceStatus.PENDING,
      });

      try {
        const saved = await occurrenceRepo.save(newOccurrence);
        saved.task = task;
        existingOccurrences.push(saved);
        existingTaskIds.add(task.id);
      } catch (error: unknown) {
        if (this.isUniqueConstraintViolation(error)) {
          this.logger.debug(
            `Occurrence for task ${task.id} on date ${targetDate} was already created concurrently.`,
          );
        } else {
          this.logger.error(
            `Failed to ensure daily occurrence for task ${task.id}`,
            error instanceof Error ? error.stack : String(error),
          );
          throw error;
        }
      }
    }

    return this.sortOccurrences(existingOccurrences);
  }

  /**
   * Sorts occurrences deterministically:
   * 1. Timed tasks first, sorted by scheduledStartTime ascending.
   * 2. Untimed tasks next.
   * 3. Deterministic secondary order by createdAt ascending, then id ascending.
   */
  private sortOccurrences(occurrences: TaskOccurrence[]): TaskOccurrence[] {
    return [...occurrences].sort((a, b) => {
      const aTime = a.scheduledStartTime ?? null;
      const bTime = b.scheduledStartTime ?? null;

      if (aTime && !bTime) return -1;
      if (!aTime && bTime) return 1;
      if (aTime && bTime && aTime !== bTime) {
        return aTime.localeCompare(bTime);
      }

      const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (aCreated !== bCreated) {
        return aCreated - bCreated;
      }

      return (a.id || '').localeCompare(b.id || '');
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
   * Update task definition fields: title, description, and/or priority.
   * Historical occurrences and their execution statuses are completely preserved.
   */
  async updateTask(
    userId: string,
    taskId: string,
    dto: UpdateTaskDto,
  ): Promise<Task> {
    const task = await this.getTaskById(userId, taskId);

    if (dto.title !== undefined) {
      const trimmedTitle = dto.title.trim();
      if (trimmedTitle.length === 0) {
        throw new BadRequestException('Task title cannot be empty.');
      }
      if (trimmedTitle.length > 160) {
        throw new BadRequestException(
          'Task title cannot exceed 160 characters.',
        );
      }
      task.title = trimmedTitle;
    }

    if (dto.description !== undefined) {
      if (dto.description === null) {
        task.description = null;
      } else {
        const trimmedDesc = dto.description.trim();
        task.description = trimmedDesc.length > 0 ? trimmedDesc : null;
      }
    }

    if (dto.priority !== undefined) {
      task.priority = dto.priority;
    }

    return await this.dataSource.getRepository(Task).save(task);
  }

  /**
   * Permanently deletes a task and its non-completed occurrences.
   * Only permitted if no completed history or point records exist for the task.
   * If completed occurrences or points exist, deletion is rejected to protect audit records.
   */
  async deleteTask(userId: string, taskId: string): Promise<void> {
    const task = await this.getTaskById(userId, taskId);

    const occurrences = await this.dataSource
      .getRepository(TaskOccurrence)
      .find({
        where: { taskId: task.id },
      });

    const hasCompletedOccurrence = occurrences.some(
      (occ) =>
        occ.status === TaskOccurrenceStatus.COMPLETED ||
        occ.status === TaskOccurrenceStatus.PARTIALLY_COMPLETED,
    );

    if (hasCompletedOccurrence) {
      throw new BadRequestException(
        'Cannot delete a task with completed history. Deactivate the task instead to preserve audit records.',
      );
    }

    const occurrenceIds = occurrences.map((occ) => occ.id);
    if (occurrenceIds.length > 0) {
      const pointTxCount = await this.dataSource
        .getRepository(PointTransaction)
        .createQueryBuilder('pt')
        .where('pt.taskOccurrenceId IN (:...ids)', { ids: occurrenceIds })
        .getCount();

      if (pointTxCount > 0) {
        throw new BadRequestException(
          'Cannot delete a task with associated point records. Deactivate the task instead to preserve audit records.',
        );
      }
    }

    await this.dataSource.transaction(async (manager) => {
      if (occurrences.length > 0) {
        await manager.getRepository(TaskOccurrence).delete({ taskId: task.id });
      }
      await manager.getRepository(Task).delete({ id: task.id });
    });
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
   * Complete an occurrence: updates status to COMPLETED, records completedAt timestamp,
   * and atomically awards qualifying XP within the same database transaction.
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

    return await this.dataSource.transaction(async (manager) => {
      const savedOccurrence = await manager
        .getRepository(TaskOccurrence)
        .save(occurrence);

      await this.gamificationService.awardTaskOccurrenceXp(
        manager,
        savedOccurrence,
        userId,
      );

      return savedOccurrence;
    });
  }

  /**
   * Mark an occurrence partially completed and atomically award partial XP
   * within the same database transaction.
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

    return await this.dataSource.transaction(async (manager) => {
      const savedOccurrence = await manager
        .getRepository(TaskOccurrence)
        .save(occurrence);

      await this.gamificationService.awardTaskOccurrenceXp(
        manager,
        savedOccurrence,
        userId,
      );

      return savedOccurrence;
    });
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
   * Update occurrence schedule: date (for one-time tasks), start time, end time,
   * or clear schedule completely.
   * For daily recurring tasks, date modification is rejected, but start time can optionally
   * be propagated to task definition (updateTaskDefault: true).
   */
  async updateOccurrenceSchedule(
    userId: string,
    occurrenceId: string,
    dto: UpdateOccurrenceScheduleDto,
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

    const timezone = await this.getUserTimezone(userId);
    const todayDate = getTodayDateString(timezone);

    // 1. Clear schedule case
    if (dto.clearSchedule === true) {
      occurrence.scheduledStartTime = null;
      occurrence.scheduledStartAt = null;
      occurrence.scheduledDueAt = null;

      const shouldUpdateDefault =
        dto.updateTaskDefault === true &&
        occurrence.task.type === TaskType.DAILY;

      if (shouldUpdateDefault) {
        return await this.dataSource.transaction(async (manager) => {
          const taskRepo = manager.getRepository(Task);
          const occurrenceRepo = manager.getRepository(TaskOccurrence);

          await occurrenceRepo.save(occurrence);
          occurrence.task.scheduledStartTime = null;
          await taskRepo.save(occurrence.task);

          return occurrence;
        });
      }

      return await this.dataSource
        .getRepository(TaskOccurrence)
        .save(occurrence);
    }

    // 2. Date modification (One-time tasks only)
    if (dto.date !== undefined && dto.date !== null) {
      if (occurrence.task.type === TaskType.DAILY) {
        throw new BadRequestException(
          'Cannot change the date of a daily recurring task occurrence.',
        );
      }

      const trimmedDate = dto.date.trim();
      if (!isValidIsoDate(trimmedDate)) {
        throw new BadRequestException(
          `'${dto.date}' is not a valid calendar date in YYYY-MM-DD format.`,
        );
      }

      if (trimmedDate < todayDate) {
        throw new BadRequestException(
          `Cannot schedule a one-time task in the past ('${trimmedDate}' < '${todayDate}' in ${timezone}).`,
        );
      }

      occurrence.date = trimmedDate;
    }

    // 3. Time interval modification
    const hasStartTimeChange = dto.startTime !== undefined;
    const hasEndTimeChange = dto.endTime !== undefined;

    if (hasStartTimeChange || hasEndTimeChange) {
      let normalizedStartTime: string | null = occurrence.scheduledStartTime;
      if (hasStartTimeChange) {
        normalizedStartTime = dto.startTime
          ? normalizeTimeString(dto.startTime)
          : null;
      }

      let normalizedEndTime: string | null = null;
      if (hasEndTimeChange) {
        normalizedEndTime = dto.endTime
          ? normalizeTimeString(dto.endTime)
          : null;
      } else if (occurrence.scheduledDueAt) {
        try {
          const formattedEnd = formatUtcToLocalTime(
            occurrence.scheduledDueAt,
            timezone,
          );
          normalizedEndTime = normalizeTimeString(formattedEnd);
        } catch {
          normalizedEndTime = null;
        }
      }

      if (normalizedStartTime && normalizedEndTime) {
        if (normalizedEndTime <= normalizedStartTime) {
          throw new BadRequestException(
            'Scheduled end time must be later than start time.',
          );
        }
      }

      occurrence.scheduledStartTime = normalizedStartTime;
      if (normalizedStartTime) {
        occurrence.scheduledStartAt = localDateTimeToUtcDate(
          occurrence.date,
          normalizedStartTime,
          timezone,
        );
      } else {
        occurrence.scheduledStartAt = null;
      }

      if (normalizedEndTime) {
        occurrence.scheduledDueAt = localDateTimeToUtcDate(
          occurrence.date,
          normalizedEndTime,
          timezone,
        );
      } else {
        occurrence.scheduledDueAt = null;
      }
    }

    const shouldUpdateDefault =
      dto.updateTaskDefault === true && occurrence.task.type === TaskType.DAILY;

    try {
      if (shouldUpdateDefault) {
        return await this.dataSource.transaction(async (manager) => {
          const taskRepo = manager.getRepository(Task);
          const occurrenceRepo = manager.getRepository(TaskOccurrence);

          await occurrenceRepo.save(occurrence);
          occurrence.task.scheduledStartTime = occurrence.scheduledStartTime;
          await taskRepo.save(occurrence.task);

          return occurrence;
        });
      }

      return await this.dataSource
        .getRepository(TaskOccurrence)
        .save(occurrence);
    } catch (error: unknown) {
      if (this.isUniqueConstraintViolation(error)) {
        throw new ConflictException(
          `An occurrence for this task on date ${occurrence.date} already exists.`,
        );
      }
      throw error;
    }
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

  /**
   * Automatically generates missing daily occurrences for all active daily tasks across all users.
   * Runs as a background worker job (e.g. hourly or at midnight).
   *
   * Catch-up Policy:
   * Generates missing occurrences for today and up to maxCatchUpDays (default 3) in the past.
   * Never generates occurrences for dates older than maxCatchUpDays or prior to the task's creation date.
   * Concurrency-safe and idempotent (unique constraint code 23505 ignored).
   */
  async generateDailyOccurrences(options?: {
    maxCatchUpDays?: number;
    now?: Date;
  }): Promise<{ generatedCount: number }> {
    const maxCatchUpDays = Math.min(
      Math.max(options?.maxCatchUpDays ?? 3, 0),
      3,
    );
    const now = options?.now ?? new Date();

    const dailyTasks = await this.dataSource.getRepository(Task).find({
      where: {
        type: TaskType.DAILY,
        isActive: true,
      },
      relations: {
        owner: {
          settings: true,
        },
        occurrences: true,
      },
    });

    if (dailyTasks.length === 0) {
      return { generatedCount: 0 };
    }

    // Group tasks by ownerId
    const tasksByUser = new Map<
      string,
      { userTimezone: string; tasks: Task[] }
    >();
    for (const task of dailyTasks) {
      const userId = task.ownerId;
      const userTimezone = task.owner?.settings?.timezone || 'Asia/Tehran';
      if (!tasksByUser.has(userId)) {
        tasksByUser.set(userId, { userTimezone, tasks: [] });
      }
      tasksByUser.get(userId)!.tasks.push(task);
    }

    let totalGenerated = 0;

    for (const [userId, { userTimezone }] of tasksByUser.entries()) {
      const todayDate = getTodayDateString(userTimezone, now);
      const datesToProcess: string[] = [];

      for (let offset = maxCatchUpDays; offset >= 0; offset--) {
        datesToProcess.push(addDaysToIsoDate(todayDate, -offset));
      }

      for (const targetDate of datesToProcess) {
        try {
          const countBefore = await this.dataSource
            .getRepository(TaskOccurrence)
            .count({
              where: {
                date: targetDate,
                task: { ownerId: userId },
              },
            });

          await this.ensureDailyOccurrencesForDate(userId, targetDate);

          const countAfter = await this.dataSource
            .getRepository(TaskOccurrence)
            .count({
              where: {
                date: targetDate,
                task: { ownerId: userId },
              },
            });

          if (countAfter > countBefore) {
            totalGenerated += countAfter - countBefore;
          }
        } catch (err: unknown) {
          this.logger.error(
            `Error generating daily occurrences for user ${userId} on date ${targetDate}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    return { generatedCount: totalGenerated };
  }

  /**
   * Retrieves all task occurrences eligible for a scheduled start notification.
   *
   * Eligibility Criteria:
   * 1. scheduledStartTime is not null.
   * 2. Current local time in user's timezone >= scheduledStartTime.
   * 3. Occurrence date matches today's date in user's timezone.
   * 4. status === TaskOccurrenceStatus.PENDING.
   * 5. notifiedAt IS NULL.
   * 6. Parent Task.isActive === true.
   */
  async getOccurrencesDueForNotification(
    now: Date = new Date(),
  ): Promise<TaskOccurrence[]> {
    const candidates = await this.dataSource
      .getRepository(TaskOccurrence)
      .find({
        where: {
          status: TaskOccurrenceStatus.PENDING,
          notifiedAt: IsNull(),
          scheduledStartTime: Not(IsNull()),
          task: {
            isActive: true,
          },
        },
        relations: {
          task: {
            owner: {
              settings: true,
              identities: true,
            },
          },
        },
      });

    const eligible: TaskOccurrence[] = [];

    for (const occurrence of candidates) {
      const user = occurrence.task?.owner;
      const userTimezone = user?.settings?.timezone || 'Asia/Tehran';

      // 1. Occurrence date must match today's date in user's timezone
      const todayDate = getTodayDateString(userTimezone, now);
      if (occurrence.date !== todayDate) {
        continue;
      }

      // 2. Current local time in user's timezone >= scheduledStartTime
      const localNowTime = formatUtcToLocalTime(now, userTimezone);
      const scheduledTime = occurrence.scheduledStartTime
        ? occurrence.scheduledStartTime.slice(0, 5)
        : null;

      if (!scheduledTime || localNowTime < scheduledTime) {
        continue;
      }

      eligible.push(occurrence);
    }

    return eligible;
  }

  /**
   * Updates notifiedAt timestamp on a task occurrence once delivery succeeds or is acknowledged.
   */
  async markOccurrenceNotified(
    occurrenceId: string,
    notifiedAt: Date = new Date(),
  ): Promise<void> {
    await this.dataSource
      .getRepository(TaskOccurrence)
      .update({ id: occurrenceId }, { notifiedAt });
  }

  /**
   * Marks unacknowledged scheduled occurrences as NOT_COMPLETED after 30 minutes.
   *
   * Timeout Criteria:
   * 1. scheduledStartTime IS NOT NULL.
   * 2. status IS STRICTLY PENDING (occurrences in IN_PROGRESS, COMPLETED, etc. are never overwritten).
   * 3. date <= todayDate in user's timezone.
   * 4. Elapsed time since local scheduledStartTime on that date >= 30 minutes.
   * Untimed tasks are NEVER timed out.
   */
  async markTimedOutOccurrences(
    now: Date = new Date(),
  ): Promise<{ timedOutCount: number }> {
    const candidates = await this.dataSource
      .getRepository(TaskOccurrence)
      .find({
        where: {
          status: TaskOccurrenceStatus.PENDING,
          scheduledStartTime: Not(IsNull()),
        },
        relations: {
          task: {
            owner: {
              settings: true,
            },
          },
        },
      });

    let timedOutCount = 0;
    const occurrenceRepo = this.dataSource.getRepository(TaskOccurrence);

    for (const occurrence of candidates) {
      if (!occurrence.scheduledStartTime) {
        continue;
      }

      const user = occurrence.task?.owner;
      const userTimezone = user?.settings?.timezone || 'Asia/Tehran';
      const todayDate = getTodayDateString(userTimezone, now);

      // Must satisfy date <= todayDate
      if (occurrence.date > todayDate) {
        continue;
      }

      try {
        const startUtc = localDateTimeToUtcDate(
          occurrence.date,
          occurrence.scheduledStartTime,
          userTimezone,
        );

        const elapsedMinutes =
          (now.getTime() - startUtc.getTime()) / (60 * 1000);

        if (elapsedMinutes >= 30) {
          occurrence.status = TaskOccurrenceStatus.NOT_COMPLETED;
          await occurrenceRepo.save(occurrence);
          timedOutCount++;
        }
      } catch (err: unknown) {
        this.logger.error(
          `Failed to evaluate timeout for occurrence ${occurrence.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { timedOutCount };
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
