import { audioText } from '../features/audioLocale.js';
export function votTransportAttempts(lively, native, configured = 'auto') {
    if (lively) return native ? ['direct', 'worker'] : ['direct'];
    if (configured === 'direct') return ['direct'];
    if (configured === 'worker') return ['worker'];
    // The native bridge has no browser CORS restriction, so ask Yandex first.
    return native ? ['direct', 'worker'] : ['worker', 'direct'];
}

export async function requestTranslationCycle(entries, request, valid, pollDelay) {
    let delay = 60;
    let received = false;
    let partial = false;
    const attempts = [];
    const failures = [];
    for (const { client, transport } of entries) {
        if (!valid()) break;
        try {
            const result = await client.translateVideo(request);
            if (!valid()) throw new Error(audioText('trackSelectionCancelled'));
            attempts.push({ transport, status: result?.status, translated: Boolean(result?.translated),
                partial: result?.status === 5, remaining: result?.remainingTime });
            if (result?.translated && result.url && result.status !== 5)
                return { ready: { result, transport }, received: true, attempts, failures };
            received = true;
            partial ||= result?.status === 5;
            delay = Math.min(delay, pollDelay(result));
            // A waiting response from one route does not prove the other route
            // lacks the already cached audio.
        } catch (error) {
            failures.push({ transport, error });
            attempts.push({ transport, error: String(error?.message || error) });
        }
    }
    return { ready: null, received, partial, delay, attempts, failures };
}
