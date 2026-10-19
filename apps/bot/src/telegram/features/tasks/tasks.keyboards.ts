import { InlineKeyboard } from 'grammy';
import { TaskOccurrence, TaskOccurrenceStatus, TaskType } from '@app/database';
import { isValidIsoDate } from '@app/core';

export function getOccurrenceButtonStyle(
  status: TaskOccurrenceStatus,
): 'success' | 'danger' | 'primary' | undefined {
  switch (status) {
    case TaskOccurrenceStatus.COMPLETED:
      return 'success';
    case TaskOccurrenceStatus.NOT_COMPLETED:
      return 'danger';
    case TaskOccurrenceStatus.PENDING:
      return 'primary';
    case TaskOccurrenceStatus.IN_PROGRESS:
      return 'primary';
    case TaskOccurrenceStatus.CANCELLED:
      return 'danger';
    case TaskOccurrenceStatus.PARTIALLY_COMPLETED:
    case TaskOccurrenceStatus.SKIPPED:
    default:
      return undefined;
  }
}

export const taskTypeKeyboard = new InlineKeyboard()
  .text('📌 تسک یک‌باره', 'task:type:one_time')
  .row()
  .text('🔄 تسک روزانه تکرارشونده', 'task:type:daily')
  .row()
  .text('🔙 بازگشت به منوی اصلی', 'task:back:to_menu');

export function buildCalendarKeyboard(
  year: number,
  month: number, // 1-12
  todayDate: string, // YYYY-MM-DD
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  // Compute tomorrow date string
  let tomorrowDate = todayDate;
  if (isValidIsoDate(todayDate)) {
    const [tY, tM, tD] = todayDate.split('-').map(Number);
    const d = new Date(Date.UTC(tY, tM - 1, tD + 1));
    tomorrowDate = d.toISOString().slice(0, 10);
  }

  // 1. Quick shortcut buttons
  keyboard
    .text(`📅 امروز (${todayDate})`, `task:date:select:${todayDate}`)
    .text(`📅 فردا (${tomorrowDate})`, `task:date:select:${tomorrowDate}`)
    .row();

  // Navigation calculation
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevNav = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextNav = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;

  const monthLabel = `${year} / ${String(month).padStart(2, '0')}`;

  // 2. Month navigation row
  const currentYearMonth = todayDate.slice(0, 7);
  if (prevNav < currentYearMonth) {
    keyboard.text(' ', 'task:date:noop');
  } else {
    keyboard.text('◀️ ماه قبل', `task:date:nav:${prevNav}`);
  }
  keyboard
    .text(`📅 ${monthLabel}`, 'task:date:noop')
    .text('ماه بعد ▶️', `task:date:nav:${nextNav}`)
    .row();

  // 3. Days of week header (Saturday to Friday)
  const dayHeaders = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
  for (const h of dayHeaders) {
    keyboard.text(h, 'task:date:noop');
  }
  keyboard.row();

  // 4. Days of month grid
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayUtc = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  // Saturday = 6 in JS getUTCDay() -> offset 0 in Persian week
  const offset = (firstDayUtc + 1) % 7;

  let colCount = 0;
  for (let i = 0; i < offset; i++) {
    keyboard.text(' ', 'task:date:noop');
    colCount++;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dayStr = String(day).padStart(2, '0');
    const monthStr = String(month).padStart(2, '0');
    const fullDate = `${year}-${monthStr}-${dayStr}`;

    if (fullDate < todayDate) {
      keyboard.text('·', 'task:date:past');
    } else {
      keyboard.text(String(day), `task:date:select:${fullDate}`);
    }
    colCount++;

    if (colCount % 7 === 0) {
      keyboard.row();
    }
  }

  // Pad the rest of the last row if needed
  if (colCount % 7 !== 0) {
    const remaining = 7 - (colCount % 7);
    for (let i = 0; i < remaining; i++) {
      keyboard.text(' ', 'task:date:noop');
    }
    keyboard.row();
  }

  // 5. Back button
  keyboard.text('🔙 بازگشت به انتخاب نوع تسک', 'task:back:to_type');

  return keyboard;
}

export const registrationModeKeyboard = new InlineKeyboard()
  .text('🏁 پایان ثبت تسک‌ها', 'task:reg:finish')
  .row()
  .text('🔙 بازگشت', 'task:reg:back');

