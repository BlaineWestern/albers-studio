import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const cloth = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/cloth.png');

test.describe('photo tool', () => {
  test('upload → transform → tapestry + weave modes', async ({ page }) => {
    await page.goto('/photo');
    await expect(page.getByText('photograph → photo modes')).toBeVisible();

    await page.getByTestId('photo-file').setInputFiles(cloth);
    // source canvas appears after image decode
    await expect(page.locator('section').first().locator('canvas')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('photo-mode-poster').click();
    await expect(page.getByTestId('photo-mode-poster')).toHaveClass(/on/);

    // force local path (uncheck API) for deterministic offline transform
    const api = page.locator('label.check input[type=checkbox]');
    if (await api.isChecked()) await api.uncheck();

    await page.getByTestId('photo-transform').click();
    await expect(page.getByTestId('photo-readout')).toContainText(/mode poster/, { timeout: 20_000 });
    await expect(page.getByTestId('tapestry-canvas')).toBeVisible();

    await page.getByTestId('weave-mode-handloom').click();
    await expect(page.getByTestId('weave-mode-handloom')).toHaveClass(/on/);
    await expect(page.getByTestId('tapestry-canvas')).toBeVisible();

    // document mode re-transform
    await page.getByTestId('photo-mode-document').click();
    await expect(page.getByTestId('photo-readout')).toContainText(/mode document/, { timeout: 20_000 });
  });
});
