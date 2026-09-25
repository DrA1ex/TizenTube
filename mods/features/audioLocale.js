// YouTube's language setting takes precedence over the device locale. All other
// languages use English, including unknown or unavailable locale settings.
export function isRussianAudioLocale() {
    const locale = globalThis.window?.yt?.config_?.HL || globalThis.navigator?.language || 'en';
    return /^ru(?:[-_]|$)/i.test(String(locale));
}

export const audioText = (english, russian) => isRussianAudioLocale() ? russian : english;
