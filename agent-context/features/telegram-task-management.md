# Feature: Telegram Task Details Menu & Task Management Operations (Phase 7)

## 1. Overview & Objectives

Phase 7 extends the Telegram task details UI into a complete, actionable task management interface. Users can inspect any task occurrence in detail and execute supported lifecycle actions, status changes, information edits, priority adjustments, and schedule modifications directly from intuitive inline keyboards.

Core principles:
- **Core Decoupling**: All mutation and business logic resides in `libs/core` (`TasksService`). The Telegram layer (`apps/bot`) handles presentation, interactive sessions, and user feedback only.
- **Strict Ownership Validation**: Every action callback and text input verifies that the authenticated user owns the task and occurrence before applying any changes.
- **Tamper-Resistant Compact Callbacks**: All callback data stays safely within Telegram's 64-byte payload limit using concise route prefixes.
- **Audit & History Preservation**: Deactivating recurring tasks or editing task definitions never overwrites or erases historical occurrences, timestamps, or points. Permanent deletion is rejected if completed occurrences or point transactions exist.

---

## 2. Details Menu Structure & Available Actions

When viewing an occurrence (`task:view:<occurrenceId>`), the bot presents an action menu formatted in Persian:

```text
[ 🔄 تغییر وضعیت ]
[ ✏️ ویرایش مشخصات ] [ ⏰ زمان‌بندی ]
[ ⚡️ تغییر اولویت ]
[ 🛑 غیرفعال‌سازی / حذف ]  (یا [ 🗑 حذف تسک ] برای تسک‌های یک‌باره)
[ 🔙 بازگشت به لیست امروز ]
[ 🏠 منوی اصلی ]
```

### Callback Routing Table

| Callback Pattern | Target Handler | Description | Max Payload Length |
|---|---|---|---|
| `task:view:<occId>` | `handleViewTaskDetails` | Opens details view with action keyboard | ~46 bytes |
| `task:act:stat:<occId>` | `handleStatusMenu` | Opens status transition submenu | ~50 bytes |
| `task:st:<occId>:<status>` | `handleSetStatus` | Applies status transition (`prog`, `comp`, `part`, `not`, `skip`, `canc`) | ~49-55 bytes |
| `task:act:prio:<occId>` | `handlePriorityMenu` | Opens priority selector submenu | ~50 bytes |
| `task:pr:<occId>:<level>` | `handleSetPriority` | Sets priority (`high`, `normal`, `low`) | ~48-51 bytes |
| `task:act:edit:<occId>` | `handleEditInfoMenu` | Opens edit fields submenu (title, description) | ~50 bytes |
| `task:ed:<occId>:title` | `handleStartEditField` | Initiates interactive title editing session | ~50 bytes |
| `task:ed:<occId>:desc` | `handleStartEditField` | Initiates interactive description editing session | ~49 bytes |
| `task:ed:canc:<occId>` | `handleCancelEdit` | Cancels active edit session and returns to details | ~49 bytes |
| `task:act:sched:<occId>` | `handleScheduleMenu` | Opens schedule management submenu | ~51 bytes |
| `task:sc:<occId>:clear` | `handleClearSchedule` | Clears scheduled times | ~50 bytes |
| `task:sc:<occId>:time` | `handleStartEditTime` | Prompts for time / interval text input | ~49 bytes |
| `task:sc:<occId>:date` | `handleStartEditDate` | Prompts for new date (one-time tasks only) | ~49 bytes |
| `task:sc:apply_today:<occId>` | `handleRecurringScheduleApply` | Applies edited time to today's occurrence only | ~57 bytes |
| `task:sc:apply_all:<occId>` | `handleRecurringScheduleApply` | Applies edited time to recurring task default | ~55 bytes |
| `task:act:lifecycle:<occId>` | `handleLifecycleMenu` | Opens recurring lifecycle options (deactivate vs delete) | ~55 bytes |
| `task:lc:deact:<occId>` | `handleDeactivateConfirm` | Displays confirmation dialog for recurring deactivation | ~50 bytes |
| `task:lc:deact_ok:<occId>` | `handleDeactivateExecute` | Executes recurring task deactivation | ~53 bytes |
| `task:act:del:<occId>` | `handleDeleteConfirm` | Displays confirmation dialog for task deletion | ~48 bytes |
| `task:lc:del_ok:<occId>` | `handleDeleteExecute` | Executes permanent deletion (if safe) | ~51 bytes |