export function buildDailyTaskListKeyboard(
  occurrences: TaskOccurrence[],
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  occurrences.forEach((occ, index) => {
    const btnText =
      occurrences.length === 1 ? 'نمایش تسک' : `نمایش تسک ${index + 1}`;
    const style = getOccurrenceButtonStyle(occ.status);
    const buttonSpec = style ? { text: btnText, style } : btnText;
    keyboard.text(buttonSpec, `task:view:${occ.id}`).row();
  });

  keyboard.text('➕ ثبت تسک جدید', 'menu:create_task');
  keyboard.text('🔙 منوی اصلی', 'task:back:to_menu');

  return keyboard;
}

export function buildDailyTaskListEmptyKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('➕ ثبت تسک جدید', 'menu:create_task')
    .row()
    .text('🔙 منوی اصلی', 'task:back:to_menu');
}

export const taskDetailsKeyboard = new InlineKeyboard()
  .text('🔙 بازگشت به لیست امروز', 'task:list:today')
  .row()
  .text('🔙 منوی اصلی', 'task:back:to_menu');

/**
 * Main action keyboard displayed under task details view.
 */
export function buildTaskDetailsActionKeyboard(
  occurrence: TaskOccurrence,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  // 1. Status action button
  keyboard.text('🔄 تغییر وضعیت', `task:act:stat:${occurrence.id}`).row();

  // 2. Edit info & Schedule buttons
  keyboard
    .text('✏️ ویرایش مشخصات', `task:act:edit:${occurrence.id}`)
    .text('⏰ زمان‌بندی', `task:act:sched:${occurrence.id}`)
    .row();

  // 3. Priority button
  keyboard.text('⚡️ تغییر اولویت', `task:act:prio:${occurrence.id}`).row();

  // 4. Delete / Deactivate button
  if (occurrence.task?.type === TaskType.DAILY) {
    keyboard
      .text('🛑 غیرفعال‌سازی / حذف', `task:act:lifecycle:${occurrence.id}`)
      .row();
  } else {
    keyboard.text('🗑 حذف تسک', `task:act:del:${occurrence.id}`).row();
  }

  // 5. Navigation buttons
  keyboard
    .text('🔙 بازگشت به لیست امروز', 'task:list:today')
    .row()
    .text('🏠 منوی اصلی', 'task:back:to_menu');

  return keyboard;
}

/**
 * Submenu for changing occurrence status.
 */
export function buildTaskStatusKeyboard(
  occurrence: TaskOccurrence,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (
    occurrence.status === TaskOccurrenceStatus.COMPLETED ||
    occurrence.status === TaskOccurrenceStatus.CANCELLED
  ) {
    keyboard.text('🔙 بازگشت به مشخصات تسک', `task:view:${occurrence.id}`);
    return keyboard;
  }

  if (occurrence.status === TaskOccurrenceStatus.PENDING) {
    keyboard
      .text('▶️ شروع کار', `task:st:${occurrence.id}:prog`)
      .text('✅ تکمیل تسک', `task:st:${occurrence.id}:comp`)
      .row()
      .text('⏭ رد کردن این مورد', `task:st:${occurrence.id}:skip`)
      .text('✖️ لغو تسک', `task:st:${occurrence.id}:canc`)
      .row();
  } else if (occurrence.status === TaskOccurrenceStatus.IN_PROGRESS) {
    keyboard
      .text('✅ تکمیل تسک', `task:st:${occurrence.id}:comp`)
      .text('🟠 تکمیل جزئی', `task:st:${occurrence.id}:part`)
      .row()
      .text('🔴 انجام‌نشده', `task:st:${occurrence.id}:not`)
      .text('✖️ لغو تسک', `task:st:${occurrence.id}:canc`)
      .row();
  } else {
    // PARTIALLY_COMPLETED, NOT_COMPLETED, SKIPPED
    keyboard
      .text('▶️ شروع مجدد', `task:st:${occurrence.id}:prog`)
      .text('✅ تکمیل تسک', `task:st:${occurrence.id}:comp`)
      .row()
      .text('✖️ لغو تسک', `task:st:${occurrence.id}:canc`)
      .row();
  }

  keyboard.text('🔙 بازگشت به مشخصات تسک', `task:view:${occurrence.id}`);
  return keyboard;
}

/**
 * Submenu for choosing task definition field to edit (title or description).
 */
