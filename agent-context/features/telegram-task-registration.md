# Feature: Telegram Task Registration Flow

> Interactive multi-step task creation in Telegram bot supporting one-time and daily recurring tasks, calendar picker, multi-line text entry with all-or-nothing validation, atomic persistence, and auto-deleting confirmation messages.

Related: [Project Context](../PROJECT_CONTEXT.md) | [System Architecture](../architecture.md) | [Task Management Core](./task-management-core.md) | [Architecture Decisions](../decisions.md)

---

## 1. Purpose & Scope

The **Telegram Task Registration Flow** (`apps/bot/src/telegram/features/tasks/`) integrates the core task creation logic (`TasksService`) and task text parser (`TaskTextParser`) into the Telegram bot UI.

### Key Capabilities:
1. **Task Type Selection**: The user selects between a **one-time task** (`TaskType.ONE_TIME`) or a **daily recurring task** (`TaskType.DAILY`).
2. **Interactive Calendar Date Picker**: For one-time tasks, provides previous/next month navigation and day selection (`YYYY-MM-DD`), with quick shortcuts for today and tomorrow. Rejects arbitrary callback data.
3. **Multi-Line Text Registration Mode**: Users can send multiple messages, each containing one or more tasks.
4. **All-or-Nothing Message Validation**: Every message is validated independently using `TaskTextParser`. If any line is invalid, no tasks from that message are created, and line-specific Persian errors are displayed.
5. **Atomic Batch Persistence**: All valid tasks in a message are saved together atomically in a single database transaction via `TasksService.createTasks()`.
6. **Non-Destructive Registration**: Tasks saved from earlier messages remain safely stored even if a later message is invalid or the user exits.
7. **Safe Message Deletion & Ephemeral Feedback**: Successfully processed messages are deleted immediately with temporary confirmation toasts; validation error messages are displayed temporarily (~15s) while preserving the user's original message temporarily to allow copying/correction.

---

## 2. Implementation Status

| Component | Status | Location | Notes |
|---|---|---|---|
| State Management | Implemented | [`task-registration.state.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/tasks/task-registration.state.ts) | Isolated in-memory session per Telegram user with TTL |
| Feature Middleware | Implemented | [`tasks.feature.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/tasks/tasks.feature.ts) | Scoped Grammy middleware prioritizing active task registration |
| Handlers | Implemented | [`task-registration.handlers.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/tasks/task-registration.handlers.ts) | Calendar callbacks, registration mode, text processing, error handling |
| Keyboards | Implemented | [`tasks.keyboards.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/tasks/tasks.keyboards.ts) | Task type picker, dynamic calendar grid, registration mode controls |
| Messages | Implemented | [`tasks.messages.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/tasks/tasks.messages.ts) | Formatted Persian instructions, validation errors, and confirmations |
| Feature Module | Implemented | [`tasks.module.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/tasks/tasks.module.ts) | Imported into `TelegramModule` |
| End-Time Timezone Mapping | Implemented | [`task-date.util.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/tasks/utils/task-date.util.ts) | `localDateTimeToUtcDate` converts local time to UTC timestamp |
| Unit Tests | Verified (24/24 passing) | [`task-registration.handlers.spec.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/tasks/task-registration.handlers.spec.ts) | Full coverage of all 16 minimum requirements |

---

## 3. Relevant Source Files

