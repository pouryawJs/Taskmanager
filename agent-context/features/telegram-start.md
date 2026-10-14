# Feature: Telegram /start Command

> Initial entry point for Telegram bot users handling the `/start` command, welcome messaging, and keyboard interaction.

Related: [Project Context](../PROJECT_CONTEXT.md) | [System Architecture](../architecture.md) | [User Registration Feature](./user-registration.md)

---

## 1. Purpose & Scope

The `/start` command is the onboarding entry point in the Telegram bot interface. When a user sends `/start` in Telegram:
1. The bot responds with a Persian welcome message (`START_MESSAGE`) explaining the core capabilities (task tracking, reminders, points & profile).
2. The bot presents an inline keyboard button (`🔥 شروع`) carrying the callback payload `GET_INFORMATION`.
3. (Intended Target): The handler registers or resolves the user's account via `UsersService.registerTelegramUser()`.

---

## 2. Implementation Status

| Component | Status | Location | Notes |
|---|---|---|---|
| Command Registration | Implemented | [`apps/bot/src/telegram/features/start/start.feature.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.feature.ts) | Bound in `onModuleInit` via `bot.command('start')` |
| Command Handler | Partially Implemented | [`apps/bot/src/telegram/features/start/start.handlers.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.handlers.ts) | Sends welcome text & keyboard; **not connected** to `UsersService` |
| Messages & Copy | Implemented | [`apps/bot/src/telegram/features/start/start.messages.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.messages.ts) | Persian text formatted with Telegram HTML tags |
| Inline Keyboard | Implemented | [`apps/bot/src/telegram/features/start/start.keyboards.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.keyboards.ts) | Button callback: `GET_INFORMATION` |
| Feature Module | Implemented | [`apps/bot/src/telegram/features/start/start.module.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.module.ts) | Imports `BotRuntimeModule`, registers feature and handler |
| Registration Integration | **Not Implemented** | `start.handlers.ts` | Does not import or invoke `UsersService` |
| Wizard Callback (`GET_INFORMATION`)| **Not Implemented** | — | Callback query is not handled |

---

## 3. Relevant Source Files

- [`apps/bot/src/telegram/features/start/start.module.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.module.ts)
- [`apps/bot/src/telegram/features/start/start.feature.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.feature.ts)
- [`apps/bot/src/telegram/features/start/start.handlers.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.handlers.ts)
- [`apps/bot/src/telegram/features/start/start.messages.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.messages.ts)
- [`apps/bot/src/telegram/features/start/start.keyboards.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/start/start.keyboards.ts)
- [`apps/bot/src/telegram/runtime/bot-runtime.module.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/runtime/bot-runtime.module.ts)

---

## 4. Current Request Flow

```text
User sends /start in Telegram
           │
           ▼
StartFeature.onModuleInit() listener:
    bot.command('start', ctx => this.startHandler.handle(ctx))
           │
           ▼
StartHandler.handle(ctx)
    ├── Checks `if (!ctx.from)` -> logs warning and exits if missing
    └── Calls `ctx.reply(START_MESSAGE, { parse_mode: 'HTML', reply_markup: startKeyboard })`
```

---

## 5. UI & Content Specifications

### Welcome Message (`START_MESSAGE`)
Persian message rendered with Telegram HTML parse mode:
- Explains task creation and daily tracking.
- Explains start/end reminder notifications.
- Explains gamification points and performance tracking.

### Keyboard (`startKeyboard`)
Inline keyboard containing a single button:
- Text: `'🔥 شروع'`
- Callback payload: `'GET_INFORMATION'`

---

## 6. Gaps & Next Steps for Completion

1. **Import `UsersModule` into `StartModule`**: `StartModule` needs access to `UsersService` (via `UsersModule` from `@app/core`).
2. **Execute Registration in `StartHandler`**:
   - Extract `ctx.from.id` and display name (`ctx.from.first_name` + optional `last_name`).
   - Validate input against `RegisterTelegramUserDto` using `class-validator`.
   - Call `await this.usersService.registerTelegramUser(dto)`.
3. **Handle Callback Query**: Either register a callback handler for `'GET_INFORMATION'` or adjust the button to open the main menu or a placeholder dialog.
