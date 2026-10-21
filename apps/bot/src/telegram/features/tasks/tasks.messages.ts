import {
  TaskType,
  TaskPriority,
  TaskOccurrenceStatus,
  TaskOccurrence,
} from '@app/database';
import {
  TaskParseError,
  formatUtcToLocalTime,
  formatTimeString,
} from '@app/core';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export const OCCURRENCE_STATUS_MAP: Record<
  TaskOccurrenceStatus,
  { emoji: string; label: string }
> = {
  [TaskOccurrenceStatus.PENDING]: { emoji: '🟡', label: 'در انتظار' },
  [TaskOccurrenceStatus.IN_PROGRESS]: { emoji: '🔵', label: 'در حال انجام' },
  [TaskOccurrenceStatus.COMPLETED]: { emoji: '🟢', label: 'تکمیل‌شده' },
  [TaskOccurrenceStatus.PARTIALLY_COMPLETED]: {
    emoji: '🟠',
    label: 'تا حدودی تکمیل‌شده',
  },
  [TaskOccurrenceStatus.NOT_COMPLETED]: {
    emoji: '🔴',
    label: 'انجام‌نشده',
  },
  [TaskOccurrenceStatus.SKIPPED]: { emoji: '⚪', label: 'ردشده' },
  [TaskOccurrenceStatus.CANCELLED]: { emoji: '⚫', label: 'لغوشده' },
};

export const TASK_PRIORITY_MAP: Record<
  TaskPriority,
  { emoji: string; label: string }
> = {
  [TaskPriority.HIGH]: { emoji: '🔴', label: 'بالا' },
  [TaskPriority.NORMAL]: { emoji: '🟢', label: 'عادی' },
  [TaskPriority.LOW]: { emoji: '⚪', label: 'پایین' },
};

export const TASK_TYPE_MAP: Record<TaskType, { emoji: string; label: string }> =
  {
    [TaskType.ONE_TIME]: { emoji: '📌', label: 'یک‌باره' },
    [TaskType.DAILY]: { emoji: '🔄', label: 'روزانه تکرارشونده' },
  };

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength).trimEnd() + '...';
}

function formatLocalDateTime(
  date: Date | string | null | undefined,
  timeZone: string,
): string | null {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;

  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return formatter.format(d).replace(',', '');
  } catch {
    return d.toISOString().replace('T', ' ').slice(0, 16);
  }
}

export const CHOOSE_TASK_TYPE_MESSAGE =
  `➕ <b>ثبت تسک جدید</b>\n\n` +
  `لطفاً نوع تسک مورد نظر خود را انتخاب کنید:\n\n` +
  `• <b>تسک یک‌باره:</b> برای کارهایی که در یک تاریخ مشخص انجام می‌شوند.\n` +
  `• <b>تسک روزانه:</b> برای عادت‌ها و برنامه‌های تکرارشونده روزانه.`;

export const CHOOSE_TASK_DATE_MESSAGE =
  `📅 <b>انتخاب تاریخ برای تسک یک‌باره</b>\n\n` +
  `لطفاً تاریخ انجام تسک را از تقویم یا گزینه‌های زیر انتخاب کنید:`;

export function buildRegistrationPromptMessage(
  taskType: TaskType,
  selectedDate?: string,
): string {
  const typeLabel =
    taskType === TaskType.ONE_TIME
      ? `📌 <b>یک‌باره</b> (تاریخ: <code>${escapeHtml(selectedDate || '')}</code>)`
      : `🔄 <b>روزانه تکرارشونده</b>`;

  return (
    `📝 <b>حالت ثبت تسک فعال شد</b>\n\n` +
    `نوع تسک انتخابی: ${typeLabel}\n\n` +
    `💡 <b>راهنمای ثبت سریع:</b>\n` +
    `• هر سطر را به یک تسک مستقل اختصاص دهید.\n` +
    `• می‌توانید چندین پیام متوالی ارسال کنید.\n` +
    `• تسک‌های ذخیره‌شده از پیام‌های قبلی، حتی در صورت خطای پیام بعدی محفوظ می‌مانند.\n\n` +
    `⏱ <b>تعیین زمان (اختیاری در انتهای سطر):</b>\n` +
    `۱) <b>بدون ساعت:</b> <code>خرید میوه و نان</code>\n` +
    `۲) <b>ساعت شروع:</b> <code>ورزش ساعت 18:00</code> یا <code>Exercise at 18:00</code>\n` +
    `۳) <b>بازه زمانی:</b> <code>مطالعه از 09:00 تا 10:30</code> یا <code>Study from 09:00 to 10:30</code>\n\n` +
    `<i>هم‌اکنون پیام‌های متنی خود را ارسال کنید، یا برای اتمام دکمه‌های زیر را لمس نمایید:</i>`
  );
}

