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

## 8. Phase 2 — Safe, Immediate, Idempotent XP Awards

### 8.1 Reward Rules
XP awards are computed immediately and deterministically when an occurrence reaches a qualifying final result:
- **On-time completion** with reliable, explicit `scheduledDueAt`: **10 base XP** (`BASE_XP_REWARDS.ON_TIME_COMPLETION`).
- **Late completion** with reliable, explicit `scheduledDueAt`: **7 base XP** (`BASE_XP_REWARDS.LATE_COMPLETION`).
- **Completion when `scheduledDueAt` is null**: **7 base XP** for MVP (`BASE_XP_REWARDS.NO_DEADLINE_COMPLETION`). Strictly does not infer an artificial deadline from `scheduledStartTime`.
- **Partial completion**: **4 base XP** (`BASE_XP_REWARDS.PARTIAL_COMPLETION`).
- **Ineligible / Zero-XP transitions**: `PENDING`, `IN_PROGRESS`, `NOT_COMPLETED`, `SKIPPED`, `CANCELLED` award **0 XP** and write no `PointTransaction` records.

### 8.2 Idempotency and Concurrency Strategy
1. **Deterministic Keys**:
   - Full completion: `task_completion:<taskOccurrenceId>`
   - Partial completion: `task_partial_completion:<taskOccurrenceId>`
2. **PostgreSQL Unique Conflict Safety**:
   - Handled via `ON CONFLICT DO NOTHING` (generated by TypeORM QueryBuilder `.orIgnore()`).
   - In PostgreSQL, catching error code `23505` within an active transaction block leaves the transaction aborted (`current transaction is aborted, commands ignored until end of transaction block`).
   - By executing `INSERT INTO point_transactions (...) VALUES (...) ON CONFLICT DO NOTHING`, PostgreSQL suppresses duplicate insert conflicts cleanly without raising an exception and without aborting the ongoing transaction block.
   - If an insert is ignored due to conflict, the service detects zero inserted rows and returns `{ awarded: false, pointsDelta: 0 }`.
3. **Partial-to-Complete Delta Upgrades**:
   - When an occurrence previously marked `PARTIALLY_COMPLETED` (4 XP) is later completed, the service queries existing occurrence transactions within the transaction, computes the remaining delta (`10 - 4 = 6 XP` for on-time), and awards only the delta under the `task_completion:<id>` key.
4. **Duplicate Protection**:
   - Repeated requests, Telegram retries, or concurrent taps never award duplicate XP.

### 8.3 Transaction Safety & Atomicity Boundary
- Integrated directly into the existing `TasksService.completeOccurrence` and `TasksService.partiallyCompleteOccurrence` methods.
- The occurrence status update and `awardTaskOccurrenceXp` execute within the exact same database transaction:
  ```typescript
  return await this.dataSource.transaction(async (manager) => {
    const saved = await manager.getRepository(TaskOccurrence).save(occurrence);
    await this.gamificationService.awardTaskOccurrenceXp(manager, saved, userId);
    return saved;
  });
  ```
- If either the occurrence save or the XP award fails, the entire transaction rolls back atomically. Partial failure and orphaned records are impossible.
- Unrelated occurrence operations (`startOccurrence`, `markOccurrenceNotCompleted`, `skipOccurrence`, `cancelOccurrence`, `rescheduleOccurrence`) do not enter the XP award flow.

### 8.4 Phase 2 Baseline Multiplier
- Phase 2 established initial award boundaries and recorded baseline `metadata.streakMultiplier: 1.0` before full streak calculation was introduced in Phase 3.

---

## 9. Phase 3 — Streak Progression Engine & Dynamic XP Multipliers

### 9.1 Core-Only Architecture & Zero Schema Bloat
All streak evaluation logic resides strictly in `libs/core/src/gamification/gamification.service.ts` and integrates atomically with `TasksService.completeOccurrence`.
No new tables or daily activity snapshot entities were added. All persistent streak state is maintained exclusively in existing `GamificationProfile` columns:
- `currentStreak`: Active consecutive qualified days count.
- `longestStreak`: Personal best streak record.
- `lastQualifiedDate`: ISO date string (`YYYY-MM-DD`) when user last qualified.

