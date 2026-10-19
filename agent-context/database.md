# Database Architecture & Data Model

> Technical documentation of database configurations, TypeORM entity definitions, relations, and database-level constraints.

Related: [Project Context](./PROJECT_CONTEXT.md) | [System Architecture](./architecture.md) | [Architecture Decisions](./decisions.md)

---

## 1. Connection & Configuration

The database infrastructure is isolated inside `libs/database`.

- **Module**: [`DatabaseModule`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/database.module.ts)
- **Engine**: PostgreSQL (`pg` driver)
- **Configuration Pattern**: `TypeOrmModule.forRootAsync()` using `ConfigService`.
- **Entity Loading**: Explicit manual registration via an `entities` array in `database.module.ts` (the project deliberately avoids `autoLoadEntities`).
- **Connection Health Check**: [`DatabaseConnectionLogger`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/database-connection.logger.ts) checks `dataSource.isInitialized` on `OnApplicationBootstrap`.
- **Schema Management**: `synchronize: true` is currently enabled for development. Production will require TypeORM migrations (the `libs/database/src/migrations/` directory is currently empty).

### Environment Variables
Configured in [`database.module.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/database.module.ts):

| Variable | Type | Default | Description |
|---|---|---|---|
| `DB_HOST` | string | *required* | PostgreSQL host |
| `DB_PORT` | number | `5432` | PostgreSQL port |
| `DB_USERNAME` | string | *required* | Database user |
| `DB_PASSWORD` | string | *required* | Database password |
| `DB_DATABASE` | string | *required* | Database name |

> [!WARNING]
> [`.env.example`](file:///f:/Programming/Nest js/projects/task-manager-platform/.env.example) uses `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USERNAME`, `DATABASE_PASSWORD`, `DATABASE_NAME`. The actual code and [`.env`](file:///f:/Programming/Nest js/projects/task-manager-platform/.env) use the `DB_*` prefix.

---

## 2. Entity Specifications

All entities are located under [`libs/database/src/entities/`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/entities/) and exported via [`libs/database/src/index.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/index.ts).

### 2.1 `User` ([`user.entity.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/entities/user.entity.ts))
Table: `users`

Represents the core user entity. Does not store channel-specific identifiers.

| Column | Type | Nullable | Details |
|---|---|---|---|
| `id` | `uuid` | No | Primary key (`uuid`) |
| `displayName` | `varchar(100)` | Yes | Optional user-facing name |
| `status` | `enum` (`UserStatus`) | No | Values: `'active'`, `'disabled'`. Default: `'active'` |
| `createdAt` | `timestamptz` | No | Automatically set on creation |
| `updatedAt` | `timestamptz` | No | Automatically updated |

**Relations**:
- `identities`: One-to-Many with `UserIdentity` (cascade delete on user removal).
- `settings`: One-to-One with `UserSettings` (cascade delete on user removal).
- `gamificationProfile`: One-to-One with `GamificationProfile` (cascade delete on user removal).
- `tasks`: One-to-Many with `Task`.
- `activityEvents`: One-to-Many with `ActivityEvent`.
- `pointTransactions`: One-to-Many with `PointTransaction`.

---

### 2.2 `UserIdentity` ([`user-identity.entity.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/entities/user-identity.entity.ts))
Table: `user_identities`

Decouples external login/auth channels from the core `User` record.

| Column | Type | Nullable | Details |
|---|---|---|---|
| `id` | `uuid` | No | Primary key (`uuid`) |
| `provider` | `enum` (`IdentityProvider`)| No | Values: `'telegram'`, `'email'` |
| `providerUserId` | `varchar(255)` | No | External unique ID from the provider (e.g. Telegram user ID string) |
| `userId` | `uuid` | No | Foreign key referencing `users.id` (`onDelete: 'CASCADE'`) |
| `createdAt` | `timestamptz` | No | Timestamp |

**Indexes & Constraints**:
- `UQ_user_identities_provider_external_id`: Unique compound index on `(provider, providerUserId)`.

---

### 2.3 `UserSettings` ([`user-settings.entity.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/entities/user-settings.entity.ts))
Table: `user_settings`

Holds user preferences and notification configurations.

| Column | Type | Nullable | Details |
|---|---|---|---|
| `userId` | `uuid` | No | Primary key and foreign key referencing `users.id` (`onDelete: 'CASCADE'`) |
| `timezone` | `varchar(64)` | No | Default: `'Asia/Tehran'` |
| `notificationsEnabled`| `boolean` | No | Default: `true` |
| `reminderBeforeMinutes`| `integer` | No | Default: `10` |
| `onboardingStep` | `enum` (`OnboardingStep`) | No | Values: `'NAME'`, `'AWAITING_CUSTOM_NAME'`, `'TIMEZONE'`, `'AWAITING_CUSTOM_TIMEZONE'`, `'GAMIFICATION'`, `'COMPLETED'`. Default: `'NAME'` |
| `onboardingCompleted` | `boolean` | No | Default: `false` |
| `updatedAt` | `timestamptz` | No | Timestamp |

