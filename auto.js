#!/usr/bin/env node
/**
 * AUTO DARKWAR - Ubuntu/Debian Chrome Version
 * Modes:
 * - default: auto run accounts
 * - connect: open Chrome for 20 minutes to login manually
 */

const puppeteer = require("puppeteer");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

function getLinuxChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.BROWSER_EXECUTABLE_PATH,
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

const CONFIG = {
  BASE_URL: "https://pay.darkwar-survival.com",

  ROOT_DIR: __dirname,
  DATA_DIR: path.resolve(__dirname, "./data"),
  LOGS_DIR: path.resolve(__dirname, "./logs"),
  CHROME_DATA_DIR: "/home/nvsang/server/chrome-data/shared",
  ACCOUNTS_FILE: path.resolve(__dirname, "./config/accounts.json"),
  PROGRESS_FILE: path.resolve(__dirname, "./data/progress.json"),
  ERROR_LOG_FILE: path.resolve(__dirname, "./logs/error.log"),

  UUID: process.env.UUID || "",
  PASSWORD: process.env.PASSWORD || "",

  DEFAULT_MULTI_ACCOUNT: true,
  DEFAULT_MOBILE: true,
  KEEP_BROWSER_OPEN: false,
  HEADLESS:
    process.env.HEADLESS === "true" || process.env.HEADLESS === "1"
      ? true
      : false,
  DEVTOOLS: true,

  BROWSER_EXECUTABLE_PATH: getLinuxChromePath(),

  NAVIGATION_TIMEOUT: 60000,
  SELECTOR_TIMEOUT: 10000,
  ACTION_DELAY: 300,
  BETWEEN_ACCOUNTS_DELAY: 3000,
  MAX_CLAIM_ROUNDS: 10,
  LOGIN_WAIT_AFTER_SUBMIT: 5000,

  CONNECT_HOLD_MINUTES: 20,
};

