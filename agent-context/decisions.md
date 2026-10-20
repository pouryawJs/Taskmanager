# Architecture Decision Records (ADRs) & Log

> Record of significant architectural and design decisions, their rationale, status, and unresolved questions.

Related: [Project Context](./PROJECT_CONTEXT.md) | [System Architecture](./architecture.md) | [Database Model](./database.md)

---

## 1. Confirmed & Implemented Decisions

### ADR-001: NestJS Monorepo with Delivery/Domain Decoupling
- **Status**: Implemented
- **Context**: The product requires an initial Telegram bot interface, with planned additions for an HTTP API and web client.
- **Decision**: Adopt a NestJS monorepo (`apps/bot`, `apps/api`, `libs/core`, `libs/database`, `libs/shared`). Reusable business logic must reside in `libs/core` and have zero dependencies on Telegram (Grammy) or HTTP controllers.
- **Consequences**: Easy code reuse across entry points. Requires discipline to prevent delivery framework objects from leaking into domain libraries.

---

### ADR-002: Grammy as Telegram Bot Framework
- **Status**: Implemented
- **Context**: Need a modern, well-typed, maintained Telegram bot framework for Node.js.
- **Decision**: Use Grammy (`grammy`) rather than Telegraf.
- **Consequences**: Clean TypeScript typing, composable middleware system, active ecosystem. Runs in long-polling mode in development via a dedicated `BotLifecycleService`.

---

### ADR-003: Explicit Entity Registration in TypeORM
- **Status**: Implemented
- **Context**: TypeORM can discover entities via `autoLoadEntities: true` or file globbing (`entities: ['**/*.entity.ts']`).
- **Decision**: Manually enumerate all entity classes in `DatabaseModule` (`entities: [User, UserIdentity, UserSettings, Task, TaskOccurrence, ActivityEvent, PointTransaction]`).
- **Consequences**: Eliminates bundler/monorepo path resolution ambiguities during Webpack compilation. Adding a new entity requires an explicit entry in `DatabaseModule`.

---

### ADR-004: Decoupled User and UserIdentity Schema
- **Status**: Implemented
- **Context**: User accounts may originate from Telegram today and email/web auth in the future.
- **Decision**: Keep the `users` table clean (containing only `displayName`, `status`, and timestamps). Create a separate `user_identities` table with a composite unique index on `(provider, providerUserId)`.
- **Consequences**: Enables linking multiple auth providers (e.g. Telegram + Email) to a single `User` without modifying core user tables or storing provider-specific fields on `User`.

---

### ADR-005: Occurrence-Based Task Scheduling Model
- **Status**: Implemented Schema / Domain Logic Pending
- **Context**: The platform needs to support both single-run tasks and recurring schedules without losing execution history.
- **Decision**: Split task representation into:
  1. `Task`: The persistent definition, title, description, priority, and ownership.
  2. `TaskOccurrence`: Individual scheduled instances with their own execution status, deadlines, and completion timestamps.
- **Consequences**: Recurring tasks simply generate new `TaskOccurrence` records while referencing the same `Task` parent, preserving status and audit history per run.

---

### ADR-006: Ledger-Based Gamification via `PointTransaction`
- **Status**: Implemented Schema / Domain Logic Pending
- **Context**: Need a tamper-evident, auditable gamification system resistant to duplicate actions.
- **Decision**: Total user points are calculated dynamically by summing `pointsDelta` across all `PointTransaction` records. `PointTransaction` uses a partial unique index on non-null `idempotencyKey` and check constraint `"pointsDelta" <> 0`.
- **Consequences**: Duplicate requests (e.g. double-tapping "complete") cannot award points twice if an idempotency key is supplied. Point adjustments or deductions are recorded as negative transactions rather than mutating historical records.

---

### ADR-007: Database-Enforced Race Condition Handling for Registration
- **Status**: Implemented
- **Context**: Concurrent `/start` requests from the same Telegram user could trigger race conditions during user registration.
- **Decision**: Pair the unique constraint `UQ_user_identities_provider_external_id` with a database transaction in `UsersService.registerTelegramUser()`. If a PostgreSQL unique violation error code (`23505`) is caught, query and return the existing record instead of throwing an unhandled error.
- **Consequences**: Guaranteed idempotency and crash-free concurrency without distributed locks.

---

## 2. Proposed & Unresolved Decisions

### ADR-008: User Display Name Policy on Subsequent Logins
- **Status**: Implemented / Resolved
- **Decision**: Retain the user's established display name when returning via `/start`. Offer the Telegram profile name only as the initial suggested default during step 2 of onboarding.
- **Rationale**: Prevents overwriting a customized display name that the user explicitly chose during onboarding.

---