**Constraints**:
- `CHK_user_settings_reminder_minutes`: Check constraint `"reminderBeforeMinutes" >= 0`.

---

### 2.4 `Task` ([`task.entity.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/entities/task.entity.ts))
Table: `tasks`

Defines a reusable task entity (definition and metadata). Independent of individual daily execution instances.

| Column | Type | Nullable | Details |
|---|---|---|---|
| `id` | `uuid` | No | Primary key (`uuid`) |
| `ownerId` | `uuid` | No | Foreign key referencing `users.id` (`onDelete: 'RESTRICT'`) |
| `type` | `enum` (`TaskType`) | No | Values: `'one_time'`, `'daily'`. Default: `'one_time'` |
| `title` | `varchar(160)` | No | Short title (max 160 chars) |
| `description` | `text` | Yes | Extended details/notes |
| `priority` | `enum` (`TaskPriority`) | No | Values: `'low'`, `'normal'`, `'high'`. Default: `'normal'` |
| `scheduledStartTime` | `time` | Yes | Default scheduled start time of day (`HH:mm:ss`) |
| `estimatedMinutes` | `integer` | Yes | Estimated time to complete |
| `isActive` | `boolean` | No | Default: `true` (deactivation stops daily recurrence without deleting occurrences) |
| `archivedAt` | `timestamptz` | Yes | Soft-archive timestamp |
| `createdAt` | `timestamptz` | No | Timestamp |
| `updatedAt` | `timestamptz` | No | Timestamp |

**Indexes & Constraints**:
- `IDX_tasks_owner_id`: Index on `(ownerId)`.
- `CHK_tasks_estimated_minutes`: Check constraint `"estimatedMinutes" IS NULL OR "estimatedMinutes" >= 0`.

---

### 2.5 `TaskOccurrence` ([`task-occurrence.entity.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/entities/task-occurrence.entity.ts))
Table: `task_occurrences`

Represents an individual scheduled execution instance of a `Task` on a specific calendar date. Enables one-off tasks and recurring task schedules without duplicating task definitions.

| Column | Type | Nullable | Details |
|---|---|---|---|
| `id` | `uuid` | No | Primary key (`uuid`) |
| `taskId` | `uuid` | No | Foreign key referencing `tasks.id` (`onDelete: 'RESTRICT'`) |
| `date` | `date` | No | Calendar date of occurrence (`YYYY-MM-DD`), independent of timezone |
| `scheduledStartTime` | `time` | Yes | Occurrence-specific scheduled start time of day (`HH:mm:ss`) |
| `status` | `enum` (`TaskOccurrenceStatus`) | No | Values: `'pending'`, `'in_progress'`, `'completed'`, `'partially_completed'`, `'not_completed'`, `'skipped'`, `'cancelled'`. Default: `'pending'` |
| `scheduledStartAt` | `timestamptz` | Yes | Target start timestamp (retained for backward compatibility) |
| `scheduledDueAt` | `timestamptz` | Yes | Target completion deadline timestamp |
| `startedAt` | `timestamptz` | Yes | Actual start timestamp |
| `completedAt` | `timestamptz` | Yes | Actual completion timestamp |
| `notifiedAt` | `timestamptz` | Yes | Scheduled start notification delivery timestamp (null if not yet notified) |
| `createdAt` | `timestamptz` | No | Timestamp |
| `updatedAt` | `timestamptz` | No | Timestamp |

**Indexes & Constraints**:
- `IDX_occurrences_task_status`: Index on `(taskId, status)`.
- `IDX_occurrences_scheduled_due_at`: Index on `(scheduledDueAt)`.
- `IDX_occurrences_date`: Index on `(date)`.
- `UQ_task_occurrences_task_date`: Unique compound index on `(taskId, date)` preventing duplicate daily occurrences.
- `CHK_occurrences_scheduled_time_order`: Check constraint `"scheduledStartAt" IS NULL OR "scheduledDueAt" IS NULL OR "scheduledDueAt" >= "scheduledStartAt"`.

---

### 2.6 `ActivityEvent` ([`activity-event.entity.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/entities/activity-event.entity.ts))
Table: `activity_events`

Immutable log of user actions for analytics, auditing, and activity feeds.

