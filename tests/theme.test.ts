// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { ThemeContext, THEME_KEY, readPreference, useThemePreference } from '../apps/web/src/theme/theme';
import { ThemeControl } from '../apps/web/src/theme/ThemeControl';
let root: Root, container: HTMLDivElement;
let systemDark = false;
let listeners = new Set<() => void>();
function Harness() { const theme = useThemePreference(); return React.createElement(ThemeContext.Provider, { value: theme }, React.createElement(ThemeControl)); }
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); systemDark = false; listeners = new Set(); vi.stubGlobal('matchMedia', () => ({ get matches() { return systemDark; }, addEventListener: (_name: string, fn: () => void) => listeners.add(fn), removeEventListener: (_name: string, fn: () => void) => listeners.delete(fn) })); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); delete document.documentElement.dataset.theme; document.documentElement.style.removeProperty('color-scheme'); delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT; });
async function render() { await act(async () => root.render(React.createElement(Harness))); }
async function choose(value: string) { await act(async () => { (container.querySelector(`input[value="${value}"]`) as HTMLInputElement).click(); }); }
it('offers keyboard-native radio options and persists manual theme choices across remounts', async () => { await render(); expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(3); expect(document.documentElement.dataset.theme).toBe('light'); await choose('dark'); expect(document.documentElement.dataset.theme).toBe('dark'); expect(document.documentElement.style.colorScheme).toBe('dark'); expect(localStorage.getItem(THEME_KEY)).toBe('dark'); expect((container.querySelector('input[value="dark"]') as HTMLInputElement).checked).toBe(true); await act(async () => root.unmount()); root = createRoot(container); await render(); expect(document.documentElement.dataset.theme).toBe('dark'); await choose('light'); expect(document.documentElement.dataset.theme).toBe('light'); });
it('follows OS changes only in System mode and cleans up listeners', async () => {
    await render();
    expect(listeners.size).toBe(1);
    await act(async () => {
        systemDark = true;
        for (const fn of [...listeners])
            fn();
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    await choose('light');
    await act(async () => {
        for (const fn of [...listeners])
            fn();
    });
    expect(document.documentElement.dataset.theme).toBe('light');
    await choose('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
    await act(async () => {
        systemDark = false;
        for (const fn of [...listeners])
            fn();
    });
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(listeners.size).toBe(1);
});
it('syncs another tab’s preference and tolerates disabled browser storage', async () => { await render(); await act(async () => { localStorage.setItem(THEME_KEY, 'dark'); window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY })); }); expect(document.documentElement.dataset.theme).toBe('dark'); vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage disabled'); }); vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage disabled'); }); expect(readPreference()).toBe('system'); await choose('light'); expect(document.documentElement.dataset.theme).toBe('light'); });
it('applies persisted appearance before React loads, including invalid and blocked storage', () => {
    const source = readFileSync(resolve('apps/web/public/theme-init.js'), 'utf8');
    for (const [preference, dark, expected] of [['light', true, 'light'], ['dark', false, 'dark'], ['system', true, 'dark'], ['invalid', false, 'light'], [null, true, 'dark']] as const) {
        const element = { dataset: {} as any, style: {} as any };
        runInNewContext(source, { localStorage: { getItem: () => preference }, document: { documentElement: element }, window: { matchMedia: () => ({ matches: dark }) } });
        expect(element.dataset.theme).toBe(expected);
        expect(element.style.colorScheme).toBe(expected);
    }
    const element = { dataset: {} as any, style: {} as any };
    runInNewContext(source, { localStorage: { getItem: () => { throw Error('disabled'); } }, document: { documentElement: element }, window: { matchMedia: () => ({ matches: true }) } });
    expect(element.dataset.theme).toBe('dark');
});
