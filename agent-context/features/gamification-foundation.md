# Feature: Gamification Foundation — Data Models, XP Ledger & Configurable Constants (Phase 1)

> Clean, minimal, extensible database foundation and centralized constants for XP ledgering, streak tracking, progressive leveling, and performance scoring.

Related: [Project Context](../PROJECT_CONTEXT.md) | [Database Architecture](../database.md) | [Architecture Decisions](../decisions.md)

---

## 1. Overview & Scope

Phase 1 establishes the persistent data layer and configurable settings for the gamification platform without introducing premature scoring engines, Telegram UI, or XP granting logic.

### Key Objectives Achieved:
1. **Dedicated Gamification Module**: Created `GamificationModule` and `GamificationService` in `libs/core/src/gamification/`, decoupled from delivery layers.
2. **Authoritative XP Ledger**: Reused and validated the immutable `PointTransaction` append-only ledger (`point_transactions`), ensuring financial-grade auditability, signed deltas, and unique idempotency keys.
3. **Persistent Gamification Profile**: Implemented `GamificationProfile` (`gamification_profiles`) storing minimal non-derived streak state (`currentStreak`, `longestStreak`, `lastQualifiedDate`) in a 1-to-1 relationship with `User`.
4. **No Duplicated State**: Total XP and current level are derived directly from the `PointTransaction` ledger. No redundant balance columns exist.
5. **Configurable Constants**: Centralized all provisional base rewards, streak multipliers, progressive leveling curves, streak threshold rules, and consistency score boundaries in `libs/core/src/gamification/constants/gamification.constants.ts`.
6. **Reversible Migration**: Implemented `CreateGamificationSchema1771340000000` in `libs/database/src/migrations/`.
7. **Strict Boundary Preservation**: Existing task creation, status state machines, Telegram bot workflows, and background schedulers remain completely unaffected.

---

## 2. Entity Specifications & Field Rationale

### 2.1 `PointTransaction` (`point_transactions`)
Authoritative, immutable financial-style ledger for all XP movements.

| Field | Type | Constraint | Rationale |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Unique transaction identifier. |
| `userId` | `uuid` | Foreign Key (`users.id`, `onDelete: RESTRICT`) | Links transaction to user. Cannot delete user while points history exists. |
| `taskOccurrenceId` | `uuid` | Foreign Key (`task_occurrences.id`, `onDelete: SET NULL`), Nullable | Traceability to specific task executions. If uncompleted occurrence is deleted, transaction remains preserved. |
| `pointsDelta` | `integer` | Check `"pointsDelta" <> 0` | Signed XP change (+10 for completion, -10 for manual reversal/correction). Cannot be zero. |
| `reason` | `varchar(100)` | Not Null | Structured business reason (e.g. `'task_completion'`, `'streak_bonus'`, `'reversal'`). |
| `idempotencyKey` | `varchar(255)` | Partial Unique Index (`WHERE "idempotencyKey" IS NOT NULL`) | Prevents duplicate XP rewards across concurrent requests or retries. |
| `metadata` | `jsonb` | Nullable | Structured calculation audit trail (e.g. `{ onTime: true, baseXp: 10, streakMultiplier: 1.0 }`). |
| `createdAt` | `timestamptz` | Not Null, Default `now()` | Exact universal timestamp of award. Immutable (no `updatedAt`). |

### 2.2 `GamificationProfile` (`gamification_profiles`)
Minimal persistent state for tracking streaks across days.

| Field | Type | Constraint | Rationale |
|---|---|---|---|
| `userId` | `uuid` | Primary Key, Foreign Key (`users.id`, `onDelete: CASCADE`) | 1-to-1 relationship with `User`. Cascades cleanly if user is deleted. |
| `currentStreak` | `integer` | Default `0`, Check `>= 0` | Consecutive qualified days meeting the 3-occurrence completion threshold. |
| `longestStreak` | `integer` | Default `0`, Check `>= 0` | Historical personal record for longest qualified streak. |
| `lastQualifiedDate` | `date` | Nullable | Local calendar date (`YYYY-MM-DD`) when user last qualified. Ensures multiple completions on the same day cannot increment streak more than once. |
| `createdAt` | `timestamptz` | Not Null | Creation timestamp. |
| `updatedAt` | `timestamptz` | Not Null | Updated on streak changes. |

