import type { Page } from '@playwright/test';
import { expect, test } from '../support/staff-session';

test.describe.configure({ mode: 'serial' });

test('provider timeout retains captured context and requires an explicit new attempt', async ({
  page,
}) => {
  const requests: { key: string | undefined; body: unknown }[] = [];
  await page.route('**/assistant/questions', async (route) => {
    requests.push({
      key: route.request().headers()['idempotency-key'],
      body: route.request().postDataJSON(),
    });
    if (requests.length === 1) {
      await route.fulfill({
        status: 504,
        json: { detail: 'AI response timed out. Your question is retained; try a new request.' },
      });
    } else {
      await route.continue();
    }
  });
  await openAssistant(page);
  const input = page.getByLabel('Question or editable transcript');
  await input.fill('Who is responding?');
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Try as new request', exact: true })).toBeVisible();
  await expect(input).toHaveValue('Who is responding?');
  expect(requests).toHaveLength(1);
  await page.getByRole('button', { name: 'Try as new request', exact: true }).click();
  await expect(page.locator('[id^="answer-"]')).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1].key).not.toBe(requests[0].key);
  expect(requests[1].body).toEqual(requests[0].body);
});

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
  await page.getByLabel('Question or editable transcript').press('Shift+Enter');
  await expect(page.getByLabel('Question or editable transcript')).toHaveValue(
    'Which current readings are missing?\n',
  );
  await expect(page.getByRole('button', { name: 'Play answer' })).toHaveCount(0);
  await page
    .getByLabel('Question or editable transcript')
    .dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(page.getByRole('button', { name: 'Play answer' })).toHaveCount(0);
  await page.getByLabel('Question or editable transcript').press('Enter');
  await expect(page.getByText('Read-only · Scripted provider', { exact: true })).toBeVisible();
  await expect(page.locator('details pre').first()).not.toBeVisible();
  await expect(page.getByText(/Configuration 1/)).not.toBeVisible();
  await page
    .locator('summary')
    .filter({ hasText: /^Sources \(\d+\)$/ })
    .click();
  await page.getByText('Plant records', { exact: true }).click();
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
  await expect(
    page.getByRole('dialog', { name: 'Ask PlantSense' }).getByRole('alert'),
  ).toContainText('permission denied');
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

test('retry retains the captured synthetic snapshot and request key', async ({ page }) => {
  const requests: { body: unknown; key: string | undefined }[] = [];
  await page.route('**/assistant/questions', async (route) => {
    requests.push({
      body: route.request().postDataJSON(),
      key: route.request().headers()['idempotency-key'],
    });
    if (requests.length === 1) {
      await route.abort();
      return;
    }
    await route.fulfill({
      json: {
        answer: 'Captured simulation fixture',
        citations: [],
        navigation: [],
        costs: [],
        configuration_version: 1,
        calculation_version: null,
        answer_reference: '1'.repeat(32),
        provider: 'Browser fixture',
        incident_id: null,
        asset_id: 'P-107',
      },
    });
  });
  await openAssistant(page);
  await page.getByLabel('Question or editable transcript').fill('Explain the simulated readings');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /fetch|Failed|network/i })).toBeVisible();
  const first = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('plantsense-simulation-v2:'))!;
    return { key, tick: JSON.parse(localStorage.getItem(key)!).tick };
  });
  await expect
    .poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).tick, first.key))
    .toBeGreaterThan(first.tick);
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByText('Captured simulation fixture')).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(
    (requests[0].body as { simulation_context: { equipment: unknown[] } }).simulation_context
      .equipment.length,
  ).toBeGreaterThan(0);
});

test('formatted full replies remain safe and survive expansion without losing draft or scroll', async ({
  page,
}) => {
  const answer =
    '**Pressure is 150 bar.**\n\n- Maya is responding.\n- Output is 65 parts/hour.\n\n' +
    'A detailed browser fixture explains the available evidence. '.repeat(50) +
    '\n\n<script>window.chatInjected=true</script> [Unsafe](javascript:alert(1))';
  let replies = 0;
  await page.route('**/assistant/questions', (route) =>
    route.fulfill({
      json: {
        answer,
        citations: [
          {
            id: 'plant-state',
            title: 'Authoritative plant snapshot',
            text: '{"configuration_version":1}',
          },
        ],
        navigation: ['javascript:alert(1)', 'https://example.test/untrusted'],
        costs: [],
        configuration_version: 1,
        calculation_version: null,
        answer_reference: String(++replies).repeat(32),
        provider: 'Browser fixture',
        incident_id: null,
        asset_id: 'P-107',
      },
    }),
  );
  await openAssistant(page);
  await page.getByLabel('Question or editable transcript').fill('Explain this in detail.');
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  const chat = page.getByRole('dialog', { name: 'Ask PlantSense', exact: true });
  const paragraph = page.locator('[id^="answer-"]');
  await expect(paragraph.locator('strong')).toHaveText('Pressure is 150 bar.');
  await expect(paragraph.locator('li')).toHaveCount(2);
  await expect(paragraph).toContainText('<script>window.chatInjected=true</script>');
  await expect(paragraph.locator('script,a')).toHaveCount(0);
  await expect(chat.locator('a')).toHaveCount(1);
  await expect(chat.getByRole('link', { name: 'View machine' })).toHaveAttribute(
    'href',
    '/monitoring/P-107',
  );
  await expect(page.getByRole('button', { name: 'Read full answer' })).toHaveCount(0);
  expect(await paragraph.evaluate((p) => p.scrollHeight <= p.clientHeight + 1)).toBe(true);
  const input = page.getByLabel('Question or editable transcript');
  await input.fill('Keep this draft');
  const scroll = paragraph.locator('..').locator('..').locator('..');
  await scroll.evaluate((node) => (node.scrollTop = 60));
  const top = await scroll.evaluate((node) => node.scrollTop);
  const canvasBefore = await page.locator('canvas').boundingBox();
  await page.getByRole('button', { name: 'Expand chat', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Collapse chat', exact: true })).toBeFocused();
  await expect(input).toHaveValue('Keep this draft');
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBe(top);
  expect((await chat.boundingBox())!.width).toBe(820);
  expect(await page.locator('canvas').boundingBox()).toEqual(canvasBefore);
  await page.keyboard.press('Escape');
  await expect(chat).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expand chat', exact: true })).toBeFocused();
  await expect(input).toHaveValue('Keep this draft');
  expect((await chat.boundingBox())!.width).toBe(440);
  await expect(page.locator('pre')).not.toBeVisible();
  await page
    .locator('summary')
    .filter({ hasText: /^Sources \(1\)$/ })
    .click();
  await page.getByText('Plant records', { exact: true }).click();
  await expect(page.locator('pre')).toContainText('configuration_version');
  await page.getByText('Screen data', { exact: true }).click();
  await expect(chat).toContainText('not verified sensor data');
  await expect(chat).toContainText('Last question captured:');
  const followup = page.waitForRequest((r) => r.url().endsWith('/assistant/questions'));
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  expect((await followup).postDataJSON().history[0].answer).toBe(answer.slice(0, 3000));
  await expect(page.locator('[id^="answer-"]')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Ask PlantSense', exact: true })).toBeFocused();
});