const VIEWPORT = {
  desktop: { width: 1400, height: 900 },
  mobile: {
    width: 375,
    height: 812,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function nowIso() {
  return new Date().toISOString();
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function getTodayLogDir() {
  const today = todayStr();
  const logDir = path.join(CONFIG.LOGS_DIR, today);
  ensureDirExists(logDir);
  return logDir;
}

function getDailyCronLogFile() {
  return path.join(getTodayLogDir(), "cron.log");
}

function getDailyErrorLogFile() {
  return path.join(getTodayLogDir(), "error.log");
}

function writeDailyErrorLog(message, context = {}) {
  const logFile = getDailyErrorLogFile();
  appendFileLine(
    logFile,
    JSON.stringify({ time: nowIso(), message, ...context }),
  );
}

function log(msg, prefix = "") {
  console.log(`[${new Date().toLocaleTimeString()}] ${prefix}${msg}`);
}

function sanitizeFileName(input) {
  return String(input || "default").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

function ensureDirExists(targetPath) {
  const dir = path.extname(targetPath) ? path.dirname(targetPath) : targetPath;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function appendFileLine(filePath, line) {
  ensureDirExists(filePath);
  fs.appendFileSync(filePath, `${line}\n`, "utf8");
}

function writeErrorLog(message, context = {}) {
  writeDailyErrorLog(message, context);
  appendFileLine(
    CONFIG.ERROR_LOG_FILE,
    JSON.stringify({
      time: nowIso(),
      message,
      ...context,
    }),
  );
}

function getRuntimeOptions() {
  return {
    mobile: CONFIG.DEFAULT_MOBILE,
    multi: CONFIG.DEFAULT_MULTI_ACCOUNT,
    keepOpen: CONFIG.KEEP_BROWSER_OPEN,
    headless: CONFIG.HEADLESS,
    devtools: CONFIG.DEVTOOLS,
    executablePath: CONFIG.BROWSER_EXECUTABLE_PATH,
  };
}

function getCliMode() {
  return process.argv[2] || "auto";
}

function getCliAccountName() {
  return process.argv[3] || "";
}

// ============ FILE HELPERS ============
function loadAccounts() {
  if (!fs.existsSync(CONFIG.ACCOUNTS_FILE)) {
    throw new Error(`accounts.json not found: ${CONFIG.ACCOUNTS_FILE}`);
  }

  const raw = fs.readFileSync(CONFIG.ACCOUNTS_FILE, "utf8");
  const accounts = JSON.parse(raw);

  if (!Array.isArray(accounts)) {
    throw new Error("accounts.json must be an array");
  }

  return accounts;
}

function findAccountForConnect(accountName = "") {
  const accounts = loadAccounts();
  const enabled = accounts.filter((a) => a.enabled && a.uuid);

  if (!enabled.length) {
    throw new Error("No enabled account found in accounts.json");
  }

  if (accountName) {
    const exact = enabled.find(
      (a) => a.name === accountName || a.uuid === accountName,
    );
    if (exact) return exact;

    throw new Error(`Account not found for connect mode: ${accountName}`);
  }

  return enabled[0];
}

// ============ PROGRESS ============
function loadProgress() {
  try {
    if (fs.existsSync(CONFIG.PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG.PROGRESS_FILE, "utf8"));
    }
  } catch (e) {
    log(`⚠️ Failed to read progress file: ${e.message}`);
    writeErrorLog("Failed to read progress file", { error: e.message });
  }

  return { accounts: {} };
}

function saveProgress(data) {
  ensureDirExists(CONFIG.PROGRESS_FILE);
  fs.writeFileSync(CONFIG.PROGRESS_FILE, JSON.stringify(data, null, 2), "utf8");
}

function ensureAccountProgress(uuid, accountName) {
  const data = loadProgress();

  if (!data.accounts[uuid]) {
    data.accounts[uuid] = {
      name: accountName || uuid,
      totalRuns: 0,
      totalSuccess: 0,
      totalFailed: 0,
      lastRun: null,
      lastStatus: null,
      lastError: null,
      completedAt: null,
      failedAt: null,
      lastConnectAt: null,
      days: {},
    };
  }

  return data;
}

function markAccountRunStart(uuid, accountName) {
  const data = ensureAccountProgress(uuid, accountName);
  const today = todayStr();
  const acc = data.accounts[uuid];

  acc.name = accountName || uuid;
  acc.totalRuns += 1;
  acc.lastRun = nowIso();
  acc.lastStatus = "running";
  acc.lastError = null;

  if (!acc.days[today]) {
    acc.days[today] = {
      tasks: [],
      status: "running",
      startedAt: nowIso(),
      completedAt: null,
      failedAt: null,
      error: null,
      connectAt: null,
    };
  } else {
    acc.days[today].status = "running";
    acc.days[today].startedAt = nowIso();
    acc.days[today].error = null;
  }

  saveProgress(data);
}

function markAccountSuccess(uuid, accountName, tasks = []) {
  const data = ensureAccountProgress(uuid, accountName);
  const today = todayStr();
  const acc = data.accounts[uuid];

  if (!acc.days[today]) {
    acc.days[today] = {};
  }

  const mergedTasks = new Set(acc.days[today].tasks || []);
  for (const task of tasks) mergedTasks.add(task);

  acc.totalSuccess += 1;
  acc.lastStatus = "success";
  acc.lastError = null;
  acc.completedAt = nowIso();
  acc.failedAt = null;

  acc.days[today].tasks = Array.from(mergedTasks);
  acc.days[today].status = "success";
  acc.days[today].completedAt = nowIso();
  acc.days[today].failedAt = null;
  acc.days[today].error = null;

  saveProgress(data);
}

function markAccountFailed(uuid, accountName, errorMessage, tasks = []) {
  const data = ensureAccountProgress(uuid, accountName);
  const today = todayStr();
  const acc = data.accounts[uuid];

  if (!acc.days[today]) {
    acc.days[today] = {};
  }

  const mergedTasks = new Set(acc.days[today].tasks || []);
  for (const task of tasks) mergedTasks.add(task);

  acc.totalFailed += 1;
  acc.lastStatus = "failed";
  acc.lastError = errorMessage;
  acc.failedAt = nowIso();

  acc.days[today].tasks = Array.from(mergedTasks);
  acc.days[today].status = "failed";
  acc.days[today].completedAt = null;
  acc.days[today].failedAt = nowIso();
  acc.days[today].error = errorMessage;

  saveProgress(data);
}

function markAccountNotSupported(uuid, accountName) {
  const data = ensureAccountProgress(uuid, accountName);
  const today = todayStr();
  const acc = data.accounts[uuid];

  if (!acc.days[today]) {
    acc.days[today] = {};
  }

  acc.lastStatus = "not_supported";
  acc.lastError = "System error - account not supported";
  acc.notSupported = true;

  acc.days[today].status = "not_supported";
  acc.days[today].error = "System error - account not supported";
  acc.days[today].notSupported = true;
  acc.days[today].notSupportedAt = nowIso();

  saveProgress(data);
  log(`⚠️ Account ${accountName} marked as NOT SUPPORTED`);
}

// Check if account is not supported (can be used to skip account)
function isNotSupported(uuid) {
  const data = loadProgress();
  return data.accounts[uuid]?.notSupported === true;
}

function markAccountConnect(uuid, accountName) {
  const data = ensureAccountProgress(uuid, accountName);
  const today = todayStr();
  const acc = data.accounts[uuid];

  acc.lastConnectAt = nowIso();

  if (!acc.days[today]) {
    acc.days[today] = {
      tasks: [],
      status: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      error: null,
      connectAt: nowIso(),
    };
  } else {
    acc.days[today].connectAt = nowIso();
  }

  saveProgress(data);
}

function isDoneToday(uuid) {
  const data = loadProgress();
  const today = todayStr();
  const day = data.accounts[uuid]?.days?.[today];
  return day?.status === "success" && day?.completedAt != null;
}

function getStats(uuid) {
  const data = loadProgress();
  const acc = data.accounts[uuid];

  if (!acc) {
    return {
      totalRuns: 0,
      totalSuccess: 0,
      totalFailed: 0,
      daysCount: 0,
      monthlyCount: 0,
    };
  }

  const daysCount = Object.keys(acc.days || {}).length;
  const monthlyCount = Object.keys(acc.days || {}).filter((d) => {
    const day = new Date(d);
    const monthAgo = new Date();
    monthAgo.setDate(monthAgo.getDate() - 30);
    return day >= monthAgo;
  }).length;

  return {
    totalRuns: acc.totalRuns || 0,
    totalSuccess: acc.totalSuccess || 0,
    totalFailed: acc.totalFailed || 0,
    daysCount,
    monthlyCount,
  };
}

// ============ GLOBAL BROWSER ============
let globalBrowser = null;

async function launchSharedBrowser() {
  if (globalBrowser) {
    log("📱 Using existing browser");
    return globalBrowser;
  }

  const options = getRuntimeOptions();
  const vp = options.mobile ? VIEWPORT.mobile : VIEWPORT.desktop;

  // Use shared profile instead of account-specific
  const sharedProfileDir = path.join(CONFIG.CHROME_DATA_DIR, "shared");
  ensureDirExists(sharedProfileDir);

  log("🚀 Launching shared browser...");
  globalBrowser = await puppeteer.launch({
    headless: options.headless,
    devtools: options.devtools,
    executablePath: options.executablePath,
    userDataDir: sharedProfileDir,
    defaultViewport: vp,
    args: [
      `--window-size=${vp.width},${vp.height + 100}`,
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--start-maximized",
      "--disable-dev-shm-usage",
    ],
    slowMo: 50,
  });

  log("✅ Shared browser launched");
  return globalBrowser;
}

async function closeSharedBrowser() {
  if (globalBrowser) {
    log("🛑 Closing shared browser...");
    await globalBrowser.close();
    globalBrowser = null;
    log("✅ Browser closed");
  }
}

async function createAccountPage() {
  const browser = await launchSharedBrowser();
  const options = getRuntimeOptions();
  const vp = options.mobile ? VIEWPORT.mobile : VIEWPORT.desktop;

  const page = await browser.newPage();
  await page.setViewport(vp);

  // Set user agent
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  );

  return page;
}

// Keep old function for backward compatibility
async function launchBrowser(accountName = "") {
  return launchSharedBrowser();
}

function attachPageDebug(page, prefix = "", account = {}) {
  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error" || type === "warning") {
      writeErrorLog("Browser console message", {
        account: account.name || account.uuid || "",
        type,
        text: msg.text(),
      });
    }
  });

  page.on("pageerror", (err) => {
    const message = err?.message || String(err);
    log(`⚠️ Page error: ${message}`, prefix);
    writeErrorLog("Page error", {
      account: account.name || account.uuid || "",
      error: message,
    });
  });

  page.on("requestfailed", (request) => {
    const failure = request.failure();
    writeErrorLog("Request failed", {
      account: account.name || account.uuid || "",
      url: request.url(),
      method: request.method(),
      error: failure?.errorText || "unknown",
    });
  });
}

