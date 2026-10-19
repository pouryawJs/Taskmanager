# Project Context — Task Manager Platform

> Canonical entry point and index for AI coding agents. Read this file first before inspecting specialized documents or codebase sources.

---

## 1. Project Purpose & Scope

The **Task Manager Platform** is a multi-channel productivity and task-tracking application designed with a **Telegram Bot** as its initial primary user interface, with future support planned for a REST/GraphQL **HTTP API** and a dedicated **Web frontend**.

Beyond standard task CRUD operations, the product architecture supports:
- One-off and recurring scheduled tasks (via a discrete occurrence model).
- Activity tracking and auditing (`activity_events`).
- Extensible gamification and points ledger with idempotency safeguards (`point_transactions`).
- Shared application and business logic decoupled from delivery channels (Telegram, HTTP, CLI).

---

## 2. Technology Stack & Environment

- **Runtime & Language**: Node.js, TypeScript `5.7.3` (`module: nodenext`, `target: ES2023`).
- **Backend Framework**: NestJS `11.0.1` monorepo.
- **ORM & Database**: TypeORM `1.1.2`, PostgreSQL driver `pg` `8.23.1`.
- **Bot Engine**: Grammy `1.46.0` (using Long Polling runtime).
- **Validation & Transformation**: `class-validator` `0.15.1`, `class-transformer` `0.5.1`.
- **Tooling**: Nest CLI `11.0.0`, Jest `30.0.0`, ESLint `9.18.0`, Prettier `3.4.2`.
- **OS / Shell**: Windows / PowerShell.

---

## 3. Monorepo Structure & Project Responsibilities

