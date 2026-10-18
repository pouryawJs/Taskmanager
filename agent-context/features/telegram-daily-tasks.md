# Feature: Telegram Daily Task List & Task Details UI (Phase 6)

## 1. Overview & Objective

Phase 6 implements the Telegram user interface for viewing today's tasks and inspecting the details of specific task occurrences.

Key capabilities:
1. **Daily Task List**: Displays all active task occurrences for the user's current calendar date (evaluated in their configured IANA timezone).
2. **On-Demand Occurrence Materialization**: Guarantees that active recurring daily tasks have an occurrence created for today on-demand if one has not already been created, without requiring a background scheduler or causing duplicate occurrences.
3. **Timezone-Aware Scheduling Display**: Converts UTC timestamps (`scheduledDueAt`) into local time intervals (`HH:mm`), matching local start times and displaying intervals accurately.
4. **Deterministic Sorting**: Orders timed tasks first by start time ascending, followed by untimed tasks.
5. **Detailed Occurrence Inspection**: Provides a dedicated, full view for any occurrence with complete title, description, priority, recurrence type, timings, duration, status, and audit timestamps.
6. **Strict Ownership Validation**: Prevents unauthorized users from accessing or viewing metadata of occurrences they do not own.
7. **In-Place Navigation**: Edits messages in-place without chat spam, providing buttons to view occurrences, return to the daily list, or return to the main menu.

---

## 2. Callback Conventions & Routing

All interactions use compact callback data strictly within Telegram's 64-byte payload limit:

| Callback Query | Handler Action | Description |
|---|---|---|
| `menu:list_tasks` | `handleListTodayTasks()` | Main menu button: opens today's task list. |
| `task:list:today` | `handleListTodayTasks()` | Inline button: re-queries and refreshes today's list. |
| `task:back:to_list` | `handleListTodayTasks()` | Alias for returning to the daily list. |
| `task:view:<occurrenceId>` | `handleViewTaskDetails()` | Opens detailed view for the specified occurrence UUID (e.g. `task:view:46-bytes`). |
| `task:back:to_menu` | Return to Main Menu | Clears any session and renders the interactive main menu card. |

---

## 3. Daily Occurrence Materialization (`ensureDailyOccurrencesForDate`)

### The Challenge
A user may register a daily recurring task (`TaskType.DAILY`, `isActive: true`) on Day 1. On Day 2, before any background cron or scheduler has executed, the user opens the bot and requests today's task list. Without a mechanism to materialize today's occurrence, the daily task would be missing from the list.

### Idempotent Core Solution
`TasksService.ensureDailyOccurrencesForDate(userId: string, date?: string)` resolves this idempotently:
1. Resolves the user's configured IANA timezone and determines `targetDate` (`YYYY-MM-DD`).
2. Fetches all active daily tasks owned by the user (`isActive: true`, `type: TaskType.DAILY`).
3. Fetches existing occurrences for `(userId, targetDate)`.
4. For each active daily task lacking an occurrence on `targetDate`:
   - Checks if `targetDate >= taskStartDate` (never creates occurrences for dates prior to task creation).
   - If an earlier occurrence featured `scheduledDueAt`, converts that local time into a UTC timestamp for `targetDate` to preserve end-time semantics.
   - Creates a new occurrence with status `PENDING`.
   - Catches PostgreSQL unique constraint violations (code `23505` on `UQ_task_occurrences_task_date`) gracefully to guarantee concurrency safety during simultaneous requests.
5. Returns all occurrences for `targetDate`, sorted deterministically.

---

## 4. UI Formatting & Visual Conventions

### 4.1 Status Indicators
- 🟡 `در انتظار` (`PENDING`)
- 🔵 `در حال انجام` (`IN_PROGRESS`)
- 🟢 `تکمیل‌شده` (`COMPLETED`)
- 🟠 `تا حدودی تکمیل‌شده` (`PARTIALLY_COMPLETED`)
- 🔴 `انجام‌نشده` (`NOT_COMPLETED`)
- ⚪ `ردشده` (`SKIPPED`)
- ⚫ `لغوشده` (`CANCELLED`)

### 4.2 Priority Indicators
- 🔴 `بالا` (`HIGH`)
- 🟢 `عادی` (`NORMAL`)
- ⚪ `پایین` (`LOW`)

### 4.3 Scheduling Presentation
- **Start and End time exist**: `⏰ ۱۰:۰۰ تا ۱۲:۰۰`
- **Only Start time exists**: `⏰ ۱۰:۰۰`
- **Only End time exists**: `⏰ تا ۱۲:۰۰`
- **Untimed**: `⏰ بدون زمان مشخص`

