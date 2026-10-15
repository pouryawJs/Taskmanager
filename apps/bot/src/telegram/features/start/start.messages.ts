export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function buildWelcomeAndNameMessage(
  suggestedName?: string | null,
): string {
  if (suggestedName) {
    return (
      `✨ سلام! به ربات <b>مدیریت تسک</b> خوش آمدید 🚀\n\n` +
      `برای راه‌اندازی حسابتان، مایلید شما را با چه نامی صدا بزنیم؟\n\n` +
      `نام پیشنهادی از حساب تلگرام شما: <b>${escapeHtml(suggestedName)}</b>`
    );
  }

  return (
    `✨ سلام! به ربات <b>مدیریت تسک</b> خوش آمدید 🚀\n\n` +
    `برای راه‌اندازی حسابتان، لطفاً نام نمایشی مورد نظر خود را تایپ و ارسال کنید:`
  );
}

export const PROMPT_CUSTOM_NAME_MESSAGE =
  `✏️ لطفاً نام نمایشی مورد نظر خود را تایپ و ارسال کنید:\n\n` +
  `<i>(نام نمی‌تواند خالی باشد و حداکثر ۱۰۰ کاراکتر است)</i>`;

export const CONFIRM_NAME_UPDATED = '✅ نام نمایشی شما با موفقیت تغییر کرد.';
export const CONFIRM_NAME_CONFIRMED = '✅ نام نمایشی شما با موفقیت تایید شد.';

export function buildNameUpdatedMessage(name: string): string {
  return `✅ نام نمایشی شما با موفقیت روی <b>${escapeHtml(name)}</b> تنظیم شد.`;
}

export function buildInvalidNameMessage(reason?: string): string {
  const detail = reason ? `\n\n<i>${escapeHtml(reason)}</i>` : '';
  return `⚠️ نام نمایشی وارد شده نامعتبر است.${detail}\n\nلطفاً دوباره نام نمایشی را ارسال کنید:`;
}

export const TIMEZONE_CONFIRM_MESSAGE =
  `🕒 <b>تنظیم منطقه زمانی</b>\n\n` +
  `ما منطقه زمانی شما را به‌صورت پیش‌فرض روی <b>تهران (Asia/Tehran)</b> قرار دادیم.\n` +
  `آیا این مورد تایید است؟`;

export const CHOOSE_TIMEZONE_MESSAGE =
  `🌐 <b>انتخاب منطقه زمانی</b>\n\n` +
  `لطفاً یکی از مناطق زمانی زیر را انتخاب کنید یا گزینه «ارسال دستی شناسه IANA» را بزنید:`;

export const PROMPT_MANUAL_TIMEZONE_MESSAGE =
  `✏️ لطفاً شناسه استاندارد IANA منطقه زمانی خود را تایپ و ارسال کنید:\n\n` +
  `<i>مثال: <code>Europe/Amsterdam</code> یا <code>America/Toronto</code></i>`;

export const CONFIRM_TIMEZONE_TEHRAN =
  '✅ منطقه زمانی شما با موفقیت روی Asia/Tehran تنظیم شد.';

export function buildConfirmTimezoneUpdated(tz: string): string {
  return `✅ منطقه زمانی شما با موفقیت روی ${escapeHtml(tz)} تنظیم شد.`;
}

export function buildTimezoneUpdatedMessage(tz: string): string {
  return `✅ منطقه زمانی شما با موفقیت روی <b>${escapeHtml(tz)}</b> تنظیم شد.`;
}

export const INVALID_TIMEZONE_MESSAGE =
  `⚠️ شناسه منطقه زمانی نامعتبر است.\n\n` +
  `لطفاً یک شناسه استاندارد IANA معتبر ارسال کنید (مثلاً: <code>Asia/Tehran</code> یا <code>Europe/London</code>).\n` +
  `<i>توجه: مقادیری مانند +03:30 یا GMT معتبر نیستند.</i>`;

export const GAMIFICATION_INTRO_MESSAGE =
  `🎮 <b>سیستم امتیازدهی و پیشرفت</b>\n\n` +
  `با انجام به‌موقع تسک‌ها امتیاز کسب کنید، سطح خودتان را ارتقا دهید و پیشرفت‌تان را رصد کنید!\n\n` +
  `سیستم گیمیفیکیشن از همین لحظه برای شما فعال است.\n` +
  `بزن بریم تا اولین تسکت رو بسازی! 🚀`;

export const CONFIRM_REGISTRATION_COMPLETED =
  '✅ ثبت‌نام شما با موفقیت تکمیل شد.';

export const REGISTRATION_SUCCESS_MESSAGE =
  `🎉 <b>ثبت‌نام شما با موفقیت تکمیل شد!</b>\n\n` +
  `حساب کاربری شما آماده است. برای شروع، تسک جدید خود را ثبت کنید:`;

export function buildMainMenuMessage(displayName?: string | null): string {
  const greeting = displayName
    ? `سلام <b>${escapeHtml(displayName)}</b> عزیز! 👋`
    : 'سلام دوست عزیز! 👋';
  return (
    `${greeting}\n` +
    `به منوی اصلی ربات مدیریت تسک خوش آمدید. چه کاری می‌خواهید انجام دهید؟`
  );
}

export const RESUME_ONBOARDING_MESSAGE = `ℹ️ ثبت‌نام شما در حال انجام است. بیایید از آخرین مرحله ادامه دهیم:`;

export const UNEXPECTED_INPUT_MESSAGE = `⚠️ لطفاً برای ادامه مراحل ثبت‌نام از دکمه‌های نمایش داده شده استفاده کنید.`;
