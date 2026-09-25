import { AUDIO_TRANSLATIONS } from './audioTranslations.js';

// YouTube's language setting takes precedence over the device locale. All other
// languages use English, including unknown or unavailable locale settings.
export function isRussianAudioLocale() {
    const locale = globalThis.window?.yt?.config_?.HL || globalThis.navigator?.language || 'en';
    return /^ru(?:[-_]|$)/i.test(String(locale));
}

export function audioText(key) {
    const entry = AUDIO_TRANSLATIONS[key];
    if (!entry) throw new Error('Unknown audio translation key: ' + key);
    return isRussianAudioLocale() ? entry.ru : entry.en;
}