export function buildTaskEditInfoKeyboard(
  occurrence: TaskOccurrence,
): InlineKeyboard {
  return new InlineKeyboard()
    .text('✏️ ویرایش عنوان', `task:ed:${occurrence.id}:title`)
    .row()
    .text('📝 ویرایش توضیحات', `task:ed:${occurrence.id}:desc`)
    .row()
    .text('🔙 بازگشت به مشخصات تسک', `task:view:${occurrence.id}`);
}

/**
 * Submenu for changing task priority.
 */
export function buildTaskPriorityKeyboard(
  occurrence: TaskOccurrence,
): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔴 بالا (High)', `task:pr:${occurrence.id}:high`)
    .row()
    .text('🟢 عادی (Normal)', `task:pr:${occurrence.id}:normal`)
    .row()
    .text('⚪ پایین (Low)', `task:pr:${occurrence.id}:low`)
    .row()
    .text('🔙 بازگشت به مشخصات تسک', `task:view:${occurrence.id}`);
}

/**
 * Submenu for schedule management.
 */
export function buildTaskScheduleKeyboard(
  occurrence: TaskOccurrence,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  keyboard
    .text('⏰ تنظیم ساعت شروع و پایان', `task:sc:${occurrence.id}:time`)
    .row()
    .text('❌ حذف زمان‌بندی (بدون ساعت)', `task:sc:${occurrence.id}:clear`)
    .row();

  if (occurrence.task?.type === TaskType.ONE_TIME) {
    keyboard.text('📅 تغییر تاریخ تسک', `task:sc:${occurrence.id}:date`).row();
  }

  keyboard.text('🔙 بازگشت به مشخصات تسک', `task:view:${occurrence.id}`);
  return keyboard;
}

/**
 * Cancel edit button displayed while waiting for user text input.
 */
export function buildCancelEditKeyboard(occurrenceId: string): InlineKeyboard {
  return new InlineKeyboard().text(
    '❌ انصراف از ویرایش',
    `task:ed:canc:${occurrenceId}`,
  );
}

/**
 * Menu for recurring task lifecycle options.
 */
export function buildTaskLifecycleMenuKeyboard(
  occurrence: TaskOccurrence,
): InlineKeyboard {
  return new InlineKeyboard()
    .text(
      '🛑 غیرفعال کردن تکرار روزانه (پیشنهادی)',
      `task:lc:deact:${occurrence.id}`,
    )
    .row()
    .text('🗑 حذف کامل تسک', `task:lc:del:${occurrence.id}`)
    .row()
    .text('🔙 بازگشت به مشخصات تسک', `task:view:${occurrence.id}`);
}

/**
 * Confirmation keyboard for deactivating recurring task.
 */
export function buildConfirmDeactivateKeyboard(
  occurrenceId: string,
): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ بله، غیرفعال شود', `task:lc:deact_ok:${occurrenceId}`)
    .row()
    .text('❌ انصراف', `task:view:${occurrenceId}`);
}

/**
 * Confirmation keyboard for permanently deleting task.
 */
export function buildConfirmDeleteKeyboard(
  occurrenceId: string,
): InlineKeyboard {
  return new InlineKeyboard()
    .text('⚠️ بله، کاملاً حذف شود', `task:lc:del_ok:${occurrenceId}`)
    .row()
    .text('❌ انصراف', `task:view:${occurrenceId}`);
}

/**
 * Scope selector for applying schedule to daily recurring tasks.
 */
export function buildRecurringScheduleApplyKeyboard(
  occurrenceId: string,
): InlineKeyboard {
  return new InlineKeyboard()
    .text('فقط برای امروز', `task:sc:apply_today:${occurrenceId}`)
    .row()
    .text('برای همه روزها (پیش‌فرض)', `task:sc:apply_all:${occurrenceId}`)
    .row()
    .text('❌ انصراف', `task:ed:canc:${occurrenceId}`);
}

/**
 * Inline keyboard attached to scheduled start notifications.
 * Shortcut button to view and manage the task using the Phase 6/7 interactive details card.
 */
export function buildTaskNotificationKeyboard(
  occurrenceId: string,
): InlineKeyboard {
  return new InlineKeyboard().text(
    '📋 مشاهده و مدیریت تسک',
    `task:view:${occurrenceId}`,
  );
}