export function buildTaskSuccessConfirmation(count: number): string {
  const taskWord = count === 1 ? 'تسک' : `${count} تسک`;
  return (
    `✅ <b>${taskWord} با موفقیت ثبت شد!</b>\n` +
    `<i>می‌توانید پیام بعدی را ارسال کنید یا دکمه «پایان» را بزنید.</i>`
  );
}

export function buildValidationErrorMessage(errors: TaskParseError[]): string {
  const formattedErrors = errors
    .map((e) => `• <b>سطر ${e.line}:</b> ${escapeHtml(e.message)}`)
    .join('\n');

  return (
    `⚠️ <b>خطا در اعتبارسنجی پیام</b>\n\n` +
    `هیچ تسکی از این پیام ذخیره نشد. لطفاً موارد زیر را اصلاح و مجدداً ارسال کنید:\n\n` +
    `${formattedErrors}`
  );
}

export const PERSISTENCE_ERROR_MESSAGE =
  `❌ <b>خطا در ذخیره‌سازی تسک‌ها</b>\n\n` +
  `متأسفانه در ثبت تسک‌ها در پایگاه داده خطایی رخ داد. پیام اصلی دست‌نخورده باقی مانده است تا بتوانید دوباره ارسال کنید.`;

export function buildRegistrationFinishedMessage(savedCount: number): string {
  return (
    `🏁 <b>ثبت تسک‌ها به پایان رسید</b>\n\n` +
    `مجموع تسک‌های ثبت‌شده در این نشست: <b>${savedCount}</b>\n\n` +
    `به منوی اصلی بازگشتید.`
  );
}

export function buildRegistrationCancelledMessage(savedCount: number): string {
  const note =
    savedCount > 0
      ? `\n<i>(${savedCount} تسک ثبت‌شده قبلی ذخیره باقی ماندند.)</i>\n`
      : '';
  return `🔙 <b>از حالت ثبت تسک خارج شدید.</b>${note}\nبه منوی قبلی بازگشتید.`;
}

export const NON_TEXT_INPUT_MESSAGE =
  '⚠️ لطفاً تسک‌های خود را به‌صورت پیام متنی ارسال کنید.';

export function buildDailyTaskListEmptyMessage(date: string): string {
  return (
    `📋 <b>لیست تسک‌های امروز</b> (<code>${escapeHtml(date)}</code>)\n\n` +
    `شما هیچ تسکی برای امروز ندارید.\n\n` +
    `برای ثبت تسک جدید و برنامه‌ریزی کارهای امروز، روی دکمه زیر کلیک کنید:`
  );
}

