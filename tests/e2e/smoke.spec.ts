import { expect, test } from '@playwright/test';

test('registration to first card (solo preview)', async ({ page }) => {
  const started = Date.now();
  await page.goto('/');
  await page.getByRole('button', { name: /I am 18 or older/ }).click();

  await page.getByLabel('Your age').fill('29');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: /Man/ }).first().click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: /Men/ }).first().click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('checkbox', { name: /Oral/ }).click();
  await page.getByRole('checkbox', { name: /Intimate/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Nickname (optional)').fill('Sam');
  await page.getByRole('button', { name: 'Begin' }).click();

  await expect(page.getByRole('heading', { name: /Good evening, Sam/ })).toBeVisible();
  await page.getByRole('button', { name: /Solo preview/ }).click();

  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
  await page.getByRole('button', { name: 'Start' }).click();

  // Responsible-use note shows once on first play.
  await page.getByRole('button', { name: 'We understand' }).click();
  await page.getByTestId('draw').click();
  await page.getByRole('button', { name: 'Reveal card' }).click();
  await expect(page.getByText(/PLACEHOLDER: describe task/)).toBeVisible();

  // Mandatory controls are visible on the card screen.
  for (const name of ['Done', 'Skip', 'Swap', 'Pause', 'Stop: safe signal', 'Hide screen now']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }

  // Safe signal stops the game and offers calm options.
  await page.getByTestId('stop').click();
  await expect(page.getByRole('heading', { name: 'Take a breath' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByRole('heading', { name: 'Take a breath' })).toBeHidden();

  expect(Date.now() - started).toBeLessThan(90_000);
});

test('under 18 is blocked', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Your age').fill('16');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: /adults only/i })).toBeVisible();
});

test('card API is unreachable without a session', async ({ request }) => {
  const res = await request.get('/api/rooms/ABCDEF');
  expect(res.status()).toBe(401);
  const robots = await request.get('/robots.txt');
  expect(await robots.text()).toContain('Disallow: /');
});