### ADR-009: Database-Persisted Onboarding State in `UserSettings`
- **Status**: Implemented / Resolved
- **Decision**: Persist onboarding progress directly in `UserSettings` using `onboardingStep` (`OnboardingStep` enum: `NAME`, `AWAITING_CUSTOM_NAME`, `TIMEZONE`, `AWAITING_CUSTOM_TIMEZONE`, `GAMIFICATION`, `COMPLETED`) and `onboardingCompleted` (`boolean`, default `false`).
- **Rationale**:
  - Avoids adding heavy external session stores (Redis) or third-party conversation plugins (`@grammyjs/conversations`) for a predictable 4-step onboarding flow.
  - Ensures full crash and restart resilience across bot polling lifecycles.
  - Preserves ADR-004 by keeping channel-agnostic `User` entity clean.
  - Allows interrupted users to seamlessly resume from their exact incomplete step on subsequent `/start`.

---

### ADR-010 (Proposed): Transition from `synchronize: true` to TypeORM Migrations
- **Status**: Unresolved / Open
- **Context**: `synchronize: true` is active in `DatabaseModule` for developer speed, but cannot be used in staging or production.
- **Action Needed**: Configure TypeORM CLI DataSource configuration to generate and run migrations from entity definitions before production deployment.

---

### ADR-011 (Proposed): Domain Architecture Scope in `libs/core/src/tasks`
- **Status**: Proposed / Scaffold Only
- **Context**: An empty directory scaffold was created in `libs/core/src/tasks` (`domain`, `application`, `infrastructure`).
- **Question**: Should the project implement full Hexagonal/Clean Architecture with domain entities, value objects, and ports/adapters for Tasks, or use standard NestJS service-repository patterns?
- **Guideline**: Follow general project principle: avoid overengineering. If domain complexity does not demand ports/adapters, favor simpler, testable NestJS services.

---

### ADR-012 (Proposed): Environment Variable Naming Standard
- **Status**: Unresolved / Discrepancy Noted
- **Discrepancy**: `.env` and `database.module.ts` use `DB_*` prefix. `.env.example` uses `DATABASE_*`.
- **Recommendation**: Standardize on `DB_*` across all `.env` files and documentation to align with existing code.

---

### ADR-013: In-Place Menu Editing and Auto-Deleting Temporary Confirmation Messages
- **Status**: Implemented
- **Context**: Navigating through multi-step bot flows with separate messages for each step clutters the chat and causes duplicate interactions.
- **Decision**: Encapsulate Telegram chat UX in `TelegramUiService`. Menu transitions mutate the existing bot message and its inline keyboard in-place via `editOrReply()`, catching Telegram's "message is not modified" error gracefully. Status feedback (e.g. `✅ نام نمایشی شما با موفقیت تغییر کرد.`) is sent as a short separate message that automatically deletes itself after ~10 seconds via asynchronous, non-blocking timers.
- **Consequences**: Conversations remain compact and uncluttered with a single interactive card. Fast, clear feedback is provided without lingering toast messages.

---

### ADR-014: Task & TaskOccurrence Data Model for One-Time and Daily Recurring Tasks
- **Status**: Implemented
- **Context**: Phase 2 requirement for task-creation feature supporting one-time and daily recurring tasks, calendar dates independent of timezones, optional scheduled start times of day, and discrete occurrence status outcomes.
- **Decision**:
  1. Add `TaskType` enum (`'one_time'`, `'daily'`) on `Task` (`type: TaskType`, default `'one_time'`). Avoid generic RRULE engines since daily recurrence is the only supported pattern for V1.
  2. Model scheduled start time as a timezone-agnostic time-of-day using PostgreSQL `TIME` (`type: 'time'`) on both `Task.scheduledStartTime` (reusable default) and `TaskOccurrence.scheduledStartTime` (per-occurrence override). This prevents times of day from accidentally becoming date-specific UTC timestamps.
  3. Store occurrence execution date using PostgreSQL `DATE` (`type: 'date'`) on `TaskOccurrence.date` (`YYYY-MM-DD`).
  4. Expand `TaskOccurrenceStatus` enum with `PARTIALLY_COMPLETED = 'partially_completed'` and `NOT_COMPLETED = 'not_completed'` alongside existing `PENDING`, `IN_PROGRESS`, `COMPLETED`, `SKIPPED`, and `CANCELLED`.
  5. Add unique composite index `UQ_task_occurrences_task_date` on `(taskId, date)` preventing duplicate daily occurrences for any task while allowing one-time tasks to hold their single occurrence.
  6. Retain `TaskOccurrence.scheduledStartAt` and `scheduledDueAt` as nullable `timestamptz` for backward-compatibility. Actual event execution times remain `startedAt` and `completedAt` as `timestamptz`.
- **Consequences**: Clear separation between reusable definitions and discrete daily executions. Deactivating a recurring task (`isActive = false`) cleanly halts future occurrences while preserving historical execution records. Skipping today's occurrence (`status = 'skipped'`) does not interrupt daily recurrence.

---