The repository is organized as a NestJS monorepo configured in [`nest-cli.json`](file:///f:/Programming/Nest js/projects/task-manager-platform/nest-cli.json) and [`tsconfig.json`](file:///f:/Programming/Nest js/projects/task-manager-platform/tsconfig.json):

```text
task-manager-platform/
├── apps/
│   ├── api/                 # NestJS HTTP API application (port 3000)
│   └── bot/                 # NestJS Telegram bot application (Grammy long-polling)
├── libs/
│   ├── core/                # Domain & application logic (independent of delivery layers)
│   ├── database/            # TypeORM entities, connection module, migrations
│   └── shared/              # Shared types, utilities, and cross-cutting contracts
└── agent-context/           # Agent persistent documentation system
```

### Path Mappings ([`tsconfig.json`](file:///f:/Programming/Nest js/projects/task-manager-platform/tsconfig.json))
- `@app/core` -> `libs/core/src`
- `@app/database` -> `libs/database/src`
- `@app/shared` -> `libs/shared/src`

### Application Responsibilities
- **`apps/bot`**: Handles Telegram events via Grammy. Creates single bot instance via [`BotRuntimeModule`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/runtime/bot-runtime.module.ts) and manages polling lifecycle via [`BotLifecycleService`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/runtime/bot-lifecycle.service.ts). Features register handlers during `onModuleInit`.
- **`apps/api`**: HTTP service placeholder. Currently minimal Nest boilerplate (`ApiController` returning "Hello World!"). Not connected to database or core modules.
- **`libs/core`**: Delivery-agnostic application logic. Contains user registration ([`UsersService`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/users/users.service.ts)) and task domain folders (currently empty scaffold).
- **`libs/database`**: Configures PostgreSQL via [`DatabaseModule`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/database.module.ts) using `TypeOrmModule.forRootAsync`. Manually registers 7 entities. Runs `synchronize: true` for development.
- **`libs/shared`**: Lightweight shared library. Currently holds basic module/service boilerplate; empty `contracts` and `types` folders.

---

## 4. Current Implementation Status

| Component / Feature | Status | Verified Details |
|---|---|---|
| **NestJS Monorepo Build** | Verified Working | All 5 projects (`api`, `bot`, `core`, `database`, `shared`) compile cleanly with `npx nest build <project>`. |
| **Database Connection & Entities** | Verified Working | 8 TypeORM entities defined and manually loaded in [`DatabaseModule`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/database.module.ts). Reversible migration `CreateGamificationSchema1771340000000` registered. [`DatabaseConnectionLogger`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/database-connection.logger.ts) logs connection on startup. |
| **User Registration Service** | Implemented & Tested | [`UsersService`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/users/users.service.ts) provides atomic transactions, display name, timezone updates, onboarding step persistence, and code `23505` concurrency handling. |
| **Telegram `/start` Command & Onboarding** | Implemented & Tested | [`StartFeature`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.feature.ts) and [`StartHandler`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.handlers.ts) implement the 4-step interactive onboarding flow, interruption recovery, and Main Menu. |
| **Telegram Wizard / Callbacks** | Implemented & Tested | Inline keyboard callbacks (`onboard:*`, `menu:*`, legacy `GET_INFORMATION`) and text message handlers process display names, timezone selection, and gamification intro. |
| **Task Domain & Use-Cases** | Implemented & Tested | [`TasksService`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/tasks/tasks.service.ts) provides one-time and daily recurring task creation, atomic transactions, occurrence status transitions, rescheduling, ownership enforcement, and timezone-aware daily occurrence queries. |
| **Task Text Parser** | Implemented & Tested | [`TaskTextParser`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/tasks/parser/task-text-parser.ts) provides deterministic, all-or-nothing multi-line task text parsing for English and Persian syntax with numeral normalization and 1-based error reporting. |
| **Telegram Task Registration Flow** | Implemented & Tested | [`TasksBotModule`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/tasks/tasks.module.ts) provides one-time & daily task creation, inline calendar picker, all-or-nothing message parsing, atomic transactions, timezone-aware end-time timestamp conversion, and isolated user sessions. |
| **Daily Task List & Task Details UI** | Implemented & Tested | Phase 6 Telegram interface displaying today's tasks (`menu:list_tasks`, `task:list:today`), on-demand idempotent daily occurrence creation (`ensureDailyOccurrencesForDate`), timed-first sorting, timezone-aware intervals (`scheduledDueAt`), occurrence details view (`task:view:<id>`), strict ownership validation, and seamless back-navigation. |
| **Task Management Operations (Phase 7)** | Implemented & Tested | Interactive management menu, submenus for status transitions, task definition edits (title/description/priority), scheduling management, priority changes, safe recurring deactivation, and protected deletion policy. |
| **Background Scheduling & Notifications (Phase 8)** | Implemented & Tested | Lightweight background scheduler via `@nestjs/schedule` (`TaskSchedulerService`): hourly automated daily occurrence materialization with up to 3 days catch-up across timezones; minutely scheduled start notifications with interactive task card shortcuts; minutely 30-minute inactivity timeouts for unacknowledged pending tasks. |
| **Gamification Foundation (Phase 1)** | Implemented & Tested | Dedicated [`GamificationModule`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/gamification/gamification.module.ts) and [`GamificationService`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/gamification/gamification.service.ts). Authoritative XP ledger [`PointTransaction`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/entities/point-transaction.entity.ts), persistent streak state [`GamificationProfile`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/entities/gamification-profile.entity.ts), centralized constants [`gamification.constants.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/gamification/constants/gamification.constants.ts), and reversible migration `CreateGamificationSchema1771340000000`. |
| **Automated Tests (`npm test`)** | Verified Passing | 23 test suites, 321 tests passing with 100% success rate across core, bot, database, shared, and api projects. |


---

## 5. Architectural Boundaries & Conventions

1. **Separation of Concerns**: Telegram (Grammy) objects must never bleed into `libs/core` or `libs/database`.
2. **DTO Validation**: `class-validator` decorators on DTOs require explicit validation at non-HTTP boundaries (such as Grammy handlers), as Nest's global `ValidationPipe` only intercepts HTTP requests.
3. **Database Transactions**: Operations creating related records across multiple tables (e.g. `User`, `UserIdentity`, `UserSettings`) must use `dataSource.transaction(manager => ...)` using the provided `manager`.
4. **Idempotency**: Prevent duplicate records at both levels: unique constraints at the database level and graceful conflict resolution in service logic.
5. **No Speculative Overengineering**: Avoid adding complex frameworks, CQRS pipelines, or dynamic rule engines until justified by actual product requirements.

---

## 6. Known Discrepancies & Issues

- **Environment Variable Divergence**: [`libs/database/src/database.module.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/database.module.ts) and `.env` use prefix `DB_*` (`DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`). However, [`.env.example`](file:///f:/Programming/Nest js/projects/task-manager-platform/.env.example) uses `DATABASE_*` (`DATABASE_HOST`, etc.).
- **Broken Tests**: Default boilerplate unit tests in `apps/bot` were not updated when the bot architecture replaced controllers with Grammy features.
- **Stale Scripts in `package.json`**: `"start:prod"` and `"test:e2e"` point to `./apps/task-manager-platform/`, which does not exist in the monorepo.
- **Pluralized Filenames in Bot Feature**: Bot uses [`start.handlers.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.handlers.ts) and [`start.keyboards.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.keyboards.ts), whereas initial brief examples used singular forms (`start.handler.ts`, `start.keyboard.ts`).

---

## 7. Specialized Documentation Map

Consult these specialized documents for in-depth details:

- **Architecture Rules & Lifecycle**: [`./architecture.md`](architecture.md)
- **Database Schema, Entities & Persistence**: [`./database.md`](database.md)
- **Architecture Decisions & Open Questions**: [`./decisions.md`](decisions.md)
- **Feature — User Registration**: [`./features/user-registration.md`](features/user-registration.md)
- **Feature — Telegram Start Flow**: [`./features/telegram-start.md`](features/telegram-start.md)
- **Feature — Task Management Core**: [`./features/task-management-core.md`](features/task-management-core.md)
- **Feature — Telegram Task Registration**: [`./features/telegram-task-registration.md`](features/telegram-task-registration.md)
- **Feature — Telegram Daily Task List & Details**: [`./features/telegram-daily-tasks.md`](features/telegram-daily-tasks.md)
- **Feature — Telegram Task Details Menu & Management Operations (Phase 7)**: [`./features/telegram-task-management.md`](features/telegram-task-management.md)
- **Feature — Background Scheduling & Notifications (Phase 8)**: [`./decisions.md#adr-020-background-scheduling-daily-occurrence-generation--telegram-notifications-phase-8`](decisions.md)
- **Feature — Gamification Foundation (Phase 1)**: [`./features/gamification-foundation.md`](features/gamification-foundation.md)


