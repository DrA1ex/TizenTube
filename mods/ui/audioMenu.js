import { audioText } from '../features/audioLocale.js';
import { configRead } from '../config.js';
import { audioFlow, rememberAudioLogin } from '../features/audioFlow.js';
import { audioInventory, filteredYouTubeTracks, languageName, LANGUAGE_NAMES, YANDEX_TARGETS } from '../features/audioTracks.js';
import { getCurrentVideoId, getVotState, loginYandex, setOAuthToken, clearOAuthToken, refreshVotAuthorization } from '../features/vot.js';
import { showModal, buttonItem, overlayPanelItemListRenderer, showToast } from './ytUI.js';
import { optionShow } from './settings.js';
import { votSettings, audioVolumeSettings } from './votSettings.js';
import { audioMenuPage } from './audioMenuPaging.js';

const row = (title, subtitle, action, parameters, selected = false) => buttonItem(
    { title: (selected ? '✓ ' : '') + title, subtitle }, { icon: 'AUDIO_TRACK' }, [{ customAction: { action, parameters } }]);
const menu = (title, subtitle, section) => row(title, subtitle, 'AUDIO_MENU', { section });

export function showAudioMenu(section = 'main', requestedPage = 0, update = false) {
    const state = audioFlow.snapshot(), inventory = audioInventory(), auth = getVotState();
    const names = { original: audioText('Original', 'Оригинал'), youtube: 'YouTube', standard: audioText('Yandex · standard', 'Яндекс · обычный'), lively: audioText('Yandex · expressive voices', 'Яндекс · живые голоса'), current: audioText('Current track', 'Текущая дорожка') };
    const states = { idle: audioText('Select a track', 'Выберите дорожку'), preparing: audioText('Requesting translation', 'Запрашиваем перевод'), waiting: audioText('Waiting for translation · playback continues', 'Ждём перевод · просмотр продолжается'),
        retrying: audioText('Network error · retrying', 'Сетевая ошибка · повторяем запрос'),
        ready: audioText('Track ready', 'Дорожка готова'), playing: audioText('Track enabled', 'Дорожка включена'), switching: audioText('Switching tracks', 'Переключаем дорожку'), auth: audioText('Yandex sign-in required', 'Нужен вход в Яндекс'), error: audioText('Could not switch tracks', 'Не удалось переключиться') };
    const hasVideo = Boolean(getCurrentVideoId());
    const selected = choice => state.audible ? state.audible.provider === choice.provider && (!choice.trackId || choice.trackId === state.audible.trackId)
        : choice.provider === 'original' ? Boolean(inventory.original) && inventory.selected?.id === inventory.original.id
        : choice.provider === 'youtube' && choice.trackId && inventory.selected?.id === choice.trackId;
    const choose = (title, subtitle, choice) => row(title, subtitle, 'AUDIO_CHOOSE', choice, selected(choice));
    const summary = state.error || (state.status === 'waiting' && state.requested?.provider === 'youtube'
        ? audioText('YouTube: requested track is not available yet', 'YouTube: нужной дорожки пока нет') : states[state.status]);
    let title = audioText('Audio and translation', 'Аудио и перевод'), subtitle = summary, items;
    if (section === 'tracks' && hasVideo) {
        title = audioText('Track for this video', 'Дорожка этого видео');
        subtitle = languageName(state.target) + ' · ' + summary;
        items = [
            choose(audioText('Original', 'Оригинал'), inventory.originalLanguage ? languageName(inventory.originalLanguage) : audioText('Language not specified · no need to switch the only track', 'Язык не указан · переключение не требуется для единственной дорожки'), { provider: 'original' }),
            menu('YouTube', audioText('Selected languages only', 'Только выбранные языки'), 'youtube'),
            choose(audioText('Yandex · standard', 'Яндекс · обычный'), YANDEX_TARGETS.includes(state.target) ? audioText('No sign-in required', 'Без входа в аккаунт') : audioText('This translation language is not supported', 'Этот язык перевода не поддерживается'), { provider: 'standard' }),
            choose(audioText('Yandex · expressive voices', 'Яндекс · живые голоса'), auth.hasOAuthToken ? audioText('Wait without stopping playback', 'Ожидать готовности без остановки видео') : audioText('Yandex sign-in required', 'Нужен вход в Яндекс'), { provider: 'lively' }),
            menu(audioText('Readiness and waiting', 'Готовность и ожидание'), summary, 'waiting')
        ];
    } else if (section === 'youtube' && hasVideo) {
        title = audioText('YouTube tracks', 'Дорожки YouTube'); subtitle = audioText('Set the listed languages in Preferences', 'Языки списка задаются в предпочтениях');
        items = filteredYouTubeTracks(inventory, configRead('audioVisibleLanguages')).map(track =>
            choose(languageName(track.language), track.name + (track.dubbed ? audioText(' · auto-dubbed', ' · автодубляж') : ''), { provider: 'youtube', trackId: track.id }));
        if (!items.length) items.push(menu(audioText('No other tracks', 'Других дорожек нет'), audioText('You can choose Yandex translation', 'Можно выбрать перевод Яндекса'), 'tracks'));
    } else if (section === 'waiting' && hasVideo) {
        title = audioText('Readiness and waiting', 'Готовность и ожидание');
        items = [];
        if (state.ready) items.push(row(audioText('Play ready track', 'Включить готовую дорожку'), names[state.ready.provider], 'AUDIO_READY'));
        if (['waiting', 'preparing', 'retrying', 'ready', 'auth'].includes(state.status))
            items.push(row(audioText('Cancel waiting', 'Отменить ожидание'), audioText('Keep the current track', 'Оставить текущую дорожку'), 'AUDIO_CANCEL'));
        items.push(row(audioText('Refresh status', 'Обновить состояние'), summary, 'AUDIO_REFRESH', { section: 'waiting' }));
    } else if (section === 'language' && hasVideo) {
        title = audioText('Language for this video', 'Язык этого видео'); subtitle = audioText('Does not change saved preferences', 'Не меняет постоянные предпочтения');
        items = Object.keys(LANGUAGE_NAMES).map(code =>
            row(languageName(code), YANDEX_TARGETS.includes(code) ? audioText('YouTube and Yandex', 'YouTube и Яндекс') : audioText('YouTube only', 'Только YouTube'), 'AUDIO_TARGET', code, code === state.target));
    } else if (section === 'account') {
        title = audioText('Yandex account', 'Аккаунт Яндекса'); subtitle = auth.hasOAuthToken ? audioText('Token saved', 'Токен сохранён') : audioText('Sign in for expressive voices', 'Для живых голосов нужен вход');
        items = [
            row(audioText('Sign in to Yandex', 'Войти в Яндекс'), audioText('The token will be saved automatically', 'Токен сохранится автоматически'), 'AUDIO_LOGIN'),
            row(audioText('Paste token', 'Вставить токен'), audioText('Alternative method', 'Запасной способ'), 'AUDIO_TOKEN')
        ];
        if (auth.hasOAuthToken) items.push(row(audioText('Remove token', 'Удалить токен'), audioText('Standard translation will remain available', 'Обычный перевод останется доступен'), 'AUDIO_LOGOUT'));
    } else {
        section = 'main'; subtitle = hasVideo ? summary : audioText('Preferences for future videos', 'Предпочтения для следующих видео');
        items = [];
        if (hasVideo) {
            items.push(menu(audioText('Track for this video', 'Дорожка этого видео'), state.ready ? audioText('A new track is ready', 'Готова новая дорожка') : names[state.audible?.provider] || audioText('Current YouTube track', 'Текущая дорожка YouTube'), 'tracks'));
            items.push(menu(audioText('Language for this video', 'Язык этого видео'), languageName(state.target), 'language'));
        }
        items.push(row(audioText('Volume', 'Громкость'), audioText('Separate translation and original volume', 'Перевод и оригинал отдельно'), 'AUDIO_VOLUMES'));
        items.push(row(audioText('Preferences', 'Предпочтения'), audioText('Auto selection · languages · waiting', 'Автовыбор · языки · ожидание'), 'AUDIO_PREFERENCES'));
        items.push(menu(audioText('Yandex account', 'Аккаунт Яндекса'), auth.hasOAuthToken ? audioText('Signed in', 'Вход выполнен') : audioText('For expressive voices', 'Для живых голосов'), 'account'));
    }
    // Only long lists are paged; main/provider menus have at most five rows already.
    let selectedIndex = 0;
    if (items.length > 5) {
        const page = audioMenuPage(items, 0, requestedPage);
        items = page.items;
        subtitle += ' · ' + (page.page + 1) + '/' + page.pageCount;
        if (page.page > 0) items.push(row(audioText('← Previous page', '← Предыдущая страница'), '', 'AUDIO_MENU', { section, page: page.page - 1, update: true }));
        if (page.page + 1 < page.pageCount) items.push(row(audioText('Next page →', 'Следующая страница →'), '', 'AUDIO_MENU', { section, page: page.page + 1, update: true }));
    }
    showModal({ title, subtitle }, overlayPanelItemListRenderer(items, selectedIndex), 'tt-audio-' + section, update);
}

