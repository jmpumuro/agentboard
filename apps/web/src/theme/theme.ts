import { createContext, useEffect, useState } from 'react';
export type ThemePreference = 'light' | 'dark' | 'system';
export const ThemeContext = createContext<readonly [
    ThemePreference,
    (value: ThemePreference) => void
]>(['system', () => { }]);
export const THEME_KEY = 'agentboard.theme';
export function readPreference(): ThemePreference {
    try {
        const saved = localStorage.getItem(THEME_KEY);
        return saved === 'light' || saved === 'dark' ? saved : 'system';
    }
    catch {
        return 'system';
    }
}
export function applyTheme(preference: ThemePreference, systemDark: boolean) {
    const theme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    return theme;
}
export function useThemePreference() {
    const [preference, setPreference] = useState<ThemePreference>(readPreference);
    useEffect(() => {
        const media = window.matchMedia?.('(prefers-color-scheme: dark)');
        const apply = () => applyTheme(preference, media?.matches ?? false);
        apply();
        media?.addEventListener('change', apply);
        const sync = (event: StorageEvent) => {
            if (event.key === THEME_KEY || event.key === null)
                setPreference(readPreference());
        };
        window.addEventListener('storage', sync);
        return () => { media?.removeEventListener('change', apply); window.removeEventListener('storage', sync); };
    }, [preference]);
    function choose(value: ThemePreference) {
        try {
            localStorage.setItem(THEME_KEY, value);
        }
        catch { /* Still usable when browser storage is disabled. */ }
        applyTheme(value, window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
        setPreference(value);
    }
    return [preference, choose] as const;
}