### ADR-015: Task Text Parser Contract and All-or-Nothing Message Validation
- **Status**: Implemented
- **Context**: Phase 4 requirement to parse multi-line task entry messages sent via Telegram into structured task drafts (`ParsedTaskDraft`), handling untimed tasks, single start times (`at` / `ساعت`), and intervals (`from ... to ...` / `از ... تا ...`), with Persian and English support.
- **Decision**:
  1. Implement a pure, deterministic parser in `libs/core/src/tasks/parser/task-text-parser.ts` with no delivery (Grammy) or persistence (TypeORM) dependencies.
  2. Implement all-or-nothing message validation: each incoming message is parsed line-by-line. If all non-empty lines are valid, return `ParsedTaskDraft[]`. If any line is invalid, return or throw an error listing all failures with their original 1-based line numbers.
  3. Digits: Normalize Persian (`۰-۹`) and Arabic-Indic (`٠-٩`) numerals to ASCII digits (`0-9`) exclusively inside time tokens; retain numerals in task titles untouched.
  4. Times: Normalize valid times to `HH:mm:ss`. Require `00 <= HH <= 23`, `00 <= mm <= 59`, and for intervals require `end > start` (no overnight or zero-length intervals in V1).
  5. Title validation: Enforce `1 <= title.length <= 160` (matching PostgreSQL `tasks.title varchar(160)`). Never truncate silently.
  6. Output contract: Preserve extracted `scheduledEndTime` on `ParsedTaskDraft` even though the database entity `TaskOccurrence` does not currently feature a dedicated `scheduledEndTime: time` column, allowing the subsequent integration phase to either populate `scheduledDueAt` or add a column migration.
- **Consequences**: Clean separation of parsing logic from Telegram interaction and database transactions. High testability with zero side-effects. Telegram UI can easily format line-specific error messages.

---

### ADR-016: Telegram Task Registration Flow, State Isolation, and Middleware Scoping
- **Status**: Implemented
- **Context**: Phase 5 requires integrating the core task-creation service and the task text parser into the Telegram bot, supporting one-time and daily recurring tasks, an interactive calendar picker, multi-message registration, safe message deletion, and preventing text conflicts with the existing onboarding flow.
- **Decision**:
  1. **Middleware Ordering & Isolation**: Prioritize `TasksFeature` before `StartFeature` in `TelegramModule`. In `TasksFeature`, intercept text messages only when the user has an active registration session (`hasActiveSession(ctx)` is true); if so, consume the message without calling `next()`. If inactive or if the text is a command (`/start`), call `next()` to let `StartFeature` handle it.
  2. **Session State Isolation**: Maintain active task registration sessions in an isolated in-memory service (`TaskRegistrationStateService`) keyed strictly by `telegramUserId`. Prevent global state leakage and allow concurrent, isolated registrations across multiple users. Automatically clean up sessions on `/start`, finish, back, or TTL expiry.
  3. **Calendar Date Selection**: Implement a dynamic, validated inline keyboard calendar with month navigation and quick shortcuts (`امروز`, `فردا`). Strictly validate date callback queries with `isValidIsoDate()` before accepting them into session state.
  4. **Scheduled End-Time Mapping**: Re-use `TaskOccurrence.scheduledDueAt` (`timestamptz`) to store the end time of day by converting the occurrence date and `scheduledEndTime` in the user's timezone using `localDateTimeToUtcDate()`, avoiding premature database schema modifications while preserving full end-time semantics.
  5. **Ephemeral Feedback & Safe Deletion**: Delete user messages immediately on successful persistence and send self-deleting confirmation toasts (~7s). On validation failure, display line-specific errors temporarily (~15s) while scheduling original message deletion after ~15s to allow copying and correction. Catch deletion failures gracefully without rolling back or retrying database writes.
- **Consequences**: Clean, collision-free Telegram UX without heavy third-party conversation plugins. Atomic multi-task persistence with full rollback safeguards per message.

---

### ADR-017: Telegram `/start` Menu Refresh & Past-Date Scheduling Restriction
- **Status**: Implemented
- **Context**: Manual testing uncovered: (1) sending `/start` when the main menu is already present skips editing because Telegram returns `message is not modified`, leaving the user with no response; (2) one-time tasks could be registered for past dates via calendar navigation or crafted callbacks.
- **Decision**:
  1. **`/start` Menu Refresh Pattern**: In `TelegramUiService.editOrReply()`, distinguish between callback queries and direct user commands/messages. For callback queries, `message is not modified` remains a no-op to avoid redundant edits. For text commands (such as `/start`), if the target menu card is already identical, `TelegramUiService` safely deletes the previous menu message and sends a fresh menu message at the bottom of the chat, maintaining exactly one interactive card without duplicates.
  2. **Past-Date Scheduling Prevention**: For V1, one-time tasks cannot be scheduled for calendar dates before today in the user's configured IANA timezone (`targetDate >= getTodayDateString(userTimezone)`).
     - In the inline calendar, previous months are blocked from navigation, and past days are visually disabled (`·`) with an alert callback (`task:date:past`).
     - In `task-registration.handlers.ts`, callback queries (`task:date:select:`) and text registration validate `selectedDate >= todayDate`.
     - In `TasksService.createTask()` and `TasksService.createTasks()`, one-time tasks validate `date >= todayDate` prior to database transactions, ensuring atomic rejection across all callers.
- **Consequences**: Reliable, responsive `/start` behavior without duplicate cards. Solid multi-layered prevention of past-dated task creation.

---

