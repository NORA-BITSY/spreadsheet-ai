import { expect, test, type Page } from '@playwright/test';

// ============================================================
// M5 — interactions: column editor, add/AI-suggest/delete columns, cell
// side-panel, bulk regenerate.
//
// Canvas note (same as grid.spec): Glide draws to <canvas>; we drive and assert
// through the screen-reader-available MIRROR <table> (data-testid="grid-mirror")
// which also exposes keyboard-accessible affordances:
//   edit-col-{index}, open-cell-{rowId}-{index}, select-col-{index}.
// SSE owns the single PHP worker, so these run serial (config workers:1).
// ============================================================

const MIRROR = '[data-testid="grid-mirror"]';

test.describe.configure({ mode: 'serial' });

async function filledCount(page: Page): Promise<number> {
    const txt = await page.getByTestId('mirror-filled-count').textContent();
    return Number.parseInt(txt ?? '0', 10);
}

async function expectedCellCount(page: Page): Promise<number> {
    const rows = await page.locator(`${MIRROR} tbody tr`).count();
    const cols = await page.locator(`${MIRROR} thead th[data-format]`).count();
    return rows * cols;
}

/** Run all and wait for the returns grid to fully fill based on active dimensions. */
async function runAllReturns(page: Page): Promise<void> {
    await page.goto('/');
    await expect(page.locator(MIRROR)).toBeAttached();
    await expect(page.locator(`${MIRROR} tbody tr`).first()).toBeAttached();
    const expected = await expectedCellCount(page);
    expect(expected).toBeGreaterThan(0);
    await page.getByRole('button', { name: /Run all/i }).click();
    await expect.poll(() => filledCount(page), { timeout: 30_000 }).toBe(expected);
    await expect(page.getByRole('button', { name: /Run all/i })).toBeVisible();
}

/** Return the `column_index` of the last AI column currently rendered in the mirror. */
async function lastAiColumnIndex(page: Page): Promise<number> {
    const testId = await page
        .locator(`${MIRROR} thead button[data-testid^="edit-col-"]`)
        .last()
        .getAttribute('data-testid');
    const match = testId?.match(/^edit-col-(\d+)$/);
    if (!match) {
        throw new Error(`Could not determine last AI column index from ${testId ?? 'null'}`);
    }
    return Number.parseInt(match[1], 10);
}

/** Delete an AI column by its column_index using the inline confirmation UI. */
async function deleteColumn(page: Page, colIndex: number): Promise<void> {
    // Wait for any active SSE stream to finish so the single PHP worker is free.
    await expect(page.getByRole('button', { name: /Run all/i })).toBeVisible({ timeout: 30_000 });
    const editBtn = page.getByTestId(`edit-col-${colIndex}`);
    if ((await editBtn.count()) === 0) return;

    const before = await page.locator(`${MIRROR} thead th[data-format]`).count();
    await editBtn.dispatchEvent('click');
    const drawer = page.getByTestId('column-editor');
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: /Delete column/i }).click();
    await drawer.getByTestId('confirm-delete-column').click();
    await expect(drawer).toBeHidden();
    await expect
        .poll(async () => page.locator(`${MIRROR} thead th[data-format]`).count(), { timeout: 15_000 })
        .toBe(before - 1);
}

test.describe('Column editor (M5.1)', () => {
    test('edit an AI column → drawer prefilled → change prompt → Save & regenerate re-streams', async ({
        page,
    }) => {
        await runAllReturns(page);

        // Open the editor for the "Cliente seriale?" column (index 1).
        await page.getByTestId('edit-col-1').dispatchEvent('click');
        const drawer = page.getByTestId('column-editor');
        await expect(drawer).toBeVisible();
        await expect(drawer.getByLabel('Label')).toHaveValue(/seriale/i);
        await expect(drawer.getByTestId('ce-format')).toHaveText('yes_no');

        // Change the prompt and save.
        await drawer.getByLabel('Prompt').fill('Il cliente ha più di 3 resi negli ultimi 12 mesi? (aggiornato)');
        await drawer.getByRole('button', { name: /Save & regenerate/i }).click();
        await expect(drawer).toBeHidden();

        // That column re-streams: it goes through generating then back to ready
        // values (yes_no renders "Yes"/"No"). Assert a known row settles.
        await expect(page.getByTestId('cell-RET-1042-1')).toHaveText(/Yes|No/, { timeout: 30_000 });
    });
});

