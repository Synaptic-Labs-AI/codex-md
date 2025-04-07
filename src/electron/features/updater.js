/**
 * Auto Update Feature
 * Handles checking for and applying application updates from GitHub releases
 * Uses electron-updater for update management
 */

const { autoUpdater } = require('electron-updater');
const { app, BrowserWindow } = require('electron');
const NotificationManager = require('./notifications');

class UpdateManager {
    constructor() {
        // Configure auto updater
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;

        // Initialize notification manager for update messages
        this.notificationManager = new NotificationManager();

        // Bind event handlers
        this.bindUpdateEvents();
    }

    /**
     * Initialize auto-update checks
     * @param {number} checkInterval - Interval in minutes between update checks
     */
    initialize(checkInterval = 60) {
        // Initial check
        this.checkForUpdates();

        // Setup periodic checks
        setInterval(() => {
            this.checkForUpdates();
        }, checkInterval * 60 * 1000);
    }

    /**
     * Bind handlers for update events
     */
    bindUpdateEvents() {
        autoUpdater.on('checking-for-update', () => {
            console.log('Checking for updates...');
        });

        autoUpdater.on('update-available', (info) => {
            console.log('Update available:', info);
            this.notificationManager.showNotification({
                title: 'Update Available',
                body: `Version ${info.version} is available and will be installed on quit`,
            });
        });

        autoUpdater.on('update-not-available', () => {
            console.log('No updates available');
        });

        autoUpdater.on('error', (err) => {
            console.error('Update error:', err);
            this.notificationManager.showNotification({
                title: 'Update Error',
                body: 'Failed to check for updates. Please try again later.',
            });
        });

        autoUpdater.on('download-progress', (progress) => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) {
                win.setProgressBar(progress.percent / 100);
            }
        });

        autoUpdater.on('update-downloaded', (info) => {
            console.log('Update downloaded:', info);
            this.notificationManager.showNotification({
                title: 'Update Ready',
                body: 'Update has been downloaded and will be installed on quit',
            });

            // Reset progress bar
            const win = BrowserWindow.getFocusedWindow();
            if (win) {
                win.setProgressBar(-1);
            }
        });
    }

    /**
     * Check for updates
     */
    async checkForUpdates() {
        try {
            await autoUpdater.checkForUpdates();
        } catch (error) {
            console.error('Failed to check for updates:', error);
        }
    }

    /**
     * Quit and install update
     */
    quitAndInstall() {
        autoUpdater.quitAndInstall();
    }
}

module.exports = UpdateManager;