// ============ HELPERS ============
function buildStepError(step, selector, error) {
  return new Error(
    `[${step}] ${selector ? `Selector: ${selector} | ` : ""}${error?.message || error}`,
  );
}

function logAndThrow(step, prefix, selector, error, extra = {}) {
  const finalError = buildStepError(step, selector, error);
  log(`❌ ${finalError.message}`, prefix);
  writeErrorLog("Action failed", {
    step,
    selector,
    error: finalError.message,
    ...extra,
  });
  throw finalError;
}

async function gotoSafe(page, url, prefix = "", label = "goto", account = {}) {
  try {
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: CONFIG.NAVIGATION_TIMEOUT,
    });
  } catch (e) {
    logAndThrow(label, prefix, url, e, {
      account: account.name || account.uuid || "",
    });
  }
}

async function waitForSelectorSafe(
  page,
  selector,
  timeout,
  step,
  prefix,
  account = {},
) {
  try {
    return await page.waitForSelector(selector, {
      timeout,
      visible: true,
    });
  } catch (e) {
    logAndThrow(step, prefix, selector, e, {
      account: account.name || account.uuid || "",
    });
  }
}

async function elementExists(page, selector) {
  try {
    return (await page.$(selector)) != null;
  } catch {
    return false;
  }
}

async function isElementClickable(page, selector) {
  const handle = await page.$(selector);
  if (!handle) return false;

  return await page.evaluate((el) => {
    if (!el) return false;

    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    const hidden =
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0" ||
      rect.width === 0 ||
      rect.height === 0;

    const disabled =
      el.disabled ||
      el.classList.contains("disabled") ||
      el.getAttribute("disabled") !== null ||
      el.getAttribute("aria-disabled") === "true";

    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const topEl = document.elementFromPoint(x, y);
    const covered = topEl && topEl !== el && !el.contains(topEl);

    return !hidden && !disabled && !covered;
  }, handle);
}

async function safeClick(
  page,
  selector,
  prefix = "",
  label = selector,
  account = {},
) {
  try {
    await waitForSelectorSafe(
      page,
      selector,
      5000,
      `waitForSelector:${label}`,
      prefix,
      account,
    );

    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) {
        el.scrollIntoView({
          behavior: "instant",
          block: "center",
          inline: "center",
        });
      }
    }, selector);

    await sleep(CONFIG.ACTION_DELAY);

    const clickable = await isElementClickable(page, selector);
    const handle = await page.$(selector);

    if (!handle) {
      throw new Error(`Element missing before click: ${label}`);
    }

    if (clickable) {
      try {
        await handle.click({ delay: 50 });
        return true;
      } catch {}
    }

    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) el.click();
    }, selector);

    await sleep(CONFIG.ACTION_DELAY);
    return true;
  } catch (e) {
    logAndThrow(`safeClick:${label}`, prefix, selector, e, {
      account: account.name || account.uuid || "",
    });
  }
}

