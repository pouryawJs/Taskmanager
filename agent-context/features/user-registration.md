# Feature: User Registration & Onboarding Domain

> User registration, identity linking, and multi-step onboarding domain logic for Telegram and future identity providers.

Related: [Project Context](../PROJECT_CONTEXT.md) | [Database Model](../database.md) | [Telegram Start Feature](./telegram-start.md)

---

## 1. Purpose & Scope

The User Registration feature handles identity resolution, account provisioning, and onboarding progress tracking. When a user interacts with the system via an external identity channel (initially Telegram), the service:
1. Resolves whether the user has an existing account linked to that provider and external ID.
2. If new, atomically provisions a `User`, a `UserIdentity` (mapping the provider and external ID), and initial `UserSettings` with `Asia/Tehran` default timezone and `onboardingStep = NAME`.
3. Supports incremental onboarding updates: display name changes, timezone updates, setting intermediate waiting steps (`AWAITING_CUSTOM_NAME`, `AWAITING_CUSTOM_TIMEZONE`), and marking onboarding completion.
4. Handles concurrent registration attempts cleanly using PostgreSQL unique constraints (`23505`) without creating duplicate records or throwing unhandled errors.

---

## 2. Implementation Status

| Component | Status | Location | Notes |
|---|---|---|---|
| DTOs | Implemented | [`libs/core/src/users/dto/`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/users/dto/) | `RegisterTelegramUserDto`, `UpdateDisplayNameDto`, `UpdateTimezoneDto` |
| Service | Implemented | [`libs/core/src/users/users.service.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/users/users.service.ts) | Idempotent transaction logic + atomic updates + code `23505` handling |
| Module | Implemented | [`libs/core/src/users/users.module.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/users/users.module.ts) | Exports `UsersService` |
| Library Export | Implemented | [`libs/core/src/index.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/index.ts) | Exported under `@app/core` |
| Ingress Integration | Implemented | `apps/bot/src/telegram/features/start` | `StartHandler` invokes `UsersService` across all steps |
| Unit Tests | Verified (49/49) | [`libs/core/src/users/users.service.spec.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/users/users.service.spec.ts) | Full coverage of new, existing, concurrency, rollback, and validation cases |

---

## 3. Relevant Source Files

- [`libs/core/src/users/dto/register-telegram-user.dto.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/users/dto/register-telegram-user.dto.ts)
- [`libs/core/src/users/dto/update-display-name.dto.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/users/dto/update-display-name.dto.ts)
- [`libs/core/src/users/dto/update-timezone.dto.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/users/dto/update-timezone.dto.ts)
- [`libs/core/src/users/users.service.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/users/users.service.ts)
- [`libs/core/src/users/users.module.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/users/users.module.ts)
- [`libs/database/src/entities/user.entity.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/entities/user.entity.ts)
- [`libs/database/src/entities/user-identity.entity.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/entities/user-identity.entity.ts)
- [`libs/database/src/entities/user-settings.entity.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/entities/user-settings.entity.ts)

---

## 4. Key Service API

### `findTelegramUser(telegramUserId: string): Promise<User | null>`
Queries `UserIdentity` by provider `telegram` and `providerUserId`, returning the linked user and their `settings`.

### `initiateTelegramUser(telegramUserId: string, suggestedDisplayName?: string | null): Promise<RegisterUserResult>`
Idempotently provisions account if not existing within an atomic transaction. Sets default timezone to `Asia/Tehran` and `onboardingStep` to `OnboardingStep.NAME`. Handles race conditions with Postgres code `23505`.

### `updateDisplayName(userId: string, displayName: string, nextStep?: OnboardingStep): Promise<User>`
Validates non-empty, trims, and updates `displayName` on `User`, while advancing `onboardingStep` (defaults to `TIMEZONE`).

### `updateTimezone(userId: string, timezone: string, nextStep?: OnboardingStep): Promise<User>`
Validates standard IANA timezone using `Intl.DateTimeFormat` (rejecting raw UTC offsets), updates `timezone` in `UserSettings`, and advances `onboardingStep` (defaults to `GAMIFICATION`).

### `setOnboardingStep(userId: string, step: OnboardingStep): Promise<User>`
Updates the active step (e.g. `AWAITING_CUSTOM_NAME` or `AWAITING_CUSTOM_TIMEZONE`).

### `completeOnboarding(userId: string): Promise<User>`
Marks `onboardingCompleted = true` and `onboardingStep = COMPLETED`.

---

## 5. Transaction Boundaries & Concurrency Safety

1. **Transaction Boundary**: User initialization, identity creation, and default settings provisioning are strictly isolated within a single `dataSource.transaction()` call using the transactional `EntityManager`.
2. **Rollback Safety**: If any related record creation fails during registration, the newly created `User` record rolls back completely.
3. **Concurrency Handling**: If two requests for the same Telegram ID execute concurrently, the second will trip `UQ_user_identities_provider_external_id`. The service catches error `23505`, fetches the existing user record, and returns it cleanly.
