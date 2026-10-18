import type { Page } from '@playwright/test';
import { expect, test } from '../support/staff-session';

test.describe.configure({ mode: 'serial' });

async function openAssistant(page: Page) {
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  await page.getByRole('button', { name: 'Ask PlantSense', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Ask PlantSense' })).toBeVisible();
}

test('contextual answers, citations, keyboard focus and 430px drawer', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openAssistant(page);
  await page
    .getByLabel('Question or editable transcript')
    .fill('Which current readings are missing?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(
    page.getByText('Scripted summary · Gemini not connected', { exact: false }),
  ).toBeVisible();
  await page.getByText('Authoritative plant snapshot · plant-state').click();
  await expect(page.locator('details pre').first()).toContainText('configuration_version');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '../.runtime/assistant-430px.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Ask PlantSense', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Ask PlantSense', exact: true }).click();
  await expect(
    page.getByText('Which current readings are missing?', { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('microphone denial leaves typed questions usable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        throw new DOMException('Denied', 'NotAllowedError');
      },
    });
  });
  await openAssistant(page);
  await page.getByRole('button', { name: 'Record question' }).click();
  await expect(page.getByRole('alert')).toContainText('permission denied');
  await page.getByLabel('Question or editable transcript').fill('Explain missing data.');
  await expect(page.getByRole('button', { name: 'Send question' })).toBeEnabled();
});

test('voice transcript is editable and never sends automatically; playback needs a click', async ({
  page,
}) => {
  let questions = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/assistant/questions')) questions++;
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const output = context.createMediaStreamDestination();
        oscillator.connect(output);
        oscillator.start();
        output.stream.getTracks()[0].addEventListener('ended', () => {
          oscillator.stop();
          void context.close();
        });
        return output.stream;
      },
    });
    HTMLMediaElement.prototype.play = async function () {
      this.dataset.played = 'yes';
    };
  });
  await page.route('**/assistant/transcriptions', async (route) => {
    const body = route.request().postDataJSON();
    expect(body.audio_base64.startsWith('UklGR')).toBe(true);
    await route.fulfill({
      json: {
        transcript: 'P-107 pressure 125 bar',
        usage: {
          request_id: 'fixture',
          status: 'completed',
          charged_micro_usd: 267,
          audio_seconds: 1,
        },
      },
    });
  });
  let speech = 0;
  await page.route('**/assistant/speech', async (route) => {
    speech++;
    expect(route.request().postDataJSON().answer_reference).toMatch(/^[a-f0-9]{32}$/);
    await route.fulfill({
      json: {
        audio_base64: 'SUQzZml4dHVyZQ==',
        mime_type: 'audio/mpeg',
        usage: { request_id: 'fixture', status: 'completed', charged_micro_usd: 1000 },
      },
    });
  });
  await openAssistant(page);
  await page.getByRole('button', { name: 'Record question' }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  // Wait for an actual PCM processing callback before stopping this browser fixture.
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.getByLabel('Question or editable transcript')).toHaveValue(
    'P-107 pressure 125 bar',
  );
  expect(questions).toBe(0);
  await page
    .getByLabel('Question or editable transcript')
    .fill('P-107 pressure 125 bar. Is there current evidence?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByRole('button', { name: 'Play answer' })).toBeVisible();
  expect(speech).toBe(0);
  await page.getByRole('button', { name: 'Play answer' }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: 'Play answer' }).click();
  expect(speech).toBe(1);
  await page.getByRole('button', { name: 'Close assistant' }).click();
});

test('navigation discards an answer from the old screen', async ({ page }) => {
  await page.route('**/assistant/questions', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({
      json: {
        answer: 'Old screen fixture',
        citations: [],
        navigation: [],
        costs: [],
        configuration_version: 1,
        calculation_version: null,
        answer_reference: '0'.repeat(32),
        provider: 'Browser fixture',
        incident_id: null,
        asset_id: 'P-107',
      },
    });
  });
  await openAssistant(page);
  await page.getByLabel('Question or editable transcript').fill('Explain this screen');
  await page.getByRole('button', { name: 'Send question' }).click();
  await page.goto('/operations');
  await page.getByRole('button', { name: 'Ask PlantSense', exact: true }).click();
  await expect(page.getByText('Old screen fixture')).toHaveCount(0);
});