### ADR-018: Telegram Daily Task List, On-Demand Occurrence Generation, and Task Details UI (Phase 6)
- **Status**: Implemented
- **Context**: Phase 6 requires displaying today's tasks in Telegram, rendering full task occurrence details on demand, providing smooth bidirectional navigation between list and details, handling authorization securely, and guaranteeing active recurring daily tasks appear on the daily list without a background scheduler.
- **Decision**:
  1. **Entry Point & Callback Conventions**: Intercept `menu:list_tasks` and `task:list:today` / `task:back:to_list` in `TasksFeature` and route to `handleListTodayTasks()`. Use `task:view:<occurrenceId>` (UUID) to open details, and `task:list:today` to navigate back to the refreshed daily list.
  2. **On-Demand Idempotent Occurrence Materialization**: Implement `TasksService.ensureDailyOccurrencesForDate(userId, targetDate)`. For active daily tasks (`type: 'daily'`, `isActive: true`), check whether an occurrence exists for `(taskId, targetDate)`. If absent and `targetDate >= taskStartDate`, create a `PENDING` occurrence. Catch TypeORM unique constraint code `23505` to guarantee concurrency safety and zero duplicate occurrences. Propagate end-time/scheduledDueAt from prior occurrences when available.
  3. **Timezone-Aware Scheduling Presentation**: Convert `scheduledDueAt` UTC timestamps to local `HH:mm` using `formatUtcToLocalTime()` in the user's `UserSettings.timezone`. Render intervals as `⏰ ۱۰:۰۰ تا ۱۲:۰۰`, single start times as `⏰ ۱۰:۰۰`, and untimed tasks as `⏰ بدون زمان مشخص`. Never display raw UTC timestamps or treat `estimatedMinutes` as an end time.
  4. **Task Ordering**: Sort timed tasks first in ascending start time order (`scheduledStartTime ASC`), followed by untimed tasks. Use deterministic secondary sorting by `createdAt ASC` and `id ASC`.
  5. **Authorization & Security**: In `TasksService.getOccurrenceById()`, enforce `occurrence.task.ownerId === userId`. If an unauthorized occurrence ID is accessed, reject with `ForbiddenException` and return a generic Persian alert (`⛔️ شما اجازه دسترسی به این تسک را ندارید.`) without revealing the title, description, or metadata.
  6. **UI State & Message Limits**: Use `TelegramUiService.editOrReply()` to update existing messages in-place without chat spam. For long lists exceeding 3800 characters, truncate gracefully with a warning notice rather than exceeding Telegram's 4096-character limit.
- **Consequences**: Fast, responsive daily task list and details views in Telegram with zero duplicate occurrences, robust authorization, and complete timezone consistency.
- **Remaining Limitations**: Daily occurrences are generated on-demand when the user views the list or queries occurrences; no background cron exists yet for offline push notifications. Editing and status mutations are left for subsequent phases.

---

### ADR-019: Task Management Operations, Definition vs Occurrence Edits, and Deletion Policy (Phase 7)
- **Status**: Implemented
- **Context**: Phase 7 expands the read-only task details view into a full task management interface in Telegram. Users need to update statuses, edit titles/descriptions/priorities, adjust time and calendar schedules, and delete or deactivate tasks.
- **Decision**:
  1. **Core Decoupling & DTOs**:
     - Keep all business mutations in `TasksService` (`libs/core`).
     - Added `UpdateTaskDto` (`title?`, `description?`, `priority?`) and `UpdateOccurrenceScheduleDto` (`date?`, `startTime?`, `endTime?`, `clearSchedule?`, `updateTaskDefault?`).
  2. **Task Definition vs Occurrence-Level Edits**:
     - `updateTask` modifies the parent `Task` entity (title, description, priority). Historical `TaskOccurrence` records remain untouched, preserving all status timestamps, completion history, and dates.
     - `updateOccurrenceSchedule` modifies the selected occurrence (time intervals or calendar date for one-time tasks). For daily recurring tasks, calendar date is immutable, but time updates can optionally propagate to `Task.scheduledStartTime` as the default across future days (`updateTaskDefault: true`).
  3. **Status State Machine & Terminal States**:
     - `COMPLETED` and `CANCELLED` are terminal states. Further transitions from these states are rejected.
     - Non-terminal occurrences (`PENDING`, `IN_PROGRESS`, `PARTIALLY_COMPLETED`, `NOT_COMPLETED`, `SKIPPED`) can transition to other states.
     - Skipping an occurrence (`SKIPPED`) affects only the current occurrence; the recurring parent task remains active.
  4. **Recurring Deactivation vs Permanent Deletion Policy**:
     - **Deactivate (`deactivateTask`)**: Sets `task.isActive = false` and `archivedAt = new Date()`. Stops future daily occurrences in `ensureDailyOccurrencesForDate`, while preserving all historical occurrences and point transactions.
     - **Delete (`deleteTask`)**: If any occurrence has status `COMPLETED` or `PARTIALLY_COMPLETED`, or if any associated `PointTransaction` exists, permanent deletion is **strictly rejected** (`BadRequestException`) to protect audit integrity. Users are guided to deactivate instead. Tasks without completed history are safely deleted along with their pending occurrences inside a database transaction.
  5. **Interactive Session Isolation**:
     - Interactive text edits (title, description, time, date) use `TaskEditStateService`, scoped to `telegramUserId` and `ctx.chat.id` with a 30-minute TTL.
     - Cleanly isolated from `TaskRegistrationStateService`: editing a task definition never interferes with task registration mode.
  6. **Compact Callback Architecture**:
     - Kept all callback payloads within Telegram's 64-byte limit using concise prefixes (`task:act:stat:`, `task:st:`, `task:act:prio:`, `task:pr:`, `task:act:edit:`, `task:ed:`, `task:act:sched:`, `task:sc:`, `task:act:lifecycle:`, `task:lc:`).
