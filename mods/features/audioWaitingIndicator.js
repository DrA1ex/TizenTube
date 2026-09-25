// Status only: never captures D-pad focus or blocks playback / player menus.
let panel;
let label;
export function waitingIndicatorMessage(flow) {
    const provider = flow.requested?.provider;
    const waiting = flow.videoId && ['youtube', 'standard', 'lively', 'detect'].includes(provider)
        && ['detecting', 'preparing', 'waiting', 'retrying'].includes(flow.status);
    if (!waiting) return null;
    const title = flow.status === 'retrying' ? 'Яндекс: повторяем сетевой запрос…'
        : provider === 'detect' ? 'Яндекс: определяем язык оригинала…'
        : provider === 'youtube' ? 'YouTube: ждём дорожку…'
        : provider === 'lively' ? 'Яндекс: ждём живые голоса…'
        : 'Яндекс: ждём перевод…';
    const language = !['youtube', 'detect'].includes(provider) && !flow.sourceLanguage
        ? '\nЯзык оригинала определится автоматически.' : '';
    return title + language + '\nПросмотр продолжается. Отмена — в «Аудио и перевод».';
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