test.describe('Add / AI Suggest / delete column (M5.2)', () => {
    test('Add column → pick format → prompt → Save → a new column appears and fills', async ({
        page,
    }) => {
        await runAllReturns(page);

        const before = await page.locator(`${MIRROR} thead th[data-format]`).count();
        let createdIdx: number | null = null;

        try {
            await page.getByRole('button', { name: /Add column/i }).click();
            const drawer = page.getByTestId('column-editor');
            await expect(drawer).toBeVisible();
            await drawer.getByLabel('Label').fill('Sentiment cliente');
            await drawer.getByRole('button', { name: /^Text/i }).click();
            await drawer.getByLabel('Prompt').fill('Determina il sentiment del cliente dal motivo del reso.');
            await drawer.getByRole('button', { name: /Save & regenerate/i }).click();
            await expect(drawer).toBeHidden();

            // A new AI column header appears.
            await expect
                .poll(async () => page.locator(`${MIRROR} thead th[data-format]`).count(), { timeout: 15_000 })
                .toBe(before + 1);

            createdIdx = await lastAiColumnIndex(page);
            await expect(page.getByTestId(`cell-RET-1042-${createdIdx}`)).not.toHaveText('', {
                timeout: 30_000,
            });
        } finally {
            if (createdIdx !== null) {
                await deleteColumn(page, createdIdx);
            }
        }
    });

    test('AI Suggest → pick a suggestion → new column appears and fills', async ({ page }) => {
        await runAllReturns(page);

        const before = await page.locator(`${MIRROR} thead th[data-format]`).count();
        let createdIdx: number | null = null;

        try {
            await page.getByRole('button', { name: /AI Suggest/i }).click();
            const menu = page.getByRole('menu', { name: /AI suggested columns/i });
            await expect(menu).toBeVisible();
            await menu.getByRole('menuitem').first().click();

            await expect
                .poll(async () => page.locator(`${MIRROR} thead th[data-format]`).count(), { timeout: 15_000 })
                .toBe(before + 1);

            createdIdx = await lastAiColumnIndex(page);
            await expect(page.getByTestId(`cell-RET-1042-${createdIdx}`)).not.toHaveText('', {
                timeout: 30_000,
            });
        } finally {
            if (createdIdx !== null) {
                await deleteColumn(page, createdIdx);
            }
        }
    });

    test('delete a column from the editor via inline confirmation → it disappears', async ({ page }) => {
        await runAllReturns(page);

        const baseline = await page.locator(`${MIRROR} thead th[data-format]`).count();
        let createdIdx: number | null = null;

        try {
            // Create a temporary column so deleting it does not mutate seeded columns.
            await page.getByRole('button', { name: /Add column/i }).click();
            const drawer = page.getByTestId('column-editor');
            await expect(drawer).toBeVisible();
            await drawer.getByLabel('Label').fill('Colonna temporanea');
            await drawer.getByRole('button', { name: /^Text/i }).click();
            await drawer.getByLabel('Prompt').fill('Campo temporaneo da eliminare.');
            await drawer.getByRole('button', { name: /Save & regenerate/i }).click();
            await expect(drawer).toBeHidden();

            await expect
                .poll(async () => page.locator(`${MIRROR} thead th[data-format]`).count(), { timeout: 15_000 })
                .toBe(baseline + 1);

            createdIdx = await lastAiColumnIndex(page);
            await expect(page.getByRole('button', { name: /Run all/i })).toBeVisible({ timeout: 30_000 });

            // Open the editor and delete via the inline confirmation button.
            await page.getByTestId(`edit-col-${createdIdx}`).dispatchEvent('click');
            await expect(drawer).toBeVisible();
            await drawer.getByRole('button', { name: /Delete column/i }).click();
            await drawer.getByTestId('confirm-delete-column').click();
            await expect(drawer).toBeHidden();

            await expect
                .poll(async () => page.locator(`${MIRROR} thead th[data-format]`).count(), { timeout: 15_000 })
                .toBe(baseline);
            createdIdx = null;
        } finally {
            if (createdIdx !== null) {
                await deleteColumn(page, createdIdx);
            }
        }
    });
});

