# System Architecture

> Overview of repository layout, layered boundaries, lifecycle management, and core architectural conventions.

Related: [Project Context](./PROJECT_CONTEXT.md) | [Database Model](./database.md) | [Architecture Decisions](./decisions.md)

---

## 1. Monorepo Organization & Projects

The repository uses NestJS Monorepo tooling configured in [`nest-cli.json`](file:///f:/Programming/Nest js/projects/task-manager-platform/nest-cli.json) and TypeScript project references in [`tsconfig.json`](file:///f:/Programming/Nest js/projects/task-manager-platform/tsconfig.json).

### Monorepo Projects Summary

| Project Name | Type | Root Path | Source Root | TSConfig | Primary Role |
|---|---|---|---|---|---|
| `api` | application | `apps/api` | `apps/api/src` | `apps/api/tsconfig.app.json` | HTTP REST API service |
| `bot` | application | `apps/bot` | `apps/bot/src` | `apps/bot/tsconfig.app.json` | Telegram bot service via Grammy |
| `core` | library | `libs/core` | `libs/core/src` | `libs/core/tsconfig.lib.json` | Domain & application logic |
| `database` | library | `libs/database` | `libs/database/src` | `libs/database/tsconfig.lib.json` | TypeORM entities & database connection |
| `shared` | library | `libs/shared` | `libs/shared/src` | `libs/shared/tsconfig.lib.json` | Common DTOs, contracts, shared utilities |

### TypeScript Import Aliases
Configured in root [`tsconfig.json`](file:///f:/Programming/Nest js/projects/task-manager-platform/tsconfig.json):
```json
{
  "paths": {
    "@app/core": ["libs/core/src"],
    "@app/core/*": ["libs/core/src/*"],
    "@app/database": ["libs/database/src"],
    "@app/database/*": ["libs/database/src/*"],
    "@app/shared": ["libs/shared/src"],
    "@app/shared/*": ["libs/shared/src/*"]
  }
}
```

---

## 2. Layered Responsibilities & Dependency Rules

The platform follows a layered dependency graph where outer ingress delivery channels depend on inner shared logic:

```text
 ┌──────────────────────┐    ┌──────────────────────┐
 │       apps/bot       │    │       apps/api       │
 │   (Telegram / Grammy)│    │     (HTTP / REST)    │
 └──────────┬───────────┘    └──────────┬───────────┘
            │                           │
            ▼                           ▼
 ┌──────────────────────────────────────────────────┐
 │                    libs/core                     │
 │          (Domain & Application Logic)            │
 └──────────────────────┬───────────────────────────┘
                        │
                        ▼
 ┌──────────────────────────────────────────────────┐
 │                  libs/database                   │
 │           (TypeORM Entities & Module)            │
 └──────────────────────────────────────────────────┘
```

### Dependency Principles
1. **Dependency Direction**: `apps/*` may depend on `libs/core`, `libs/database`, and `libs/shared`. `libs/core` may depend on `libs/database` and `libs/shared`.
2. **Delivery Decoupling**: `libs/core` and `libs/database` must never import Grammy, Express, or any Telegram/HTTP-specific objects.
3. **Infrastructure Isolation**: Database entities and connection configuration reside in `libs/database`. `libs/core` consumes entities via TypeORM repositories or `DataSource`.

---

## 3. Application Runtimes & Lifecycle Management

### 3.1 Telegram Bot Runtime (`apps/bot`)

The bot application runs continuously via Grammy long-polling without exposing an HTTP port.

#### Component Responsibilities:
- **[`BotModule`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/bot.module.ts)**: Root module. Imports `ConfigModule.forRoot({ isGlobal: true })`, `DatabaseModule`, and `TelegramModule`.
- **[`TelegramModule`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/telegram.module.ts)**: Aggregator module that imports `BotRuntimeModule` and feature modules (e.g. `StartModule`).
- **[`BotRuntimeModule`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/runtime/bot-runtime.module.ts)**: Provides and exports a singleton instance of `Bot<Context>` using the `Bot` class token:
  ```typescript
  {
    provide: Bot,
    inject: [ConfigService],
    useFactory: (config: ConfigService) => new Bot(config.getOrThrow('TELEGRAM_BOT_TOKEN')),
  }
  ```
- **[`BotLifecycleService`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/runtime/bot-lifecycle.service.ts)**:
  - Implements `OnApplicationBootstrap`: triggers `this.bot.start()` asynchronously.
  - Implements `OnModuleDestroy`: awaits `this.bot.stop()` for graceful shutdown.
- **Feature Modules (e.g. [`StartModule`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.module.ts))**:
  - Implement `OnModuleInit` (e.g. [`StartFeature`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.feature.ts)) to bind Grammy command/event handlers to the bot before polling starts.

#### Lifecycle Ordering:
1. Nest instantiates modules and providers.
2. `onModuleInit`: Feature classes bind handlers (e.g. `bot.command('start', ...)`).
3. `onApplicationBootstrap`: `BotLifecycleService` begins bot polling.
4. `onModuleDestroy`: Graceful polling termination on SIGINT/SIGTERM.

### 3.2 HTTP API Runtime (`apps/api`)

- Standard NestJS HTTP application bootstrapped with `NestFactory.create(ApiModule)` on `process.env.port ?? 3000`.
- Currently contains boilerplate `ApiController` and `ApiService`.

---

## 4. Architectural Conventions & Constraints

### 4.1 Input Validation Boundary
- DTOs use `class-validator` and `class-transformer` (e.g. [`RegisterTelegramUserDto`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/users/dto/register-telegram-user.dto.ts)).
- **Critical rule for non-HTTP boundaries**: In `apps/bot`, incoming Grammy messages bypass NestJS HTTP `ValidationPipe`. When calling core services from Telegram handlers, the handler must transform plain data to the DTO instance and validate using `validate()` from `class-validator`, or the service must perform explicit validation.

### 4.2 Database Transactions
- Any business action requiring multi-table mutations (such as creating a user, assigning an identity, and provisioning initial settings) must execute within a `DataSource.transaction()` block.
- Always use the provided transactional `EntityManager` inside the transaction callback, rather than root repositories.

### 4.3 Concurrency & Idempotency
- Unique database constraints (e.g. `UQ_user_identities_provider_external_id`) protect against race conditions.
- Services catch `QueryFailedError` with PostgreSQL error code `'23505'` (unique violation) to resolve concurrent operations gracefully without unhandled exceptions.