async function safeClickHandle(
  page,
  handle,
  prefix = "",
  label = "element",
  account = {},
) {
  try {
    if (!handle) {
      throw new Error(`Missing handle: ${label}`);
    }

    await handle.evaluate((el) => {
      el.scrollIntoView({
        behavior: "instant",
        block: "center",
        inline: "center",
      });
    });

    await sleep(200);

    try {
      await handle.click({ delay: 50 });
      return true;
    } catch {}

    await handle.evaluate((el) => el.click());
    await sleep(200);
    return true;
  } catch (e) {
    logAndThrow(`safeClickHandle:${label}`, prefix, "", e, {
      account: account.name || account.uuid || "",
    });
  }
}

// ============ MODAL / POPUP ============
async function closePromoPopup(page, account = {}) {
  try {
    const selectors = [
      ".modal-container .pop-content .close",
      ".modal .pop-content .close",
      ".pop-content .close",
    ];

    for (const selector of selectors) {
      if (await elementExists(page, selector)) {
        try {
          await safeClick(page, selector, "", selector, account);
          log("   ✅ Closed promo popup");
          await sleep(500);
        } catch {}
      }
    }
  } catch {}
}

async function closeAnyModal(page, account = {}) {
  let closed = 0;

  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      let found = false;

      const selectors = [
        ".next-time",
        ".modal .pop-content .close",
        ".modal-container .pop-content .close",
        ".base-dialog__modal .close-icon",
        ".close-icon",
        ".modal-close",
        ".icon-close",
      ];

      for (const selector of selectors) {
        const items = await page.$$(selector);
        for (const item of items) {
          try {
            await safeClickHandle(page, item, "", selector, account);
            found = true;
            closed++;
            await sleep(300);
          } catch {}
        }
      }

      if (!found) break;
    }

    try {
      await page.keyboard.press("Escape");
      await sleep(150);
    } catch {}
  } catch {}

  return closed;
}

// Check if system error modal appears after login
async function checkSystemErrorModal(page, account = {}) {
  try {
    const errorText =
      "System error, please try again later or contact support.";

    // Check in modal content
    const hasError = await page.evaluate((searchText) => {
      // Check visible modals
      const modals = document.querySelectorAll(
        '.modal-container, .modal, [role="dialog"]',
      );
      for (const modal of modals) {
        const text = (modal.innerText || modal.textContent || "").trim();
        if (text.includes(searchText)) {
          return true;
        }
      }

      // Also check page body for error messages
      const bodyText =
        document.body.innerText || document.body.textContent || "";
      if (bodyText.includes(searchText)) {
        return true;
      }

      return false;
    }, errorText);

    if (hasError) {
      log(
        "⚠️ System error modal detected - account not supported",
        `[${account.name || account.uuid}] `,
      );
      return true;
    }

    return false;
  } catch (error) {
    writeErrorLog("checkSystemErrorModal failed", {
      account: account.name || account.uuid || "",
      error: error.message,
    });
    return false;
  }
}

async function handleClaimResultModal(page, prefix = "", account = {}) {
  let confirmed = false;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await sleep(500);

      const hasResultModal = await page.evaluate(() => {
        const root = document.querySelector(".result-container");
        if (!root) return false;
        const text = (root.innerText || "").trim();
        return text.length > 0;
      });

      if (!hasResultModal) {
        if (attempt === 0) return false;
        break;
      }

      const confirmClicked = await page.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll(
            ".result-container button, .result-container .button button",
          ),
        );

        const target = buttons.find((btn) => {
          const text = (btn.innerText || btn.textContent || "")
            .trim()
            .toLowerCase();
          return text === "confirm" || text.includes("confirm");
        });

        if (target) {
          target.click();
          return true;
        }

        return false;
      });

      if (confirmClicked) {
        confirmed = true;
        log("✅ Modal confirm detected and clicked", prefix);
        await sleep(1000);
      } else {
        const fallback = await page.$(".result-container .action button");
        if (fallback) {
          await safeClickHandle(
            page,
            fallback,
            prefix,
            "result confirm fallback",
            account,
          );
          confirmed = true;
          log("✅ Modal confirm fallback clicked", prefix);
          await sleep(1000);
        } else {
          break;
        }
      }

      await closeAnyModal(page, account);
      await sleep(300);
    } catch (e) {
      writeErrorLog("handleClaimResultModal error", {
        account: account.name || account.uuid || "",
        error: e.message,
      });
      log(`⚠️ handleClaimResultModal error: ${e.message}`, prefix);
    }
  }

  return confirmed;
}

