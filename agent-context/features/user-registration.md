# Feature: User Registration

> User registration and identity linking domain logic for Telegram and future identity providers.

Related: [Project Context](../PROJECT_CONTEXT.md) | [Database Model](../database.md) | [Telegram Start Feature](./telegram-start.md)

---

## 1. Purpose & Scope

The User Registration feature handles identity resolution and account provisioning. When a user interacts with the system via an external identity channel (initially Telegram), the service:
1. Resolves whether the user has an existing account linked to that provider and ID.
2. If new, atomically provisions a `User`, a `UserIdentity` (mapping the provider and external ID), and default `UserSettings`.
3. Handles concurrent registration attempts cleanly without creating duplicate records or throwing unhandled errors.

---

## 2. Implementation Status

| Component | Status | Location | Notes |
|---|---|---|---|
| DTO | Implemented | [`libs/core/src/users/dto/register-telegram-user.dto.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/users/dto/register-telegram-user.dto.ts) | Runtime validation via `class-validator` and `class-transformer` |
| Service | Implemented | [`libs/core/src/users/users.service.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/users/users.service.ts) | Atomic transaction + PostgreSQL `23505` error handling |
| Module | Implemented | [`libs/core/src/users/users.module.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/users/users.module.ts) | Exports `UsersService` |
| Library Export | Implemented | [`libs/core/src/index.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/index.ts) | Exported under `@app/core` |
| Ingress Integration | **Not Implemented** | `apps/bot` / `apps/api` | `StartHandler` does not yet call `UsersService` |

---

## 3. Relevant Source Files

- [`libs/core/src/users/dto/register-telegram-user.dto.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/users/dto/register-telegram-user.dto.ts)
- [`libs/core/src/users/users.service.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/users/users.service.ts)
- [`libs/core/src/users/users.module.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/users/users.module.ts)
- [`libs/database/src/entities/user.entity.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/entities/user.entity.ts)
- [`libs/database/src/entities/user-identity.entity.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/entities/user-identity.entity.ts)
- [`libs/database/src/entities/user-settings.entity.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/database/src/entities/user-settings.entity.ts)

---

## 4. Interfaces & Data Transfer Objects

### `RegisterTelegramUserDto`
```typescript
export class RegisterTelegramUserDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[1-9]\d*$/, {
    message: 'telegramUserId must be a positive integer represented as a string.',
  })
  @MaxLength(20)
  telegramUserId!: string;

  @ValidateIf((_object, value) => value !== null)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  displayName!: string | null;
}
```

### `RegisterUserResult`
```typescript
export interface RegisterUserResult {
  user: User;
  isNew: boolean;
}
```

---

## 5. Request & Data Flow

```text
Caller (e.g. StartHandler)
       │
       ▼
UsersService.registerTelegramUser(dto)
       │
       ├─► 1. Query UserIdentity (provider = 'telegram', providerUserId = dto.telegramUserId)
       │      │
       │      ├── If found: Return { user: existingIdentity.user, isNew: false }
       │      │
       │      └── If not found:
       │             │
       ▼             ▼
       2. DataSource.transaction(async manager => {
             a. user = manager.save(User.create({ displayName }))
             b. manager.save(UserIdentity.create({ provider: 'telegram', providerUserId, userId: user.id }))
             c. manager.save(UserSettings.create({ userId: user.id }))
             return { user, isNew: true }
          })
       │
       ▼ (On QueryFailedError code '23505' - Unique Violation)
       3. Re-query UserIdentity and return existing user ({ user, isNew: false })
```

---

## 6. Database Interactions & Transaction Boundaries

1. **Transaction Boundary**: The user creation, identity association, and default settings provisioning are strictly isolated within a single `dataSource.transaction()` call.
2. **Rollback Safety**: If `UserIdentity` or `UserSettings` creation fails during registration, the newly created `User` record rolls back completely.
3. **Concurrency Handling**: If two requests for the same Telegram ID hit step 2 concurrently, the second will trip the `UQ_user_identities_provider_external_id` unique constraint. The `catch` block intercepts PostgreSQL error `23505`, fetches the freshly created user record, and returns it cleanly.

---

## 7. Known Limitations & Next Steps

1. **Not Wired to Ingress**: `StartHandler` in `apps/bot` does not yet call `UsersService.registerTelegramUser()`.
2. **Profile Updates**: Returning users do not have their `displayName` updated if they changed their name in Telegram.
3. **Validation at Non-HTTP Boundary**: Telegram handlers must explicitly run `validate()` on `RegisterTelegramUserDto` before passing it to `UsersService`.
4. **Unit / Integration Tests**: No test file currently covers `UsersService` or `RegisterTelegramUserDto`.