test.describe('Stream cancellation (Stop button)', () => {
    test('clicking Stop mid-stream halts generation and allows a clean subsequent run', async ({
        page,
    }) => {
        await page.goto('/');
        await expect(page.locator(MIRROR)).toBeAttached();
        await expect(page.locator(`${MIRROR} tbody tr`).first()).toBeAttached();
        const expected = await expectedCellCount(page);
        expect(expected).toBeGreaterThan(0);

        // Start streaming and immediately click Stop mid-stream.
        await page.getByRole('button', { name: /Run all/i }).click();
        const stopBtn = page.getByRole('button', { name: /^Stop$/i });
        await expect(stopBtn).toBeVisible();
        await stopBtn.click();

        // Generation halts cleanly: Run all returns and progressbar hides.
        await expect(page.getByRole('button', { name: /Run all/i })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('progressbar')).toBeHidden();

        // A subsequent Run all completes cleanly without permanent broken state.
        await page.getByRole('button', { name: /Run all/i }).click();
        await expect.poll(() => filledCount(page), { timeout: 30_000 }).toBe(expected);
        await expect(page.locator(`${MIRROR} td[data-status="generating"]`)).toHaveCount(0);
        await expect(page.getByRole('button', { name: /Run all/i })).toBeVisible();
    });
});

test.describe('Cell side-panel (M5.3)', () => {
    test('click a filled cell → panel opens with value + citation + Regenerate', async ({ page }) => {
        await runAllReturns(page);

        // Open the side-panel for an enum cell (index 0 → "Wrong Size").
        await page.getByTestId('open-cell-RET-1042-0').dispatchEvent('click');
        const panel = page.getByTestId('cell-side-panel');
        await expect(panel).toBeVisible();
        await expect(panel.getByTestId('cp-value')).not.toHaveText('');
        await expect(panel.getByTestId('cp-citations')).toBeVisible();
        await expect(panel.getByRole('button', { name: /Regenerate/i })).toBeVisible();

        // Regenerate just this column re-streams it.
        await panel.getByRole('button', { name: /Regenerate/i }).click();
        await expect(page.getByTestId('cell-RET-1042-0')).toHaveText('Wrong Size', { timeout: 30_000 });

        await panel.getByRole('button', { name: /Close panel/i }).click();
        await expect(panel).toBeHidden();
    });
});

test.describe('Bulk regenerate (M5.3)', () => {
    test('select multiple columns → bulk toolbar → Regenerate selected re-streams them', async ({
        page,
    }) => {
        await runAllReturns(page);

        // Select two AI columns (index 0 + 3).
        await page.getByTestId('select-col-0').dispatchEvent('click');
        await page.getByTestId('select-col-3').dispatchEvent('click');

        const toolbar = page.getByTestId('bulk-toolbar');
        await expect(toolbar).toBeVisible();
        await expect(toolbar).toContainText(/2 colonne selezionate/i);

        await toolbar.getByRole('button', { name: /Regenerate/i }).click();

        // Both selected columns re-stream back to their values.
        await expect(page.getByTestId('cell-RET-1042-0')).toHaveText('Wrong Size', { timeout: 30_000 });
        await expect(page.getByTestId('cell-RET-1042-3')).toHaveText('1/5', { timeout: 30_000 });

        // Clear selection hides the toolbar.
        await page.getByTestId('select-col-0').dispatchEvent('click');
        await page.getByRole('button', { name: /Clear selection/i }).click();
        await expect(toolbar).toBeHidden();
    });
});
