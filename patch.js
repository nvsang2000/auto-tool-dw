// Patch script - add daily logs and retry logic
const fs = require('fs');
const path = require('path');

let content = fs.readFileSync('/home/nvsang/server/auto-tool/auto.js', 'utf8');

// 1. Add daily log functions after log()
const dailyLogs = `
function getTodayLogDir() {
  const today = todayStr();
  const logDir = path.join(CONFIG.LOGS_DIR, today);
  ensureDirExists(logDir);
  return logDir;
}

function getDailyCronLogFile() {
  return path.join(getTodayLogDir(), 'cron.log');
}

function getDailyErrorLogFile() {
  return path.join(getTodayLogDir(), 'error.log');
}

function writeDailyErrorLog(message, context = {}) {
  const logFile = getDailyErrorLogFile();
  appendFileLine(logFile, JSON.stringify({ time: nowIso(), message, ...context }));
}
`;

content = content.replace(
  'function log(msg, prefix = "") {',
  dailyLogs + '\nfunction log(msg, prefix = "") {'
);

// 2. Add to writeErrorLog
content = content.replace(
  'function writeErrorLog(message, context = {}) {',
  'function writeErrorLog(message, context = {}) {\n  writeDailyErrorLog(message, context);'
);

// 3. Add retry logic in catch block of runMulti
content = content.replace(
  'log(`❌ Failed: ${e.message}`, `[${acc.name || `Acc-${i + 1}`}] `);',
  'log(`❌ Failed: ${e.message}`, `[${acc.name || `Acc-${i + 1}`}] `);\n        if (e.message && e.message.includes("Page error")) { failedAccounts.push(acc); log(`⚠️ Will retry ${acc.name || acc.uuid} later`); }'
);

// 4. Add failedAccounts array
content = content.replace(
  'let completed = 0;\n  let failed = 0;\n  let skipped = 0;',
  'let completed = 0;\n  let failed = 0;\n  let skipped = 0;\n  const failedAccounts = [];'
);

fs.writeFileSync('/home/nvsang/server/auto-tool/auto.js', content);
console.log('Patched!');
