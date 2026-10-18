# Feature: Task Management Core Domain

> Delivery-agnostic task creation, occurrence retrieval, status state-machine transitions, rescheduling, and ownership enforcement.

Related: [Project Context](../PROJECT_CONTEXT.md) | [System Architecture](../architecture.md) | [Database Architecture](../database.md) | [Architecture Decisions](../decisions.md)

---

## 1. Purpose & Scope

The **Task Management Core** library module resides in `libs/core/src/tasks/` and encapsulates all core business rules and persistence coordination for tasks and daily occurrences. It is delivery-agnostic and serves as the single source of truth for both `apps/bot` (Telegram) and `apps/api` (HTTP REST).

### Key Responsibilities:
1. **Task & Initial Occurrence Creation**: Provisioning reusable task definitions (`Task`) and discrete initial executions (`TaskOccurrence`) atomically within database transactions.
2. **Occurrence Queries**: Listing occurrences for a specific calendar date with strict user ownership validation, automatically resolving "today" using the user's `UserSettings.timezone`.
3. **Status State Machine**: Enforcing valid transitions for occurrence execution states (`PENDING`, `IN_PROGRESS`, `COMPLETED`, `PARTIALLY_COMPLETED`, `NOT_COMPLETED`, `SKIPPED`, `CANCELLED`), recording timestamps, and preventing terminal states from being accidentally reverted.
4. **Rescheduling**: Updating an occurrence's scheduled start time of day, with optional atomic propagation to the parent recurring task definition's default start time.
5. **Task Lifecycle & Deactivation**: Soft-deactivating recurring tasks (`isActive = false`, `archivedAt`) to halt future occurrence generation while preserving full historical occurrences and points audit trails.
6. **Integrity & Idempotency**: Enforcing ownership on every operation, preventing duplicate daily occurrences for the same task on the same date, and handling race conditions.

---

## 2. Implementation Status

| Component | Status | Location | Notes |
|---|---|---|---|
| DTOs | Implemented | [`libs/core/src/tasks/dto/`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/tasks/dto/) | `CreateTaskDto`, `RescheduleOccurrenceDto` with `class-validator` |
| Utilities | Implemented | [`libs/core/src/tasks/utils/task-date.util.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/tasks/utils/task-date.util.ts) | Timezone-aware date resolution, calendar validation, time normalization |
| Service | Implemented | [`libs/core/src/tasks/tasks.service.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/tasks/tasks.service.ts) | Complete domain logic, atomic transactions, status state machine |
| Text Parser | Implemented | [`libs/core/src/tasks/parser/task-text-parser.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/tasks/parser/task-text-parser.ts) | Deterministic all-or-nothing multi-line parser for English & Persian syntax |
| Module | Implemented | [`libs/core/src/tasks/tasks.module.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/tasks/tasks.module.ts) | Exported under `@app/core` |
| Unit Tests | Verified (143/143 passing) | [`libs/core/src/tasks/`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/tasks/) | Service, date utility, and comprehensive text parser test suites |

---

## 3. Relevant Source Files

