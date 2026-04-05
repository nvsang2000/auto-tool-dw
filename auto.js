#!/usr/bin/env node
/**
 * AUTO DARKWAR - Complete Version with Progress Tracking
 * Flow: Login → Close Modal → Claim (.btn.can) → Tasks → Save Log
 */

const puppeteer = require("puppeteer");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const CONFIG = {
  USER_DATA_DIR: path.resolve(__dirname, "./chrome-data"),
  ACCOUNTS_FILE: path.resolve(__dirname, "./config/accounts.json"),
  PROGRESS_FILE: path.resolve(__dirname, "./data/progress.json"),
  BASE_URL: "https://pay.darkwar-survival.com",
  UUID: process.env.UUID || "",
  PASSWORD: process.env.PASSWORD || "",
};

const VIEWPORT = {
  desktop: { width: 1400, height: 900 },
  mobile: { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (msg, prefix = "") => console.log(`[${new Date().toLocaleTimeString()}] ${prefix}${msg}`);
const hasArg = (f) => process.argv.includes(f);

// ============ PROGRESS TRACKING ============
function loadProgress() {
  if (fs.existsSync(CONFIG.PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(CONFIG.PROGRESS_FILE, "utf8"));
  }
  return { accounts: {} };
}

function saveProgress(data) {
  fs.writeFileSync(CONFIG.PROGRESS_FILE, JSON.stringify(data, null, 2));
}

function updateProgress(uuid, accountName, tasks) {
  const data = loadProgress();
  const today = new Date().toISOString().split('T')[0];
  
  if (!data.accounts[uuid]) {
    data.accounts[uuid] = {
      name: accountName || uuid,
      totalRuns: 0,
      days: {},
      lastRun: null
    };
  }
  
  const acc = data.accounts[uuid];
  acc.totalRuns++;
  acc.lastRun = new Date().toISOString();
  
  if (!acc.days[today]) {
    acc.days[today] = { tasks: [], completedAt: null };
  }
  
  acc.days[today].tasks.push(...tasks);
  acc.days[today].completedAt = new Date().toISOString();
  
  saveProgress(data);
  log(`💾 Progress saved: ${acc.totalRuns} total runs`, `[${accountName || uuid}] `);
}

function isDoneToday(uuid) {
  const data = loadProgress();
  const today = new Date().toISOString().split('T')[0];
  return data.accounts[uuid]?.days?.[today]?.completedAt != null;
}

function getStats(uuid) {
  const data = loadProgress();
  const acc = data.accounts[uuid];
  if (!acc) return { totalRuns: 0, daysCount: 0 };
  
  const daysCount = Object.keys(acc.days).length;
  const monthlyCount = Object.keys(acc.days).filter(d => {
    const day = new Date(d);
    const monthAgo = new Date();
    monthAgo.setDate(monthAgo.getDate() - 30);
    return day >= monthAgo;
  }).length;
  
  return { totalRuns: acc.totalRuns, daysCount, monthlyCount };
}

// ============ BROWSER ============
async function launchBrowser() {
  const vp = hasArg('--mobile') ? VIEWPORT.mobile : VIEWPORT.desktop;
  
  const browser = await puppeteer.launch({
    headless: false,
    devtools: true,
    userDataDir: CONFIG.USER_DATA_DIR,
    args: [
      `--window-size=${vp.width},${vp.height + 100}`,
      '--disable-blink-features=AutomationControlled'
    ],
    slowMo: 50,
  });
  
  return browser;
}

// ============ UTILS ============
async function closePromoPopup(page) {
  try {
    const popupClose = await page.$('.modal-container .pop-content .close');
    if (popupClose) {
      await popupClose.click();
      log("   ✅ Closed promo popup");
      await sleep(500);
    }
  } catch (e) {}
}

async function closeBaseDialog(page) {
  try {
    await sleep(500);
    const modal = await page.$('.base-dialog__modal');
    if (modal) {
      const closeIcon = await modal.$('.close-icon');
      if (closeIcon) {
        await closeIcon.click();
        log("   ✅ Closed base-dialog modal");
        await sleep(500);
        return true;
      }
    }
  } catch (e) {}
  return false;
}

async function closeAnyModal(page) {
  let closed = 0;
  try {
    // Try multiple times to close all modals
    for (let attempt = 0; attempt < 3; attempt++) {
      let found = false;
      
      // Check for "next-time" button first
      const nextTime = await page.$('.next-time');
      if (nextTime) {
        await nextTime.click();
        log("   ✅ Clicked 'next time'");
        await sleep(500);
        found = true;
        closed++;
        continue;
      }
      
      // Check for promo modal (.modal .close)
      const promoClose = await page.$('.modal .pop-content .close');
      if (promoClose) {
        await promoClose.click();
        log("   ✅ Closed promo modal");
        await sleep(500);
        found = true;
        closed++;
      }
      
      // Check for base-dialog
      const baseDialog = await page.$('.base-dialog__modal');
      if (baseDialog) {
        const closeIcon = await baseDialog.$('.close-icon');
        if (closeIcon) {
          await closeIcon.click();
          log("   ✅ Closed base-dialog");
          await sleep(500);
          found = true;
          closed++;
        }
      }
      
      // Check for other close icons
      const closeIcons = await page.$$('.close-icon, .modal-close, .icon-close');
      for (const icon of closeIcons) {
        try {
          await icon.click();
          log("   ✅ Closed modal");
          await sleep(300);
          found = true;
          closed++;
        } catch (e) {}
      }
      
      if (!found) break; // No more modals found
    }
    
    // Try Escape key as fallback
    await page.keyboard.press('Escape');
    await sleep(200);
    
  } catch (e) {}
  return closed;
}

async function clearStorage(page) {
  try {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.deleteCookie(...await page.cookies());
    log("   ✅ Storage cleared");
  } catch (e) {
    log("   ⚠️ Could not clear storage");
  }
}

// ============ LOGIN ============
async function doLogin(page, account, prefix) {
  const { uuid, password } = account;
  
  log("🔐 Logging in...", prefix);
  
  await page.waitForSelector('.userIcon', { timeout: 10000, visible: true });
  await page.click('.userIcon');
  
  await page.waitForSelector('.modal-container', { visible: true, timeout: 10000 });
  await sleep(1000);
  
  const uidInput = await page.waitForSelector('input[autocomplete="username"]', { visible: true });
  await uidInput.focus();
  await uidInput.click({ clickCount: 3 });
  await uidInput.type(uuid, { delay: 30 });
  log(`   UUID: ${uuid.slice(0, 10)}...`, prefix);
  
  await uidInput.press('Tab');
  await sleep(2000);
  
  let passwordFilled = false;
  const passInput1 = await page.$('input[type="password"]');
  if (passInput1 && password) {
    await passInput1.focus();
    await passInput1.click({ clickCount: 3 });
    await passInput1.type(password, { delay: 30 });
    passwordFilled = true;
    log("   Password entered", prefix);
  }
  
  const boxes = await page.$$('input[type="checkbox"]');
  for (const box of boxes) {
    const checked = await box.evaluate(el => el.checked);
    if (!checked) {
      await box.click();
      await sleep(300);
    }
  }
  
  await sleep(2000);
  const passInput2 = await page.$('input[type="password"]');
  if (passInput2) {
    const hasValue = await passInput2.evaluate(el => el.value?.length > 0);
    if (!hasValue && password && !passwordFilled) {
      await passInput2.focus();
      await passInput2.click({ clickCount: 3 });
      await passInput2.type(password, { delay: 30 });
    }
  }
  
  const btn = await page.$('button[data-action="submit"]');
  if (btn) await btn.click();
  
  await sleep(5000);
  
  // Close any modal after login
  await closeAnyModal(page);
  await closePromoPopup(page);
  
  log("   ✅ Login complete", prefix);
}

// ============ CLAIM REWARDS (Immediate .btn.can) ============
async function claimImmediateRewards(page, prefix) {
  log("🎁 Checking immediate rewards (.btn.can)...", prefix);
  
  const claimBtns = await page.$$('.btn.can');
  log(`   Found ${claimBtns.length} claimable button(s)`, prefix);
  
  for (let i = 0; i < claimBtns.length; i++) {
    try {
      await claimBtns[i].click();
      log(`   ✅ Claimed reward ${i + 1}`, prefix);
      await sleep(800);
      
      // Close any modal that appears after claiming
      await closeAnyModal(page);
    } catch (e) {
      log(`   ⚠️ Failed to claim ${i + 1}`, prefix);
    }
  }
  
  if (claimBtns.length === 0) {
    log("   ℹ️ No immediate rewards", prefix);
  }
}

// ============ TASKS ============
const TASKS = {
  task1_order: async (page, account, prefix) => {
    log("📋 Task 1: Visit /order", prefix);
    await page.goto(`${CONFIG.BASE_URL}/#/order`, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(3000);
    await closeAnyModal(page);
    await closePromoPopup(page);
    log("   ✅ Complete", prefix);
    return true;
  },
  
  task2_vip: async (page, account, prefix) => {
    log("📋 Task 2: Visit /vip", prefix);
    await page.goto(`${CONFIG.BASE_URL}/#/vip`, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(3000);
    await closeAnyModal(page);
    await closePromoPopup(page);
    
    // Check for claimable button
    const claimable = await page.$('.claimable');
    if (claimable) {
      await claimable.click();
      log("   ✅ Clicked claimable", prefix);
      await sleep(1000);
      // Close any modal after claiming
      await closeAnyModal(page);
    } else {
      // Check for noclaimable
      const noclaimable = await page.$('.noclaimable');
      if (noclaimable) {
        log("   ℹ️ Found noclaimable, skipping", prefix);
      } else {
        log("   ℹ️ No claimable/noclaimable found", prefix);
      }
    }
    
    log("   ✅ Complete", prefix);
    return true;
  },
  
  task3_claim: async (page, account, prefix) => {
    log("📋 Task 3: Claim boxTool rewards", prefix);
    
    await page.goto(`${CONFIG.BASE_URL}/#/order`, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(3000);
    await closeAnyModal(page);
    
    const boxTool = await page.$('.boxTool');
    if (boxTool) {
      await boxTool.click();
      log("   Opened boxTool", prefix);
      await sleep(2000);
      
      const claimBtns = await page.$$('.btn.can');
      for (let i = 0; i < claimBtns.length; i++) {
        await claimBtns[i].click();
        log(`   ✅ Claimed ${i + 1}`, prefix);
        await sleep(500);
      }
    } else {
      log("   ⚠️ boxTool not found", prefix);
    }
    
    log("   ✅ Complete", prefix);
    return true;
  }
};

// ============ MAIN RUNNER ============
async function runAccount(page, account, index) {
  const prefix = `[${account.name || `Acc-${index + 1}`}] `;
  const { uuid } = account;
  
  log(`\n${"=".repeat(50)}`, prefix);
  log(`🚀 Starting account ${index + 1}`, prefix);
  
  // Check if already done today
  if (isDoneToday(uuid)) {
    const stats = getStats(uuid);
    log(`⏭️ Already done today! (Total: ${stats.totalRuns} runs, ${stats.monthlyCount}/30 days)`, prefix);
    return { skipped: true, reason: "already_done" };
  }
  
  // Load page and clear
  log("🌐 Loading...", prefix);
  await page.goto(`${CONFIG.BASE_URL}/#/order`, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(3000);
  await clearStorage(page);
  await closeAnyModal(page);
  
  // Check if need login
  const avatar = await page.$('.userIcon');
  if (avatar) {
    await doLogin(page, account, prefix);
  } else {
    log("   Already logged in", prefix);
  }
  
  // Close any modal after login
  await closeAnyModal(page);
  
  // Claim immediate rewards
  await claimImmediateRewards(page, prefix);
  
  // Run tasks
  const taskList = ['task1_order', 'task2_vip', 'task3_claim'];
  const completedTasks = [];
  
  log(`\n🎯 Running ${taskList.length} tasks...`, prefix);
  
  for (const taskName of taskList) {
    try {
      const task = TASKS[taskName];
      if (task) {
        await task(page, account, prefix);
        completedTasks.push(taskName);
        await sleep(2000);
      }
    } catch (e) {
      log(`   ❌ ${taskName} failed: ${e.message}`, prefix);
    }
  }
  
  // Save progress
  updateProgress(uuid, account.name || `Acc-${index + 1}`, completedTasks);
  
  const stats = getStats(uuid);
  log(`\n📊 Stats: ${stats.totalRuns} runs | ${stats.daysCount} days | ${stats.monthlyCount}/30 days`, prefix);
  log(`✅ All done!`, prefix);
  
  return { success: true, tasks: completedTasks };
}

// ============ MODES ============
async function runSingle() {
  if (!CONFIG.UUID) {
    log("❌ Error: No UUID in .env");
    process.exit(1);
  }
  
  log("🔄 Mode: Single Account");
  
  const browser = await launchBrowser();
  const page = (await browser.pages())[0] || await browser.newPage();
  const vp = hasArg('--mobile') ? VIEWPORT.mobile : VIEWPORT.desktop;
  await page.setViewport(vp);
  
  await runAccount(page, { uuid: CONFIG.UUID, password: CONFIG.PASSWORD }, 0);
  
  log("\n✅ Complete! Press Ctrl+C to exit.");
  await new Promise(() => {});
}

async function runMulti() {
  if (!fs.existsSync(CONFIG.ACCOUNTS_FILE)) {
    log("❌ Error: accounts.json not found");
    process.exit(1);
  }
  
  const accounts = JSON.parse(fs.readFileSync(CONFIG.ACCOUNTS_FILE, "utf8"));
  const enabled = accounts.filter(a => a.enabled && a.uuid);
  
  log(`🔄 Mode: Multi Account (${enabled.length} accounts)`);
  
  // Show progress summary
  const progress = loadProgress();
  const today = new Date().toISOString().split('T')[0];
  const doneToday = enabled.filter(a => progress.accounts[a.uuid]?.days?.[today]).length;
  log(`📊 Progress: ${doneToday}/${enabled.length} done today`);
  
  const browser = await launchBrowser();
  const vp = hasArg('--mobile') ? VIEWPORT.mobile : VIEWPORT.desktop;
  
  let completed = 0;
  let skipped = 0;
  
  for (let i = 0; i < enabled.length; i++) {
    const acc = enabled[i];
    
    try {
      // Open new tab for each account (first uses existing)
      const pages = await browser.pages();
      let page;
      if (i === 0 && pages.length > 0) {
        page = pages[0];
      } else {
        page = await browser.newPage();
        log(`🆕 New tab for account ${i + 1}`);
      }
      await page.setViewport(vp);
      
      const result = await runAccount(page, acc, i);
      
      if (result.skipped) {
        skipped++;
      } else {
        completed++;
      }
      
      if (i < enabled.length - 1) {
        log(`⏳ Waiting 3s before next...`);
        await sleep(3000);
      }
    } catch (e) {
      log(`❌ Failed: ${e.message}`, `[${acc.name || `Acc-${i+1}`}] `);
    }
  }
  
  log(`\n${"=".repeat(60)}`);
  log(`✅ Summary: ${completed} completed, ${skipped} skipped`);
  log(`📊 Progress saved to: ${CONFIG.PROGRESS_FILE}`);
  log(`=".repeat(60)}`);
  log(`Press Ctrl+C to exit.`);
  
  await new Promise(() => {});
}

async function main() {
  const mobile = hasArg('--mobile');
  const multi = hasArg('--accounts');
  
  log("=".repeat(60));
  log("🤖 AUTO DARKWAR - Progress Tracking");
  log("=".repeat(60));
  log(`📂 Data: ${CONFIG.USER_DATA_DIR}`);
  log(`📊 Log: ${CONFIG.PROGRESS_FILE}`);
  if (mobile) log("📱 Mobile viewport");
  
  if (multi) {
    await runMulti();
  } else {
    await runSingle();
  }
}

main().catch(e => {
  log(`❌ Error: ${e.message}`);
  process.exit(1);
});
