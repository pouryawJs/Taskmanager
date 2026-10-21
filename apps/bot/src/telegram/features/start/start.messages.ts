import type { GamificationOverview, ConsistencyScoreResult } from '@app/core';

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
  `برای ارسال دقیق و به‌موقع یادآورها، منطقه زمانی شما به‌صورت پیش‌فرض روی <b>تهران (Asia/Tehran)</b> تنظیم شده است.\n\n` +
  `آیا این تنظیم مورد تایید است؟`;

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
  `🎮 <b>سیستم امتیاز و پیشرفت (گیمیفیکیشن)</b>\n\n` +
  `با انجام به‌موقع تسک‌ها:\n` +
  `• <b>امتیاز (XP)</b> کسب کنید و سطح خود را ارتقا دهید.\n` +
  `• <b>زنجیره استمرار (Streak)</b> بسازید و ضریب پاداش روزانه بگیرید.\n` +
  `• با <b>شاخص پایداری</b> کیفیت نظم کاری‌تان را رصد کنید.\n\n` +
  `سیستم پیشرفت از همین لحظه فعال است. برای شروع، اولین تسکتان را ثبت کنید! 🚀`;

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

export function buildSettingsMessage(
  displayName?: string | null,
  timezone?: string | null,
): string {
  return (
    `⚙️ <b>تنظیمات حساب کاربری</b>\n\n` +
    `👤 نام نمایشی: <b>${escapeHtml(displayName || 'کاربر')}</b>\n` +
    `🕒 منطقه زمانی: <code>${escapeHtml(timezone || 'Asia/Tehran')}</code>\n` +
    `🔔 یادآورها: <b>فعال</b> (ارسال خودکار در ساعت شروع تسک)\n\n` +
    `برای ویرایش اطلاعات حساب، یکی از گزینه‌های زیر را انتخاب کنید:`
  );
}

export const PROMPT_SETTINGS_NAME_MESSAGE =
  `✏️ <b>ویرایش نام نمایشی</b>\n\n` +
  `لطفاً نام نمایشی جدید خود را تایپ و ارسال کنید:\n` +
  `<i>(حداکثر ۱۰۰ کاراکتر)</i>`;

export const CHOOSE_SETTINGS_TIMEZONE_MESSAGE =
  `🌐 <b>تغییر منطقه زمانی</b>\n\n` +
  `لطفاً یکی از مناطق زمانی زیر را انتخاب کنید:\n` +
  `<i>(ساعت اعلان‌ها و تقویم تسک‌های امروز طبق منطقه زمانی انتخابی محاسبه خواهند شد)</i>`;

export const CONFIRM_SETTINGS_NAME_UPDATED =
  '✅ نام نمایشی شما با موفقیت بروزرسانی شد.';
export const CONFIRM_SETTINGS_TZ_UPDATED =
  '✅ منطقه زمانی شما با موفقیت تغییر کرد.';

export function renderProgressBar(
  percentage: number,
  length: number = 10,
): string {
  const validPercent = Number.isFinite(percentage) ? percentage : 0;
  const bounded = Math.max(0, Math.min(100, Math.round(validPercent)));
  const filled = Math.round((bounded / 100) * length);
  const empty = Math.max(0, length - filled);
  return `${'▓'.repeat(filled)}${'░'.repeat(empty)} ${bounded}%`;
}

export interface GamificationProfileMessageParams {
  displayName?: string | null;
  overview: GamificationOverview;
  streakMultiplier: number;
  consistencyScore: ConsistencyScoreResult;
  rangeTitle?: string;
}

export function formatGamificationProfileMessage(
  params: GamificationProfileMessageParams,
): string {
  const {
    displayName,
    overview,
    streakMultiplier,
    consistencyScore,
    rangeTitle,
  } = params;
  const levelInfo = overview.levelInfo;

  const provisionalSuffix = consistencyScore.isProvisional
    ? ' (در حال شکل‌گیری — حداقل ۵ تسک نیاز است)'
    : '';

  const rangeHeader = rangeTitle ? ` (${rangeTitle})` : '';

  const multiplierNote =
    streakMultiplier > 1
      ? `\n⚡️ ضریب پاداش فعال: <b>${streakMultiplier.toFixed(2)}x</b>`
      : '';

  return (
    `🏆 <b>وضعیت پیشرفت و امتیازات</b>\n\n` +
    `👤 کاربر: <b>${escapeHtml(displayName || 'کاربر')}</b>\n` +
    `🎖 <b>سطح ${levelInfo.currentLevel} — ${escapeHtml(levelInfo.tierTitle)}</b>\n\n` +
    `✨ مجموع امتیازات: <b>${overview.totalXp} XP</b>\n` +
    `📈 پیشرفت سطح: <b>${levelInfo.currentLevelXp}/${levelInfo.xpRequiredForNextLevel} XP</b>\n` +
    `${renderProgressBar(levelInfo.progressPercentage)}\n\n` +
    `🔥 زنجیره فعلی: <b>${overview.currentStreak} روز</b> (بهترین رکورد: ${overview.longestStreak} روز)` +
    multiplierNote +
    `\n\n` +
    `📊 <b>شاخص پایداری${rangeHeader}:</b> <b>${consistencyScore.score} از ۱۰۰</b>${provisionalSuffix}\n` +
    `✅ کامل‌شده: <b>${consistencyScore.completedCount}</b> | ` +
    `🌗 بخشی: <b>${consistencyScore.partiallyCompletedCount}</b> | ` +
    `❌ انجام‌نشده: <b>${consistencyScore.notCompletedCount}</b>`
  );
}

export interface GamificationPhotoCaptionParams {
  displayName?: string | null;
  overview: GamificationOverview;
  consistencyScore: ConsistencyScoreResult;
  period: '7d' | '30d' | 'all';
}

export function formatGamificationPhotoCaption(
  params: GamificationPhotoCaptionParams,
): string {
  const { displayName, overview, consistencyScore, period } = params;
  const levelInfo = overview.levelInfo;
  const periodLabel =
    period === '7d'
      ? '۷ روز اخیر'
      : period === '30d'
        ? '۳۰ روز اخیر'
        : 'کل دوره';

  const provisionalTag = consistencyScore.isProvisional
    ? '\n<i>(شاخص موقت — حداقل ۵ تسک نیاز است)</i>'
    : '';

  return (
    `🏆 <b>پروفایل و نمودار پایداری</b> (${periodLabel})\n\n` +
    `👤 <b>${escapeHtml(displayName || 'کاربر')}</b> | 🎖 <b>سطح ${levelInfo.currentLevel} (${escapeHtml(levelInfo.tierTitle)})</b>\n` +
    `✨ مجموع امتیازات: <b>${overview.totalXp} XP</b>\n` +
    `🔥 زنجیره فعلی: <b>${overview.currentStreak} روز</b> (بهترین: ${overview.longestStreak})\n\n` +
    `📊 شاخص پایداری: <b>${consistencyScore.score}%</b>${provisionalTag}`
  );
}