- **Consequences**: Safe, auditable, and modular task management interface in Telegram with zero data loss or cascading foreign key issues.

---

### ADR-020: Background Scheduling, Daily Occurrence Generation & Telegram Notifications (Phase 8)
- **Status**: Implemented
- **Context**: Phase 8 completes the task management MVP by introducing automated background scheduling via `@nestjs/schedule`. System responsibilities:
  1. Automatically generate daily occurrences for active daily recurring tasks across user timezones with catch-up logic.
  2. Detect scheduled tasks whose start time has arrived today and dispatch clear Persian Telegram notifications with interactive task card shortcuts.
  3. Enforce a 30-minute inactivity timeout for unacknowledged scheduled tasks strictly in `PENDING` status.
- **Decision**:
  1. **Architectural Separation**:
     - `libs/core` (`TasksService`): Completely delivery-agnostic with zero Grammy/Telegram imports. Contains core query and domain logic: `generateDailyOccurrences()`, `getOccurrencesDueForNotification()`, `markOccurrenceNotified()`, and `markTimedOutOccurrences()`.
     - `apps/bot` (`TaskSchedulerService`): Houses cron orchestration using `@nestjs/schedule`, formats Persian messages (`buildTaskNotificationMessage`), attaches inline buttons (`buildTaskNotificationKeyboard`), and dispatches via Grammy `Bot` instance.
     - `libs/database`: Added `notifiedAt: Date | null` column to `TaskOccurrence`.
  2. **Automated Daily Occurrence Generation**:
     - Scheduled hourly (`@Cron(CronExpression.EVERY_HOUR)`) and executed at application startup (`onApplicationBootstrap`).
     - Generates missing occurrences for all tasks where `type = TaskType.DAILY` and `isActive = true`.
     - **Catch-up Policy**: Evaluates today's date in each user's timezone (`UserSettings.timezone`) and catches up missing occurrences up to a maximum of 3 days in the past (`[today - 3, today - 2, today - 1, today]`). Dates older than 3 days or prior to task creation are strictly ignored.
     - Reuses `ensureDailyOccurrencesForDate`, catching PostgreSQL error `23505` to guarantee absolute idempotency and concurrency safety.
  3. **Scheduled Start Notifications**:
     - Executed every minute (`@Cron(CronExpression.EVERY_MINUTE)`).
     - Eligible if and only if: `scheduledStartTime IS NOT NULL`, current local time in user's timezone >= `scheduledStartTime`, occurrence `date` matches today's date in user's timezone, `status === PENDING`, `notifiedAt IS NULL`, and parent `Task.isActive === true`.
     - Dispatches Persian notification with task title, start time, priority emoji, and inline shortcut button: `[ 📋 مشاهده و مدیریت تسک ]` with callback `task:view:<occurrenceId>` reusing the Phase 6/7 interactive details card.
     - Sets `notifiedAt = new Date()` on successful delivery.
     - If user blocked the bot (HTTP 403 Forbidden), logs warning and marks `notifiedAt` to prevent endless retry loops.
     - On transient errors (network, 500, rate limit), logs error and leaves `notifiedAt = null` for subsequent retry without blocking other users.
  4. **30-Minute Inactivity Timeout**:
     - Executed every minute.
     - If an occurrence has `scheduledStartTime IS NOT NULL`, `status === PENDING`, `date <= todayDate`, and local elapsed time since `scheduledStartTime` >= 30 minutes, it is marked as `NOT_COMPLETED`.
     - Tasks in non-pending states (`IN_PROGRESS`, `COMPLETED`, `PARTIALLY_COMPLETED`, `SKIPPED`, `CANCELLED`) are treated as acknowledged/handled and are never overwritten.
     - Untimed tasks (`scheduledStartTime IS NULL`) are never timed out.
- **Consequences**: Robust, lightweight, single-instance background scheduler with zero overengineering (no Redis, BullMQ, or distributed locks), full idempotency, and complete timezone consistency.

---