| Column | Type | Nullable | Details |
|---|---|---|---|
| `id` | `uuid` | No | Primary key (`uuid`) |
| `userId` | `uuid` | No | Foreign key referencing `users.id` (`onDelete: 'RESTRICT'`) |
| `eventType` | `enum` (`ActivityEventType`) | No | Values: `'task_created'`, `'task_started'`, `'task_completed'`, `'task_skipped'`, `'task_archived'` |
| `entityType` | `varchar(50)` | No | Polymorphic entity category (e.g. `'task'`, `'occurrence'`) |
| `entityId` | `uuid` | Yes | Polymorphic entity ID |
| `metadata` | `jsonb` | Yes | Arbitrary structured context payload |
| `occurredAt` | `timestamptz` | No | Timestamp of the event occurrence |
| `createdAt` | `timestamptz` | No | Database insertion timestamp |

**Indexes**:
- `IDX_activity_events_user_occurred_at`: Compound index on `(userId, occurredAt)`.
- `IDX_activity_events_entity`: Compound index on `(entityType, entityId)`.

---

### 2.7 `PointTransaction` ([`point-transaction.entity.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/entities/point-transaction.entity.ts))
Table: `point_transactions`

Immutable append-only ledger for gamification points. User total points are computed by summing `pointsDelta`.

| Column | Type | Nullable | Details |
|---|---|---|---|
| `id` | `uuid` | No | Primary key (`uuid`) |
| `userId` | `uuid` | No | Foreign key referencing `users.id` (`onDelete: 'RESTRICT'`) |
| `taskOccurrenceId` | `uuid` | Yes | Optional foreign key referencing `task_occurrences.id` (`onDelete: 'SET NULL'`) |
| `pointsDelta` | `integer` | No | Non-zero delta (positive for awards, negative for deductions/penalties) |
| `reason` | `varchar(100)` | No | Business reason code/description |
| `idempotencyKey` | `varchar(255)` | Yes | Optional deduplication key to prevent duplicate awards |
| `metadata` | `jsonb` | Yes | Arbitrary calculation metadata |
| `createdAt` | `timestamptz` | No | Timestamp |

**Indexes & Constraints**:
- `IDX_point_transactions_user_created_at`: Compound index on `(userId, createdAt)`.
- `UQ_point_transactions_idempotency_key`: Partial unique index on `(idempotencyKey)` where `"idempotencyKey" IS NOT NULL`.
- `CHK_point_transactions_nonzero_delta`: Check constraint `"pointsDelta" <> 0`.

---

### 2.8 `GamificationProfile` ([`gamification-profile.entity.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/entities/gamification-profile.entity.ts))
Table: `gamification_profiles`

Persists the user's minimal, non-derived gamification state (streak counters and most recent qualified local date). Total XP and current level are derived directly from `point_transactions` and are intentionally not duplicated here.

| Column | Type | Nullable | Details |
|---|---|---|---|
| `userId` | `uuid` | No | Primary key and foreign key referencing `users.id` (`onDelete: 'CASCADE'`) |
| `currentStreak` | `integer` | No | Consecutive qualified days meeting the 3-occurrence completion threshold. Default: `0` |
| `longestStreak` | `integer` | No | All-time highest qualified streak achieved. Default: `0` |
| `lastQualifiedDate` | `date` | Yes | Local calendar date (`YYYY-MM-DD`) when user last qualified, preventing duplicate daily increments |
| `createdAt` | `timestamptz` | No | Timestamp |
| `updatedAt` | `timestamptz` | No | Timestamp |

**Constraints**:
- `CHK_gamification_profiles_current_streak`: Check constraint `"currentStreak" >= 0`.
- `CHK_gamification_profiles_longest_streak`: Check constraint `"longestStreak" >= 0`.

---

## 3. Referential Integrity & Cascade Map

```text
User
 ├── UserIdentity       (onDelete: CASCADE)
 ├── UserSettings       (onDelete: CASCADE)
 ├── GamificationProfile(onDelete: CASCADE)
 ├── Task               (onDelete: RESTRICT)
 │    └── TaskOccurrence (onDelete: RESTRICT)
 │         └── PointTransaction (onDelete: SET NULL)
 ├── ActivityEvent      (onDelete: RESTRICT)
 └── PointTransaction   (onDelete: RESTRICT)
```

---

## 4. Migrations

Located under [`libs/database/src/migrations/`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/migrations/):

- `1771340000000-CreateGamificationSchema.ts`: Provisions `point_transactions` (with unique idempotency index, user/occurrence foreign keys, and non-zero check) and `gamification_profiles` (with primary foreign key to `users`, non-negative streak checks). Reversible via `down()`.
