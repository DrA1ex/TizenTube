function bufferedAhead(video) {
    try {
        const time = video.currentTime;
        for (let i = 0; i < video.buffered.length; i++) {
            if (video.buffered.start(i) <= time + 0.1 && video.buffered.end(i) >= time) {
                return video.buffered.end(i) - time;
            }
        }
    } catch (_) { /* Media ranges can change during a source switch. */ }
    return 0;
}

function presentedFrames(video) {
    try {
        const quality = video.getVideoPlaybackQuality?.();
        const total = quality?.totalVideoFrames;
        const dropped = quality?.droppedVideoFrames;
        if (Number.isFinite(total) && Number.isFinite(dropped)) return total - dropped;
    } catch (_) { /* Frame counters are optional on Cobalt devices. */ }
    return null;
}

// Cobalt can briefly emit waiting while a full buffer keeps playing. Four such
// events within a minute make the TV player lower its persistent performance
// cap, even if no network stall occurred. Let real stalls reach the player.
export function installBufferedWaitingFilter(documentRef, readSpeed, {
    now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout
} = {}) {
    let lastVideo = null;
    let lastTime = -1;
    let progressAt = 0;
    let pending = null;
    const forwarded = new WeakSet();

    const onProgress = event => {
        const video = documentRef.querySelector('video');
        if (event.target !== video) return;
        if ((lastVideo !== video && video.currentTime > 0)
            || (lastVideo === video && video.currentTime > lastTime)) progressAt = now();
        lastVideo = video;
        lastTime = video.currentTime;
    };
    const onPlaying = event => {
        if (pending?.video !== event.target) return;
        clearTimer(pending.timer);
        pending = null;
    };
    const onWaiting = event => {
        if (forwarded.has(event)) return;
        const video = documentRef.querySelector('video');
        const speed = Number(readSpeed());
        if (event.target !== video || speed <= 1 || video.paused || video.seeking
            || video.ended || !progressAt || now() - progressAt > 1000
            || bufferedAhead(video) < Math.max(10, speed * 6)) return;

        event.stopImmediatePropagation();
        if (pending?.video === video) return;
        const startTime = video.currentTime;
        const startFrames = presentedFrames(video);
        const timer = setTimer(() => {
            pending = null;
            if (documentRef.querySelector('video') !== video || video.seeking || video.paused) return;
            const endFrames = presentedFrames(video);
            const advanced = video.currentTime - startTime >= 0.25
                && (startFrames === null || endFrames === null || endFrames > startFrames);
            if (advanced) return;
            const EventClass = video.ownerDocument?.defaultView?.Event || Event;
            const replay = new EventClass('waiting');
            forwarded.add(replay);
            video.dispatchEvent(replay);
        }, 700);
        pending = { video, timer };
    };

    documentRef.addEventListener('timeupdate', onProgress, true);
    documentRef.addEventListener('playing', onPlaying, true);
    documentRef.addEventListener('waiting', onWaiting, true);
    return () => {
        if (pending) clearTimer(pending.timer);
        documentRef.removeEventListener('timeupdate', onProgress, true);
        documentRef.removeEventListener('playing', onPlaying, true);
        documentRef.removeEventListener('waiting', onWaiting, true);
    };
}