export function buildDailyTaskListMessage(
  occurrences: TaskOccurrence[],
  date: string,
  timeZone: string,
): string {
  const completedCount = occurrences.filter(
    (o) => o.status === TaskOccurrenceStatus.COMPLETED,
  ).length;
  const inProgressCount = occurrences.filter(
    (o) => o.status === TaskOccurrenceStatus.IN_PROGRESS,
  ).length;

  const progressSummary =
    occurrences.length > 0
      ? `پیشرفت: <b>${completedCount} از ${occurrences.length}</b> تکمیل‌شده` +
        (inProgressCount > 0
          ? ` | <b>${inProgressCount}</b> در حال انجام`
          : '') +
        `\n\n`
      : `\n`;

  const header =
    `📋 <b>لیست تسک‌های امروز</b> (<code>${escapeHtml(date)}</code>)\n` +
    `منطقه زمانی: <code>${escapeHtml(timeZone)}</code>\n` +
    `تعداد تسک‌ها: <b>${occurrences.length}</b> | ` +
    progressSummary;

  const itemBlocks: string[] = [];
  const MAX_MESSAGE_LENGTH = 3800;
  let isTruncated = false;

  for (let i = 0; i < occurrences.length; i++) {
    const occ = occurrences[i];
    const task = occ.task;
    const statusInfo = OCCURRENCE_STATUS_MAP[occ.status] || {
      emoji: '🟡',
      label: occ.status,
    };
    const priorityInfo = TASK_PRIORITY_MAP[task?.priority] || {
      emoji: '🟢',
      label: 'عادی',
    };

    const startStr = formatTimeString(occ.scheduledStartTime);
    let endStr: string | null = null;
    if (occ.scheduledDueAt) {
      try {
        endStr = formatUtcToLocalTime(occ.scheduledDueAt, timeZone);
      } catch {
        endStr = null;
      }
    }

    let scheduleText = 'بدون زمان مشخص';
    if (startStr && endStr) {
      scheduleText = `${startStr} تا ${endStr}`;
    } else if (startStr) {
      scheduleText = startStr;
    } else if (endStr) {
      scheduleText = `تا ${endStr}`;
    }

    let block = `${i + 1}. ${statusInfo.emoji} <b>${escapeHtml(task?.title || 'بدون عنوان')}</b>\n`;
    if (task?.description && task.description.trim().length > 0) {
      const excerpt = truncateText(task.description.trim(), 50);
      block += `   📝 <i>${escapeHtml(excerpt)}</i>\n`;
    }
    block += `   ⏰ ${scheduleText} | ${priorityInfo.emoji} ${priorityInfo.label} | ${statusInfo.label}\n`;

    // Check message length limit
    const currentLength =
      header.length + itemBlocks.join('\n').length + block.length + 100;
    if (currentLength > MAX_MESSAGE_LENGTH) {
      isTruncated = true;
      break;
    }

    itemBlocks.push(block);
  }

  let result = header + itemBlocks.join('\n');
  if (isTruncated) {
    result += `\n⚠️ <i>به دلیل محدودیت طول پیام تلگرام، تنها ${itemBlocks.length} تسک اول نمایش داده شدند.</i>\n`;
  }

  return result;
}

export function buildTaskOccurrenceDetailsMessage(
  occurrence: TaskOccurrence,
  timeZone: string,
): string {
  const task = occurrence.task;
  const statusInfo = OCCURRENCE_STATUS_MAP[occurrence.status] || {
    emoji: '🟡',
    label: occurrence.status,
  };
  const priorityInfo = TASK_PRIORITY_MAP[task?.priority] || {
    emoji: '🟢',
    label: 'عادی',
  };
  const typeInfo = TASK_TYPE_MAP[task?.type] || {
    emoji: '📌',
    label: 'یک‌باره',
  };

  const startStr = formatTimeString(occurrence.scheduledStartTime);
  let endStr: string | null = null;
  if (occurrence.scheduledDueAt) {
    try {
      endStr = formatUtcToLocalTime(occurrence.scheduledDueAt, timeZone);
    } catch {
      endStr = null;
    }
  }

  let durationStr = '<i>مشخص نشده</i>';
  if (task?.estimatedMinutes != null) {
    durationStr = `${task.estimatedMinutes} دقیقه`;
  } else if (startStr && endStr) {
    try {
      const [h1, m1] = startStr.split(':').map(Number);
      const [h2, m2] = endStr.split(':').map(Number);
      const totalMinutes = h2 * 60 + m2 - (h1 * 60 + m1);
      if (totalMinutes > 0) {
        if (totalMinutes >= 60) {
          const h = Math.floor(totalMinutes / 60);
          const m = totalMinutes % 60;
          durationStr =
            m > 0
              ? `${h} ساعت و ${m} دقیقه (${totalMinutes} دقیقه)`
              : `${h} ساعت (${totalMinutes} دقیقه)`;
        } else {
          durationStr = `${totalMinutes} دقیقه`;
        }
      }
    } catch {
      // Fallback
    }
  }

  const createdStr = formatLocalDateTime(task?.createdAt, timeZone);
  const startedStr = formatLocalDateTime(occurrence.startedAt, timeZone);
  const completedStr = formatLocalDateTime(occurrence.completedAt, timeZone);

  let scheduleSection = '';
  if (startStr || endStr || task?.estimatedMinutes != null) {
    scheduleSection =
      `⏱ <b>زمان‌بندی:</b>\n` +
      `• زمان شروع: <b>${startStr || '<i>مشخص نشده</i>'}</b>\n` +
      `• زمان پایان: <b>${endStr || '<i>مشخص نشده</i>'}</b>\n` +
      `• مدت تخمینی: ${durationStr}\n\n`;
  } else {
    scheduleSection = `⏱ <b>زمان‌بندی:</b> <i>شناور (انجام در طول روز)</i>\n\n`;
  }

  let message =
    `🔍 <b>جزئیات تسک</b>\n\n` +
    `📌 <b>عنوان:</b> <b>${escapeHtml(task?.title || 'بدون عنوان')}</b>\n` +
    `📊 <b>وضعیت:</b> ${statusInfo.emoji} <b>${statusInfo.label}</b>\n` +
    `⚡️ <b>اولویت:</b> ${priorityInfo.emoji} ${priorityInfo.label}\n` +
    `🏷 <b>نوع تسک:</b> ${typeInfo.emoji} ${typeInfo.label}\n` +
    `📅 <b>تاریخ وقوع:</b> <code>${escapeHtml(occurrence.date)}</code>\n\n` +
    scheduleSection;

  if (task?.description && task.description.trim().length > 0) {
    message += `📝 <b>توضیحات کامل:</b>\n${escapeHtml(task.description.trim())}\n\n`;
  }

  const metaLines: string[] = [];
  if (createdStr) {
    metaLines.push(`• تاریخ ثبت: <code>${createdStr}</code>`);
  }
  if (startedStr) {
    metaLines.push(`• زمان آغاز: <code>${startedStr}</code>`);
  }
  if (completedStr) {
    metaLines.push(`• زمان تکمیل: <code>${completedStr}</code>`);
  }

  if (metaLines.length > 0) {
    message += `ℹ️ <b>اطلاعات تکمیلی:</b>\n${metaLines.join('\n')}\n`;
  }

  return message;
}

