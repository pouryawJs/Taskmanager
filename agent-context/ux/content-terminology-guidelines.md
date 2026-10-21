# Content and Terminology Guidelines — Task Manager Platform

> Authoritative voice, tone, vocabulary, and UX copywriting standards for Persian and multilingual interfaces across the Task Manager Platform.

---

## 1. Voice and Tone

The product communicates with users as a **calm, intelligent, and encouraging productivity partner**.

### Tone Dimensions
- **Respectful & Natural (محترمانه و صمیمی)**:
  - Address users with the polite plural pronoun «شما» rather than overly casual slang.
  - Avoid stiff administrative jargon (e.g., use «راهنمای ثبت سریع» instead of «قوانین و مقررات سیستم»).
- **Contextual & Informative (روشن و معنادار)**:
  - Every status message explains *what happened* and *what it means* for the user's progress.
  - Success messages acknowledge gamification consequences (e.g., points awarded, streak maintained).
- **Non-Punitive & Encouraging (مثبت و بدون سرزنش)**:
  - Missed or skipped tasks are treated as neutral adjustments rather than failures.
  - Streaks and Consistency Scores focus on encouraging the next positive action.

---

## 2. Standardized Vocabulary Glossary

| English Term | Standard Persian Term | Context & Notes | Anti-Patterns to Avoid |
|---|---|---|---|
| **Task** | تسک / وظیفه | «تسک» is the universally accepted, standard term in modern Iranian tech and productivity tools. | تکالیف، کاردکس، پروژه |
| **Occurrence** | مورد اجرایی / تسک روز | When addressing users, refer directly to today's tasks (e.g. «تسک‌های امروز»). In technical docs: «نمونه اجرایی تسک». | رخداد، واقعه |
| **One-Time Task** | تسک یک‌باره | A task that occurs on a single specified calendar date. | تسک موقت، تسک یکباره |
| **Daily Recurring Task** | تسک روزانه تکرارشونده | A routine habit or daily task materialized every day. | تسک همیشگی، تسک روزمره |
| **Pending** | در انتظار | Initial state waiting for user action. | معلق، بلاتکلیف |
| **In Progress** | در حال انجام | User has actively started working on the task. | در جریان، در دست اقدام |
| **Completed** | تکمیل‌شده | Task finished successfully; terminal state awarding XP. | انجام گردید، تمام شد |
| **Partially Completed** | تکمیل جزئی | Partial progress recorded; terminal state awarding partial XP. | تا حدودی تکمیل |
| **Not Completed** | انجام‌نشده | Task was missed or timed out. | ناموفق، رد صلاحیت |
| **Skipped** | ردشده | Deliberately skipped for today; neutral for streaks. | نادیده‌گرفته، پرش |
| **Cancelled** | لغوشده | Cancelled task instance; terminal state. | ابطال‌شده، باطل |
| **XP / Experience Points** | امتیاز (XP) | Keep `XP` alongside `امتیاز` to build familiarity with progression mechanics. | امتیاز تجربه، اکسی‌پی |
| **Level** | سطح | Player progression tier (Level 1 to 30+). | درجه، رتبه |
| **Streak** | زنجیرهٔ استمرار (Streak) | Consecutive days with at least 1 completed task. Mention `Streak` on first explanation. | رگه، نوار موفقیت |
| **Consistency Score** | شاخص پایداری | Quality metric (0–100) based on completion ratio over eligible tasks. | امتیاز ثبات، نمره پیوستگی |
| **Timezone** | منطقه زمانی | Standard IANA time-zone identifier (e.g., `Asia/Tehran`). | ساعت محلی، افق شرعی |
| **Schedule / Time** | زمان‌بندی / ساعت شروع | Scheduled time of day or interval. | جدول زمان، تایم |
| **Deactivate** | غیرفعال‌سازی | Safely pausing recurring task generation while protecting past history. | تعلیق، خاموش کردن |

---

## 3. UI Copywriting Rules

### A. Button Labels
1. **Action-Oriented & Descriptive**:
   - Begin with clear emojis and action verbs (e.g., `➕ ثبت تسک جدید`, `✏️ ویرایش نام نمایشی`, `🗑 حذف تسک`).