### 9.2 Qualified Day Evaluation Rules
1. **Timezone-Aware Local Date**:
   - Local date string evaluated using `UserSettings.timezone` via `getTodayDateString(userTimezone, completionDate)`.
2. **Distinct Occurrence Threshold**:
   - A day qualifies if and only if completed occurrences count reaches $\ge 3$ distinct occurrences (`STREAK_RULES_CONFIG.QUALIFIED_DAY_MIN_COMPLETED_TASKS`).
   - Query filters by `task.ownerId = userId`, `occ.date = todayDate`, and `occ.status = COMPLETED`.
3. **Same-Day Idempotency Guard**:
   - If `profile.lastQualifiedDate === todayDate`, the day has already qualified.
   - Subsequent task completions (4th, 5th, etc.) on the same date award XP with the active multiplier but do NOT increment `currentStreak` again.

### 9.3 Continuity, Rest-Day Preservation & Break Rules
When a day newly qualifies:
1. **Initial Streak**:
   - If `lastQualifiedDate` is null or `currentStreak === 0`: `currentStreak = 1`.
2. **Consecutive Day**:
   - If `lastQualifiedDate === yesterdayDate` ($T_{\text{today}} - 1$ in user timezone): `currentStreak = currentStreak + 1`.
3. **Intervening Gap Days (Rest Day vs. Broken Streak)**:
   - Evaluates all calendar days in the interval $(T_{\text{last}}, T_{\text{today}})$:
   - **Rest Days (Safe Preservation)**: If for *every* calendar day in the gap interval, the user had **zero scheduled occurrences**, those days are treated as rest days. The streak is preserved and advances: `currentStreak = currentStreak + 1`.
   - **Broken Streak (Missed Commitments)**: If on *any* calendar day in the gap interval, scheduled task occurrences existed but the user completed $< 3$ tasks, the streak was broken. The streak resets: `currentStreak = 1`.
4. **Bounds & Persistence**:
   - `longestStreak = Math.max(profile.longestStreak, currentStreak)`.
   - `lastQualifiedDate = todayDate`.
   - Updated profile saved within the active transaction manager.

### 9.4 Dynamic Streak Multiplier Formula & XP Scaling
1. **Formula**:
   $$\text{streakMultiplier} = \min(\text{BASE\_MULTIPLIER} + \text{currentStreak} \times \text{DAILY\_INCREMENT}, \; \text{MAXIMUM\_MULTIPLIER})$$
   Defaults: $1.0 + \text{currentStreak} \times 0.02$, capped at $1.50$ (`STREAK_MULTIPLIER_CONFIG`).
2. **Scaled XP**:
   - Full completion: $\text{finalXp} = \text{Math.round}(\text{baseXp} \times \text{streakMultiplier})$.
   - Partial completion: awards base 4 XP without streak multiplier.
   - Delta upgrade (partial to complete): delta calculated against scaled target XP (`targetFinalXp - alreadyAwardedXp`).
3. **Audit Trail**:
   - `PointTransaction.metadata` records `{ baseXp, streakMultiplier, currentStreak, onTime, timing }`.

---

## 10. Phase 4 — User Level Progression & Mathematical XP Curve

1. **Derived Level & Threshold Function**:
   - Total XP is calculated from the authoritative ledger `point_transactions`.
   - Linear arithmetic progression threshold formula (per ADR-024 and `LEVEL_PROGRESSION_CONFIG`):
     $$\text{XP}_{\text{required}}(L) = \text{INITIAL\_XP\_THRESHOLD} + (L - 1) \times \text{XP\_STEP\_PER\_LEVEL}$$
     where $\text{INITIAL\_XP\_THRESHOLD} = 50$, $\text{XP\_STEP\_PER\_LEVEL} = 25$.
   - Monotonic iterative evaluation from Level 1 up to level boundary.
2. **Semantic Tiers**:
   - Level 1–5: `شروع‌کننده`
   - Level 6–15: `سازنده عادت`
   - Level 16–30: `پایدار`
   - Level 31+: `استاد استمرار`
