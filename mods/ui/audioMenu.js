import { configRead } from '../config.js';
import { audioFlow, rememberAudioLogin } from '../features/audioFlow.js';
import { audioInventory, filteredYouTubeTracks, languageName, LANGUAGE_NAMES, YANDEX_TARGETS } from '../features/audioTracks.js';
import { getCurrentVideoId, getVotState, loginYandex, setOAuthToken, clearOAuthToken, refreshVotAuthorization } from '../features/vot.js';
import { showModal, buttonItem, overlayPanelItemListRenderer, showToast } from './ytUI.js';
import { optionShow } from './settings.js';
import { votSettings, audioVolumeSettings } from './votSettings.js';
import { audioMenuPage } from './audioMenuPaging.js';

const names = { original: 'Оригинал', youtube: 'YouTube', standard: 'Яндекс · обычный', lively: 'Яндекс · живые голоса', current: 'Текущая дорожка' };
const states = { idle: 'Выберите дорожку', preparing: 'Запрашиваем перевод', waiting: 'Ждём перевод · просмотр продолжается',
    retrying: 'Сетевая ошибка · повторяем запрос',
    ready: 'Дорожка готова', playing: 'Дорожка включена', switching: 'Переключаем дорожку', auth: 'Нужен вход в Яндекс', error: 'Не удалось переключиться' };
const row = (title, subtitle, action, parameters, selected = false) => buttonItem(
    { title: (selected ? '✓ ' : '') + title, subtitle }, { icon: 'AUDIO_TRACK' }, [{ customAction: { action, parameters } }]);
const menu = (title, subtitle, section) => row(title, subtitle, 'AUDIO_MENU', { section });

export function showAudioMenu(section = 'main', requestedPage = 0, update = false) {
    const state = audioFlow.snapshot(), inventory = audioInventory(), auth = getVotState();
    const hasVideo = Boolean(getCurrentVideoId());
    const selected = choice => state.audible ? state.audible.provider === choice.provider && (!choice.trackId || choice.trackId === state.audible.trackId)
        : choice.provider === 'original' ? Boolean(inventory.original) && inventory.selected?.id === inventory.original.id
        : choice.provider === 'youtube' && choice.trackId && inventory.selected?.id === choice.trackId;
    const choose = (title, subtitle, choice) => row(title, subtitle, 'AUDIO_CHOOSE', choice, selected(choice));
    const summary = state.error || (state.status === 'waiting' && state.requested?.provider === 'youtube'
        ? 'YouTube: нужной дорожки пока нет' : states[state.status]);
    let title = 'Аудио и перевод', subtitle = summary, items;
    if (section === 'tracks' && hasVideo) {
        title = 'Дорожка этого видео';
        subtitle = languageName(state.target) + ' · ' + summary;
        items = [
            choose('Оригинал', inventory.originalLanguage ? languageName(inventory.originalLanguage) : 'Язык не указан · переключение не требуется для единственной дорожки', { provider: 'original' }),
            menu('YouTube', 'Только выбранные языки', 'youtube'),
            choose('Яндекс · обычный', YANDEX_TARGETS.includes(state.target) ? 'Без входа в аккаунт' : 'Этот язык перевода не поддерживается', { provider: 'standard' }),
            choose('Яндекс · живые голоса', auth.hasOAuthToken ? 'Ожидать готовности без остановки видео' : 'Нужен вход в Яндекс', { provider: 'lively' }),
            menu('Готовность и ожидание', summary, 'waiting')
        ];
    } else if (section === 'youtube' && hasVideo) {
        title = 'Дорожки YouTube'; subtitle = 'Языки списка задаются в предпочтениях';
        items = filteredYouTubeTracks(inventory, configRead('audioVisibleLanguages')).map(track =>
            choose(languageName(track.language), track.name + (track.dubbed ? ' · автодубляж' : ''), { provider: 'youtube', trackId: track.id }));
        if (!items.length) items.push(menu('Других дорожек нет', 'Можно выбрать перевод Яндекса', 'tracks'));
    } else if (section === 'waiting' && hasVideo) {
        title = 'Готовность и ожидание';
        items = [];
        if (state.ready) items.push(row('Включить готовую дорожку', names[state.ready.provider], 'AUDIO_READY'));
        if (['waiting', 'preparing', 'retrying', 'ready', 'auth'].includes(state.status))
            items.push(row('Отменить ожидание', 'Оставить текущую дорожку', 'AUDIO_CANCEL'));
        items.push(row('Обновить состояние', summary, 'AUDIO_REFRESH', { section: 'waiting' }));
    } else if (section === 'language' && hasVideo) {
        title = 'Язык этого видео'; subtitle = 'Не меняет постоянные предпочтения';
        items = Object.entries(LANGUAGE_NAMES).map(([code, name]) =>
            row(name, YANDEX_TARGETS.includes(code) ? 'YouTube и Яндекс' : 'Только YouTube', 'AUDIO_TARGET', code, code === state.target));
    } else if (section === 'account') {
        title = 'Аккаунт Яндекса'; subtitle = auth.hasOAuthToken ? 'Токен сохранён' : 'Для живых голосов нужен вход';
        items = [
            row('Войти в Яндекс', 'Токен сохранится автоматически', 'AUDIO_LOGIN'),
            row('Вставить токен', 'Запасной способ', 'AUDIO_TOKEN')
        ];
        if (auth.hasOAuthToken) items.push(row('Удалить токен', 'Обычный перевод останется доступен', 'AUDIO_LOGOUT'));
    } else {
        section = 'main'; subtitle = hasVideo ? summary : 'Предпочтения для следующих видео';
        items = [];
        if (hasVideo) {
            items.push(menu('Дорожка этого видео', state.ready ? 'Готова новая дорожка' : names[state.audible?.provider] || 'Текущая дорожка YouTube', 'tracks'));
            items.push(menu('Язык этого видео', languageName(state.target), 'language'));
        }
        items.push(row('Громкость', 'Перевод и оригинал отдельно', 'AUDIO_VOLUMES'));
        items.push(row('Предпочтения', 'Автовыбор · языки · ожидание', 'AUDIO_PREFERENCES'));
        items.push(menu('Аккаунт Яндекса', auth.hasOAuthToken ? 'Вход выполнен' : 'Для живых голосов', 'account'));
    }
    // Only long lists are paged; main/provider menus have at most five rows already.
    let selectedIndex = 0;
    if (items.length > 5) {
        const page = audioMenuPage(items, 0, requestedPage);
        items = page.items;
        subtitle += ' · ' + (page.page + 1) + '/' + page.pageCount;
        if (page.page > 0) items.push(row('← Предыдущая страница', '', 'AUDIO_MENU', { section, page: page.page - 1, update: true }));
        if (page.page + 1 < page.pageCount) items.push(row('Следующая страница →', '', 'AUDIO_MENU', { section, page: page.page + 1, update: true }));
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
    } catch (error) { showToast('Аудио и перевод', error.message); }
}
