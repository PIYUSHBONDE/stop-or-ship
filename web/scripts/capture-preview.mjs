import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('../docs/artifacts', { recursive: true });
const software = !process.argv.includes('--default-renderer');
const suffix = software ? 'v2' : 'v2-default';
const browser = await chromium.launch({
  args: software
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : [],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const start = Date.now();
await page.goto('http://127.0.0.1:3000');
await page.getByRole('heading', { name: 'Your plant, in context.' }).waitFor();
const usableMs = Date.now() - start;
await page.locator('canvas').waitFor();
await page.waitForTimeout(5000);
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let count = 0;
      const start = performance.now();
      function frame() {
        count++;
        if (performance.now() - start >= 5000)
          resolve((count / (performance.now() - start)) * 1000);
        else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }),
);
await page.screenshot({ path: `../docs/artifacts/plant-${suffix}.png`, fullPage: true });
const performance = {
  usable_ms: usableMs,
  viewport: { width: 1600, height: 1050 },
  graphics_selection: await page.getByLabel('Graphics quality').inputValue(),
  canvas: await page.locator('canvas').evaluate((element) => ({
    buffer_width: element.width,
    buffer_height: element.height,
    displayed_width: element.clientWidth,
    displayed_height: element.clientHeight,
  })),
  animation_frame_callbacks_per_second: fps,
  requested_renderer: software ? 'SwiftShader software' : 'Browser default',
  renderer: await page.locator('canvas').evaluate((element) => {
    const gl = element.getContext('webgl2');
    const details = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && details ? gl.getParameter(details.UNMASKED_RENDERER_WEBGL) : 'Unavailable';
  }),
  rendering: 'requestAnimationFrame cadence is not a GPU frame benchmark',
  errors,
};
await writeFile(
  `../docs/artifacts/browser-performance-${suffix}.json`,
  JSON.stringify(performance, null, 2),
);
console.log(JSON.stringify(performance));
await browser.close();
