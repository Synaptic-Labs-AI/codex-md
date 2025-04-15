/**
 * restart-app.js
 * 
 * A utility script to restart the Codex MD application.
 * This is useful after making changes to core components like converters.
 */

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Get the platform-specific command to kill the process
const getKillCommand = () => {
  switch (os.platform()) {
    case 'win32':
      return 'taskkill /F /IM codex-md.exe';
    case 'darwin':
      return "pkill -f 'Codex MD'";
    default:
      return "pkill -f 'codex-md'";
  }
};

// Get the platform-specific command to start the app
const getStartCommand = () => {
  const appPath = path.resolve(__dirname, '..');
  
  switch (os.platform()) {
    case 'win32':
      return `cd "${appPath}" && npm run start`;
    case 'darwin':
      return `cd "${appPath}" && npm run start`;
    default:
      return `cd "${appPath}" && npm run start`;
  }
};

console.log('🔄 Restarting Codex MD application...');

// First kill the existing process
const killCommand = getKillCommand();
console.log(`Executing: ${killCommand}`);

exec(killCommand, (error) => {
  if (error) {
    console.log('Note: No running instance found or could not be terminated.');
  } else {
    console.log('✅ Existing process terminated.');
  }

  // Wait a moment to ensure the process is fully terminated
  setTimeout(() => {
    // Then start the app again
    const startCommand = getStartCommand();
    console.log(`Starting application with: ${startCommand}`);

    const child = exec(startCommand);
    
    child.stdout.on('data', (data) => {
      console.log(`stdout: ${data}`);
    });
    
    child.stderr.on('data', (data) => {
      console.error(`stderr: ${data}`);
    });
    
    child.on('close', (code) => {
      console.log(`Child process exited with code ${code}`);
    });
    
    console.log('✅ Application restart initiated.');
    console.log('You can close this terminal window once the application has started.');
  }, 2000);
});
