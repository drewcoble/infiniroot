// Renders og/card.html to public/og.png at 1200x630. Run from infinifantasy/: node og/render.cjs
// Set CHROMIUM_PATH if Playwright's bundled browser isn't the one installed.
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto("file://" + path.resolve(__dirname, "card.html"));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.resolve(__dirname, "../public/og.png") });
  await browser.close();
})();
