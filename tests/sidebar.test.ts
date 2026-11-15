// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Brand } from '../apps/web/src/ui/Brand';
it('hides all labels in the collapsed desktop rail while retaining accessible link names', () => { const style = document.createElement('style'); style.textContent = readFileSync(resolve('apps/web/src/styles.css'), 'utf8'); document.head.append(style); const aside = document.createElement('aside'); aside.className = 'sidebar'; aside.innerHTML = `<a class="brand" aria-label="AgentBoard">${renderToStaticMarkup(React.createElement(Brand))}</a><nav><a aria-label="Boards" title="Boards"><svg></svg><span class="nav-label">Boards</span></a></nav><a class="profile" aria-label="Account settings"><span class="avatar">A</span><span class="profile-label">Account name</span></a>`; document.body.append(aside); try {
    for (const selector of ['.brand-name', '.nav-label', '.profile-label']) {
        const el = aside.querySelector(selector)!;
        expect(getComputedStyle(el).visibility, selector).toBe('hidden');
        expect(getComputedStyle(el).opacity, selector).toBe('0');
    }
    expect(getComputedStyle(aside.querySelector('nav svg')!).visibility).toBe('visible');
    expect(aside.querySelector('nav a')!.getAttribute('aria-label')).toBe('Boards');
    expect(aside.querySelector('.brand-agent')!.textContent).toBe('Agent');
    expect(aside.querySelector('.brand-board')!.textContent).toBe('Board');
}
finally {
    aside.remove();
    style.remove();
} });
