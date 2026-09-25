import { audioText } from '../features/audioLocale.js';
import { configRead } from '../config.js';
import { LANGUAGE_CODES, languageName } from '../features/audioTracks.js';
const radio = (name, key, values) => ({ name, icon: 'AUDIO_TRACK', value: null, menuId: 'tt-audio-' + key,
    menuHeader: { title: name }, options: values.map(([value, name]) => ({ name, key, value })) });
const group = (name, id, options) => ({ name, icon: 'AUDIO_TRACK', value: null, menuId: 'tt-audio-' + id,
    menuHeader: { title: name }, options });
export function audioVolumeSettings() {
    const volume = (name, key) => radio(name + ' · ' + Math.round(Number(configRead(key)) * 100) + '%', key,
        Array.from({ length: 11 }, (_, i) => [String(i / 10), i * 10 + '%']));
    return group(audioText('volume'), 'volumes', [
        volume(audioText('translation'), 'votTranslationVolume'), volume(audioText('originalUnderTranslation'), 'votOriginalVolume')
    ]);
}
export function votSettings() {
    const languages = LANGUAGE_CODES.map(code => [code, languageName(code)]);
    return group(audioText('audioPreferences'), 'preferences', [
        group(audioText('automaticSelection'), 'automatic', [
            { name: audioText('autoSelectTrack'), value: 'audioAutoStart',
                subtitle: audioText('applyRulesWhenAVideoStarts') },
            { name: audioText('translateOtherAudio'), value: 'audioAutoDifferentLanguage',
                subtitle: audioText('whenTheOriginalLanguageDiffers') },
            { name: audioText('languageDetection'), value: 'audioDetectUnknownLanguage',
                subtitle: audioText('forVideosWithoutLanguageMetadata') },
            { name: audioText('translateUnknownAudio'), value: 'audioAutoUnknownLanguage',
                subtitle: audioText('evenWhenYandexCannotDetectIt') }
        ]),
        radio(audioText('translationProvider'), 'audioPreferredProvider', [
            ['youtube', 'YouTube'], ['standard', audioText('yandexStandard')], ['lively', audioText('yandexExpressiveVoices')]]),
        group(audioText('languages'), 'languages', [
            radio(audioText('translationLanguage'), 'audioTargetLanguage', languages.map(([key, name]) =>
                [key, name + (['ru', 'en', 'kk'].includes(key) ? '' : audioText('youtubeOnly2'))])),
            { name: audioText('youtubeLanguages'), value: null, menuId: 'tt-audio-visible-languages',
                menuHeader: { title: audioText('youtubeTrackLanguages') }, arrayToEdit: 'audioVisibleLanguages',
                options: languages.map(([value, name]) => ({ name, value })) }
        ]),
        group(audioText('waitingForTranslation'), 'wait-policy', [
            radio(audioText('whenTheTrackIsReady'), 'audioReadyBehavior', [
                ['switch', audioText('switchAutomatically')], ['notify', audioText('notifyOnly')]]),
            radio(audioText('whileTranslationIsBeingPrepared'), 'audioWaitingTrack', [
                ['current', audioText('listenToTheCurrentTrack')], ['original', audioText('listenToTheOriginal')],
                ['standard', audioText('useStandardYandexUntilReady')]])
        ])
    ]);
}