export function buildTaskStatusMenuMessage(occurrence: TaskOccurrence): string {
  const statusInfo = OCCURRENCE_STATUS_MAP[occurrence.status] || {
    emoji: '🟡',
    label: occurrence.status,
  };

  let message =
    `🔄 <b>مدیریت وضعیت تسک</b>\n\n` +
    `📌 تسک: <b>${escapeHtml(occurrence.task?.title || 'بدون عنوان')}</b>\n` +
    `📊 وضعیت فعلی: ${statusInfo.emoji} <b>${statusInfo.label}</b>\n\n`;

  if (
    occurrence.status === TaskOccurrenceStatus.COMPLETED ||
    occurrence.status === TaskOccurrenceStatus.CANCELLED
  ) {
    message += `⚠️ این تسک در وضعیت نهایی قرار دارد و امکان تغییر مجدد وضعیت آن وجود ندارد.`;
  } else {
    message += `وضعیت جدید مورد نظر خود را از دکمه‌های زیر انتخاب کنید:`;
  }

  return message;
}

export function buildTaskEditFieldPrompt(
  field: 'title' | 'description',
  currentValue?: string | null,
): string {
  if (field === 'title') {
    return (
      `✏️ <b>ویرایش عنوان تسک</b>\n\n` +
      `عنوان فعلی: <b>${escapeHtml(currentValue || 'بدون عنوان')}</b>\n\n` +
      `لطفاً عنوان جدید را ارسال کنید (حداکثر ۱۶۰ کاراکتر):\n` +
      `<i>برای انصراف دکمه زیر را لمس کرده یا دستور /cancel را بفرستید.</i>`
    );
  }

  return (
    `📝 <b>ویرایش توضیحات تسک</b>\n\n` +
    `توضیحات فعلی: <i>${escapeHtml(currentValue || 'بدون توضیحات')}</i>\n\n` +
    `لطفاً توضیحات جدید را ارسال کنید.\n` +
    `<i>(برای حذف کامل توضیحات، عبارت <code>حذف</code> یا <code>-</code> یا <code>/skip</code> را بفرستید)</i>`
  );
}

export function buildTaskPriorityMenuMessage(
  occurrence: TaskOccurrence,
): string {
  const priorityInfo = TASK_PRIORITY_MAP[occurrence.task?.priority] || {
    emoji: '🟢',
    label: 'عادی',
  };

  return (
    `⚡️ <b>تغییر اولویت تسک</b>\n\n` +
    `📌 تسک: <b>${escapeHtml(occurrence.task?.title || 'بدون عنوان')}</b>\n` +
    `اولویت فعلی: ${priorityInfo.emoji} <b>${priorityInfo.label}</b>\n\n` +
    `اولویت جدید را انتخاب کنید:`
  );
}