- [`libs/core/src/tasks/tasks.module.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/tasks/tasks.module.ts)
- [`libs/core/src/tasks/tasks.service.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/tasks/tasks.service.ts)
- [`libs/core/src/tasks/parser/task-text-parser.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/tasks/parser/task-text-parser.ts)
- [`libs/core/src/tasks/parser/task-text-parser.spec.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/tasks/parser/task-text-parser.spec.ts)
- [`libs/core/src/tasks/dto/create-task.dto.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/tasks/dto/create-task.dto.ts)
- [`libs/core/src/tasks/dto/reschedule-occurrence.dto.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/tasks/dto/reschedule-occurrence.dto.ts)
- [`libs/core/src/tasks/utils/task-date.util.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/tasks/utils/task-date.util.ts)
- [`libs/database/src/entities/task.entity.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/entities/task.entity.ts)
- [`libs/database/src/entities/task-occurrence.entity.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/entities/task-occurrence.entity.ts)

---

## 4. Key Service API

### 4.1 Task Creation

#### `createTask(userId: string, dto: CreateTaskDto): Promise<TaskOccurrence>`
Atomically creates a `Task` definition and its corresponding initial `TaskOccurrence` inside a single `dataSource.transaction`.
- **One-time tasks (`type = 'one_time'`)**: Requires a valid calendar date (`YYYY-MM-DD`). Creates definition and single occurrence.
- **Daily recurring tasks (`type = 'daily'`)**: If `date` is omitted, automatically resolves today's calendar date in the user's `UserSettings.timezone`. Stores optional default `scheduledStartTime` on both definition and initial occurrence.
- **Atomicity**: If either the `Task` or `TaskOccurrence` fails to persist, the transaction aborts with complete rollback.

#### `createTasks(userId: string, dtos: CreateTaskDto[]): Promise<TaskOccurrence[]>`
Batch atomic creation. Validates all task definitions up front, then persists all tasks and occurrences inside a single transaction.

---

### 4.2 Querying Tasks & Occurrences

#### `getOccurrencesForDate(userId: string, date?: string): Promise<TaskOccurrence[]>`
Lists all occurrences for the user on a specific calendar date (`YYYY-MM-DD`).
- If `date` is omitted, resolves today's date using the user's configured IANA timezone (default `Asia/Tehran`).
- Enforces ownership: filters by `task.ownerId = userId`.
- Orders results by `scheduledStartTime ASC NULLS LAST, createdAt ASC`.

#### `getOccurrenceById(userId: string, occurrenceId: string): Promise<TaskOccurrence>`
Retrieves an occurrence and loads its parent `task` relation. Enforces ownership: throws `ForbiddenException` if `task.ownerId !== userId`.

#### `getUserTasks(userId: string, options?: { type?: TaskType; isActive?: boolean }): Promise<Task[]>`
Retrieves task definitions owned by the user, with optional filtering by task type and active status.

#### `deactivateTask(userId: string, taskId: string): Promise<Task>`
Soft-deactivates an active recurring task (`isActive = false`, `archivedAt = new Date()`). Halts future occurrence generation while preserving all past historical occurrences and points ledger records.

---

### 4.3 Status State Machine & Transitions

Occurrences follow strict transition rules to prevent corrupted history or unintended status rewrites:

| Method | Target Status | Behavior & Side Effects |
|---|---|---|
| `startOccurrence(userId, id)` | `IN_PROGRESS` | Records `startedAt = new Date()` (if not already set). Idempotent if already `IN_PROGRESS`. |
| `completeOccurrence(userId, id)` | `COMPLETED` | Records `completedAt = new Date()`. Sets `startedAt` if null. Terminal state: cannot be transitioned to pending/skipped. |
| `partiallyCompleteOccurrence(userId, id)` | `PARTIALLY_COMPLETED` | Records `completedAt = new Date()` (if null). Indicates incomplete execution. |
| `markOccurrenceNotCompleted(userId, id)` | `NOT_COMPLETED` | Sets status when scheduled occurrence timed out without response. |
| `skipOccurrence(userId, id)` | `SKIPPED` | Explicitly skips execution for that date. **Does NOT deactivate recurring parent task.** |
| `cancelOccurrence(userId, id)` | `CANCELLED` | Explicitly cancels occurrence. Terminal state. |

**Transition Restrictions**:
- Occurrences with `COMPLETED` status cannot be altered to `PENDING`, `IN_PROGRESS`, `SKIPPED`, or `CANCELLED`.
- Occurrences with `CANCELLED` status cannot be transitioned directly to `COMPLETED` or `IN_PROGRESS`.
- Calling an action on an occurrence that already holds that status returns the occurrence idempotently without mutating timestamps.

---

### 4.4 Rescheduling

#### `rescheduleOccurrence(userId: string, occurrenceId: string, dto: RescheduleOccurrenceDto): Promise<TaskOccurrence>`
Updates an occurrence's scheduled start time of day (`HH:mm:ss`).
- **Occurrence-only (default)**: Updates `occurrence.scheduledStartTime` while preserving `Task.scheduledStartTime` unchanged.
- **Propagate to recurring default (`updateTaskDefault = true`)**: If the parent task is `DAILY`, atomically updates both `occurrence.scheduledStartTime` and `Task.scheduledStartTime` inside a transaction.
- **Terminal guard**: Completed or cancelled occurrences cannot be rescheduled.

#### `createOccurrenceForDate(userId: string, taskId: string, date: string, scheduledStartTime?: string | null): Promise<TaskOccurrence>`
Allows generating or scheduling an occurrence for an existing recurring task on a future or specific calendar date, checking ownership, verifying active state, and preventing duplicate daily occurrences via pre-check and code `23505` handling.

---

## 5. Date & Timezone Semantics

1. **Calendar Dates (`YYYY-MM-DD`)**:
   - Persisted as PostgreSQL `DATE` on `TaskOccurrence.date`.
   - Never shifted by UTC offsets.
   - Today's date is resolved using `Intl.DateTimeFormat('en-CA', { timeZone })` where `timeZone` is retrieved from the user's `UserSettings.timezone`.
2. **Start Times (`HH:mm:ss`)**:
   - Persisted as PostgreSQL `TIME` on `Task.scheduledStartTime` and `TaskOccurrence.scheduledStartTime`.
   - Represents a local time of day without date or timezone attachments, preventing unexpected UTC day rollovers.
3. **Execution Timestamps (`TIMESTAMPTZ`)**:
   - `startedAt` and `completedAt` represent exact universal timestamps in UTC for auditing and duration calculations.

---

## 6. Task Text Parser Specification

The Task Text Parser (`libs/core/src/tasks/parser/task-text-parser.ts`) provides deterministic, pure parsing and validation for multi-line user task messages in the Telegram task-entry workflow.

### 6.1 Supported Input Syntax

Each non-empty line represents exactly one task. Blank lines are ignored.

1. **Format A: Untimed Task**
   - The entire trimmed line is interpreted as the title.
   - `scheduledStartTime` and `scheduledEndTime` are `null`.
   - Examples:
     ```text
     Buy groceries
     مطالعه داکیومنت NestJS
     خواندن فصل ۲ کتاب
     ```

2. **Format B: Start Time Only (No End Time)**
   - Trailing suffix `at <time>` or `ساعت <time>`.
   - The title is the text before the suffix; `scheduledStartTime` is normalized to `HH:mm:ss`; `scheduledEndTime` is `null`.
   - Examples:
     ```text
     Exercise at 18:00
     ورزش ساعت 18:00
     جلسه کاری ساعت ۱۸:۳۰
     ```

3. **Format C: Start and End Time Interval**
   - Trailing suffix `from <start> to <end>` or `از <start> تا <end>`.
   - Both start and end times are normalized to `HH:mm:ss`.
   - Requires `scheduledEndTime > scheduledStartTime` (V1 does not support zero-length or overnight intervals).
   - Examples:
     ```text
     Study from 09:00 to 10:30
     مطالعه کتاب از 09:00 تا 10:30
     کلاس زبان از ۰۸:۱۵ تا ۱۰:۰۰
     ```

### 6.2 Normalization and Digit Handling
- **Numeral Normalization**: Persian (`۰-۹`) and Arabic-Indic (`٠-٩`) digits are mapped to ASCII digits (`0-9`) specifically within time tokens. Digits within titles (e.g. `خرید ۲ عدد کتاب`) are preserved intact.
- **Time Format**: Parsed times are normalized to `HH:mm:ss` (e.g., `9:30` -> `09:30:00`, `18:00` -> `18:00:00`).
- **Whitespace**: Leading, trailing, and redundant surrounding whitespace around titles and time tokens are stripped.

### 6.3 Validation Rules & Error Handling
- **Title Validation**:
  - Titles must not be empty after extracting the recognized time suffix.
  - Titles must not exceed 160 characters (database constraint). Titles are never silently truncated.
- **Strict Time Ranges**:
  - `00 <= HH <= 23` and `00 <= mm <= 59`. Values like `25:90` are rejected.
- **Interval Validation**:
  - End time must be strictly after start time. Suffixes like `from 10:00 to 09:00` or `from 10:00 to 10:00` are rejected.
- **No Conflicting / Ambiguous Suffixes**:
  - Conflicting repeated suffixes (e.g., `Task at 10:00 at 12:00` or `Task from 09:00 to 10:00 at 11:00`) are rejected.
  - Incomplete or malformed suffixes (e.g., `Task from 09:00` or `Task ساعت`) are rejected rather than silently remaining in the title.
- **Preservation of Ordinary Words**:
  - Words resembling time keywords within the title (e.g. `Talk at length`, `Look at the stars`) are preserved as ordinary untimed task titles.

### 6.4 All-or-Nothing Message Validation
- Every non-empty line in a message is parsed and validated.
- **If all lines are valid**: Returns all `ParsedTaskDraft` objects.
- **If any line is invalid**: Fails completely and returns all errors across all invalid lines. No partial drafts are returned.
- **1-Based Original Line Numbers**: Line numbers in validation errors reference the original user message line (including any blank lines), allowing the Telegram UI to tell the user precisely which lines to fix.

### 6.5 Output Contract (`ParsedTaskDraft`)
```typescript
export interface ParsedTaskDraft {
  title: string;
  scheduledStartTime: string | null; // 'HH:mm:ss' or null
  scheduledEndTime: string | null;   // 'HH:mm:ss' or null
  originalLine: number;              // 1-based line number in input
  rawText: string;                   // Untrimmed original line text
}
```

### 6.6 Scheduled End Time & Existing Data Model Compatibility
- **Current Model**: `TaskOccurrence` has `scheduledStartTime` (`TIME`) and `scheduledDueAt` (`TIMESTAMPTZ`), but does not have a dedicated `scheduledEndTime` (`TIME`) column.
- **Parser Responsibility**: The parser extracts, normalizes, and validates `scheduledEndTime` (`HH:mm:ss`) faithfully and retains it in `ParsedTaskDraft`.
- **Integration Mapping**: In the upcoming Telegram integration phase, the calling flow can map `scheduledEndTime` either by computing `scheduledDueAt` using the occurrence's `date` + `scheduledEndTime` in the user's timezone, or by adding a dedicated `scheduledEndTime: time` column in a future schema migration.

### 6.7 Responsibility Boundary
- **Parser Scope**: Pure, deterministic text extraction and validation. No database writes, no Telegram objects, no date resolution, no recurrence logic.
- **Telegram Workflow Scope (Phase 5+)**: Gathering user input, tracking interactive state, managing inline keyboards, auto-deleting confirmation messages, and calling `TasksService.createTasks()`.

---

## 7. Deferred Decisions & Out-of-Scope Items

The following functionality is intentionally deferred to subsequent phases:
- **Telegram Bot Ingress & Conversation Flow**: Bot keyboards, callback handlers, and task-entry wizard (`apps/bot`).
- **Telegram Task Persistence**: Calling `TasksService.createTasks` from parsed drafts in the bot.
- **Daily Scheduler / Background Jobs**: Cron workers generating tomorrow's occurrences for active recurring tasks.
- **30-Minute Inactivity Timeout**: Automated transition worker setting unacknowledged occurrences to `NOT_COMPLETED`.
- **Gamification Points Engine**: Awarding points on occurrence completion via `PointTransaction`.