// ============ STORAGE ============
async function clearStorage(page, account = {}) {
  try {
    await page.evaluate(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {}
    });

    const cookies = await page.cookies();
    if (cookies.length) {
      await page.deleteCookie(...cookies);
    }

    log("   ✅ Storage cleared");
  } catch (e) {
    writeErrorLog("clearStorage failed", {
      account: account.name || account.uuid || "",
      error: e.message,
    });
    log(`   ⚠️ Could not clear storage: ${e.message}`);
  }
}

// ============ LOGIN ============
async function isLoggedIn(page) {
  try {
    const hasUserIcon = await page.$(".userIcon");
    if (!hasUserIcon) return true;

    const isLoginModalVisible = await page.evaluate(() => {
      const modal = document.querySelector(".modal-container");
      if (!modal) return false;
      const style = window.getComputedStyle(modal);
      return style.display !== "none" && style.visibility !== "hidden";
    });

    return !isLoginModalVisible;
  } catch {
    return false;
  }
}

async function doLogin(page, account, prefix) {
  const { uuid, password } = account;

  log("🔐 Logging in...", prefix);

  await safeClick(page, ".userIcon", prefix, ".userIcon", account);

  await waitForSelectorSafe(
    page,
    ".modal-container",
    CONFIG.SELECTOR_TIMEOUT,
    "wait login modal",
    prefix,
    account,
  );

  await sleep(1000);

  const uidInput = await waitForSelectorSafe(
    page,
    'input[autocomplete="username"]',
    CONFIG.SELECTOR_TIMEOUT,
    "wait username input",
    prefix,
    account,
  );

  await uidInput.focus();
  await uidInput.click({ clickCount: 3 });
  await uidInput.type(uuid, { delay: 30 });
  log(`   UUID: ${uuid.slice(0, 10)}...`, prefix);

  await uidInput.press("Tab");
  await sleep(1200);

  let passwordFilled = false;

  const passInput1 = await page.$('input[type="password"]');
  if (passInput1 && password) {
    await passInput1.focus();
    await passInput1.click({ clickCount: 3 });
    await passInput1.type(password, { delay: 30 });
    passwordFilled = true;
    log("   Password entered", prefix);
  }

  const checkboxes = await page.$$('input[type="checkbox"]');
  for (const box of checkboxes) {
    try {
      const checked = await box.evaluate((el) => el.checked);
      if (!checked) {
        await box.click();
        await sleep(300);
      }
    } catch (e) {
      writeErrorLog("Checkbox click failed", {
        account: account.name || account.uuid || "",
        error: e.message,
      });
    }
  }

  await sleep(1200);

  const passInput2 = await page.$('input[type="password"]');
  if (passInput2) {
    const hasValue = await passInput2.evaluate(
      (el) => (el.value || "").length > 0,
    );
    if (!hasValue && password && !passwordFilled) {
      await passInput2.focus();
      await passInput2.click({ clickCount: 3 });
      await passInput2.type(password, { delay: 30 });
    }
  }

  const submitBtn = await page.$('button[data-action="submit"]');
  if (!submitBtn) {
    throw new Error("Submit login button not found");
  }

  await safeClickHandle(page, submitBtn, prefix, "submit login", account);
  await sleep(CONFIG.LOGIN_WAIT_AFTER_SUBMIT);

  // Check for system error modal
  const hasSystemError = await checkSystemErrorModal(page, account);
  if (hasSystemError) {
    markAccountNotSupported(account.uuid, account.name || uuid);
    throw new Error(
      "ACCOUNT_NOT_SUPPORTED: System error - account not supported",
    );
  }

  await closeAnyModal(page, account);
  await closePromoPopup(page, account);

  log("   ✅ Login complete", prefix);
}

// ============ CLAIM ============
async function claimAllButtons(
  page,
  prefix,
  account = {},
  scopeSelector = null,
) {
  let totalClaimed = 0;

  for (let round = 1; round <= CONFIG.MAX_CLAIM_ROUNDS; round++) {
    await closeAnyModal(page, account);
    await sleep(300);

    const buttons = await page.$$(
      scopeSelector ? `${scopeSelector} .btn.can` : ".btn.can",
    );

    if (!buttons.length) {
      if (round === 1) {
        log("ℹ️ No .btn.can found", prefix);
      }
      break;
    }

    let clickedThisRound = false;

    for (let i = 0; i < buttons.length; i++) {
      try {
        const btn = buttons[i];

        const info = await btn.evaluate((el) => {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return {
            text: (el.innerText || el.textContent || "").trim(),
            disabled:
              el.disabled ||
              el.classList.contains("disabled") ||
              el.getAttribute("disabled") !== null ||
              el.getAttribute("aria-disabled") === "true",
            visible:
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              style.opacity !== "0" &&
              rect.width > 0 &&
              rect.height > 0,
          };
        });

        if (!info.visible) continue;

        if (info.disabled) {
          log(
            `ℹ️ Skip disabled .btn.can ${i + 1} (${info.text || "no-text"})`,
            prefix,
          );
          continue;
        }

        await safeClickHandle(page, btn, prefix, `.btn.can #${i + 1}`, account);

        totalClaimed++;
        clickedThisRound = true;
        log(
          `✅ Claimed .btn.can ${totalClaimed} ${info.text ? `(${info.text})` : ""}`,
          prefix,
        );

        await sleep(1000);
        await handleClaimResultModal(page, prefix, account);
        await closeAnyModal(page, account);
        await sleep(500);

        break;
      } catch (e) {
        writeErrorLog("Claim button failed", {
          account: account.name || account.uuid || "",
          error: e.message,
          buttonIndex: i + 1,
        });
        log(`⚠️ Failed .btn.can #${i + 1}: ${e.message}`, prefix);
      }
    }

    if (!clickedThisRound) break;
  }

  return totalClaimed;
}

