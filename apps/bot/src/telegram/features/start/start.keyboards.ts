import { InlineKeyboard } from 'grammy';

export function buildNameKeyboard(
  suggestedName?: string | null,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (suggestedName && suggestedName.trim().length > 0) {
    const label =
      suggestedName.length > 20
        ? `✅ تایید «${suggestedName.slice(0, 18)}...»`
        : `✅ تایید «${suggestedName}»`;
    keyboard.text(label, 'onboard:name:suggested').row();
  }

  keyboard.text('✏️ وارد کردن نام دیگر', 'onboard:name:custom');
  return keyboard;
}

export const backToSuggestedNameKeyboard = new InlineKeyboard().text(
  '🔙 بازگشت به نام پیشنهادی',
  'onboard:name:back_to_suggested',
);

export const timezoneConfirmKeyboard = new InlineKeyboard()
  .text('✅ تایید تهران (Asia/Tehran)', 'onboard:tz:confirm_tehran')
  .row()
  .text('🌐 انتخاب منطقه زمانی دیگر', 'onboard:tz:choose_other');

export const timezonePickerKeyboard = new InlineKeyboard()
  .text('🇮🇷 تهران (Asia/Tehran)', 'onboard:tz:set:Asia/Tehran')
  .text('🌐 ساعت جهانی (UTC)', 'onboard:tz:set:UTC')
  .row()
  .text('🇬🇧 لندن (Europe/London)', 'onboard:tz:set:Europe/London')
  .text('🇫🇷 پاریس (Europe/Paris)', 'onboard:tz:set:Europe/Paris')
  .row()
  .text('🇩🇪 برلین (Europe/Berlin)', 'onboard:tz:set:Europe/Berlin')
  .text('🇹🇷 استانبول (Europe/Istanbul)', 'onboard:tz:set:Europe/Istanbul')
  .row()
  .text('🇦🇪 دبی (Asia/Dubai)', 'onboard:tz:set:Asia/Dubai')
  .text('🇨🇦 تورنتو (America/Toronto)', 'onboard:tz:set:America/Toronto')
  .row()
  .text('🇺🇸 نیویورک (America/New_York)', 'onboard:tz:set:America/New_York')
  .text(
    '🇺🇸 لس آنجلس (America/Los_Angeles)',
    'onboard:tz:set:America/Los_Angeles',
  )
  .row()
  .text('✏️ ارسال دستی شناسه IANA', 'onboard:tz:manual_prompt')
  .row()
  .text('🔙 بازگشت به تایید تهران', 'onboard:tz:back_to_tehran');

export const backToTimezonePickerKeyboard = new InlineKeyboard().text(
  '🔙 بازگشت به انتخاب منطقه زمانی',
  'onboard:tz:choose_other',
);

export const gamificationKeyboard = new InlineKeyboard().text(
  '🚀 بزن بریم!',
  'onboard:gamification:complete',
);

export const mainMenuKeyboard = new InlineKeyboard()
  .text('➕ ثبت تسک جدید', 'menu:create_task')
  .row()
  .text('📋 لیست تسک‌های من', 'menu:list_tasks')
  .row()
  .text('🏆 امتیازها و رتبه', 'menu:gamification')
  .text('⚙️ تنظیمات', 'menu:settings');
