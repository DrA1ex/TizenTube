import { audioText } from '../features/audioLocale.js';
import { YandexVOTProtobuf } from '@vot.js/core/protobuf';
import { config as votConfig } from '@vot.js/shared';
import { getSecYaHeaders } from '@vot.js/shared/secure';
import { languageCode } from './votPlayback.js';

// There is no separate public language-detection endpoint in Yandex VOT. Send
// one standard probe with a deliberately chosen source hint and allow Yandex to
// correct it. The protocol returns `language` when the hint was wrong; when the
// field is absent, the hint was accepted.
export async function probeVotLanguage(client, videoData, targetLang) {
    const hint = targetLang === 'en' ? 'ru' : 'en';
    const provider = client.provider;
    const session = await provider.getSession('video-translation');
    const body = YandexVOTProtobuf.encodeTranslationRequest(videoData.url,
        videoData.duration || votConfig.defaultDuration, hint, targetLang, null,
        { forceSourceLang: false, useLivelyVoice: false });
    const path = provider.paths.videoTranslation;
    const headers = await getSecYaHeaders('Vtrans', session, body, path);
    const response = await provider.request(path, body, headers);
    if (!response.success) throw new Error(audioText('Yandex did not respond to the language detection request', 'Яндекс не ответил на запрос определения языка'));
    const result = YandexVOTProtobuf.decodeTranslationResponse(response.data);
    return languageCode(result.language) || hint;
}
