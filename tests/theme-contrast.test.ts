import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../apps/web/src/theme/themes.css', import.meta.url), 'utf8');
const blocks = [...css.matchAll(/:root(?:\[data-theme="dark"\])?\s*\{([^}]+)\}/g)];
const palettes = blocks.map(m => Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*(#[a-f\d]{6});/gi)].map(p => [p[1], p[2]])));
function luminance(hex: string) { const channels = hex.slice(1).match(/../g)!.map(c => parseInt(c, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4); return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722; }
function contrast(a: string, b: string) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
for (const [index, palette] of palettes.entries())
    describe(index ? 'dark theme contrast' : 'light theme contrast', () => {
        const cases: [
            string,
            string,
            number
        ][] = [];
        for (const surface of ['bg', 'panel', 'soft', 'preview-bg', 'banner-bg', 'icon-bg'])
            for (const ink of ['ink', 'muted', 'accent', 'brand-agent', 'brand-board'])
                cases.push([ink, surface, 4.5]);
        for (const surface of ['bg', 'panel', 'soft', 'agent-soft'])
            cases.push(['rust', surface, 4.5]);
        for (const surface of ['yellow', 'blue', 'green', 'pink', 'purple', 'white']) {
            for (const ink of ['note-ink', 'note-muted', 'note-mark'])
                cases.push([ink, surface, 4.5]);
            cases.push(['note-outline', surface, 3]);
        }
        for (const surface of ['bg', 'panel', 'soft']) {
            cases.push(['control-border', surface, 3]);
            cases.push(['focus', surface, 3]);
        }
        cases.push(['primary-ink', 'primary-bg', 4.5], ['auth-ink', 'auth-bg', 4.5], ['auth-muted', 'auth-bg', 4.5], ['danger', 'danger-soft', 4.5], ['toast-ink', 'toast-bg', 4.5], ['toast-action', 'toast-bg', 4.5], ['selection-ink', 'selection-bg', 4.5], ['toggle-thumb', 'toggle-off', 3], ['toggle-thumb', 'primary-bg', 3]);
        it.each(cases)('%s on %s meets %s:1', (foreground, background, minimum) => { expect(palette[foreground]).toBeDefined(); expect(palette[background]).toBeDefined(); expect(contrast(palette[foreground], palette[background]), `${foreground} on ${background}`).toBeGreaterThanOrEqual(minimum); });
    });
it('has both explicit theme palettes and no competing OS-only stylesheet overrides', () => { expect(palettes).toHaveLength(2); const styles = readFileSync(new URL('../apps/web/src/styles.css', import.meta.url), 'utf8'); expect(styles).not.toContain('prefers-color-scheme:dark'); expect(styles).not.toContain('opacity:.5'); expect(styles).toContain('color:var(--primary-ink)'); });