export function buildTaskScheduleMenuMessage(
  occurrence: TaskOccurrence,
  timeZone: string,
): string {
  const startStr = formatTimeString(occurrence.scheduledStartTime);
  let endStr: string | null = null;
  if (occurrence.scheduledDueAt) {
    try {
      endStr = formatUtcToLocalTime(occurrence.scheduledDueAt, timeZone);
    } catch {
      endStr = null;
    }
  }

  let scheduleText = 'بدون زمان مشخص';
  if (startStr && endStr) {
    scheduleText = `${startStr} تا ${endStr}`;
  } else if (startStr) {
    scheduleText = `از ${startStr}`;
  }

  return (
    `⏰ <b>مدیریت زمان‌بندی تسک</b>\n\n` +
    `📌 تسک: <b>${escapeHtml(occurrence.task?.title || 'بدون عنوان')}</b>\n` +
    `📅 تاریخ: <code>${occurrence.date}</code>\n` +
    `⏰ زمان فعلی: <b>${scheduleText}</b>\n` +
    `🌍 منطقه زمانی: <code>${timeZone}</code>\n\n` +
    `عملیات مورد نظر را انتخاب کنید:`
  );
}

export function buildTaskTimeInputPrompt(timeZone: string): string {
  return (
    `⏰ <b>تنظیم زمان تسک</b>\n\n` +
    `منطقه زمانی شما: <code>${timeZone}</code>\n\n` +
    `لطفاً زمان مورد نظر را به یکی از دو صورت زیر ارسال کنید:\n` +
    `• <b>فقط ساعت شروع:</b> مثلاً <code>10:00</code> یا <code>14:30</code>\n` +
    `• <b>بازه زمانی (شروع و پایان):</b> مثلاً <code>10:00-11:30</code> یا <code>18:00-19:00</code>\n\n` +
    `<i>توجه: ساعت پایان باید دیرتر از ساعت شروع باشد.</i>`
  );
}

export function buildConfirmDeactivateMessage(taskTitle: string): string {
  return (
    `🛑 <b>غیرفعال‌سازی تسک روزانه</b>\n\n` +
    `آیا از غیرفعال کردن تکرار روزانه تسک <b>«${escapeHtml(taskTitle)}»</b> اطمینان دارید؟\n\n` +
    `ℹ️ <i>با غیرفعال‌سازی، این تسک دیگر در روزهای آینده تکرار نخواهد شد، اما تمام سوابق، امتیازها و تسک‌های روزهای گذشته و امروز در سیستم باقی می‌مانند.</i>`
  );
}

export function buildConfirmDeleteMessage(taskTitle: string): string {
  return (
    `🗑 <b>حذف دائمی تسک</b>\n\n` +
    `آیا از حذف کامل تسک <b>«${escapeHtml(taskTitle)}»</b> اطمینان دارید؟\n\n` +
    `⚠️ <i>این عملیات غیرقابل بازگشت است.</i>`
  );
}

export function buildDeleteBlockedByHistoryMessage(taskTitle: string): string {
  return (
    `⚠️ <b>امکان حذف وجود ندارد</b>\n\n` +
    `تسک <b>«${escapeHtml(taskTitle)}»</b> دارای سوابق انجام‌شده یا تراکنش‌های امتیاز می‌باشد.\n\n` +
    `به منظور حفظ صحت گزارش‌ها و تاریخچه، این تسک قابل حذف دائم نیست. شما می‌توانید به جای حذف، تسک را <b>غیرفعال</b> کنید.`
  );
}

/**
 * Formats a Persian notification message when a scheduled task's start time arrives.
 */
export function buildTaskNotificationMessage(
  occurrence: TaskOccurrence,
): string {
  const task = occurrence.task;
  const title = task?.title ? escapeHtml(task.title) : 'بدون عنوان';
  const priorityInfo = task?.priority
    ? TASK_PRIORITY_MAP[task.priority]
    : TASK_PRIORITY_MAP[TaskPriority.NORMAL];
  const startTime = occurrence.scheduledStartTime
    ? formatTimeString(occurrence.scheduledStartTime)
    : 'نامشخص';

  return (
    `🔔 <b>یادآور موعد تسک</b>\n\n` +
    `📌 <b>عنوان:</b> ${title}\n` +
    `⏰ <b>زمان شروع:</b> ${startTime}\n` +
    `⚡️ <b>اولویت:</b> ${priorityInfo.emoji} ${priorityInfo.label}\n\n` +
    `زمان شروع این تسک فرارسیده است. لطفاً وضعیت آن را بررسی یا تغییر دهید.`
  );
}
