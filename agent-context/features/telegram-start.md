# Feature: Telegram /start Command & Onboarding Flow

> Initial entry point for Telegram bot users handling the `/start` command, welcome messaging, display name choice, timezone confirmation, gamification introduction, and main menu.

Related: [Project Context](../PROJECT_CONTEXT.md) | [System Architecture](../architecture.md) | [User Registration Feature](./user-registration.md)

---

## 1. Purpose & Scope

The `/start` command and onboarding flow is the primary user onboarding entry point in the Telegram bot interface. When a user sends `/start` in Telegram:
1. **Registered & Completed Users**: The bot immediately displays the Main Menu without recreating records or restarting onboarding.
2. **New Users**: The bot automatically extracts profile information from Telegram (`id`, `first_name`, `last_name`), initiates an account in a database transaction, and guides the user through the onboarding steps:
   - **Step 2 (Display Name)**: Confirms the suggested profile name or accepts a custom name with validation (non-empty, trimmed, <= 100 chars).
   - **Step 3 (Time Zone)**: Confirms the default `Asia/Tehran` time zone or provides a curated IANA time-zone picker and manual IANA identifier entry.
   - **Step 4 (Gamification)**: Introduces the gamification rules and features ("Complete tasks to earn points and track your progress. Let's get started!").
   - **Step 5 (Completion)**: Marks onboarding complete in `UserSettings`, shows a celebration message, and presents the Main Menu.
3. **Interrupted Registrations**: If a user leaves and returns, subsequent `/start` commands resume from their last incomplete onboarding step (`NAME`, `TIMEZONE`, or `GAMIFICATION`).

---

## 2. Implementation Status

| Component | Status | Location | Notes |
|---|---|---|---|
| Command Registration | Implemented | [`apps/bot/src/telegram/features/start/start.feature.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.feature.ts) | Registers `/start`, `callback_query:data`, and `message:text` |
| Onboarding Handler | Implemented | [`apps/bot/src/telegram/features/start/start.handlers.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.handlers.ts) | Multi-step wizard, interruption recovery, validation, idempotency |
| Messages & Copy | Implemented | [`apps/bot/src/telegram/features/start/start.messages.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.messages.ts) | Persian formatted with HTML mode & sanitization |
| Inline Keyboards | Implemented | [`apps/bot/src/telegram/features/start/start.keyboards.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.keyboards.ts) | Display name, timezone confirm/picker, gamification, main menu |
| Feature Module | Implemented | [`apps/bot/src/telegram/features/start/start.module.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.module.ts) | Imports `BotRuntimeModule` and `UsersModule` |
| Core Service Integration | Implemented | [`libs/core/src/users/users.service.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/users/users.service.ts) | `initiateTelegramUser`, `updateDisplayName`, `updateTimezone`, `completeOnboarding` |
| Unit Tests | Verified (49/49) | [`apps/bot/src/telegram/features/start/start.handlers.spec.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.handlers.spec.ts) | Covers all 12 test scenarios specified in requirements |

---

## 3. Relevant Source Files

- [`apps/bot/src/telegram/features/start/start.module.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.module.ts)
- [`apps/bot/src/telegram/features/start/start.feature.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.feature.ts)
- [`apps/bot/src/telegram/features/start/start.handlers.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.handlers.ts)
- [`apps/bot/src/telegram/features/start/start.messages.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.messages.ts)
- [`apps/bot/src/telegram/features/start/start.keyboards.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.keyboards.ts)
- [`libs/core/src/users/users.service.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/users/users.service.ts)
- [`libs/core/src/users/dto/update-display-name.dto.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/users/dto/update-display-name.dto.ts)
- [`libs/core/src/users/dto/update-timezone.dto.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/users/dto/update-timezone.dto.ts)

---

## 4. Request & State Flow

```text
User sends /start
       │
       ▼
StartHandler.handleStart()
       │
       ├─► Existing & Onboarding Completed: Show Main Menu
       │
       ├─► Existing & Onboarding Incomplete: Resume from user.settings.onboardingStep
       │      ├── NAME / AWAITING_CUSTOM_NAME: Prompt display name
       │      ├── TIMEZONE / AWAITING_CUSTOM_TIMEZONE: Prompt timezone confirmation
       │      └── GAMIFICATION: Prompt gamification intro & "Let's go!" button
       │
       └─► New User:
              │
              ├── 1. UsersService.initiateTelegramUser(id, suggestedName)
              │      (atomic transaction: User + UserIdentity + UserSettings[onboardingStep='NAME'])
              │
              └── 2. Prompt Step 2 (Display Name)
                     [✅ Confirm Suggested] -> updateDisplayName() -> Step 3
                     [✏️ Enter Custom] -> setOnboardingStep(AWAITING_CUSTOM_NAME)
                            │ (User sends text message)
                            ▼
                     validate(UpdateDisplayNameDto) -> updateDisplayName() -> Step 3
                            │
                            ▼
                     Step 3 (Time Zone Confirmation)
                     [✅ Confirm Asia/Tehran] -> updateTimezone() -> Step 4
                     [🌐 Choose Other] -> Timezone picker (or manual IANA entry)
                            │
                            ▼
                     Step 4 (Gamification Introduction)
                     "Complete tasks to earn points and track your progress. Let's get started!"
                     [🚀 Let's go!] -> completeOnboarding()
                            │
                            ▼
                     Step 5 (Complete Registration)
                     Mark onboardingCompleted=true, show celebration message, and render Main Menu.
```

---

## 5. Interruption Handling & Concurrency Safety

1. **State Persistence**: Onboarding step is stored in `UserSettings.onboardingStep` (`NAME`, `AWAITING_CUSTOM_NAME`, `TIMEZONE`, `AWAITING_CUSTOM_TIMEZONE`, `GAMIFICATION`, `COMPLETED`), keeping `User` entity clean per ADR-004.
2. **Repeated Clicks & Idempotency**: Callback query handlers check if user has already completed onboarding or passed that step, answering callback queries gracefully without re-executing state transitions.
3. **Unexpected Input Recovery**: If a user sends unexpected text during button-only steps, the bot informs them politely and re-prompts the current step keyboard so they are never stranded.

---

## 6. Message Editing & Temporary Confirmations Pattern

Established in [`TelegramUiService`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/ui/telegram-ui.service.ts) as the standard interaction pattern across the bot:
1. **In-Place Message Editing**:
   - Menu transitions edit the existing message and inline keyboard via `editOrReply()` rather than spamming new messages into the chat.
   - Handles Telegram's `message is not modified` error safely without throwing or sending duplicates.
   - Falls back gracefully to `ctx.reply()` if the target message was deleted or cannot be edited.
2. **Temporary Confirmation Messages**:
   - Short status toasts (e.g. `✅ نام نمایشی شما با موفقیت تغییر کرد.`, `✅ منطقه زمانی شما با موفقیت روی Asia/Tehran تنظیم شد.`, `✅ ثبت‌نام شما با موفقیت تکمیل شد.`) are sent separately after successful operations.
   - Automatically scheduled for deletion after approximately 10 seconds.
   - Deletion executes asynchronously without blocking the update handler or throwing unhandled errors if already deleted.
   - Deletes strictly the bot's own confirmation message.