---

## 3. Authoritative vs. Derived Values

To avoid dual-state inconsistencies, race conditions, and synchronization bugs:

| Metric | Storage Type | Source of Truth | Calculation Strategy |
|---|---|---|---|
| **Total XP** | **Derived** | `point_transactions` | `SELECT COALESCE(SUM(pointsDelta), 0) FROM point_transactions WHERE userId = :userId` |
| **Current Level** | **Derived** | Total XP | Calculated from Total XP via progressive leveling curve constants in future service. |
| **Current Streak** | **Authoritative (Persistent)** | `gamification_profiles.currentStreak` | Stored persistently to avoid full-history recursive queries on every request. |
| **Longest Streak** | **Authoritative (Persistent)** | `gamification_profiles.longestStreak` | Stored persistently so historical records survive streak resets. |
| **Last Qualified Date** | **Authoritative (Persistent)** | `gamification_profiles.lastQualifiedDate` | Guard against duplicate daily streak increments. |
| **Performance Score** | **Derived** | `task_occurrences` | Derived dynamically across user history or selected date ranges. |

---

## 4. XP Ledger Idempotency Strategy

Duplicate operations (e.g. repeated button presses, retries, webhook duplicates) are prevented at the database level:

1. **Unique Index**:
   ```sql
   CREATE UNIQUE INDEX "UQ_point_transactions_idempotency_key"
   ON "point_transactions" ("idempotencyKey")
   WHERE "idempotencyKey" IS NOT NULL;
   ```
2. **Key Format Convention**:
   - Task completion: `task_completion:<taskOccurrenceId>`
   - Daily streak bonus: `streak_bonus:<userId>:<localCalendarDate>`
   - Level-up reward: `level_up:<userId>:<levelNumber>`
   - Manual adjustment: `adjustment:<adjustmentUuid>`
   - Reversal: `reversal:<originalTransactionId>`
3. **Conflict Handling**:
   - Future award services catch PostgreSQL error code `23505` and gracefully return the existing transaction without duplicate point credit.

---

## 5. Streak Business Rules & Data Foundation

> [!IMPORTANT]
> **Streak logic is NOT implemented in Phase 1.** The fields on `GamificationProfile` (`currentStreak`, `longestStreak`, `lastQualifiedDate`) serve strictly as the minimal persistent state model.

Future streak calculation logic in subsequent phases must enforce:
1. **Timezone-Aware Local Calendar Day**:
   - Evaluated strictly using the user's configured IANA timezone (`UserSettings.timezone`).
2. **Distinct Occurrence Counting**:
   - A day qualifies as a useful day if and only if the user completes **at least 3 distinct TaskOccurrences**.
   - Multiple state transitions of the same occurrence, repeated button presses, or status toggles must never count as multiple completions.
3. **Distinguishing Idle Days from Failed Days**:
   - **Days with scheduled occurrences**: If an occurrence was scheduled for that calendar date and fewer than 3 qualifying completions occurred, the day failed qualification and breaks the streak.
   - **Days without scheduled occurrences**: If no occurrences were scheduled for that local calendar date (e.g. resting day or weekends), the day must **not** be interpreted as a failed task day. The streak remains intact and pauses until the next day with scheduled tasks.
4. **Idempotent Daily Advancement**:
   - Once a day has qualified, `lastQualifiedDate` is set to that date (`YYYY-MM-DD`). Completing additional (4th, 5th) tasks on that same day must not increment `currentStreak` again.
   - Deactivating an active recurring task halts future occurrences but does not retroactively qualify past days or automatically advance future streaks.

---

## 6. Configurable Constants Map (`gamification.constants.ts`)

All constants reside in `libs/core/src/gamification/constants/gamification.constants.ts`:

### 6.1 Base XP Rewards (`BASE_XP_REWARDS`)
- `ON_TIME_COMPLETION`: `10` (Applies when an occurrence with an explicit `scheduledDueAt` is completed on or before deadline).
- `LATE_COMPLETION`: `7` (Applies when completed after an explicit `scheduledDueAt` deadline).
- `PARTIAL_COMPLETION`: `4`
- `NOT_COMPLETED`: `0`
- `SKIPPED`: `0`
- `CANCELLED`: `0`