3. **Level Multiplier**:
   $$\text{levelMultiplier} = \min(1.0 + (\text{level} - 1) \times 0.01, 2.0)$$

---

## 11. Phase 5 — Consistency Score & Historical Performance Engine

1. **Derived Reliability Metric (0 to 100)**:
   - On-demand evaluation from `task_occurrences` linked to user tasks without snapshot tables.
   - Weights: On-time ($1.0$), Late/No Deadline ($0.8$), Partial ($0.5$), Not completed ($0.0$).
   - Neutral de-scoping: `SKIPPED` and `CANCELLED` occurrences are excluded from numerator and denominator.
   - Provisional Flag: `isProvisional: true` when sample count is less than `MIN_SAMPLE_SIZE` (5).
2. **Timeframe Filtering**:
   - `getUserConsistencyScore(userId, { startDate, endDate })` enables windowed evaluation (7d, 30d, all-time).

---

## 12. Phase 6 — Telegram Gamification UI & Profile Card

1. **Entry Points & Commands**:
   - Main menu keyboard button: `🏆 وضعیت پیشرفت و امتیازات` (`menu:gamification`).
   - Commands: `/profile` and `/stats`.
2. **Motivating Persian Status Card**:
   - Displays Level, Semantic Tier, Total XP, progress bar (`renderProgressBar`), active streak, personal record, dynamic multiplier, and Consistency Score.
   - Appends `(در حال شکلگیری - نیاز به حداقل ۵ تسک)` when provisional.
3. **In-Place Timeframe Filter Buttons**:
   - Inline buttons (<= 64 bytes): `gam:range:7d`, `gam:range:30d`, `gam:range:all`, and `task:back:to_menu`.
   - Recomputes timeframe using user's timezone and updates card in-place via `TelegramUiService.editOrReply`.

---

## 13. Gamification Core Verification & Premium Telegram Performance Chart

1. **Audit Corrections**:
   - **Streak Multiplier Ordering**: In `awardTaskOccurrenceXp`, the 1st, 2nd, and qualifying 3rd completed occurrences of a local day evaluate their XP multiplier using the streak established before that day (`getPreDayActiveStreak`). Qualifying the 3rd occurrence advances `profile.currentStreak` for subsequent (4th+) completions.
   - **Rest-Day vs Missing Occurrence Detection**: In `checkGapContinuity`, days without occurrences are checked against active daily recurring tasks (`getUserActiveDailyTasks`). If active daily tasks existed for that date, missing occurrences are identified as unmaterialized/missed commitments, breaking the streak. Genuinely unscheduled dates with zero tasks preserve the streak.
2. **Consistency Score Trend Metric**:
   - Plotted line chart represents **Consistency Score trend** (0–100), not cumulative XP.
   - Authoritative weights: on-time (1.0), late/no deadline (0.8), partial (0.5), not completed (0), skipped/cancelled excluded.
   - Buckets with zero eligible occurrences are explicitly represented as `score: null` to render a visual line gap instead of a misleading zero.
3. **Adaptive Bucketing**:
   - `gam:range:7d`: 7 daily buckets.
   - `gam:range:30d`: 30 daily buckets.
   - `gam:range:all`: adaptive (<=30 days daily, 31–90 days weekly, >90 days monthly).
4. **Server-Side PNG Rendering (`GamificationChartService`)**:
   - Uses `chartjs-node-canvas` (5.0.0) with `chart.js` (4.5.1).
   - Generates an 800x420 dark minimalist PNG buffer (`#181b20` background, `#38bdf8` line color, subtle grid lines, `spanGaps: false`).
   - Clean Latin typography on chart axes, title, and dates to ensure crisp rendering on all platforms without broken Persian glyphs.
5. **Photo-Based Telegram Profile Card**:
   - Replaces text-only card on `/profile`, `/stats`, and `menu:gamification`.
   - Sends Telegram photo with Persian caption (Level, Tier, Total XP, Active Streak, Record, Consistency Score, Provisional status, and Period).
   - Period toggles delete the previous photo message safely via `TelegramUiService.deleteBotMessageSafely` and send the new photo card. Graceful text fallback if rendering fails.