- [`apps/bot/src/telegram/features/tasks/task-registration.state.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/tasks/task-registration.state.ts)
- [`apps/bot/src/telegram/features/tasks/task-registration.handlers.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/tasks/task-registration.handlers.ts)
- [`apps/bot/src/telegram/features/tasks/tasks.feature.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/tasks/tasks.feature.ts)
- [`apps/bot/src/telegram/features/tasks/tasks.keyboards.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/tasks/tasks.keyboards.ts)
- [`apps/bot/src/telegram/features/tasks/tasks.messages.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/tasks/tasks.messages.ts)
- [`apps/bot/src/telegram/features/tasks/tasks.module.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/tasks/tasks.module.ts)
- [`apps/bot/src/telegram/features/tasks/task-registration.handlers.spec.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/apps/bot/src/telegram/features/tasks/task-registration.handlers.spec.ts)
- [`libs/core/src/tasks/utils/task-date.util.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/tasks/utils/task-date.util.ts)
- [`libs/core/src/tasks/tasks.service.ts`](file:///f:/Programming/Nest js/projects/task-manager-platform/libs/core/src/tasks/tasks.service.ts)

---

## 4. User Workflow

### Step A — Choose Task Type
1. User taps `➕ ثبت تسک جدید` from the Main Menu (`menu:create_task`).
2. Bot displays the type selection message:
   - `📌 تسک یک‌باره` (`task:type:one_time`)
   - `🔄 تسک روزانه تکرارشونده` (`task:type:daily`)
   - `🔙 بازگشت به منوی اصلی` (`task:back:to_menu`)
3. **One-Time Task**: User is prompted to select a date via the inline calendar.
4. **Daily Recurring Task**: Uses the current calendar date in the user's `UserSettings.timezone` as the initial occurrence date and enters registration mode immediately.

### Calendar Date Picker
- **Navigation**: Month navigation with next month (`task:date:nav:YYYY-MM`) and previous month. Previous month navigation is disabled when the target month is in the past.
- **Shortcuts**: `📅 امروز` and `📅 فردا` buttons at the top for instant 1-tap selection (evaluated in user's configured IANA timezone).
- **Day Grid**: Persian week starting on Saturday (`ش`, `ی`, `د`, `س`, `چ`, `پ`, `ج`). Past days (`< todayDate`) are visually disabled with `·` and return an immediate alert if tapped (`task:date:past`).
- **Validation**: Strict ISO date verification (`isValidIsoDate`) and past-date rejection (`selectedDate >= todayDate`). Any attempt to select a past date is rejected with an explanatory Persian alert. Stale or crafted callbacks and messages cannot bypass this boundary.

### Step B — Enter Task Registration Mode
Bot displays the instructional message explaining:
- Each non-empty line represents one task.
- Formats: untimed (`خرید نان`), start-time only (`ورزش ساعت 18:00`), start & end interval (`مطالعه از 09:00 تا 10:30`).
- Multi-message support: multiple messages can be sent in sequence.
- Independent message validation: earlier saved tasks remain saved.
- Action buttons: `🏁 پایان ثبت تسک‌ها` (`task:reg:finish`) and `🔙 بازگشت` (`task:reg:back`).

### Step C — Process Each Text Message
For each incoming text message:
1. Parse using `TaskTextParser.tryParse(text)`.
2. **If validation fails**:
   - No tasks are created from that message.
   - Line-specific Persian errors are displayed in a temporary toast (~15s auto-delete).
   - The user's original message is preserved temporarily and scheduled for auto-deletion after ~15s, allowing copying/correction.
3. **If validation succeeds**:
   - Maps drafts to `CreateTaskDto[]`.
   - Converts `scheduledEndTime` to UTC timestamp `scheduledDueAt` using `localDateTimeToUtcDate()`.
   - Calls `TasksService.createTasks(userId, dtos)` inside a single atomic database transaction.
   - Deletes the user's original message immediately.
   - Sends a self-deleting confirmation toast (~7s auto-delete).
   - Session remains active for additional messages.

### Step D & E — Finish and Back
- **Finish Registration**: Clears the session, displays the total number of tasks created during the session, and returns to the Main Menu.
- **Back**: Clears the session without touching previously saved tasks, and returns to the date picker or task type picker.
- **`/start` Command**: Cleans up any active task registration session and redirects to the start/main menu.

---

## 5. Middleware Ordering & Collision Prevention

To prevent text messages during task registration from leaking into `StartHandler` (onboarding custom name/timezone) or vice versa:

1. `TasksBotModule` is imported before `StartModule` in `TelegramModule`.
2. In `TasksFeature`, `bot.on('message:text', ...)` intercepts incoming text:
   - If the text is a command (starts with `/`), calls `next()` immediately.
   - If `TaskRegistrationHandler.hasActiveSession(ctx)` is **true**, it consumes and processes the message and **does NOT call `next()`**. `StartHandler` never receives it.
   - If `hasActiveSession(ctx)` is **false**, it calls `await next()`, allowing `StartHandler` to handle onboarding text normally.
3. `/start` command listener in `TasksFeature` explicitly cleans up any orphaned task registration session before delegating to `StartFeature`.
4. Callbacks prefixed with `task:` or equal to `menu:create_task` are captured by `TasksFeature` without calling `next()`.

---

## 6. End-Time Representation & Timezone Mapping

- **Parser Output**: `draft.scheduledEndTime` represents `HH:mm:ss`.
- **Occurrence Model**: `TaskOccurrence.scheduledDueAt` is a PostgreSQL `TIMESTAMPTZ` field.
- **Mapping Logic**:
  ```typescript
  const scheduledDueAt = localDateTimeToUtcDate(
    targetDate,             // 'YYYY-MM-DD'
    draft.scheduledEndTime, // 'HH:mm:ss'
    userTimezone,           // e.g. 'Asia/Tehran'
  );
  ```
  `localDateTimeToUtcDate` uses standard ECMAScript `Intl.DateTimeFormat` with refinement to convert local wall-clock times to exact UTC `Date` objects, accurately accounting for standard time and daylight saving time without external dependencies.
- **DTO Support**: `CreateTaskDto.scheduledDueAt` passes this timestamp into `TasksService.createTasks()`, persisting it on `TaskOccurrence.scheduledDueAt`.

---

## 7. Deferred Items

The following functionality remains deferred to subsequent phases:
- Daily task-list view (`menu:list_tasks`) and calendar schedule browsing.
- Occurrence completion / cancellation / status toggles in Telegram chat.
- Background cron worker generating daily occurrences for recurring tasks.
- 30-minute unacknowledged occurrence timeout worker.
- Gamification point allocation on occurrence completion.
