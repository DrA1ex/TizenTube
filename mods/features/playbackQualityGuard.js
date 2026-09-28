const RESTORE_KEY = 'tt-acceleration-quality-restore';
const restoredPlayers = new WeakSet();

// Older builds stored a temporary quality cap as YouTube's sticky preference.
// Clear it once so the player's own adaptive selection can take over again.
export function restoreLegacyQualityPreference(player, video) {
    if (!player || restoredPlayers.has(player) || video?.seeking) return;

    let storage;
    try { storage = video?.ownerDocument?.defaultView?.localStorage; } catch (_) { return; }
    if (!storage) return;

    let saved;
    try { saved = JSON.parse(storage.getItem(RESTORE_KEY) || 'null'); } catch (_) { saved = null; }
    if (saved?.cap && typeof saved.preferred === 'string') {
        if (typeof player.getPreferredQuality !== 'function'
            || typeof player.setPlaybackQualityRange !== 'function') return;
        try {
            if (player.getPreferredQuality() === saved.cap) {
                player.setPlaybackQualityRange(saved.preferred, saved.preferred);
            }
        } catch (_) { return; }
    }

    try { storage.removeItem(RESTORE_KEY); } catch (_) { return; }
    restoredPlayers.add(player);
}

export function applyPreferredQuality(player, quality) {
    player.setPlaybackQualityRange(quality, quality);
}
