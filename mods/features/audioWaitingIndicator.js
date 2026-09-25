import { audioText } from '../features/audioLocale.js';
// Status only: never captures D-pad focus or blocks playback / player menus.
let panel;
let label;
export function waitingIndicatorMessage(flow) {
    const provider = flow.requested?.provider;
    const waiting = flow.videoId && ['youtube', 'standard', 'lively', 'detect'].includes(provider)
        && ['detecting', 'preparing', 'waiting', 'retrying'].includes(flow.status);
    if (!waiting) return null;
    const title = flow.status === 'retrying' ? audioText('Yandex: retrying the network request…', 'Яндекс: повторяем сетевой запрос…')
        : provider === 'detect' ? audioText('Yandex: detecting the original language…', 'Яндекс: определяем язык оригинала…')
        : provider === 'youtube' ? audioText('YouTube: waiting for a track…', 'YouTube: ждём дорожку…')
        : provider === 'lively' ? audioText('Yandex: waiting for expressive voices…', 'Яндекс: ждём живые голоса…')
        : audioText('Yandex: waiting for translation…', 'Яндекс: ждём перевод…');
    const language = !['youtube', 'detect'].includes(provider) && !flow.sourceLanguage
        ? audioText('\nThe original language will be detected automatically.', '\nЯзык оригинала определится автоматически.') : '';
    return title + language + audioText('\nPlayback continues. Cancel in Audio and translation.', '\nПросмотр продолжается. Отмена — в «Аудио и перевод».');
}

export function updateAudioWaitingIndicator(flow) {
    const value = !document.hidden && waitingIndicatorMessage(flow);
    if (!value) { panel?.remove(); panel = null; label = null; return; }
    if (!document.body) return;
    if (!panel) {
        panel = document.createElement('div');
        panel.setAttribute('role', 'status');
        panel.setAttribute('aria-live', 'polite');
        panel.style.cssText = 'position:fixed;left:4vw;bottom:7vh;max-width:38vw;z-index:2147483646;background:rgba(24,24,24,.94);color:white;border-radius:12px;padding:18px 22px;font:22px Roboto,sans-serif;pointer-events:none;display:flex;align-items:center;gap:16px';
        const marker = document.createElement('span');
        marker.setAttribute('aria-hidden', 'true');
        marker.textContent = '…';
        marker.style.cssText = 'display:block;flex-shrink:0;color:#ffcc33;font:bold 32px Roboto,sans-serif;line-height:20px';
        label = document.createElement('span');
        panel.append(marker, label);
        document.body.appendChild(panel);
    }
    if (label.textContent !== value) { label.style.whiteSpace = 'pre-line'; label.textContent = value; }
}
