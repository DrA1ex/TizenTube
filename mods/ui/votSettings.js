import { configRead } from '../config.js';
import { LANGUAGE_NAMES } from '../features/audioTracks.js';
const radio = (name, key, values) => ({ name, icon: 'AUDIO_TRACK', value: null, menuId: 'tt-audio-' + key,
    menuHeader: { title: name }, options: values.map(([value, name]) => ({ name, key, value })) });
const group = (name, id, options) => ({ name, icon: 'AUDIO_TRACK', value: null, menuId: 'tt-audio-' + id,
    menuHeader: { title: name }, options });
export function audioVolumeSettings() {
    const volume = (name, key) => radio(name + ' · ' + Math.round(Number(configRead(key)) * 100) + '%', key,
        Array.from({ length: 11 }, (_, i) => [String(i / 10), i * 10 + '%']));
    return group('Громкость', 'volumes', [
        volume('Перевод', 'votTranslationVolume'), volume('Оригинал под переводом', 'votOriginalVolume')
    ]);
}
export function votSettings() {
    const languages = Object.entries(LANGUAGE_NAMES);
    return group('Предпочтения аудио', 'preferences', [
        group('Автовыбор', 'automatic', [
            { name: 'Автовыбор дорожки', value: 'audioAutoStart',
                subtitle: 'Применять правила при запуске видео.' },
            { name: 'Перевод другого языка', value: 'audioAutoDifferentLanguage',
                subtitle: 'Когда оригинал не на выбранном языке.' },
            { name: 'Определение языка', value: 'audioDetectUnknownLanguage',
                subtitle: 'Для видео без языковых данных.' },
            { name: 'Перевод без определения', value: 'audioAutoUnknownLanguage',
                subtitle: 'Даже если Яндекс не определил язык.' }
        ]),
        radio('Источник перевода', 'audioPreferredProvider', [
            ['youtube', 'YouTube'], ['standard', 'Яндекс · обычный'], ['lively', 'Яндекс · живые голоса']]),
        group('Языки', 'languages', [
            radio('Язык перевода', 'audioTargetLanguage', languages.map(([key, name]) =>
                [key, name + (['ru', 'en', 'kk'].includes(key) ? '' : ' · только YouTube')])),
            { name: 'Языки YouTube', value: null, menuId: 'tt-audio-visible-languages',
                menuHeader: { title: 'Языки дорожек YouTube' }, arrayToEdit: 'audioVisibleLanguages',
                options: languages.map(([value, name]) => ({ name, value })) }
        ]),
        group('Ожидание перевода', 'wait-policy', [
            radio('Когда дорожка готова', 'audioReadyBehavior', [
                ['switch', 'Переключиться автоматически'], ['notify', 'Только уведомить']]),
            radio('Пока перевод готовится', 'audioWaitingTrack', [
                ['current', 'Слушать текущую дорожку'], ['original', 'Слушать оригинал'],
                ['standard', 'Обычный Яндекс до готовности']])
        ])
    ]);
}