async function claimImmediateRewards(page, prefix, account) {
  log("🎁 Checking immediate rewards (.btn.can)...", prefix);
  const claimed = await claimAllButtons(page, prefix, account);
  if (claimed > 0) {
    log(`✅ Total immediate claimed: ${claimed}`, prefix);
  }
}

// ============ TASKS ============
const TASKS = {
  task1_order: async (page, account, prefix) => {
    log("📋 Task 1: Visit /order", prefix);
    await gotoSafe(
      page,
      `${CONFIG.BASE_URL}/#/order`,
      prefix,
      "goto /order",
      account,
    );
    await sleep(3000);
    await closeAnyModal(page, account);
    await closePromoPopup(page, account);
    log("   ✅ Complete", prefix);
    return true;
  },

  task2_vip: async (page, account, prefix) => {
    log("📋 Task 2: Visit /vip", prefix);
    await gotoSafe(
      page,
      `${CONFIG.BASE_URL}/#/vip`,
      prefix,
      "goto /vip",
      account,
    );
    await sleep(3000);
    await closeAnyModal(page, account);
    await closePromoPopup(page, account);

    const claimable = await page.$(".claimable");
    if (claimable) {
      await safeClickHandle(page, claimable, prefix, ".claimable", account);
      log("   ✅ Clicked claimable", prefix);
      await sleep(1000);
      await handleClaimResultModal(page, prefix, account);
      await closeAnyModal(page, account);
    } else {
      const noclaimable = await page.$(".noclaimable");
      if (noclaimable) {
        log("   ℹ️ Found noclaimable, skipping", prefix);
      } else {
        writeErrorLog("VIP task: no claimable or noclaimable found", {
          account: account.name || account.uuid || "",
        });
        log("   ℹ️ No claimable/noclaimable found", prefix);
      }
    }

    log("   ✅ Complete", prefix);
    return true;
  },

  task3_pointCenter: async (page, account, prefix) => {
    log("📋 Task 3: Visit /pointCenter", prefix);
    await gotoSafe(
      page,
      `${CONFIG.BASE_URL}/#/pointCenter`,
      prefix,
      "goto /pointCenter",
      account,
    );
    await sleep(3000);
    await closeAnyModal(page, account);
    await closePromoPopup(page, account);

    const claimable = await page.$(".claimable");
    if (claimable) {
      await safeClickHandle(page, claimable, prefix, ".claimable", account);
      log("   ✅ Clicked claimable", prefix);
      await sleep(1000);
      await handleClaimResultModal(page, prefix, account);
      await closeAnyModal(page, account);
    } else {
      const noclaimable = await page.$(".noclaimable");
      if (noclaimable) {
        log("   ℹ️ Found noclaimable, skipping", prefix);
      } else {
        writeErrorLog("PointCenter task: no claimable or noclaimable found", {
          account: account.name || account.uuid || "",
        });
        log("   ℹ️ No claimable/noclaimable found", prefix);
      }
    }

    log("   ✅ Complete", prefix);
    return true;
  },

  task4_claim: async (page, account, prefix) => {
    log("📋 Task 4: Claim boxTool rewards", prefix);

    await gotoSafe(
      page,
      `${CONFIG.BASE_URL}/#/order`,
      prefix,
      "goto /order for boxTool",
      account,
    );
    await sleep(3000);
    await closeAnyModal(page, account);

    const boxTool = await page.$(".boxTool");
    if (!boxTool) {
      throw new Error("boxTool not found");
    }

    await safeClickHandle(page, boxTool, prefix, ".boxTool", account);
    log("   Opened boxTool", prefix);
    await sleep(2000);

    const claimed = await claimAllButtons(page, prefix, account);
    log(`   ✅ boxTool claimed total: ${claimed}`, prefix);

    log("   ✅ Complete", prefix);
    return true;
  },
};