*Note*: `Task.estimatedMinutes` is displayed as estimated duration (`⏱ مدت تخمینی: ۴۵ دقیقه`), never conflated with scheduled end time.

### 4.4 Inline Button Styles (Color-Style Follow-up)
Telegram Bot API supports `style?: 'success' | 'danger' | 'primary'` on inline keyboard buttons (`InlineKeyboardButton.AbstractInlineKeyboardButton`). In `buildDailyTaskListKeyboard()`, the `نمایش تسک` button for each occurrence is styled dynamically based on `TaskOccurrenceStatus`:
- **`COMPLETED`**: `success` (green)
- **`NOT_COMPLETED`**: `danger` (red)
- **`PENDING`**: `primary` (blue)
- **`IN_PROGRESS`**: `primary` (blue)
- **`CANCELLED`**: `danger` (red)
- **`SKIPPED` / `PARTIALLY_COMPLETED`**: `undefined` (default app-specific style)

Existing status emojis and labels in message text are fully preserved; button styles supplement them visually.

### 4.5 List Item Layout
```text
📋 لیست تسک‌های امروز (2026-10-18)
منطقه زمانی: Asia/Tehran
تعداد تسک‌ها: ۲

۱. 🟡 خرید نان سنگک
   📝 از نانوایی سر کوچه دو عدد نان کنجدی...
   ⏰ ۰۹:۰۰ | 🟢 عادی | در انتظار

۲. 🟢 ورزش باشگاه
   ⏰ ۱۸:۰۰ تا ۱۹:۰۰ | 🔴 بالا | تکمیل‌شده
```

### 4.6 Telegram Message Length Safeguard
Telegram rejects messages longer than 4096 characters.
In `buildDailyTaskListMessage()`:
- Task description excerpts are truncated to 50 characters.
- If accumulated text reaches 3800 characters, the loop halts gracefully and appends:
  `⚠️ به دلیل محدودیت طول پیام تلگرام، تنها X تسک اول نمایش داده شدند.`


---

## 5. Security & Ownership Validation

When opening task details via `task:view:<occurrenceId>`:
1. Validates that `occurrenceId` is a valid RFC 4122 UUID.
2. Calls `TasksService.getOccurrenceById(userId, occurrenceId)`, which performs:
   ```typescript
   if (occurrence.task.ownerId !== userId) {
     throw new ForbiddenException('You do not have permission to access this task occurrence.');
   }
   ```
3. If unauthorized: catches `ForbiddenException` and shows a generic alert (`⛔️ شما اجازه دسترسی به این تسک را ندارید.`). **Zero task information (no title, description, or existence confirmation) is disclosed to unauthorized callers.**
4. If not found: catches `NotFoundException` and shows `⚠️ تسک مورد نظر یافت نشد یا ممکن است حذف شده باشد.`.

---

## 6. Testing & Verification

15 automated end-to-end integration test scenarios cover this feature in `apps/bot/src/telegram/features/tasks/task-list-and-details.spec.ts`:
1. Multiple occurrences rendering with inline buttons.
2. Empty state handling with `➕ ثبت تسک جدید` button.
3. Mixed one-time and recurring task occurrences.
4. Correct calendar date resolution across different timezones (`Asia/Tehran`, `America/New_York`, `UTC`).
5. All 7 status labels and emojis.
6. Local scheduling display converting `scheduledDueAt` into user timezone.
7. Timed tasks sorting before untimed tasks.
8. Opening specific occurrence details with full metadata.
9. Returning to the list and refreshing data.
10. Rejecting access to other users' occurrences without leaking details.
11. Handling nonexistent occurrences and malformed UUID callbacks.
12. Idempotency and preventing duplicate occurrences on repeated clicks.
13. Avoiding duplicate messages by editing in-place via `TelegramUiService.editOrReply`.
14. Graceful fallback on Telegram edit errors.
15. Handling long lists within message length limits.

---

## 7. Limitations & Future Phases

1. **No Background Cron (Yet)**: Daily occurrences are materialized on-demand when the user views their list or queries occurrences. A future phase will introduce a background worker/scheduler for proactive notification reminders.
2. **Read-Only Scope**: Status mutations (marking completed, in-progress, skipped, cancelled) and editing titles/descriptions are strictly out-of-scope for Phase 6 and will be implemented in subsequent phases.