export async function audioMenuAction(action, parameters) {
    try {
        if (action === 'AUDIO_MENU') { showAudioMenu(parameters?.section, parameters?.page, parameters?.update); return; }
        if (action === 'AUDIO_PREFERENCES') { optionShow(votSettings()); return; }
        if (action === 'AUDIO_VOLUMES') { optionShow(audioVolumeSettings()); return; }
        if (action === 'AUDIO_LANGUAGE') { showAudioMenu('language'); return; }
        if (action === 'AUDIO_LOGIN') { rememberAudioLogin(); await loginYandex(); return; }
        if (action === 'AUDIO_TOKEN') { await setOAuthToken(); return; }
        if (action === 'AUDIO_LOGOUT') { audioFlow.cancelWaiting(); await clearOAuthToken(); showAudioMenu('account', 0, true); return; }
        if (action === 'AUDIO_CHOOSE') { await audioFlow.select(parameters); showAudioMenu('tracks'); return; }
        if (action === 'AUDIO_TARGET') { await audioFlow.setTarget(parameters); showAudioMenu('tracks'); return; }
        if (action === 'AUDIO_READY') await audioFlow.applyReady();
        else if (action === 'AUDIO_CANCEL') audioFlow.cancelWaiting();
        else if (action === 'AUDIO_REFRESH') await refreshVotAuthorization();
        showAudioMenu('waiting', 0, true);
    } catch (error) { showToast(audioText('Audio and translation', 'Аудио и перевод'), error.message); }
}
