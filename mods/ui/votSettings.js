import { audioText } from '../features/audioLocale.js';
import { configRead } from '../config.js';
import { LANGUAGE_NAMES, languageName } from '../features/audioTracks.js';
const radio = (name, key, values) => ({ name, icon: 'AUDIO_TRACK', value: null, menuId: 'tt-audio-' + key,
    menuHeader: { title: name }, options: values.map(([value, name]) => ({ name, key, value })) });
const group = (name, id, options) => ({ name, icon: 'AUDIO_TRACK', value: null, menuId: 'tt-audio-' + id,
    menuHeader: { title: name }, options });
export function audioVolumeSettings() {
    const volume = (name, key) => radio(name + ' · ' + Math.round(Number(configRead(key)) * 100) + '%', key,
        Array.from({ length: 11 }, (_, i) => [String(i / 10), i * 10 + '%']));
    return group(audioText('Volume', 'Громкость'), 'volumes', [
        volume(audioText('Translation', 'Перевод'), 'votTranslationVolume'), volume(audioText('Original under translation', 'Оригинал под переводом'), 'votOriginalVolume')
    ]);
}
export function votSettings() {
    const languages = Object.keys(LANGUAGE_NAMES).map(code => [code, languageName(code)]);
    return group(audioText('Audio preferences', 'Предпочтения аудио'), 'preferences', [
        group(audioText('Automatic selection', 'Автовыбор'), 'automatic', [
            { name: audioText('Auto-select track', 'Автовыбор дорожки'), value: 'audioAutoStart',
                subtitle: audioText('Apply rules when a video starts.', 'Применять правила при запуске видео.') },
            { name: audioText('Translate other audio', 'Перевод другого языка'), value: 'audioAutoDifferentLanguage',
                subtitle: audioText('When the original language differs.', 'Когда оригинал не на выбранном языке.') },
            { name: audioText('Language detection', 'Определение языка'), value: 'audioDetectUnknownLanguage',
                subtitle: audioText('For videos without language metadata.', 'Для видео без языковых данных.') },
            { name: audioText('Translate unknown audio', 'Перевод без определения'), value: 'audioAutoUnknownLanguage',
                subtitle: audioText('Even when Yandex cannot detect it.', 'Даже если Яндекс не определил язык.') }
        ]),
        radio(audioText('Translation provider', 'Источник перевода'), 'audioPreferredProvider', [
            ['youtube', 'YouTube'], ['standard', audioText('Yandex · standard', 'Яндекс · обычный')], ['lively', audioText('Yandex · expressive voices', 'Яндекс · живые голоса')]]),
        group(audioText('Languages', 'Языки'), 'languages', [
            radio(audioText('Translation language', 'Язык перевода'), 'audioTargetLanguage', languages.map(([key, name]) =>
                [key, name + (['ru', 'en', 'kk'].includes(key) ? '' : audioText(' · YouTube only', ' · только YouTube'))])),
            { name: audioText('YouTube languages', 'Языки YouTube'), value: null, menuId: 'tt-audio-visible-languages',
                menuHeader: { title: audioText('YouTube track languages', 'Языки дорожек YouTube') }, arrayToEdit: 'audioVisibleLanguages',
                options: languages.map(([value, name]) => ({ name, value })) }
        ]),
        group(audioText('Waiting for translation', 'Ожидание перевода'), 'wait-policy', [
            radio(audioText('When the track is ready', 'Когда дорожка готова'), 'audioReadyBehavior', [
                ['switch', audioText('Switch automatically', 'Переключиться автоматически')], ['notify', audioText('Notify only', 'Только уведомить')]]),
            radio(audioText('While translation is being prepared', 'Пока перевод готовится'), 'audioWaitingTrack', [
                ['current', audioText('Listen to the current track', 'Слушать текущую дорожку')], ['original', audioText('Listen to the original', 'Слушать оригинал')],
                ['standard', audioText('Use standard Yandex until ready', 'Обычный Яндекс до готовности')]])
        ])
    ]);
}
