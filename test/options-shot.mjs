// A picture of the settings page, in light and dark.
import { launch, shot } from './browser.mjs';
for (const dark of [false, true]) {
  const { context, id } = await launch({ dark, height: 1500 });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.waitForTimeout(600);
  await shot(page, `options-${dark ? 'dark' : 'light'}`);
  await context.close();
}
