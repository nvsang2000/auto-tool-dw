const puppeteer = require("puppeteer");
const path = require("path");
const fs = require("fs");

function getChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }

  return "/usr/bin/google-chrome";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  try {
    console.log("🚀 Initializing browser...");

    const sharedProfileDir = "/home/nvsang/server/chrome-data/shared";

    const browser = await puppeteer.launch({
      headless: false, // bắt buộc
      devtools: true,
      executablePath: getChromePath(),
      userDataDir: sharedProfileDir,
      defaultViewport: { width: 1400, height: 900 },
      args: [
        "--window-size=1400,1000",
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--start-maximized",
        "--disable-dev-shm-usage",
      ],
      slowMo: 50,
    });

    const page = await browser.newPage();

    await page.goto("https://google.com");

    console.log("⏳ Browser will stay open for 3 minutes...");

    await sleep(3 * 60 * 1000);

    console.log("🛑 Closing browser...");
    await browser.close();

    console.log("✅ Done");
  } catch (e) {
    console.error("❌ Error:", e.message);
  }
})();