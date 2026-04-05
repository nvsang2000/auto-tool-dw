#!/usr/bin/env node
/**
 * Backup browser data for GitHub upload
 * Usage: node scripts/backup-data.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DATA_DIR = path.resolve(__dirname, '../chrome-data');
const BACKUP_DIR = path.resolve(__dirname, '../browser-backup');

function createBackup() {
  console.log('📦 Creating browser data backup...\n');
  
  // Create backup directory
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  
  // Clean old backup
  const files = fs.readdirSync(BACKUP_DIR);
  for (const file of files) {
    fs.rmSync(path.join(BACKUP_DIR, file), { recursive: true, force: true });
  }
  
  // Copy essential files (exclude large cache files)
  if (fs.existsSync(DATA_DIR)) {
    const essentialFiles = [
      'Preferences',
      'Local State',
      'Secure Preferences',
      'Network Persistent State',
      'TransportSecurity',
      'Login Data',
      'Cookies',
      'Local Storage',
      'IndexedDB',
      'Session Storage',
      'Sessions'
    ];
    
    for (const file of essentialFiles) {
      const srcPath = path.join(DATA_DIR, file);
      const destPath = path.join(BACKUP_DIR, file);
      
      if (fs.existsSync(srcPath)) {
        if (fs.statSync(srcPath).isDirectory()) {
          copyDir(srcPath, destPath);
          console.log(`✅ Copied: ${file}/`);
        } else {
          fs.copyFileSync(srcPath, destPath);
          console.log(`✅ Copied: ${file}`);
        }
      }
    }
    
    // Create zip
    const zipName = `browser-data-${Date.now()}.zip`;
    const zipPath = path.resolve(__dirname, '..', zipName);
    
    try {
      execSync(`cd "${BACKUP_DIR}" && zip -r "${zipPath}" .`, { stdio: 'inherit' });
      console.log(`\n✅ Backup created: ${zipName}`);
      console.log(`📊 Size: ${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(2)} MB`);
    } catch (e) {
      console.log('⚠️ Could not create zip. Make sure zip is installed.');
    }
    
  } else {
    console.log('❌ No chrome-data found');
  }
}

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    // Skip large files (>10MB)
    if (!entry.isDirectory()) {
      try {
        const stats = fs.statSync(srcPath);
        if (stats.size > 10 * 1024 * 1024) {
          console.log(`   ⚠️ Skipped large file: ${entry.name}`);
          continue;
        }
      } catch (e) {}
    }
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

createBackup();
