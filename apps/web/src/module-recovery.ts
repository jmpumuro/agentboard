/** One reload recovers a tab older than the retained build assets. Never loop. */
export function recoverModule(event: Event, storage: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage, reload = () => window.location.reload(), now = Date.now()) {
    try {
        const previous = Number(storage.getItem('agentboard.module-reload') || 0);
        if (now - previous < 30000) return false;
        storage.setItem('agentboard.module-reload', String(now));
        event.preventDefault(); reload(); return true;
    } catch { return false; }
}
