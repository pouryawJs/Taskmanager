import { TaskType } from '@app/database';
import { TaskParseError } from '@app/core';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
    `📌 <b>قوانین و راهنما:</b>\n` +
    `• هر سطر غیرخالی یک تسک مستقل محسوب می‌شود.\n` +
    `• می‌توانید چندین پیام متوالی ارسال کنید.\n` +
    `• تسک‌های ذخیره‌شده از پیام‌های قبلی، حتی در صورت خطای پیام بعدی دست‌نخورده باقی می‌مانند.\n\n` +
    `⏱ <b>فرمت‌های زمانی پشتیبانی‌شده در انتهای هر سطر:</b>\n` +
    `۱) <b>بدون زمان:</b>\n` +
    `<code>خرید میوه و نان</code>\n\n` +
    `۲) <b>با زمان شروع:</b>\n` +
    `<code>ورزش ساعت 18:00</code> یا <code>Exercise at 18:00</code>\n\n` +
    `۳) <b>با بازه زمانی (شروع و پایان):</b>\n` +
    `<code>مطالعه کتاب از 09:00 تا 10:30</code>\n` +
    `<code>Study from 09:00 to 10:30</code>\n\n` +
    `<i>هم‌اکنون پیام‌های متنی خود را ارسال کنید، یا برای اتمام دکمه‌های زیر را لمس کنید:</i>`
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
