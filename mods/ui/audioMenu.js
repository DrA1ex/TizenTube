import { audioText } from '../features/audioLocale.js';
import { configRead } from '../config.js';
import { audioFlow, rememberAudioLogin } from '../features/audioFlow.js';
import { audioInventory, filteredYouTubeTracks, languageName, LANGUAGE_CODES, YANDEX_TARGETS } from '../features/audioTracks.js';
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
    const names = { original: audioText('original'), youtube: 'YouTube', standard: audioText('yandexStandard'), lively: audioText('yandexExpressiveVoices'), current: audioText('currentTrack') };
    const states = { idle: audioText('selectATrack'), preparing: audioText('requestingTranslation'), waiting: audioText('waitingForTranslationPlaybackContinues'),
        retrying: audioText('networkErrorRetrying'),
        ready: audioText('trackReady'), playing: audioText('trackEnabled'), switching: audioText('switchingTracks'), auth: audioText('yandexSignInRequired'), error: audioText('couldNotSwitchTracks') };
    const hasVideo = Boolean(getCurrentVideoId());
    const selected = choice => state.audible ? state.audible.provider === choice.provider && (!choice.trackId || choice.trackId === state.audible.trackId)
        : choice.provider === 'original' ? Boolean(inventory.original) && inventory.selected?.id === inventory.original.id
        : choice.provider === 'youtube' && choice.trackId && inventory.selected?.id === choice.trackId;
    const choose = (title, subtitle, choice) => row(title, subtitle, 'AUDIO_CHOOSE', choice, selected(choice));
    const summary = state.error || (state.status === 'waiting' && state.requested?.provider === 'youtube'
        ? audioText('youtubeRequestedTrackIsNotAvailable') : states[state.status]);
    let title = audioText('audioAndTranslation'), subtitle = summary, items;
    if (section === 'tracks' && hasVideo) {
        title = audioText('trackForThisVideo');
        subtitle = languageName(state.target) + ' · ' + summary;
        items = [
            choose(audioText('original'), inventory.originalLanguage ? languageName(inventory.originalLanguage) : audioText('languageNotSpecifiedNoNeedTo'), { provider: 'original' }),
            menu('YouTube', audioText('selectedLanguagesOnly'), 'youtube'),
            choose(audioText('yandexStandard'), YANDEX_TARGETS.includes(state.target) ? audioText('noSignInRequired') : audioText('thisTranslationLanguageIsNotSupported'), { provider: 'standard' }),
            choose(audioText('yandexExpressiveVoices'), auth.hasOAuthToken ? audioText('waitWithoutStoppingPlayback') : audioText('yandexSignInRequired'), { provider: 'lively' }),
            menu(audioText('readinessAndWaiting'), summary, 'waiting')
        ];
    } else if (section === 'youtube' && hasVideo) {
        title = audioText('youtubeTracks'); subtitle = audioText('setTheListedLanguagesInPreferences');
        items = filteredYouTubeTracks(inventory, configRead('audioVisibleLanguages')).map(track =>
            choose(languageName(track.language), track.name + (track.dubbed ? audioText('autoDubbed') : ''), { provider: 'youtube', trackId: track.id }));
        if (!items.length) items.push(menu(audioText('noOtherTracks'), audioText('youCanChooseYandexTranslation'), 'tracks'));
    } else if (section === 'waiting' && hasVideo) {
        title = audioText('readinessAndWaiting');
        items = [];
        if (state.ready) items.push(row(audioText('playReadyTrack'), names[state.ready.provider], 'AUDIO_READY'));
        if (['waiting', 'preparing', 'retrying', 'ready', 'auth'].includes(state.status))
            items.push(row(audioText('cancelWaiting'), audioText('keepTheCurrentTrack'), 'AUDIO_CANCEL'));
        items.push(row(audioText('refreshStatus'), summary, 'AUDIO_REFRESH', { section: 'waiting' }));
    } else if (section === 'language' && hasVideo) {
        title = audioText('languageForThisVideo'); subtitle = audioText('doesNotChangeSavedPreferences');
        items = LANGUAGE_CODES.map(code =>
            row(languageName(code), YANDEX_TARGETS.includes(code) ? audioText('youtubeAndYandex') : audioText('youtubeOnly'), 'AUDIO_TARGET', code, code === state.target));
    } else if (section === 'account') {
        title = audioText('yandexAccount'); subtitle = auth.hasOAuthToken ? audioText('tokenSaved') : audioText('signInForExpressiveVoices');
        items = [
            row(audioText('signInToYandex'), audioText('theTokenWillBeSavedAutomatically'), 'AUDIO_LOGIN'),
            row(audioText('pasteToken'), audioText('alternativeMethod'), 'AUDIO_TOKEN')
        ];
        if (auth.hasOAuthToken) items.push(row(audioText('removeToken'), audioText('standardTranslationWillRemainAvailable'), 'AUDIO_LOGOUT'));
    } else {
        section = 'main'; subtitle = hasVideo ? summary : audioText('preferencesForFutureVideos');
        items = [];
        if (hasVideo) {
            items.push(menu(audioText('trackForThisVideo'), state.ready ? audioText('aNewTrackIsReady') : names[state.audible?.provider] || audioText('currentYouTubeTrack'), 'tracks'));
            items.push(menu(audioText('languageForThisVideo'), languageName(state.target), 'language'));
        }
        items.push(row(audioText('volume'), audioText('separateTranslationAndOriginalVolume'), 'AUDIO_VOLUMES'));
        items.push(row(audioText('preferences'), audioText('autoSelectionLanguagesWaiting'), 'AUDIO_PREFERENCES'));
        items.push(menu(audioText('yandexAccount'), auth.hasOAuthToken ? audioText('signedIn') : audioText('forExpressiveVoices'), 'account'));
    }
    // Only long lists are paged; main/provider menus have at most five rows already.
    let selectedIndex = 0;
    if (items.length > 5) {
        const page = audioMenuPage(items, 0, requestedPage);
        items = page.items;
        subtitle += ' · ' + (page.page + 1) + '/' + page.pageCount;
        if (page.page > 0) items.push(row(audioText('previousPage'), '', 'AUDIO_MENU', { section, page: page.page - 1, update: true }));
        if (page.page + 1 < page.pageCount) items.push(row(audioText('nextPage'), '', 'AUDIO_MENU', { section, page: page.page + 1, update: true }));
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
    } catch (error) { showToast(audioText('audioAndTranslation'), error.message); }
}