2. **Include Key Context**:
   - On list buttons, display the status indicator and the actual title (e.g. `[ 🟢 نمایش تسک ۱: ورزش صبحگاهی ]`) instead of abstract numbering (`[ نمایش تسک ۱ ]`).
3. **Scannable Hierarchy**:
   - Primary action on top or distinct row (`✅ تکمیل تسک`), secondary actions together (`✏️ ویرایش` | `⏰ زمان‌بندی`), navigation grouped cleanly (`🔙 بازگشت به لیست امروز` | `🏠 منوی اصلی`).

### B. Feedback, Toasts & Alerts
1. **Specific Consequences**:
   - Bad: `✅ وضعیت تغییر یافت.`
   - Good: `🎉 تسک با موفقیت تکمیل شد و امتیاز (XP) به حساب شما افزوده شد!`
2. **Preserve Reversibility Context**:
   - If an action is irreversible (like completing or cancelling an occurrence, or deleting a task), state that clearly before confirmation.
3. **Graceful Deletion vs. Deactivation**:
   - When a task cannot be deleted due to audit history, explain why and offer the safe alternative:
     `⚠️ این تسک دارای سوابق انجام‌شده یا امتیاز است. به منظور حفظ صحت گزارش‌ها، تسک قابل حذف نیست اما می‌توانید آن را غیرفعال کنید.`

### C. Empty States & Untimed Tasks
1. **Actionable Empty States**:
   - Explain what is missing and provide an immediate call to action button.
   - Example:
     `📋 لیست تسک‌های امروز (2026-10-21)`
     `شما هیچ تسکی برای امروز ندارید.`
     `برای ثبت تسک جدید و برنامه‌ریزی کارهای امروز، روی دکمه زیر کلیک کنید:`
2. **Honest Time Presentation**:
   - For untimed tasks, say `شناور (انجام در طول روز)` rather than printing repetitive lines of `مشخص نشده`.

### D. Gamification Metrics Copy
1. **Provisional Score Notice**:
   - When samples < 5: `(در حال شکل‌گیری — حداقل ۵ تسک نیاز است)`
2. **Streak Multiplier Explanation**:
   - When multiplier > 1: `⚡️ ضریب پاداش فعال: 1.08x امتیاز بیشتر برای انجام به‌موقع تسک‌ها`
3. **Level Up & Progress**:
   - Always display `currentLevelXp / xpRequiredForNextLevel` with visual progress bar (`[▓▓▓▓░░░░░░ 40%]`).

---

## 4. Good Copy Examples (Grounded in Product)

### Onboarding Gamification Intro
```text
🎮 سیستم امتیاز و پیشرفت (گیمیفیکیشن)

با انجام به‌موقع تسک‌ها:
• امتیاز (XP) کسب کنید و سطح خود را ارتقا دهید.
• زنجیره استمرار (Streak) بسازید و ضریب پاداش روزانه بگیرید.
• با شاخص پایداری کیفیت نظم کاری‌تان را رصد کنید.

سیستم پیشرفت از همین لحظه فعال است. برای شروع، اولین تسکتان را ثبت کنید! 🚀
```

### Daily Task Notification Reminder
```text
🔔 یادآور موعد تسک

📌 عنوان: بررسی گزارش مالی
⏰ زمان شروع: 10:00
⚡️ اولویت: 🔴 بالا

زمان شروع این تسک فرارسیده است. لطفاً وضعیت آن را بررسی یا تغییر دهید.
```

### Profile & Consistency Card
```text
🏆 وضعیت پیشرفت و امتیازات (۷ روز اخیر)

👤 کاربر: پوریا
🎖 سطح ۲ — شروع‌کننده

✨ مجموع امتیازات: 180 XP
📈 پیشرفت سطح: 80/141 XP
▓▓▓▓▓░░░░░ 56%

🔥 زنجیره فعلی: 4 روز (بهترین رکورد: 7 روز)
⚡️ ضریب پاداش فعال: 1.08x

📊 شاخص پایداری (۷ روز اخیر): 85.5 از ۱۰۰
✅ کامل‌شده: 10 | 🌗 بخشی: 1 | ❌ انجام‌نشده: 1
```