### ADR-021: Gamification Foundation — Data Models, XP Ledger & Configurable Constants (Phase 1)
- **Status**: Implemented
- **Context**: Need a clean, minimal, extensible database foundation and configuration layer for future XP rewards, progressive leveling, streak tracking, and consistency scoring.
- **Decision**:
  1. **Authoritative XP Ledger**:
     - `PointTransaction` (`point_transactions`) serves as the single source of truth for user XP.
     - Total XP is dynamically computed by summing `pointsDelta` (`getUserTotalXp`). No cached or redundant `totalXp` balance column is introduced on `User` or profile.
     - Signed integer `pointsDelta` (`CHK_point_transactions_nonzero_delta`) allows corrections or reversals as new ledger entries without mutating or deleting historical records.
     - Partial unique index `UQ_point_transactions_idempotency_key` on `idempotencyKey WHERE "idempotencyKey" IS NOT NULL` enforces deduplication at the database level across all reward types (`task_completion:<occId>`, `streak_bonus:<userId>:<date>`, etc.).
  2. **Referential Integrity & Financial Preservation**:
     - `User` foreign key uses `onDelete: 'RESTRICT'`, preventing user deletion while points history exists.
     - `TaskOccurrence` foreign key uses `onDelete: 'SET NULL'`, ensuring that even if non-completed task occurrences are removed, historical financial ledger rows are preserved.
  3. **Minimal Persistent Gamification Profile & Streak Foundation**:
     - Created `GamificationProfile` (`gamification_profiles`) in a 1-to-1 relationship with `User` (`userId` primary key, `onDelete: 'CASCADE'`).
     - Persists only non-derived streak state: `currentStreak`, `longestStreak`, and `lastQualifiedDate` (`YYYY-MM-DD`).
     - Streak logic is NOT implemented in Phase 1. Stored fields are purely the minimal state model.
     - In future phases, streak calculation must evaluate local days in the user's timezone (`UserSettings.timezone`), count distinct completions ($\ge 3$), and distinguish days without scheduled occurrences (rest days; streak preserved) from days with scheduled tasks where the user failed to qualify (streak resets).
     - Check constraints `CHK_gamification_profiles_current_streak` and `CHK_gamification_profiles_longest_streak` enforce non-negative counters.
     - Avoided storing XP or level on the profile, keeping the ledger authoritative and avoiding dual-state synchronization bugs.
  4. **Centralized Provisional Constants**:
     - Created `libs/core/src/gamification/constants/gamification.constants.ts` grouping provisional defaults:
       - `BASE_XP_REWARDS`: on-time (10), late (7), partial (4), not completed (0), skipped (0), cancelled (0).
       - `STREAK_MULTIPLIER_CONFIG`: base (1.0), daily increment (0.02), max cap (1.50).
       - `LEVEL_PROGRESSION_CONFIG`: initial threshold (50), growth factor (1.25), base reward multiplier (1.0), growth rate (0.01), max cap (2.0). Documented strictly as provisional tuning values, not a finalized curve/algorithm.
       - `STREAK_RULES_CONFIG`: useful-day qualification threshold (3 distinct completions).
       - `CONSISTENCY_SCORE_CONFIG` (and alias `PERFORMANCE_SCORE_CONFIG`): min (0), max (100), provisional sample size threshold (5; unapproved as a formal product rule so as not to prematurely constrain lifetime-history scoring).
       - `GAMIFICATION_TRANSACTION_REASONS`: standard transaction reason codes.
  5. **Reversible Migrations**:
     - Implemented `CreateGamificationSchema1771340000000` under `libs/database/src/migrations/`, provisioning tables and indexes idempotently with clean rollback in `down()`.
  6. **Historical Reconstruction Limitations Identified**:
     - **Completion Deadlines**: `TaskOccurrence` records `completedAt: timestamptz` and has `scheduledDueAt: timestamptz`. When `scheduledDueAt` is present, on-time vs late is deterministically distinguishable. However, `scheduledDueAt` is nullable (untimed tasks, start-time-only tasks); when null, no database deadline exists. Product policy for classifying deadline-less completions must be decided in Phase 2 rather than assuming an artificial deadline.
     - **Cancellations**: `TaskOccurrence` currently lacks explicit `cancelledAt` and `skippedAt` timestamps (relying only on `updatedAt`), meaning cancellations before a deadline cannot be distinguished from cancellations after a deadline from `TaskOccurrence` alone unless audited via `ActivityEvent`.
- **Consequences**: Extremely clean, audit-compliant gamification foundation with zero breaking changes to existing bot features or task lifecycle logic.

---

