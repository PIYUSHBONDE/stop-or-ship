/** Explicit live Google acceptance. Never included in the scripted browser suite. */
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('real Gemini answer, Google transcription and playable Google MP3', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/workspace');
  const access = await (await page.request.get('/api/v1/access/state')).json();
  const credentials = {
    email: 'product-owner@example.test',
    password: 'testing-only strong passphrase!',
  };
  const login = await page.request.post(
    `/api/v1/access/${access.setup_required ? 'setup' : 'sign-in'}`,
    {
      data: access.setup_required
        ? {
            ...credentials,
            display_name: 'Live fixture owner',
            organization_name: 'Isolated acceptance',
            plant_name: 'Live assistant fixture',
          }
        : credentials,
    },
  );
  expect(login.ok()).toBe(true);
  const plant = (await login.json()).plants[0].id;
  await page.evaluate((id) => localStorage.setItem('plantsense-workspace', id), plant);
  await page.goto('/operations');
  await page.getByRole('button', { name: 'Ask PlantSense', exact: true }).click();
  await page
    .getByLabel('Question or editable transcript')
    .fill('Which current readings are missing for P-107?');
  const answerResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/assistant/questions') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Send question' }).click();
  const answer = await (await answerResponse).json();
  expect(answer.provider).toMatch(/^Gemini/);
  expect(answer.usage.status).toBe('completed');
  await expect(page.getByRole('button', { name: 'Play answer' })).toBeVisible();
  const audioResponse = page.waitForResponse((response) =>
    response.url().endsWith('/assistant/speech'),
  );
  await page.getByRole('button', { name: 'Play answer' }).click();
  const audio = await (await audioResponse).json();
  expect(audio.usage.status).toBe('completed');
  // Decode actual Google output in Chromium; a returned base64 string alone is insufficient proof.
  const duration = await page.evaluate(async (encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    const context = new AudioContext();
    const decoded = await context.decodeAudioData(bytes.buffer);
    await context.close();
    return decoded.duration;
  }, audio.audio_base64);
  expect(duration).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  const fixture = await readFile('../.runtime/assistant-voice-fixture-v3.wav');
  const transcription = await page.request.post(
    `/api/v1/plants/${plant}/assistant/transcriptions`,
    {
      data: { asset_id: 'P-107', audio_base64: fixture.toString('base64') },
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    },
  );
  expect(transcription.ok()).toBe(true);
  const text = (await transcription.json()).transcript
    .toLowerCase()
    .replaceAll(' ', '')
    .replaceAll('-', '');
  expect(text).toContain('107');
  expect(text).toContain('125');
  expect(text).toContain('bar');
  expect(text).toContain('60');
  await page.setViewportSize({ width: 430, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '../.runtime/assistant-live-430px.png' });
  expect(errors).toEqual([]);
});
