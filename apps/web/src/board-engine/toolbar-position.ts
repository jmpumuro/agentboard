export type ToolbarPosition = {
    fraction: number;
    bottom: number;
};
export const DEFAULT_TOOLBAR_POSITION: ToolbarPosition = { fraction: .5, bottom: 32 };
export function constrainToolbar(position: ToolbarPosition, canvas: {
    width: number;
    height: number;
}, toolbar: {
    width: number;
    height: number;
}): ToolbarPosition {
    const padding = 12, width = Math.max(1, canvas.width), half = Math.min(toolbar.width, width - 2 * padding) / 2;
    return { fraction: Math.max((half + padding) / width, Math.min(1 - (half + padding) / width, position.fraction)), bottom: Math.max(padding, Math.min(Math.max(padding, canvas.height - toolbar.height - padding), position.bottom)) };
}
export function readToolbarPosition(key: string): ToolbarPosition {
    try {
        const p = JSON.parse(localStorage.getItem(key) || 'null');
        if (p && Number.isFinite(p.fraction) && Number.isFinite(p.bottom))
            return p;
    }
    catch { }
    return { ...DEFAULT_TOOLBAR_POSITION };
}
export function hiddenResponseKey(userId: string, boardId: string) { return `agentboard.responses.${userId}.${boardId}`; }
