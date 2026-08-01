import { test, expect } from '@playwright/test';

test.describe('home + navigation', () => {
  test('home shows both tools and routes work', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Albers Studio' })).toBeVisible();
    await expect(page.getByTestId('home-photo')).toBeVisible();
    await expect(page.getByTestId('home-generate')).toBeVisible();

    await page.getByTestId('home-photo').click();
    await expect(page).toHaveURL(/\/photo$/);
    await expect(page.getByTestId('nav-photo')).toHaveClass(/on/);

    await page.getByTestId('nav-generate').click();
    await expect(page).toHaveURL(/\/generate$/);
    await expect(page.getByTestId('nav-generate')).toHaveClass(/on/);
  });
});
