import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { DataSource, Repository, QueryFailedError } from 'typeorm';

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

import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';

describe('TasksService', () => {
  let service: TasksService;
  let dataSource: jest.Mocked<DataSource>;
  let taskRepo: jest.Mocked<Repository<Task>>;
  let occurrenceRepo: jest.Mocked<Repository<TaskOccurrence>>;
  let userRepo: jest.Mocked<Repository<User>>;
  let settingsRepo: jest.Mocked<Repository<UserSettings>>;
  let pointTxRepo: jest.Mocked<Repository<PointTransaction>>;

  const mockUser: User = {
    id: 'user-uuid-1',
    displayName: 'Pourya',
    settings: {
      userId: 'user-uuid-1',
      timezone: 'Asia/Tehran',
    } as UserSettings,
  } as User;

  beforeEach(() => {
    taskRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => ({ ...dto }) as Task),
      save: jest.fn((entity) =>
        Promise.resolve({
          id: entity.id || 'task-uuid-1',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...entity,
        } as Task),
      ),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as jest.Mocked<Repository<Task>>;

    occurrenceRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => ({ ...dto }) as TaskOccurrence),
      save: jest.fn((entity) =>
        Promise.resolve({
          id: entity.id || 'occurrence-uuid-1',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...entity,
        } as TaskOccurrence),
      ),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as jest.Mocked<Repository<TaskOccurrence>>;

    userRepo = {
      findOne: jest.fn().mockResolvedValue(mockUser),
    } as unknown as jest.Mocked<Repository<User>>;

    settingsRepo = {
      findOne: jest.fn().mockResolvedValue(mockUser.settings),
    } as unknown as jest.Mocked<Repository<UserSettings>>;

    pointTxRepo = {
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      })),
    } as unknown as jest.Mocked<Repository<PointTransaction>>;

    dataSource = {
      getRepository: jest.fn((entity) => {
        if (entity === Task) return taskRepo;
        if (entity === TaskOccurrence) return occurrenceRepo;
        if (entity === User) return userRepo;
        if (entity === UserSettings) return settingsRepo;
        if (entity === PointTransaction) return pointTxRepo;
        return null;
      }),
      transaction: jest.fn(async (cb) => {
        const manager = {
          getRepository: (entity: any) => {
            if (entity === Task) return taskRepo;
            if (entity === TaskOccurrence) return occurrenceRepo;
            if (entity === PointTransaction) return pointTxRepo;
            return null;
          },
        };
        return await cb(manager);
      }),
    } as unknown as jest.Mocked<DataSource>;

    service = new TasksService(dataSource);
  });

  describe('createTask', () => {
    it('should successfully create a one-time task with its initial occurrence atomically', async () => {
      const dto: CreateTaskDto = {
        title: 'Submit tax report',
        description: 'Prepare and submit online',
        priority: TaskPriority.HIGH,
        type: TaskType.ONE_TIME,
        date: '2026-10-25',
        scheduledStartTime: '09:00',
        estimatedMinutes: 45,
      };

      const result = await service.createTask('user-uuid-1', dto);

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(taskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'user-uuid-1',
          title: 'Submit tax report',
          description: 'Prepare and submit online',
          priority: TaskPriority.HIGH,
          type: TaskType.ONE_TIME,
          scheduledStartTime: '09:00:00',
          estimatedMinutes: 45,
          isActive: true,
        }),
      );
      expect(occurrenceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-uuid-1',
          date: '2026-10-25',
          scheduledStartTime: '09:00:00',
          status: TaskOccurrenceStatus.PENDING,
        }),
      );
      expect(result.id).toBe('occurrence-uuid-1');
      expect(result.task).toBeDefined();
    });

    it('should successfully create a daily recurring task defaulting to today in user timezone if date omitted', async () => {
      const dto: CreateTaskDto = {
        title: 'Morning stretch',
        type: TaskType.DAILY,
        scheduledStartTime: '07:30',
      };

      const result = await service.createTask('user-uuid-1', dto);

      expect(taskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TaskType.DAILY,
          scheduledStartTime: '07:30:00',
        }),
      );
      expect(occurrenceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduledStartTime: '07:30:00',
          date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      );
      expect(result.task.type).toBe(TaskType.DAILY);
    });

    it('should throw BadRequestException if one-time task has no date', async () => {
      const dto: CreateTaskDto = {
        title: 'No date task',
        type: TaskType.ONE_TIME,
      };

      await expect(service.createTask('user-uuid-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for empty title or title exceeding 160 chars', async () => {
      await expect(
        service.createTask('user-uuid-1', {
          title: '   ',
          date: '2026-10-20',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createTask('user-uuid-1', {
          title: 'A'.repeat(161),
          date: '2026-10-20',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid calendar date', async () => {
      await expect(
        service.createTask('user-uuid-1', {
          title: 'Invalid date task',
          date: '2026-02-30',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid time format or negative duration', async () => {
      await expect(
        service.createTask('user-uuid-1', {
          title: 'Bad time task',
          date: '2026-10-20',
          scheduledStartTime: '25:00',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createTask('user-uuid-1', {
          title: 'Bad duration task',
          date: '2026-10-20',
          estimatedMinutes: -10,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if user does not exist', async () => {
      userRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.createTask('unknown-user', {
          title: 'Task',
          date: '2026-10-20',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate transaction error when creation fails atomically', async () => {
      dataSource.transaction.mockRejectedValueOnce(
        new Error('Transaction aborted by database'),
      );

      await expect(
        service.createTask('user-uuid-1', {
          title: 'Task',
          date: '2026-10-20',
        }),
      ).rejects.toThrow('Transaction aborted by database');
    });
    it('should successfully persist scheduledDueAt and scheduledStartAt if provided', async () => {
      const scheduledDueAt = new Date('2026-10-25T11:00:00.000Z');
      const scheduledStartAt = new Date('2026-10-25T09:00:00.000Z');
      const dto: CreateTaskDto = {
        title: 'Task with timestamps',
        date: '2026-10-25',
        scheduledStartTime: '09:00:00',
        scheduledStartAt,
        scheduledDueAt,
      };

      await service.createTask('user-uuid-1', dto);

      expect(occurrenceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduledStartAt,
          scheduledDueAt,
        }),
      );
    });
  });

  describe('createTasks (bulk atomic creation)', () => {
    it('should atomically create multiple tasks in one transaction', async () => {
      const dtos: CreateTaskDto[] = [
        { title: 'Task 1', date: '2026-10-20' },
        { title: 'Task 2', date: '2026-10-20', priority: TaskPriority.HIGH },
      ];

      const results = await service.createTasks('user-uuid-1', dtos);

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(results).toHaveLength(2);
      expect(results[0].task.title).toBe('Task 1');
      expect(results[1].task.title).toBe('Task 2');
    });

    it('should persist scheduledDueAt across bulk created tasks', async () => {
      const dueAt = new Date('2026-10-20T12:00:00.000Z');
      const dtos: CreateTaskDto[] = [
        {
          title: 'Study session',
          date: '2026-10-20',
          scheduledStartTime: '10:00:00',
          scheduledDueAt: dueAt,
        },
      ];

      await service.createTasks('user-uuid-1', dtos);

      expect(occurrenceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduledDueAt: dueAt,
        }),
      );
    });

    it('should throw BadRequestException if task list is empty', async () => {
      await expect(service.createTasks('user-uuid-1', [])).rejects.toThrow(
        BadRequestException,
      );
    });

    it('createTasks: should reject batch if any one-time task has a past date and not save any tasks or occurrences', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-18T12:00:00.000Z'));

      const dtos: CreateTaskDto[] = [
        { title: 'Valid task', type: TaskType.ONE_TIME, date: '2026-10-20' },
        { title: 'Past task', type: TaskType.ONE_TIME, date: '2026-10-15' },
      ];

      await expect(service.createTasks('user-uuid-1', dtos)).rejects.toThrow(
        BadRequestException,
      );

      // Verify that transaction was never committed and repos were never called for persistence
      expect(occurrenceRepo.create).not.toHaveBeenCalled();
      expect(taskRepo.save).not.toHaveBeenCalled();
      expect(occurrenceRepo.save).not.toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('past-date validation for one-time tasks', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-18T12:00:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should reject one-time task with date in the past (yesterday)', async () => {
      // In Asia/Tehran at 2026-10-18T12:00:00Z, local date is 2026-10-18. Yesterday is 2026-10-17.
      await expect(
        service.createTask('user-uuid-1', {
          title: 'Past task',
          type: TaskType.ONE_TIME,
          date: '2026-10-17',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept one-time task with date today in user timezone', async () => {
      // Today in Asia/Tehran is 2026-10-18
      const result = await service.createTask('user-uuid-1', {
        title: 'Today task',
        type: TaskType.ONE_TIME,
        date: '2026-10-18',
      });
      expect(result).toBeDefined();
    });

    it('should accept one-time task with a future date', async () => {
      const result = await service.createTask('user-uuid-1', {
        title: 'Future task',
        type: TaskType.ONE_TIME,
        date: '2026-10-25',
      });
      expect(result).toBeDefined();
    });

    it('should correctly evaluate date boundary across different timezones', async () => {
      // At 2026-10-18T21:00:00Z:
      // UTC date is 2026-10-18.
      // Asia/Tehran date is 2026-10-19 (+03:30).
      jest.setSystemTime(new Date('2026-10-18T21:00:00.000Z'));

      // For Tehran user (user-uuid-1), today is 2026-10-19. Therefore 2026-10-18 is yesterday -> rejected!
      await expect(
        service.createTask('user-uuid-1', {
          title: 'Boundary task',
          type: TaskType.ONE_TIME,
          date: '2026-10-18',
        }),
      ).rejects.toThrow(BadRequestException);

      // For UTC user, today is 2026-10-18 -> 2026-10-18 is accepted!
      userRepo.findOne.mockResolvedValueOnce({
        id: 'user-utc',
        displayName: 'UTC User',
        settings: { userId: 'user-utc', timezone: 'UTC' } as UserSettings,
      } as User);

      const resultUtc = await service.createTask('user-utc', {
        title: 'UTC task',
        type: TaskType.ONE_TIME,
        date: '2026-10-18',
      });
      expect(resultUtc).toBeDefined();
    });
  });

  describe('getOccurrencesForDate', () => {
    it('should query occurrences for requested calendar date and user', async () => {
      const mockOccurrences = [
        { id: 'occ-1', date: '2026-10-20' } as TaskOccurrence,
      ];
      occurrenceRepo.find.mockResolvedValueOnce(mockOccurrences);

      const result = await service.getOccurrencesForDate(
        'user-uuid-1',
        '2026-10-20',
      );

      expect(occurrenceRepo.find).toHaveBeenCalledWith({
        where: {
          date: '2026-10-20',
          task: { ownerId: 'user-uuid-1' },
        },
        relations: { task: true },
        order: {
          scheduledStartTime: 'ASC',
          createdAt: 'ASC',
        },
      });
      expect(result).toEqual(mockOccurrences);
    });

    it('should default to user timezone today when date is omitted', async () => {
      occurrenceRepo.find.mockResolvedValueOnce([]);

      await service.getOccurrencesForDate('user-uuid-1');

      expect(occurrenceRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            task: { ownerId: 'user-uuid-1' },
            date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          }),
        }),
      );
    });

    it('should throw BadRequestException for invalid date format', async () => {
      await expect(
        service.getOccurrencesForDate('user-uuid-1', 'not-a-date'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('ensureDailyOccurrencesForDate', () => {
    it('should create missing occurrence for active daily task on requested date', async () => {
      const activeDailyTask: Task = {
        id: 'daily-task-1',
        ownerId: 'user-uuid-1',
        type: TaskType.DAILY,
        isActive: true,
        title: 'Daily Exercise',
        scheduledStartTime: '08:00:00',
        occurrences: [
          {
            id: 'old-occ',
            taskId: 'daily-task-1',
            date: '2026-10-17',
            scheduledDueAt: new Date('2026-10-17T06:30:00.000Z'), // 10:00 Tehran
          } as TaskOccurrence,
        ],
      } as Task;

      taskRepo.find.mockResolvedValueOnce([activeDailyTask]);
      // No existing occurrences for 2026-10-18
      occurrenceRepo.find.mockResolvedValueOnce([]);

      const result = await service.ensureDailyOccurrencesForDate(
        'user-uuid-1',
        '2026-10-18',
      );

      expect(occurrenceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'daily-task-1',
          date: '2026-10-18',
          scheduledStartTime: '08:00:00',
          status: TaskOccurrenceStatus.PENDING,
          scheduledDueAt: expect.any(Date),
        }),
      );
      expect(occurrenceRepo.save).toHaveBeenCalled();
      expect(result.length).toBe(1);
    });

    it('should not create duplicate occurrence if one already exists for that date', async () => {
      const activeDailyTask: Task = {
        id: 'daily-task-1',
        ownerId: 'user-uuid-1',
        type: TaskType.DAILY,
        isActive: true,
      } as Task;

      const existingOcc: TaskOccurrence = {
        id: 'occ-already-exists',
        taskId: 'daily-task-1',
        date: '2026-10-18',
        status: TaskOccurrenceStatus.PENDING,
      } as TaskOccurrence;

      taskRepo.find.mockResolvedValueOnce([activeDailyTask]);
      occurrenceRepo.find.mockResolvedValueOnce([existingOcc]);

      const result = await service.ensureDailyOccurrencesForDate(
        'user-uuid-1',
        '2026-10-18',
      );

      expect(occurrenceRepo.create).not.toHaveBeenCalled();
      expect(occurrenceRepo.save).not.toHaveBeenCalled();
      expect(result).toEqual([existingOcc]);
    });

    it('should skip tasks that are inactive', async () => {
      // taskRepo.find queries with isActive: true, so inactive tasks are filtered out
      taskRepo.find.mockResolvedValueOnce([]);
      occurrenceRepo.find.mockResolvedValueOnce([]);

      const result = await service.ensureDailyOccurrencesForDate(
        'user-uuid-1',
        '2026-10-18',
      );

      expect(occurrenceRepo.save).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should skip dates before task start date', async () => {
      const futureDailyTask: Task = {
        id: 'daily-task-future',
        ownerId: 'user-uuid-1',
        type: TaskType.DAILY,
        isActive: true,
        occurrences: [
          {
            id: 'occ-future',
            date: '2026-10-25',
          } as TaskOccurrence,
        ],
      } as Task;

      taskRepo.find.mockResolvedValueOnce([futureDailyTask]);
      occurrenceRepo.find.mockResolvedValueOnce([]);

      const result = await service.ensureDailyOccurrencesForDate(
        'user-uuid-1',
        '2026-10-18',
      );

      expect(occurrenceRepo.save).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should safely handle concurrent creation (code 23505) without throwing', async () => {
      const activeDailyTask: Task = {
        id: 'daily-task-1',
        ownerId: 'user-uuid-1',
        type: TaskType.DAILY,
        isActive: true,
      } as Task;

      taskRepo.find.mockResolvedValueOnce([activeDailyTask]);
      occurrenceRepo.find.mockResolvedValueOnce([]);

      const uniqueViolationError = new QueryFailedError(
        'query',
        [],
        new Error(),
      );
      (uniqueViolationError as any).driverError = { code: '23505' };
      occurrenceRepo.save.mockRejectedValueOnce(uniqueViolationError);

      await expect(
        service.ensureDailyOccurrencesForDate('user-uuid-1', '2026-10-18'),
      ).resolves.not.toThrow();
    });

    it('should sort timed tasks before untimed tasks and use deterministic secondary ordering', async () => {
      taskRepo.find.mockResolvedValueOnce([]);
      const untimedOcc: TaskOccurrence = {
        id: 'occ-untimed',
        date: '2026-10-18',
        scheduledStartTime: null,
        createdAt: new Date('2026-10-18T05:00:00Z'),
      } as TaskOccurrence;
      const timedLater: TaskOccurrence = {
        id: 'occ-late',
        date: '2026-10-18',
        scheduledStartTime: '18:00:00',
        createdAt: new Date('2026-10-18T06:00:00Z'),
      } as TaskOccurrence;
      const timedEarlier: TaskOccurrence = {
        id: 'occ-early',
        date: '2026-10-18',
        scheduledStartTime: '09:00:00',
        createdAt: new Date('2026-10-18T07:00:00Z'),
      } as TaskOccurrence;

      occurrenceRepo.find.mockResolvedValueOnce([
        untimedOcc,
        timedLater,
        timedEarlier,
      ]);

      const result = await service.ensureDailyOccurrencesForDate(
        'user-uuid-1',
        '2026-10-18',
      );

      expect(result.map((r) => r.id)).toEqual([
        'occ-early',
        'occ-late',
        'occ-untimed',
      ]);
    });
  });

  describe('getOccurrenceById (Ownership Enforcement)', () => {
    it('should return occurrence when user is owner', async () => {
      const occurrence = {
        id: 'occ-1',
        task: { ownerId: 'user-uuid-1' } as Task,
      } as TaskOccurrence;
      occurrenceRepo.findOne.mockResolvedValueOnce(occurrence);

      const result = await service.getOccurrenceById('user-uuid-1', 'occ-1');
      expect(result).toBe(occurrence);
    });

    it('should throw ForbiddenException if caller is not the task owner', async () => {
      const occurrence = {
        id: 'occ-1',
        task: { ownerId: 'different-user' } as Task,
      } as TaskOccurrence;
      occurrenceRepo.findOne.mockResolvedValueOnce(occurrence);

      await expect(
        service.getOccurrenceById('user-uuid-1', 'occ-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if occurrence does not exist', async () => {
      occurrenceRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.getOccurrenceById('user-uuid-1', 'non-existent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getUserTasks and getTaskById', () => {
    it('should return tasks owned by the user', async () => {
      const tasks = [{ id: 't-1', ownerId: 'user-uuid-1' } as Task];
      taskRepo.find.mockResolvedValueOnce(tasks);

      const result = await service.getUserTasks('user-uuid-1');
      expect(result).toBe(tasks);
    });

    it('should throw ForbiddenException when accessing another user task', async () => {
      taskRepo.findOne.mockResolvedValueOnce({
        id: 't-1',
        ownerId: 'other-user',
      } as Task);

      await expect(service.getTaskById('user-uuid-1', 't-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('deactivateTask', () => {
    it('should set isActive to false and set archivedAt without deleting occurrences', async () => {
      const task = {
        id: 't-1',
        ownerId: 'user-uuid-1',
        isActive: true,
        archivedAt: null,
      } as Task;
      taskRepo.findOne.mockResolvedValueOnce(task);

      const result = await service.deactivateTask('user-uuid-1', 't-1');

      expect(result.isActive).toBe(false);
      expect(result.archivedAt).toBeInstanceOf(Date);
      expect(occurrenceRepo.save).not.toHaveBeenCalled(); // occurrences untouched
    });
  });

  describe('Occurrence Status Transitions', () => {
    let mockOccurrence: TaskOccurrence;

    beforeEach(() => {
      mockOccurrence = {
        id: 'occ-1',
        status: TaskOccurrenceStatus.PENDING,
        startedAt: null,
        completedAt: null,
        task: {
          id: 'task-1',
          ownerId: 'user-uuid-1',
          type: TaskType.DAILY,
          isActive: true,
        } as Task,
      } as TaskOccurrence;

      occurrenceRepo.findOne.mockResolvedValue(mockOccurrence);
    });

    it('startOccurrence: should set status to IN_PROGRESS and record startedAt', async () => {
      const result = await service.startOccurrence('user-uuid-1', 'occ-1');

      expect(result.status).toBe(TaskOccurrenceStatus.IN_PROGRESS);
      expect(result.startedAt).toBeInstanceOf(Date);
    });

    it('startOccurrence: should be idempotent if already IN_PROGRESS', async () => {
      const initialStartedAt = new Date('2026-10-18T08:00:00Z');
      mockOccurrence.status = TaskOccurrenceStatus.IN_PROGRESS;
      mockOccurrence.startedAt = initialStartedAt;

      const result = await service.startOccurrence('user-uuid-1', 'occ-1');

      expect(result.status).toBe(TaskOccurrenceStatus.IN_PROGRESS);
      expect(result.startedAt).toBe(initialStartedAt);
    });

    it('completeOccurrence: should set status to COMPLETED and record completedAt and startedAt', async () => {
      const result = await service.completeOccurrence('user-uuid-1', 'occ-1');

      expect(result.status).toBe(TaskOccurrenceStatus.COMPLETED);
      expect(result.completedAt).toBeInstanceOf(Date);
      expect(result.startedAt).toBeDefined();
    });

    it('completeOccurrence: should be idempotent if already COMPLETED', async () => {
      mockOccurrence.status = TaskOccurrenceStatus.COMPLETED;
      mockOccurrence.completedAt = new Date();

      const result = await service.completeOccurrence('user-uuid-1', 'occ-1');
      expect(result.status).toBe(TaskOccurrenceStatus.COMPLETED);
    });

    it('partiallyCompleteOccurrence: should set status to PARTIALLY_COMPLETED', async () => {
      const result = await service.partiallyCompleteOccurrence(
        'user-uuid-1',
        'occ-1',
      );

      expect(result.status).toBe(TaskOccurrenceStatus.PARTIALLY_COMPLETED);
      expect(result.completedAt).toBeInstanceOf(Date);
    });

    it('markOccurrenceNotCompleted: should set status to NOT_COMPLETED', async () => {
      const result = await service.markOccurrenceNotCompleted(
        'user-uuid-1',
        'occ-1',
      );

      expect(result.status).toBe(TaskOccurrenceStatus.NOT_COMPLETED);
    });

    it('skipOccurrence: should skip occurrence without deactivating parent recurring task', async () => {
      const result = await service.skipOccurrence('user-uuid-1', 'occ-1');

      expect(result.status).toBe(TaskOccurrenceStatus.SKIPPED);
      expect(result.task.isActive).toBe(true);
    });

    it('cancelOccurrence: should set status to CANCELLED', async () => {
      const result = await service.cancelOccurrence('user-uuid-1', 'occ-1');

      expect(result.status).toBe(TaskOccurrenceStatus.CANCELLED);
    });

    it('should reject status changes when occurrence is already in terminal COMPLETED state', async () => {
      mockOccurrence.status = TaskOccurrenceStatus.COMPLETED;

      await expect(
        service.startOccurrence('user-uuid-1', 'occ-1'),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.skipOccurrence('user-uuid-1', 'occ-1'),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.cancelOccurrence('user-uuid-1', 'occ-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject status changes when occurrence is already CANCELLED', async () => {
      mockOccurrence.status = TaskOccurrenceStatus.CANCELLED;

      await expect(
        service.completeOccurrence('user-uuid-1', 'occ-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('rescheduleOccurrence', () => {
    let mockOccurrence: TaskOccurrence;

    beforeEach(() => {
      mockOccurrence = {
        id: 'occ-1',
        scheduledStartTime: '08:00:00',
        status: TaskOccurrenceStatus.PENDING,
        task: {
          id: 'task-1',
          ownerId: 'user-uuid-1',
          type: TaskType.DAILY,
          scheduledStartTime: '08:00:00',
        } as Task,
      } as TaskOccurrence;

      occurrenceRepo.findOne.mockResolvedValue(mockOccurrence);
    });

    it('should update occurrence scheduledStartTime only when updateTaskDefault is false', async () => {
      const result = await service.rescheduleOccurrence(
        'user-uuid-1',
        'occ-1',
        {
          newStartTime: '10:30',
          updateTaskDefault: false,
        },
      );

      expect(result.scheduledStartTime).toBe('10:30:00');
      expect(result.task.scheduledStartTime).toBe('08:00:00'); // untouched
    });

    it('should update both occurrence and task default start time when updateTaskDefault is true for recurring task', async () => {
      const result = await service.rescheduleOccurrence(
        'user-uuid-1',
        'occ-1',
        {
          newStartTime: '11:00',
          updateTaskDefault: true,
        },
      );

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result.scheduledStartTime).toBe('11:00:00');
      expect(result.task.scheduledStartTime).toBe('11:00:00');
    });

    it('should throw BadRequestException if trying to reschedule a completed or cancelled occurrence', async () => {
      mockOccurrence.status = TaskOccurrenceStatus.COMPLETED;

      await expect(
        service.rescheduleOccurrence('user-uuid-1', 'occ-1', {
          newStartTime: '10:00',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createOccurrenceForDate (Daily Occurrence & Conflict Safeguard)', () => {
    let mockTask: Task;

    beforeEach(() => {
      mockTask = {
        id: 'task-1',
        ownerId: 'user-uuid-1',
        type: TaskType.DAILY,
        isActive: true,
        scheduledStartTime: '08:30:00',
      } as Task;

      taskRepo.findOne.mockResolvedValue(mockTask);
    });

    it('should successfully create occurrence for a valid date', async () => {
      occurrenceRepo.findOne.mockResolvedValueOnce(null); // no existing

      const result = await service.createOccurrenceForDate(
        'user-uuid-1',
        'task-1',
        '2026-10-21',
      );

      expect(occurrenceRepo.create).toHaveBeenCalledWith({
        taskId: 'task-1',
        date: '2026-10-21',
        scheduledStartTime: '08:30:00',
        status: TaskOccurrenceStatus.PENDING,
      });
      expect(result.date).toBe('2026-10-21');
    });

    it('should throw ConflictException if occurrence already exists for that date', async () => {
      occurrenceRepo.findOne.mockResolvedValueOnce({
        id: 'existing-occ',
        taskId: 'task-1',
        date: '2026-10-21',
      } as TaskOccurrence);

      await expect(
        service.createOccurrenceForDate('user-uuid-1', 'task-1', '2026-10-21'),
      ).rejects.toThrow(ConflictException);
    });

    it('should catch database unique constraint violation (code 23505) and throw ConflictException', async () => {
      occurrenceRepo.findOne.mockResolvedValueOnce(null);

      const dbError = new QueryFailedError('query', [], new Error('duplicate'));
      (dbError as any).driverError = { code: '23505' };
      occurrenceRepo.save.mockRejectedValueOnce(dbError);

      await expect(
        service.createOccurrenceForDate('user-uuid-1', 'task-1', '2026-10-21'),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException if task is inactive', async () => {
      mockTask.isActive = false;

      await expect(
        service.createOccurrenceForDate('user-uuid-1', 'task-1', '2026-10-21'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateTask', () => {
    it('should update task title, description, and priority', async () => {
      const task = {
        id: 'task-1',
        ownerId: 'user-uuid-1',
        title: 'Old Title',
        description: 'Old Description',
        priority: TaskPriority.NORMAL,
      } as Task;
      taskRepo.findOne.mockResolvedValueOnce(task);

      const result = await service.updateTask('user-uuid-1', 'task-1', {
        title: 'New Title',
        description: 'New Description',
        priority: TaskPriority.HIGH,
      });

      expect(result.title).toBe('New Title');
      expect(result.description).toBe('New Description');
      expect(result.priority).toBe(TaskPriority.HIGH);
      expect(taskRepo.save).toHaveBeenCalled();
    });

    it('should allow clearing description with empty string or null', async () => {
      const task = {
        id: 'task-1',
        ownerId: 'user-uuid-1',
        title: 'Title',
        description: 'Has Description',
        priority: TaskPriority.NORMAL,
      } as Task;
      taskRepo.findOne.mockResolvedValueOnce(task);

      const result = await service.updateTask('user-uuid-1', 'task-1', {
        description: '   ',
      });

      expect(result.description).toBeNull();
    });

    it('should throw BadRequestException if title is empty or exceeds 160 characters', async () => {
      const task = {
        id: 'task-1',
        ownerId: 'user-uuid-1',
        title: 'Title',
      } as Task;
      taskRepo.findOne.mockResolvedValue(task);

      await expect(
        service.updateTask('user-uuid-1', 'task-1', { title: '   ' }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.updateTask('user-uuid-1', 'task-1', { title: 'a'.repeat(161) }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should preserve historical occurrences when updating task definition', async () => {
      const task = {
        id: 'task-1',
        ownerId: 'user-uuid-1',
        title: 'Title',
        occurrences: [{ id: 'occ-1', status: TaskOccurrenceStatus.COMPLETED }],
      } as unknown as Task;
      taskRepo.findOne.mockResolvedValueOnce(task);

      await service.updateTask('user-uuid-1', 'task-1', {
        title: 'Updated Title',
      });

      expect(occurrenceRepo.save).not.toHaveBeenCalled();
      expect(occurrenceRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('updateOccurrenceSchedule', () => {
    it('should clear schedule when clearSchedule is true', async () => {
      const occurrence = {
        id: 'occ-1',
        date: '2026-10-20',
        scheduledStartTime: '10:00:00',
        scheduledStartAt: new Date(),
        scheduledDueAt: new Date(),
        status: TaskOccurrenceStatus.PENDING,
        task: {
          id: 'task-1',
          ownerId: 'user-uuid-1',
          type: TaskType.DAILY,
          scheduledStartTime: '10:00:00',
        },
      } as unknown as TaskOccurrence;
      occurrenceRepo.findOne.mockResolvedValueOnce(occurrence);

      const result = await service.updateOccurrenceSchedule(
        'user-uuid-1',
        'occ-1',
        { clearSchedule: true, updateTaskDefault: true },
      );

      expect(result.scheduledStartTime).toBeNull();
      expect(result.scheduledStartAt).toBeNull();
      expect(result.scheduledDueAt).toBeNull();
      expect(result.task.scheduledStartTime).toBeNull();
    });

    it('should update date for one-time task on future/today date', async () => {
      const occurrence = {
        id: 'occ-1',
        date: '2026-10-20',
        status: TaskOccurrenceStatus.PENDING,
        task: {
          id: 'task-1',
          ownerId: 'user-uuid-1',
          type: TaskType.ONE_TIME,
        },
      } as unknown as TaskOccurrence;
      occurrenceRepo.findOne.mockResolvedValueOnce(occurrence);

      const result = await service.updateOccurrenceSchedule(
        'user-uuid-1',
        'occ-1',
        { date: '2026-10-25' },
      );

      expect(result.date).toBe('2026-10-25');
    });

    it('should reject date change for daily recurring task', async () => {
      const occurrence = {
        id: 'occ-1',
        date: '2026-10-20',
        status: TaskOccurrenceStatus.PENDING,
        task: {
          id: 'task-1',
          ownerId: 'user-uuid-1',
          type: TaskType.DAILY,
        },
      } as unknown as TaskOccurrence;
      occurrenceRepo.findOne.mockResolvedValueOnce(occurrence);

      await expect(
        service.updateOccurrenceSchedule('user-uuid-1', 'occ-1', {
          date: '2026-10-25',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject past date for one-time task', async () => {
      const occurrence = {
        id: 'occ-1',
        date: '2026-10-20',
        status: TaskOccurrenceStatus.PENDING,
        task: {
          id: 'task-1',
          ownerId: 'user-uuid-1',
          type: TaskType.ONE_TIME,
        },
      } as unknown as TaskOccurrence;
      occurrenceRepo.findOne.mockResolvedValueOnce(occurrence);

      await expect(
        service.updateOccurrenceSchedule('user-uuid-1', 'occ-1', {
          date: '2020-01-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update start and end time interval', async () => {
      const occurrence = {
        id: 'occ-1',
        date: '2026-10-20',
        status: TaskOccurrenceStatus.PENDING,
        task: {
          id: 'task-1',
          ownerId: 'user-uuid-1',
          type: TaskType.ONE_TIME,
        },
      } as unknown as TaskOccurrence;
      occurrenceRepo.findOne.mockResolvedValueOnce(occurrence);

      const result = await service.updateOccurrenceSchedule(
        'user-uuid-1',
        'occ-1',
        { startTime: '10:00', endTime: '12:00' },
      );

      expect(result.scheduledStartTime).toBe('10:00:00');
      expect(result.scheduledStartAt).toBeInstanceOf(Date);
      expect(result.scheduledDueAt).toBeInstanceOf(Date);
    });

    it('should reject end time earlier than or equal to start time', async () => {
      const occurrence = {
        id: 'occ-1',
        date: '2026-10-20',
        status: TaskOccurrenceStatus.PENDING,
        task: {
          id: 'task-1',
          ownerId: 'user-uuid-1',
          type: TaskType.ONE_TIME,
        },
      } as unknown as TaskOccurrence;
      occurrenceRepo.findOne.mockResolvedValue(occurrence);

      await expect(
        service.updateOccurrenceSchedule('user-uuid-1', 'occ-1', {
          startTime: '12:00',
          endTime: '10:00',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.updateOccurrenceSchedule('user-uuid-1', 'occ-1', {
          startTime: '10:00',
          endTime: '10:00',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject rescheduling for completed or cancelled occurrence', async () => {
      const completedOcc = {
        id: 'occ-1',
        status: TaskOccurrenceStatus.COMPLETED,
        task: { ownerId: 'user-uuid-1' },
      } as unknown as TaskOccurrence;
      occurrenceRepo.findOne.mockResolvedValueOnce(completedOcc);

      await expect(
        service.updateOccurrenceSchedule('user-uuid-1', 'occ-1', {
          startTime: '10:00',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteTask', () => {
    it('should throw BadRequestException if task has completed occurrences', async () => {
      const task = {
        id: 'task-1',
        ownerId: 'user-uuid-1',
      } as Task;
      taskRepo.findOne.mockResolvedValueOnce(task);
      occurrenceRepo.find.mockResolvedValueOnce([
        {
          id: 'occ-1',
          status: TaskOccurrenceStatus.COMPLETED,
        } as TaskOccurrence,
      ]);

      await expect(service.deleteTask('user-uuid-1', 'task-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if task has point transactions', async () => {
      const task = {
        id: 'task-1',
        ownerId: 'user-uuid-1',
      } as Task;
      taskRepo.findOne.mockResolvedValueOnce(task);
      occurrenceRepo.find.mockResolvedValueOnce([
        { id: 'occ-1', status: TaskOccurrenceStatus.PENDING } as TaskOccurrence,
      ]);
      (pointTxRepo.createQueryBuilder as jest.Mock).mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(1),
      });

      await expect(service.deleteTask('user-uuid-1', 'task-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should delete non-completed occurrences and task when safe', async () => {
      const task = {
        id: 'task-1',
        ownerId: 'user-uuid-1',
      } as Task;
      taskRepo.findOne.mockResolvedValueOnce(task);
      occurrenceRepo.find.mockResolvedValueOnce([
        { id: 'occ-1', status: TaskOccurrenceStatus.PENDING } as TaskOccurrence,
        {
          id: 'occ-2',
          status: TaskOccurrenceStatus.CANCELLED,
        } as TaskOccurrence,
      ]);
      (pointTxRepo.createQueryBuilder as jest.Mock).mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      });

      await service.deleteTask('user-uuid-1', 'task-1');

      expect(occurrenceRepo.delete).toHaveBeenCalledWith({ taskId: 'task-1' });
      expect(taskRepo.delete).toHaveBeenCalledWith({ id: 'task-1' });
    });
  });
});
