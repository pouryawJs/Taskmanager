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