// ============ RUN ACCOUNT ============
async function runAccount(page, account, index) {
  const prefix = `[${account.name || `Acc-${index + 1}`}] `;
  const { uuid } = account;
  const completedTasks = [];

  log(`\n${"=".repeat(50)}`, prefix);
  log(`🚀 Starting account ${index + 1}`, prefix);

  // Skip if account not supported
  if (isNotSupported(uuid)) {
    log(`⏭️ Account marked as NOT SUPPORTED - skipping`, prefix);
    return { skipped: true, reason: "not_supported" };
  }

  if (isDoneToday(uuid)) {
    const stats = getStats(uuid);
    log(
      `⏭️ Already done today! (runs=${stats.totalRuns}, success=${stats.totalSuccess}, failed=${stats.totalFailed})`,
      prefix,
    );
    return { skipped: true, reason: "already_done" };
  }

  markAccountRunStart(uuid, account.name || `Acc-${index + 1}`);

  try {
    log("🌐 Loading...", prefix);
    await gotoSafe(
      page,
      `${CONFIG.BASE_URL}/#/order`,
      prefix,
      "initial goto /order",
      account,
    );
    await sleep(3000);

    await clearStorage(page, account);
    await closeAnyModal(page, account);
    await gotoSafe(
      page,
      `${CONFIG.BASE_URL}/#/order`,
      prefix,
      "reload after clear",
      account,
    );
    await sleep(2000);

    await doLogin(page, account, prefix);

    await closeAnyModal(page, account);
    await claimImmediateRewards(page, prefix, account);

    const taskList = [
      "task1_order",
      "task2_vip",
      "task3_pointCenter",
      "task4_claim",
    ];
    log(`\n🎯 Running ${taskList.length} tasks...`, prefix);

    for (const taskName of taskList) {
      const task = TASKS[taskName];
      if (!task) continue;

      try {
        await task(page, account, prefix);
        completedTasks.push(taskName);
        await sleep(2000);
      } catch (e) {
        writeErrorLog("Task failed", {
          account: account.name || account.uuid || "",
          task: taskName,
          error: e.message,
        });
        throw e;
      }
    }

    markAccountSuccess(
      uuid,
      account.name || `Acc-${index + 1}`,
      completedTasks,
    );

    const stats = getStats(uuid);
    log(
      `\n📊 Stats: runs=${stats.totalRuns} | success=${stats.totalSuccess} | failed=${stats.totalFailed} | days=${stats.daysCount}`,
      prefix,
    );
    log("✅ All done!", prefix);

    return { success: true, tasks: completedTasks };
  } catch (e) {
    markAccountFailed(
      uuid,
      account.name || `Acc-${index + 1}`,
      e.message,
      completedTasks,
    );
    writeErrorLog("Account failed", {
      account: account.name || account.uuid || "",
      error: e.message,
      tasksCompleted: completedTasks,
    });

    log(`❌ Account failed: ${e.message}`, prefix);
    return { success: false, tasks: completedTasks, error: e.message };
  }
}

// ============ CONNECT MODE ============
async function runConnectMode() {
  const accountArg = getCliAccountName();
  const account = findAccountForConnect(accountArg);
  const prefix = `[${account.name || account.uuid}] `;

  log("=".repeat(60));
  log("🔗 CONNECT MODE - Manual Login");
  log("=".repeat(60));
  log(`👤 Account: ${account.name || account.uuid}`);
  log(`🌐 Chrome path: ${CONFIG.BROWSER_EXECUTABLE_PATH}`);
  log(`⏳ Hold time: ${CONFIG.CONNECT_HOLD_MINUTES} minute(s)`);

  let browser = null;

  try {
    browser = await launchBrowser(account.name || account.uuid);
    const page = await browser.newPage();
    attachPageDebug(page, prefix, account);

    await gotoSafe(
      page,
      `${CONFIG.BASE_URL}/#/order`,
      prefix,
      "connect goto /order",
      account,
    );
    await sleep(2000);
    await closeAnyModal(page, account);
    await closePromoPopup(page, account);

    markAccountConnect(account.uuid, account.name || account.uuid);

    log("✅ Chrome is ready for manual login", prefix);
    log(
      "📝 You can now login manually. Session will be saved to this account profile.",
      prefix,
    );
    log(
      `⏳ Browser will stay open for ${CONFIG.CONNECT_HOLD_MINUTES} minutes...`,
      prefix,
    );

    await sleep(CONFIG.CONNECT_HOLD_MINUTES * 60 * 1000);

    log("⌛ Connect time ended. Closing browser...", prefix);
  } catch (e) {
    writeErrorLog("Connect mode failed", {
      account: account.name || account.uuid || "",
      error: e.message,
    });
    log(`❌ Connect mode failed: ${e.message}`, prefix);
    process.exitCode = 1;
  } finally {
    try {
      if (browser) {
        await browser.close();
        log("🧹 Browser closed", prefix);
      }
    } catch (e) {
      writeErrorLog("Failed to close browser in connect mode", {
        account: account.name || account.uuid || "",
        error: e.message,
      });
    }
  }
}

// ============ MODES ============
async function runSingle() {
  if (!CONFIG.UUID) {
    log("❌ Error: No UUID in .env");
    process.exit(1);
  }

  const options = getRuntimeOptions();
  const account = {
    uuid: CONFIG.UUID,
    password: CONFIG.PASSWORD,
    name: "SingleAccount",
  };

  log("🔄 Mode: Single Account");

  const browser = await launchBrowser(account.name);
  const page = await browser.newPage();
  attachPageDebug(page, "[SingleAccount] ", account);

  const result = await runAccount(page, account, 0);

  if (options.keepOpen) {
    log("\n✅ Complete! Press Ctrl+C to exit.");
    await new Promise(() => {});
  } else {
    await browser.close();
  }

  return result;
}

