import { expect, type Page } from '@playwright/test';
// Authentication is established once by the setup project; normal tests reuse
// its storage state rather than repeatedly exercising production login limits.
export async function login(page: Page) {
    await page.goto('/boards');
    await expect(page.getByRole('heading', { name: 'A place to think together.' })).toBeVisible();
}
