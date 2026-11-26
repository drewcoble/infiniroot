// Renders og/card.html to public/og.png at 1200x630, with the hero's app screen copied in from
// index.html. Run from infinifantasy/: node og/render.cjs
// Set CHROMIUM_PATH if Playwright's bundled browser isn't the one installed.
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const screen = index.match(/<figure class="screen[\s\S]*?<\/figure>/)?.[0];
if (!screen) throw new Error("No <figure class=\"screen\"> in index.html");

// The page's absolute paths (/headshots/..., /team-helmet.svg) live in public/.
const card = fs
  .readFileSync(path.join(__dirname, "card.html"), "utf8")
  .replace("<!-- SCREEN -->", screen.replace(/(src=")\//g, "$1../public/"));
const tmp = path.join(__dirname, ".card.rendered.html");
fs.writeFileSync(tmp, card);

(async () => {
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto("file://" + tmp);
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Fit the screen to the card's height, leaving a margin top and bottom.
    const box = document.querySelector(".og-screen");
    const scale = Math.min(1, (630 - 80) / box.offsetHeight);
    box.style.transform = `translateY(-50%) scale(${scale})`;
  });
  await page.screenshot({ path: path.join(root, "public/og.png") });
  await browser.close();
  fs.unlinkSync(tmp);
})();
