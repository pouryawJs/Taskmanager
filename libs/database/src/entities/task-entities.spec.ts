import {
  Task,
  TaskType,
  TaskPriority,
  TaskOccurrence,
  TaskOccurrenceStatus,
} from '../index';

describe('Task and TaskOccurrence Entities', () => {
  describe('TaskType Enum', () => {
    it('should have ONE_TIME and DAILY values', () => {
      expect(TaskType.ONE_TIME).toBe('one_time');
      expect(TaskType.DAILY).toBe('daily');
    });
  });

  describe('TaskPriority Enum', () => {
    it('should define low, normal, and high priorities', () => {
      expect(TaskPriority.LOW).toBe('low');
      expect(TaskPriority.NORMAL).toBe('normal');
      expect(TaskPriority.HIGH).toBe('high');
    });
  });

  describe('TaskOccurrenceStatus Enum', () => {
    it('should define all 7 required status outcomes', () => {
      expect(TaskOccurrenceStatus.PENDING).toBe('pending');
      expect(TaskOccurrenceStatus.IN_PROGRESS).toBe('in_progress');
      expect(TaskOccurrenceStatus.COMPLETED).toBe('completed');
      expect(TaskOccurrenceStatus.PARTIALLY_COMPLETED).toBe(
        'partially_completed',
      );
      expect(TaskOccurrenceStatus.NOT_COMPLETED).toBe('not_completed');
      expect(TaskOccurrenceStatus.SKIPPED).toBe('skipped');
      expect(TaskOccurrenceStatus.CANCELLED).toBe('cancelled');
    });
  });

  describe('Task Entity instantiation', () => {
    it('should instantiate a one-time task with default values', () => {
      const task = new Task();
      task.id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
      task.ownerId = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
      task.title = 'Complete Phase 2 report';
      task.type = TaskType.ONE_TIME;
      task.priority = TaskPriority.NORMAL;
      task.scheduledStartTime = null;
      task.estimatedMinutes = 30;
      task.isActive = true;

      expect(task.title).toBe('Complete Phase 2 report');
      expect(task.type).toBe(TaskType.ONE_TIME);
      expect(task.priority).toBe(TaskPriority.NORMAL);
      expect(task.scheduledStartTime).toBeNull();
      expect(task.estimatedMinutes).toBe(30);
      expect(task.isActive).toBe(true);
    });

    it('should instantiate a daily recurring task with scheduled start time', () => {
      const task = new Task();
      task.title = 'Morning workout';
      task.type = TaskType.DAILY;
      task.priority = TaskPriority.HIGH;
      task.scheduledStartTime = '07:30:00';
      task.isActive = true;

      expect(task.type).toBe(TaskType.DAILY);
      expect(task.scheduledStartTime).toBe('07:30:00');
      expect(task.priority).toBe(TaskPriority.HIGH);
    });
  });

  describe('TaskOccurrence Entity instantiation', () => {
    it('should instantiate an occurrence with calendar date and status', () => {
      const occurrence = new TaskOccurrence();
      occurrence.id = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';
      occurrence.taskId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
      occurrence.date = '2026-10-18';
      occurrence.scheduledStartTime = '07:30:00';
      occurrence.status = TaskOccurrenceStatus.PENDING;

      expect(occurrence.date).toBe('2026-10-18');
      expect(occurrence.scheduledStartTime).toBe('07:30:00');
      expect(occurrence.status).toBe(TaskOccurrenceStatus.PENDING);
    });

    it('should support skipped status while parent task remains active', () => {
      const task = new Task();
      task.type = TaskType.DAILY;
      task.isActive = true;

      const occurrenceToday = new TaskOccurrence();
      occurrenceToday.task = task;
      occurrenceToday.date = '2026-10-18';
      occurrenceToday.status = TaskOccurrenceStatus.SKIPPED;

      expect(occurrenceToday.status).toBe(TaskOccurrenceStatus.SKIPPED);
      expect(occurrenceToday.task.isActive).toBe(true);
    });

    it('should support not_completed status for timed out tasks', () => {
      const occurrence = new TaskOccurrence();
      occurrence.date = '2026-10-18';
      occurrence.status = TaskOccurrenceStatus.NOT_COMPLETED;

      expect(occurrence.status).toBe(TaskOccurrenceStatus.NOT_COMPLETED);
    });
  });
});
