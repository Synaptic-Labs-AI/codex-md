/**
 * Run the Electron app with console output redirected to a log file
 * This script helps capture console output when the app is running
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Create log file with timestamp
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const logFile = path.join(logsDir, `app-run-${timestamp}.log`);
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

// Log header
logStream.write(`=== Codex MD Application Run Log ===\n`);
logStream.write(`Started: ${new Date().toLocaleString()}\n`);
logStream.write(`================================\n\n`);

console.log(`Logging output to: ${logFile}`);

// Run the app from the dist directory
const appPath = path.join(__dirname, '..', 'dist', 'win-unpacked', 'codex.md.exe');
const args = ['--trace-warnings', '--verbose'];

console.log(`Starting app: ${appPath} ${args.join(' ')}`);
logStream.write(`Starting app: ${appPath} ${args.join(' ')}\n`);

// Spawn the process
const child = spawn(appPath, args, {
    stdio: ['ignore', 'pipe', 'pipe']
});

// Pipe stdout and stderr to both console and log file
child.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(output);
    logStream.write(`[STDOUT] ${output}`);
});

child.stderr.on('data', (data) => {
    const output = data.toString();
    console.error(output);
    logStream.write(`[STDERR] ${output}`);
});

// Handle process exit
child.on('exit', (code, signal) => {
    const exitMessage = `Process exited with code ${code} and signal ${signal}\n`;
    console.log(exitMessage);
    logStream.write(exitMessage);
    logStream.end();
});

// Handle errors
child.on('error', (error) => {
    const errorMessage = `Error starting process: ${error.message}\n`;
    console.error(errorMessage);
    logStream.write(errorMessage);
    logStream.end();
});

// Handle CTRL+C to gracefully close the log file
process.on('SIGINT', () => {
    logStream.write('Process terminated by user\n');
    logStream.end();
    process.exit();
});