> [!NOTE]
> **Occurrence Deadline Policy**:
> `scheduledDueAt` is nullable on `TaskOccurrence`. Untimed tasks and tasks with only a start time (`scheduledStartTime`) do not have an explicit due-time timestamp. Phase 2 must explicitly establish the business policy for classifying completions without explicit deadlines rather than inventing an artificial deadline or silently guessing.

### 6.2 Streak Multiplier (`STREAK_MULTIPLIER_CONFIG`)
Provisional defaults for future tuning:
- `BASE_MULTIPLIER`: `1.0`
- `DAILY_INCREMENT`: `0.02`
- `MAXIMUM_MULTIPLIER`: `1.50`
Intended future service formula:
`min(BASE_MULTIPLIER + qualifiedStreakDays * DAILY_INCREMENT, MAXIMUM_MULTIPLIER)`

### 6.3 Level Progression (`LEVEL_PROGRESSION_CONFIG`)
Provisional curve configuration ONLY (not a finalized algorithm):
- `INITIAL_XP_THRESHOLD`: `50` (Provisional XP to reach Level 2)
- `XP_GROWTH_FACTOR`: `1.25`
- `BASE_LEVEL_MULTIPLIER`: `1.0`
- `LEVEL_MULTIPLIER_GROWTH_RATE`: `0.01`
- `MAX_LEVEL_MULTIPLIER`: `2.0`

> [!WARNING]
> These progression values are provisional placeholders. The future leveling curve must be calibrated and reviewed before implementation to ensure achievable progression and controlled, non-punitive growth.

### 6.4 Streak Rules & Consistency Score Boundaries
- `STREAK_RULES_CONFIG.QUALIFIED_DAY_MIN_COMPLETED_TASKS`: `3` (Minimum distinct completions to qualify a day).
- `CONSISTENCY_SCORE_CONFIG.MIN_SCORE`: `0`
- `CONSISTENCY_SCORE_CONFIG.MAX_SCORE`: `100`
- `CONSISTENCY_SCORE_CONFIG.MIN_SAMPLE_SIZE`: `5` (Provisional default; unapproved as a formal product constraint and kept configurable to prevent prematurely constraining lifetime-history scoring).
- `PERFORMANCE_SCORE_CONFIG`: Backwards-compatible alias for `CONSISTENCY_SCORE_CONFIG`.

---

## 7. Known Data Model Limitations in Reconstructing Historical Performance

An inspection of `TaskOccurrence` and status transitions reveals:

1. **Explicit Deadlines vs. Deadline-less Occurrences**:
   - `TaskOccurrence` stores `completedAt: timestamptz` and `scheduledDueAt: timestamptz` (nullable).
   - If `scheduledDueAt` is present, `completedAt <= scheduledDueAt` deterministically identifies on-time versus late completions.
   - **Limitation**: If `scheduledDueAt` is null (untimed tasks or single-start-time tasks), the database contains no completion deadline. The system cannot deterministically classify such completions as on-time or late without a defined product rule.
2. **Cancellations Before vs. After Deadline are Currently Ambiguous**:
   - `TaskOccurrence` does not store an explicit `cancelledAt` or `skippedAt` timestamp (it only updates generic `updatedAt`).
   - If an occurrence is cancelled, `status = CANCELLED`, but `updatedAt` may be subsequently modified by other operations.
   - Unless `ActivityEvent` records are joined, `TaskOccurrence` alone cannot determine whether cancellation happened before the deadline or after the deadline passed.
3. **Deleted Tasks without History**:
   - `TasksService.deleteTask()` permanently deletes tasks and pending occurrences that have never been completed and have no point transactions. This is intentional to keep drafts clean, but means abandoned drafts are not counted as historical failures.

---

## 8. Intentionally Deferred Functionality (Out-of-Scope for Phase 1)

The following items are strictly deferred to subsequent phases:
- Granting XP on task completion.
- Calculating or advancing levels.
- Streak increment/reset background worker or event handler.
- Consistency / Performance Score calculation algorithm.
- Telegram gamification UI, commands, or menus.
- Badges, achievements, and leaderboards.
