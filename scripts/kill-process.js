/**
 * Kill Process Script
 * 
 * This script helps kill any running instances of the app before building
 * to avoid the "file is being used by another process" error.
 */

const { exec } = require('child_process');
const path = require('path');

// Get the app name from package.json
const packageJson = require('../package.json');
const appName = packageJson.build.productName || 'codex.md';

console.log(`Attempting to kill any running instances of ${appName}...`);

// Command to find and kill the process
const command = process.platform === 'win32'
  ? `taskkill /F /IM "${appName}.exe" /T`
  : `pkill -f "${appName}"`;

exec(command, (error, stdout, stderr) => {
  if (error) {
    // Error code 128 means no processes found, which is fine
    if (error.code === 128 || (process.platform === 'win32' && error.code === 1)) {
      console.log(`No running instances of ${appName} found.`);
    } else {
      console.error(`Error killing process: ${error.message}`);
    }
    return;
  }
  
  if (stdout) {
    console.log(`Process output: ${stdout}`);
  }
  
  if (stderr) {
    console.error(`Process error: ${stderr}`);
  }
  
  console.log(`Successfully terminated any running instances of ${appName}.`);
});

// Also try to clean up the dist directory
const fs = require('fs-extra');
const distPath = path.join(__dirname, '..', 'dist');

try {
  if (fs.existsSync(distPath)) {
    console.log('Cleaning up dist directory...');
    fs.removeSync(path.join(distPath, 'win-unpacked', 'resources', 'app.asar'));
    console.log('Removed app.asar file');
  }
} catch (error) {
  console.error(`Error cleaning dist directory: ${error.message}`);
}