### ADR-022: Safe, Immediate, Idempotent XP Awards Architecture (Phase 2)
- **Status**: Implemented
- **Context**: Phase 2 introduces immediate XP awards when a `TaskOccurrence` reaches a qualifying final result. Requirements dictate strict transaction safety, deterministic idempotency, concurrency safety across Telegram retries, safe PostgreSQL conflict handling without transaction aborts, and clean boundaries without guessing streak state.
- **Decision**:
  1. **Centralized Reward Rules**:
     - On-time completion (`completedAt <= scheduledDueAt`): **10 base XP** (`BASE_XP_REWARDS.ON_TIME_COMPLETION`).
     - Late completion (`completedAt > scheduledDueAt`): **7 base XP** (`BASE_XP_REWARDS.LATE_COMPLETION`).
     - Completion when `scheduledDueAt` is null: **7 base XP** for MVP (`BASE_XP_REWARDS.NO_DEADLINE_COMPLETION`). Strictly does not infer an artificial deadline from `scheduledStartTime`.
     - Partial completion: **4 base XP** (`BASE_XP_REWARDS.PARTIAL_COMPLETION`).
     - Ineligible / Zero-XP transitions (`PENDING`, `IN_PROGRESS`, `NOT_COMPLETED`, `SKIPPED`, `CANCELLED`): **0 XP**. No transaction rows are created.
  2. **Deterministic Idempotency Keys**:
     - Formatted as `<event_type>:<occurrenceId>`:
       - Full completion: `task_completion:<taskOccurrenceId>`
       - Partial completion: `task_partial_completion:<taskOccurrenceId>`
     - Extensible to future award types (`streak_bonus:<userId>:<date>`, etc.).
  3. **PostgreSQL Safe Concurrency via `ON CONFLICT DO NOTHING`**:
     - In PostgreSQL, catching unique constraint violation code `23505` inside a `BEGIN...COMMIT` block leaves the transaction aborted (`current transaction is aborted, commands ignored until end of transaction block`).
     - Handled via TypeORM InsertQueryBuilder's `.orIgnore()`, which generates native SQL `INSERT INTO point_transactions (...) VALUES (...) ON CONFLICT DO NOTHING`.
     - Suppresses duplicate key conflicts without raising an exception and without aborting the ongoing transaction block.
     - The service inspects `result.raw` and `result.identifiers` to detect whether a row was inserted, returning `{ awarded: false, pointsDelta: 0 }` on conflicts.
  4. **Single Atomic Transaction Boundary**:
     - Directly integrated into existing `TasksService.completeOccurrence` and `TasksService.partiallyCompleteOccurrence` paths.
     - Occurrence status save and `GamificationService.awardTaskOccurrenceXp` execute within the exact same `this.dataSource.transaction(async (manager) => ...)` boundary.
     - Guarantees that occurrence state and XP awards can never become inconsistent due to partial failures. If either fails, the transaction rolls back completely.
     - Unrelated occurrence updates (`startOccurrence`, `markOccurrenceNotCompleted`, `skipOccurrence`, `cancelOccurrence`, `rescheduleOccurrence`) do not enter the XP award flow.
  5. **Delta Upgrades for Multi-Step State Transitions**:
     - An occurrence transitioning from `PARTIALLY_COMPLETED` (4 XP) to `COMPLETED` evaluates existing occurrence transactions in-transaction and awards only the delta (`targetXp - alreadyAwardedXp` = `10 - 4 = 6 XP` for on-time), preventing double-dipping while accurately rewarding completion.
  6. **Streak Multiplier Deferral**:
     - Streak calculation and retroactive rewards remain strictly deferred in Phase 2.
     - Phase 2 baseline awards record `metadata.streakMultiplier: 1.0` and award base XP only.
- **Consequences**: Zero risk of aborted PostgreSQL transactions, absolute deduplication across concurrent Telegram requests, complete rollback consistency, and zero breaking changes to existing bot or task management features.

---

