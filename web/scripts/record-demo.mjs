import { chromium } from '@playwright/test';
import { mkdir, rename, writeFile } from 'node:fs/promises';

await mkdir('../docs/artifacts', { recursive: true });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: { dir: '../docs/artifacts', size: { width: 1440, height: 1000 } },
});
const page = await context.newPage();
await page.goto('http://127.0.0.1:3000');
await page.getByRole('heading', { name: 'Your plant, in context.' }).waitFor();
await page.locator('canvas').waitFor();
const started = Date.now();
async function at(seconds, caption) {
  const remaining = seconds * 1000 - (Date.now() - started);
  if (remaining > 0) await page.waitForTimeout(remaining);
  await page.evaluate((text) => {
    let el = document.getElementById('rehearsal-caption');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rehearsal-caption';
      el.style.cssText =
        'position:fixed;bottom:8px;left:90px;right:28px;z-index:200;background:#102b29f5;border:1px solid #80d8b9;padding:14px 20px;color:#def6e9;font:14px Arial;border-radius:6px;pointer-events:none';
      document.body.appendChild(el);
    }
    el.textContent = text;
  }, 'LOCAL REHEARSAL · SCRIPTED INVESTIGATOR · ' + caption);
}
async function idle() {
  await page.getByRole('status').waitFor({ state: 'detached' });
}
async function step(n) {
  for (let i = 0; i < n; i++) {
    await page.getByRole('button', { name: 'Advance one telemetry window' }).click();
    await idle();
  }
}
await at(0, 'A whole plant: two production lines, twelve assets, shared utilities.');
await at(15, 'Measured UCI hydraulic replay. The plant and production context are simulated.');
await page.getByRole('button', { name: 'Start scenario', exact: true }).click();
await idle();
await page.getByRole('button', { name: 'Pause replay' }).click();
await idle();
await at(24, 'A conventional detector requires three persistent abnormal windows.');
await step(6);
await page.getByRole('navigation').getByRole('link', { name: 'Incidents', exact: true }).click();
await page.getByText('INVESTIGATION SUMMARY', { exact: true }).waitFor();
await at(
  45,
  'Evidence connects the pump to downstream output. The parallel line stays independent.',
);
await page.getByRole('button', { name: 'Telemetry', exact: true }).first().click();
await at(57, 'Inspect measurements and provenance. Diagnosis remains a hypothesis.');
await page.keyboard.press('Escape');
await at(70, 'Compare Reliability and Production over the same deterministic cost model.');
await page.getByRole('tab', { name: 'Decision', exact: true }).click();
await at(86, 'Expected costs use configured assumptions—not calibrated failure probabilities.');
await page.getByRole('button', { name: 'Inspect assumptions & sensitivity' }).click();
await at(101, 'Python owns the arithmetic. Human approval owns the action.');
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Approve selected intervention' }).click();
await idle();
await at(113, 'A versioned approval creates the work order. The investigator cannot issue it.');
await page.getByRole('navigation').getByRole('link', { name: 'Maintenance', exact: true }).click();
await page.getByRole('button', { name: 'Start approved repair' }).click();
await idle();
await page.getByLabel('Observed root cause').fill('Valve bypass');
await page.getByLabel('Repair performed').fill('Reseated bypass valve and replaced its seal');
await at(126, 'Technician correction: the observed cause differs from the original hypothesis.');
await page.getByRole('button', { name: 'Complete repair & verify' }).click();
await idle();
await page.getByRole('navigation').getByRole('link', { name: 'Plant', exact: true }).click();
await page.getByRole('button', { name: 'Pause replay' }).click();
await idle();
await at(139, 'Work completion is not proof of recovery. Verify three healthy windows.');
await step(3);
await page.getByRole('navigation').getByRole('link', { name: 'Memory', exact: true }).click();
await at(
  151,
  'Confirmed repair memory preserves both the AI hypothesis and the technician outcome.',
);
await page.getByRole('button', { name: 'Replay a similar incident' }).click();
await idle();
await page.getByRole('navigation').getByRole('link', { name: 'Plant', exact: true }).click();
await page.getByRole('button', { name: 'Pause replay' }).click();
await idle();
await step(6);
await page.getByRole('navigation').getByRole('link', { name: 'Incidents', exact: true }).click();
await at(168, 'A later investigation retrieves the verified repair as evidence, not certainty.');
await page.getByRole('button', { name: 'Verified repair', exact: true }).click();
await at(177, 'Signal → evidence → decision → human approval → verified outcome.');
await page.waitForTimeout(Math.max(0, 180000 - (Date.now() - started)));
const video = page.video();
await context.close();
const path = await video.path();
await rename(path, '../docs/artifacts/plantsense-local-demo.webm');
await writeFile(
  '../docs/artifacts/recording.json',
  JSON.stringify(
    {
      duration_target_seconds: 180,
      elapsed_seconds: (Date.now() - started) / 1000,
      mode: 'local scripted investigator',
      audio: false,
      submission_ready: false,
    },
    null,
    2,
  ),
);
await browser.close();
console.log('Saved silent local rehearsal to docs/artifacts/plantsense-local-demo.webm');
