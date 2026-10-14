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

### ADR-008 (Proposed): Profile Update Policy on Subsequent Logins
- **Status**: Unresolved / Open
- **Question**: When an existing user sends `/start` and their Telegram `first_name` or `displayName` has changed, should `UsersService` automatically update `User.displayName`?
- **Trade-offs**:
  - *Auto-update*: Keeps display names synced with Telegram profiles, but could overwrite manual changes if custom display names are supported later.
  - *Keep existing*: Respects established display name, but may leave stale Telegram names in place.

---

### ADR-009 (Proposed): Wizard / Conversation Engine for Telegram Onboarding
- **Status**: Unresolved / Deferred
- **Question**: The `/start` inline keyboard sends a callback query with `GET_INFORMATION`. How should multi-step interactive wizard flows be managed?
- **Options**:
  - Grammy Conversations plugin (`@grammyjs/conversations`).
  - Custom state machine using database or Redis.
- **Current Action**: Deferred until the core user settings and onboarding questions are finalized.

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
