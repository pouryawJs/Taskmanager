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
    keyboard.text(label, 'onboard:name:suggested').success().row();
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
  .success()
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

export const gamificationKeyboard = new InlineKeyboard()
  .text('🚀 شروع کار با ربات', 'onboard:gamification:complete')
  .success();

export const mainMenuKeyboard = new InlineKeyboard()
  .text('➕ ثبت تسک جدید', 'menu:create_task')
  .success()
  .row()
  .text('📋 تسک‌های امروز', 'menu:list_tasks')
  .primary()
  .row()
  .text('🏆 وضعیت پیشرفت و امتیازات', 'menu:gamification')
  .text('⚙️ تنظیمات', 'menu:settings');

export const settingsMenuKeyboard = new InlineKeyboard()
  .text('✏️ ویرایش نام نمایشی', 'settings:edit_name')
  .row()
  .text('🌐 تغییر منطقه زمانی', 'settings:edit_tz')
  .row()
  .text('🔙 بازگشت به منوی اصلی', 'task:back:to_menu');

export const cancelSettingsEditKeyboard = new InlineKeyboard()
  .text('❌ انصراف و بازگشت به تنظیمات', 'menu:settings')
  .danger();

export const settingsTimezonePickerKeyboard = new InlineKeyboard()
  .text('🇮🇷 تهران (Asia/Tehran)', 'settings:tz:set:Asia/Tehran')
  .text('🌐 ساعت جهانی (UTC)', 'settings:tz:set:UTC')
  .row()
  .text('🇬🇧 لندن (Europe/London)', 'settings:tz:set:Europe/London')
  .text('🇫🇷 پاریس (Europe/Paris)', 'settings:tz:set:Europe/Paris')
  .row()
  .text('🇩🇪 برلین (Europe/Berlin)', 'settings:tz:set:Europe/Berlin')
  .text('🇹🇷 استانبول (Europe/Istanbul)', 'settings:tz:set:Europe/Istanbul')
  .row()
  .text('🇦🇪 دبی (Asia/Dubai)', 'settings:tz:set:Asia/Dubai')
  .text('🇨🇦 تورنتو (America/Toronto)', 'settings:tz:set:America/Toronto')
  .row()
  .text('🇺🇸 نیویورک (America/New_York)', 'settings:tz:set:America/New_York')
  .text(
    '🇺🇸 لس آنجلس (America/Los_Angeles)',
    'settings:tz:set:America/Los_Angeles',
  )
  .row()
  .text('🔙 بازگشت به تنظیمات', 'menu:settings');

export function buildGamificationKeyboard(
  currentRange: '7d' | '30d' | 'all' = 'all',
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  const label7d = currentRange === '7d' ? '🔘 ۷ روز' : '📅 ۷ روز';
  const label30d = currentRange === '30d' ? '🔘 ۳۰ روز' : '🗓 ۳۰ روز';
  const labelAll = currentRange === 'all' ? '🔘 کل دوره' : '♾ کل دوره';

  keyboard
    .text(label7d, 'gam:range:7d')
    .text(label30d, 'gam:range:30d')
    .text(labelAll, 'gam:range:all')
    .row()
    .text('🎖 جزئیات سطح و امتیاز', 'gam:view:level')
    .text('📊 تحلیل عملکرد', 'gam:view:activity')
    .row()
    .text('🔙 بازگشت به منوی اصلی', 'task:back:to_menu');

  return keyboard;
}

export function buildGamificationLevelKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📊 تحلیل عملکرد', 'gam:view:activity')
    .row()
    .text('🔙 بازگشت به پروفایل', 'gam:back:profile')
    .text('🏠 منوی اصلی', 'task:back:to_menu');
}

export function buildGamificationActivityKeyboard(
  currentRange: '7d' | '30d' | 'all' = 'all',
): InlineKeyboard {
  const label7d = currentRange === '7d' ? '🔘 ۷ روز' : '📅 ۷ روز';
  const label30d = currentRange === '30d' ? '🔘 ۳۰ روز' : '🗓 ۳۰ روز';
  const labelAll = currentRange === 'all' ? '🔘 کل تاریخچه' : '♾ کل تاریخچه';

  return new InlineKeyboard()
    .text(label7d, 'gam:act:7d')
    .text(label30d, 'gam:act:30d')
    .text(labelAll, 'gam:act:all')
    .row()
    .text('🎖 جزئیات سطح و امتیاز', 'gam:view:level')
    .row()
    .text('🔙 بازگشت به پروفایل', 'gam:back:profile')
    .text('🏠 منوی اصلی', 'task:back:to_menu');
}