async function runMulti() {
  const accounts = loadAccounts();
  const enabled = accounts.filter((a) => a.enabled && a.uuid);

  log(`🔄 Mode: Multi Account (${enabled.length} accounts) - SHARED BROWSER`);

  const progress = loadProgress();
  const today = todayStr();
  const doneToday = enabled.filter(
    (a) => progress.accounts[a.uuid]?.days?.[today]?.status === "success",
  ).length;

  log(`📊 Progress: ${doneToday}/${enabled.length} success today`);

  let completed = 0;
  let failed = 0;
  let skipped = 0;
  const failedAccounts = [];

  // Launch shared browser once
  let sharedBrowser = null;
  try {
    sharedBrowser = await launchSharedBrowser();

    for (let i = 0; i < enabled.length; i++) {
      const acc = enabled[i];
      let page = null;

      try {
        // Create new page/tab for each account
        page = await createAccountPage();
        log(`📄 Created new page for ${acc.name || `Acc-${i + 1}`}`);

        const prefix = `[${acc.name || `Acc-${i + 1}`}] `;
        attachPageDebug(page, prefix, acc);

        const result = await runAccount(page, acc, i);

        if (result.skipped) skipped++;
        else if (result.success) completed++;
        else failed++;
      } catch (e) {
        failed++;
        markAccountFailed(acc.uuid, acc.name || `Acc-${i + 1}`, e.message, []);
        writeErrorLog("runMulti page/account failure", {
          account: acc.name || acc.uuid || "",
          error: e.message,
        });
        log(`❌ Failed: ${e.message}`, `[${acc.name || `Acc-${i + 1}`}] `);
        if (e.message && e.message.includes("Page error")) {
          failedAccounts.push(acc);
          log(`⚠️ Will retry ${acc.name || acc.uuid} later`);
        }
      } finally {
        // Close page but keep browser open
        if (page) {
          await page.close().catch(() => {});
          log(`📄 Closed page for ${acc.name || `Acc-${i + 1}`}`);
        }

        if (i < enabled.length - 1) {
          log("⏳ Waiting 3s before next...");
          await sleep(CONFIG.BETWEEN_ACCOUNTS_DELAY);
        }
      }
    }

    // Retry failed accounts
    if (failedAccounts.length > 0) {
      const retryResult = await retryFailedAccounts(
        failedAccounts,
        sharedBrowser,
      );
      completed += retryResult.completed;
      failed -= retryResult.completed;
      log(
        `\n🔄 Retry complete: ${retryResult.completed} succeeded, ${retryResult.failed} still failed`,
      );
    }
  } finally {
    // Close shared browser at the end
    await closeSharedBrowser();
  }

  log(`\n${"=".repeat(60)}`);
  log(
    `✅ Summary: ${completed} completed, ${failed} failed, ${skipped} skipped`,
  );
  log(`📊 Progress saved to: ${CONFIG.PROGRESS_FILE}`);
  log(`📝 Error log saved to: ${CONFIG.ERROR_LOG_FILE}`);
  log(`${"=".repeat(60)}`);
}

// ============ MAIN ============
async function main() {
  const mode = getCliMode();
  const options = getRuntimeOptions();

  log("=".repeat(60));
  log("🤖 AUTO DARKWAR - Ubuntu/Debian Chrome");
  log("=".repeat(60));
  log(`🌐 Chrome path: ${options.executablePath}`);
  log(`📂 Chrome data: ${CONFIG.CHROME_DATA_DIR}`);
  log(`📊 Progress: ${CONFIG.PROGRESS_FILE}`);
  log(`📝 Error log: ${CONFIG.ERROR_LOG_FILE}`);
  log(`👥 Multi account: ${options.multi ? "ON" : "OFF"}`);
  log(`📱 Mobile viewport: ${options.mobile ? "ON" : "OFF"}`);
  log(`🖥️ Headless: ${options.headless ? "ON" : "OFF"}`);
  log(`🧭 Mode: ${mode}`);

  if (mode === "connect") {
    await runConnectMode();
    return;
  }

  if (options.multi) {
    await runMulti();
  } else {
    await runSingle();
  }
}

main().catch((e) => {
  writeErrorLog("Fatal main error", { error: e.message });
  log(`❌ Error: ${e.message}`);
  process.exit(1);
});

// Retry failed accounts function
async function retryFailedAccounts(failedAccounts, sharedBrowser) {
  if (failedAccounts.length === 0) return { completed: 0, failed: 0 };

  log(`\n🔄 Retrying ${failedAccounts.length} failed accounts...`);
  let completed = 0;
  let stillFailed = 0;

  for (let i = 0; i < failedAccounts.length; i++) {
    const acc = failedAccounts[i];
    let page = null;

    try {
      page = await sharedBrowser.newPage();
      log(`📄 Retry page created for ${acc.name || acc.uuid}`);

      const result = await runAccount(page, acc, i, true);

      if (result.success) {
        completed++;
        log(`✅ Retry successful for ${acc.name || acc.uuid}`);
      } else {
        stillFailed++;
        log(`❌ Retry failed for ${acc.name || acc.uuid}`);
      }
    } catch (e) {
      stillFailed++;
      writeDailyErrorLog("Retry error", {
        error: e.message,
        account: acc.name || acc.uuid,
      });
      log(`❌ Retry exception: ${e.message}`);
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
      await sleep(3000);
    }
  }

  return { completed, failed: stillFailed };
}