### ADR-023: Streak Evaluation Engine, Rest-Day Preservation, and Dynamic XP Multipliers (Phase 3)
- **Status**: Implemented
- **Context**: Phase 3 implements the streak progression engine, calendar continuity with rest-day awareness, and dynamic streak multipliers for XP awards. Requirements demand core-only execution in `libs/core`, atomic transactionality with task completion, timezone resolution via user settings, idempotency on multiple completions within the same calendar date, safe rest-day preservation vs. missed commitment reset, and mathematically bounded dynamic streak multipliers.
- **Decision**:
  1. **Core-Only Execution & Zero Schema Bloat**:
     - All streak calculation and evaluation logic resides strictly in `libs/core/src/gamification/gamification.service.ts` and integrates with `TasksService.completeOccurrence`.
     - Zero delivery-layer imports (Telegram/Grammy) and zero new tables, snapshot entities, or daily activity caches.
     - Streak state is maintained entirely within existing columns of `GamificationProfile`: `currentStreak`, `longestStreak`, and `lastQualifiedDate` (`YYYY-MM-DD`).
  2. **Qualified Day Evaluation Engine**:
     - Evaluates the user's local calendar date using their configured IANA timezone (`UserSettings.timezone` via `getTodayDateString(userTimezone, completionDate)`), defaulting to `'Asia/Tehran'`.
     - Counts distinct completed `TaskOccurrence` records (`status = COMPLETED` and `date = todayDate` where `task.ownerId = userId`). Multiple transitions on the same occurrence count as 1.
     - Daily threshold requirement: `STREAK_RULES_CONFIG.QUALIFIED_DAY_MIN_COMPLETED_TASKS` ($\ge 3$ distinct completions).
     - **Same-Day Idempotency Guard**: If `profile.lastQualifiedDate === todayDate`, the day has already qualified. The engine does not advance the streak counter for 4th, 5th, etc., task completions on the same date.
  3. **Continuity, Rest-Day Preservation & Break Rules**:
     - When a day newly qualifies (reaches $\ge 3$ completions):
       - **Initial Streak**: If `lastQualifiedDate` is null or `currentStreak === 0` $\to$ `currentStreak = 1`.
       - **Consecutive Day**: If `lastQualifiedDate === yesterdayDate` (i.e. $T_{\text{today}} - 1$ day in user timezone via `addDaysToIsoDate(todayDate, -1)`) $\to$ `currentStreak = currentStreak + 1`.
       - **Gap Days Interval**: For any gap between `lastQualifiedDate` and `todayDate`:
         - **Rest Days (Safe Preservation)**: If for *every* calendar day in the gap interval, the user had **zero scheduled task occurrences**, the interval represents valid rest/idle days. The streak is preserved and advances: `currentStreak = currentStreak + 1`.
         - **Broken Streak (Missed Commitments)**: If on *any* calendar day in the gap interval, scheduled task occurrences existed and the user completed $< 3$ tasks, the streak was broken. The streak resets and restarts: `currentStreak = 1`.
       - **Streak Bounds & Persistence**:
         - `longestStreak = Math.max(profile.longestStreak, currentStreak)`.
         - `lastQualifiedDate = todayDate`.
         - The updated `GamificationProfile` is persisted via the active transactional `manager`.
  4. **Dynamic Streak Multipliers on XP Awards**:
     - Formula:
       $$\text{streakMultiplier} = \min(\text{BASE\_MULTIPLIER} + \text{currentStreak} \times \text{DAILY\_INCREMENT}, \; \text{MAXIMUM\_MULTIPLIER})$$
       ($1.0 + \text{currentStreak} \times 0.02$, capped at $1.50$ via `STREAK_MULTIPLIER_CONFIG`).
     - Calculation: $\text{finalXp} = \text{Math.round}(\text{baseXp} \times \text{streakMultiplier})$.
     - Scaled XP applies to full completions; partial completions (`PARTIALLY_COMPLETED`) receive base XP (4) without streak multiplier.
     - Delta upgrades (e.g. `PARTIALLY_COMPLETED` to `COMPLETED`) compute delta against the scaled target XP (`targetFinalXp - alreadyAwardedXp`).
     - Audit Metadata: Recorded in `PointTransaction.metadata`: `{ baseXp, streakMultiplier, currentStreak, onTime, timing }`.
  5. **Atomic Transactionality**:
     - Streak evaluation, profile update, occurrence status transition, and point transaction creation execute within the single `dataSource.transaction` boundary managed in `TasksService.completeOccurrence`.
     - If any step fails, the entire transaction rolls back, guaranteeing zero divergence between occurrence status, streak profile, and ledger transactions.
- **Consequences**: Deterministic streak progression and XP scaling with accurate rest-day support, full timezone correctness, database-backed idempotency, and clean auditability.

---

### ADR-024: Pure Level Progression & Controlled XP Curve (Phase 4)
- **Status**: Implemented
- **Context**: Phase 4 introduces user level progression and semantic tier titles derived from accumulated XP. Architectural constraints require zero schema changes (preserving ADR-021: Total XP and Level are derived, not stored), delivery-layer independence, controlled non-punitive progression growth, and pure calculation utilities.
- **Decision**:
  1. **Pure In-Memory Derivation & Zero Schema Bloat**:
     - No `level` or `totalXp` columns added to `gamification_profiles` or `users`.
     - `LevelInfo` is derived on demand purely from `getUserTotalXp(userId)` (the authoritative sum of `PointTransaction.pointsDelta`).
     - Exposes `getUserLevelInfo(userId)` and enriches `getGamificationOverview(userId)` with `levelInfo`.
  2. **Linear-Step Controlled Leveling Formula**:
     - Level begins at `1` for `0 XP`.
     - Level 1 requires 50 XP (`INITIAL_XP_THRESHOLD`) to reach Level 2.
     - Each subsequent level $L$ requires $\text{baseXp} + (L - 1) \times \text{stepXp}$ where $\text{stepXp} = 25$ (`XP_STEP_PER_LEVEL` in `LEVEL_PROGRESSION_CONFIG`).
     - Avoids steep exponential curves that make higher levels mathematically unreachable for long-term task execution.
     - `progressPercentage` computed as $(\text{currentLevelXp} / \text{xpRequiredForNextLevel}) \times 100$, rounded to 1 decimal place and strictly bounded in $[0, 100]$.
  3. **Semantic Persian Tier Titles**:
     - Levels 1–5: `شروعکننده` (Starter)
     - Levels 6–15: `سازنده عادت` (Habit Builder)
     - Levels 16–30: `پایدار` (Consistent)
     - Levels 31+: `استاد استمرار` (Master)
  4. **Standalone Level Multiplier Utility**:
     - Implemented `calculateLevelMultiplier(level: number): number` adhering to `LEVEL_PROGRESSION_CONFIG`:
       $$\text{levelMultiplier} = \min(1.0 + (\text{level} - 1) \times 0.01, \; 2.0)$$
     - Kept as an uninvoked pure utility for future roadmap phases; Phase 2/3 XP award pathways remain untouched.
- **Consequences**: Fast, zero-query mathematical derivation, zero risk of dual-state desynchronization, and seamless integration into gamification overview payloads.