---

## 3. Status Transition Rules & Behavior

Status operations operate on the selected `TaskOccurrence`:

- **Transitions**:
  - `PENDING` -> `IN_PROGRESS`, `COMPLETED`, `SKIPPED`, `CANCELLED`
  - `IN_PROGRESS` -> `COMPLETED`, `PARTIALLY_COMPLETED`, `NOT_COMPLETED`, `CANCELLED`
  - `PARTIALLY_COMPLETED` / `NOT_COMPLETED` / `SKIPPED` -> `IN_PROGRESS`, `COMPLETED`, `CANCELLED`
- **Terminal States**:
  - `COMPLETED` and `CANCELLED` are terminal states. Further transitions are rejected with user-friendly alerts.
- **Idempotency**:
  - Requesting the same status that the occurrence already possesses is an idempotent no-op.
- **Skipping vs Recurrence**:
  - Skipping an occurrence (`SKIPPED`) affects only the current occurrence. The parent `Task` remains active and future daily occurrences will generate normally.
- **UI Refresh**:
  - After changing status, the details view and the daily list reflect the updated status emoji and Telegram inline button color styles (`success`, `danger`, `primary`).

---

## 4. Task Definition vs. Occurrence-Level Edits

### Task Definition Edits (`updateTask`)
- **Title**: String between 1 and 160 characters. Truncated whitespace is cleaned; empty titles are rejected.
- **Description**: Optional text. Can be cleared by sending `حذف`, `-`, or `/skip`.
- **Priority**: One of `HIGH`, `NORMAL`, `LOW`.
- **Occurrence Retention**: Editing the task definition updates the parent `Task` entity. Existing occurrences remain linked and immediately reflect the new title/description/priority without mutating historical status timestamps or occurrence dates.

### Occurrence-Level Schedule Edits (`updateOccurrenceSchedule`)
- **Clearing Schedule**: Resets `scheduledStartTime`, `scheduledStartAt`, and `scheduledDueAt` to `null`.
- **Start Time Only**: Normalized to `HH:mm:ss`, converts to UTC `scheduledStartAt`.
- **Start & End Interval**: Validates that end time is strictly later than start time. Computes UTC `scheduledStartAt` and `scheduledDueAt`.
- **Date Rescheduling**:
  - For `TaskType.ONE_TIME`: Validates ISO date format and guarantees `date >= today` in the user's timezone.
  - For `TaskType.DAILY`: Date modification is rejected (daily tasks exist on every day).
- **Daily Task Default Propagation**:
  - When editing the time of a daily task, the user selects whether the time applies only to today's occurrence or updates `Task.scheduledStartTime` across all future days.

---

## 5. Deactivation vs. Permanent Deletion Policy

### Deactivation (`deactivateTask`)
- Recommended action for recurring tasks (`TaskType.DAILY`).
- Sets `isActive: false` and records `archivedAt: new Date()`.
- Prevents `ensureDailyOccurrencesForDate` from generating future daily occurrences.
- **Completely preserves all historical occurrences, statuses, audit timestamps, and point transactions.**

### Permanent Deletion (`deleteTask`)
- **Guardrail**: If a task has completed occurrences (`COMPLETED`, `PARTIALLY_COMPLETED`) or has associated `PointTransaction` records, permanent deletion is **rejected**. The bot informs the user that historical audit records exist and offers deactivation instead.
- If safe (no completed history or points):
  - Atomically deletes pending/cancelled occurrences first (satisfying `onDelete: 'RESTRICT'`).
  - Deletes the `Task` entity.

---

## 6. Interactive Session Isolation & TTL

Interactive text inputs (title, description, time, date) use `TaskEditStateService`:
- Keyed by `telegramUserId` and validated against `ctx.chat.id` to guarantee user and chat isolation.
- Automatically expires abandoned sessions using a 30-minute TTL.
- Cancelable at any time via inline button `❌ انصراف از ویرایش` or `/cancel`.
- Invalid input returns a clear error prompt while maintaining the session, allowing immediate retry.
- Isolated from `TaskRegistrationStateService`: editing a task never triggers task registration prompts.
