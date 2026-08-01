import { test, expect } from '@playwright/test';

test.describe('generate tool', () => {
  test('generate → inspector → rematerialize → authoring', async ({ page }) => {
    await page.goto('/generate');
    await expect(page.getByText('environment + rug style')).toBeVisible();

    await page.getByTestId('generate').click();
    await expect(page.getByTestId('generate-readout')).toContainText(/generative/, { timeout: 20_000 });
    await expect(page.getByTestId('tapestry-canvas')).toBeVisible();
    await expect(page.getByTestId('authoring')).toBeVisible();
    await expect(page.getByTestId('motif-canvas')).toBeVisible();
    await expect(page.getByTestId('draft-canvas')).toBeVisible();

    // DesignSpec inspector via Preview if not already filled by generate
    if (!(await page.getByTestId('design-spec').locator('select').count())){
      await page.getByTestId('preview-spec').click();
    }
    await expect(page.getByTestId('design-spec').locator('select').first()).toBeVisible();

    await page.getByTestId('double-weave').check();
    await page.getByTestId('ca-seed').check();
    await page.getByTestId('rematerialize').click();
    await expect(page.getByTestId('generate-readout')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('face-toggle')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('face-b').click();
    await expect(page.getByTestId('face-b')).toHaveClass(/on/);
    await page.getByTestId('face-a').click();
    await expect(page.getByTestId('face-a')).toHaveClass(/on/);

    // motif brush paint
    const motif = page.getByTestId('motif-canvas');
    const box = await motif.boundingBox();
    expect(box).toBeTruthy();
    await page.getByTestId('yarn-pick-1').click();
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
    await expect(page.getByTestId('authoring-undo')).toBeEnabled();

    // draft cell toggle
    const draft = page.getByTestId('draft-canvas');
    const dbox = await draft.boundingBox();
    await draft.click({ position: { x: dbox.width * 0.3, y: dbox.height * 0.3 } });

    await page.getByTestId('weave-mode-ribbon').click();
    await expect(page.getByTestId('weave-mode-ribbon')).toHaveClass(/on/);
    await expect(page.getByTestId('tapestry-canvas')).toBeVisible();
  });

  test('construction exports stay enabled after generate', async ({ page }) => {
    await page.goto('/generate');
    await page.getByTestId('generate').click();
    await expect(page.getByTestId('tapestry-canvas')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'PNG' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'SVG' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Draft' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'WIF' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Provenance' })).toBeEnabled();
  });
});
