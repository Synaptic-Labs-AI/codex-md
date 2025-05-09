"use strict";

/**
 * Offline IPC Handlers
 * Implements handlers for offline functionality in the Electron application.
 * 
 * These handlers provide the renderer process with access to offline capabilities
 * such as caching, operation queueing, and network status monitoring.
 * 
 * Related files:
 * - services/OfflineService.js: Core offline functionality
 * - ipc/handlers.js: IPC handler registration
 * - preload.js: API exposure to renderer
 */

const {
  ipcMain
} = require('electron');
const OfflineService = require('../../../services/OfflineService');

/**
 * Registers all offline-related IPC handlers
 */
function registerOfflineHandlers() {
  // Get offline status
  ipcMain.handle('codex:offline:status', async () => {
    return {
      online: OfflineService.getOnlineStatus(),
      apiStatus: OfflineService.getApiStatus()
    };
  });

  // Get queued operations
  ipcMain.handle('codex:offline:queued-operations', async () => {
    return OfflineService.getQueuedOperations();
  });

  // Queue an operation
  ipcMain.handle('codex:offline:queue-operation', async (event, operation) => {
    try {
      const operationId = OfflineService.queueOperation(operation);
      return {
        success: true,
        operationId
      };
    } catch (error) {
      console.error('Failed to queue operation:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Cache data
  ipcMain.handle('codex:offline:cache-data', async (event, {
    key,
    data
  }) => {
    try {
      const success = await OfflineService.cacheData(key, data);
      return {
        success
      };
    } catch (error) {
      console.error('Failed to cache data:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Get cached data
  ipcMain.handle('codex:offline:get-cached-data', async (event, {
    key,
    maxAge
  }) => {
    try {
      const data = await OfflineService.getCachedData(key, maxAge);
      return {
        success: true,
        data
      };
    } catch (error) {
      console.error('Failed to get cached data:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Invalidate cache
  ipcMain.handle('codex:offline:invalidate-cache', async (event, {
    key
  }) => {
    try {
      const success = await OfflineService.invalidateCache(key);
      return {
        success
      };
    } catch (error) {
      console.error('Failed to invalidate cache:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Clear cache
  ipcMain.handle('codex:offline:clear-cache', async () => {
    try {
      const success = await OfflineService.clearCache();
      return {
        success
      };
    } catch (error) {
      console.error('Failed to clear cache:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Set up event forwarding from OfflineService to renderer
  OfflineService.addListener(event => {
    // Forward events to any renderer that might be listening
    const windows = require('electron').BrowserWindow.getAllWindows();
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('codex:offline:event', event);
      }
    }
  });
  console.log('📡 Registered offline IPC handlers');
}

/**
 * Cleans up offline handlers and resources
 */
function cleanupOfflineHandlers() {
  // Clean up the OfflineService
  OfflineService.cleanup();
}
module.exports = {
  registerOfflineHandlers,
  cleanupOfflineHandlers
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJpcGNNYWluIiwicmVxdWlyZSIsIk9mZmxpbmVTZXJ2aWNlIiwicmVnaXN0ZXJPZmZsaW5lSGFuZGxlcnMiLCJoYW5kbGUiLCJvbmxpbmUiLCJnZXRPbmxpbmVTdGF0dXMiLCJhcGlTdGF0dXMiLCJnZXRBcGlTdGF0dXMiLCJnZXRRdWV1ZWRPcGVyYXRpb25zIiwiZXZlbnQiLCJvcGVyYXRpb24iLCJvcGVyYXRpb25JZCIsInF1ZXVlT3BlcmF0aW9uIiwic3VjY2VzcyIsImVycm9yIiwiY29uc29sZSIsIm1lc3NhZ2UiLCJrZXkiLCJkYXRhIiwiY2FjaGVEYXRhIiwibWF4QWdlIiwiZ2V0Q2FjaGVkRGF0YSIsImludmFsaWRhdGVDYWNoZSIsImNsZWFyQ2FjaGUiLCJhZGRMaXN0ZW5lciIsIndpbmRvd3MiLCJCcm93c2VyV2luZG93IiwiZ2V0QWxsV2luZG93cyIsIndpbmRvdyIsImlzRGVzdHJveWVkIiwid2ViQ29udGVudHMiLCJzZW5kIiwibG9nIiwiY2xlYW51cE9mZmxpbmVIYW5kbGVycyIsImNsZWFudXAiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2VsZWN0cm9uL2lwYy9oYW5kbGVycy9vZmZsaW5lL2luZGV4LmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBPZmZsaW5lIElQQyBIYW5kbGVyc1xyXG4gKiBJbXBsZW1lbnRzIGhhbmRsZXJzIGZvciBvZmZsaW5lIGZ1bmN0aW9uYWxpdHkgaW4gdGhlIEVsZWN0cm9uIGFwcGxpY2F0aW9uLlxyXG4gKiBcclxuICogVGhlc2UgaGFuZGxlcnMgcHJvdmlkZSB0aGUgcmVuZGVyZXIgcHJvY2VzcyB3aXRoIGFjY2VzcyB0byBvZmZsaW5lIGNhcGFiaWxpdGllc1xyXG4gKiBzdWNoIGFzIGNhY2hpbmcsIG9wZXJhdGlvbiBxdWV1ZWluZywgYW5kIG5ldHdvcmsgc3RhdHVzIG1vbml0b3JpbmcuXHJcbiAqIFxyXG4gKiBSZWxhdGVkIGZpbGVzOlxyXG4gKiAtIHNlcnZpY2VzL09mZmxpbmVTZXJ2aWNlLmpzOiBDb3JlIG9mZmxpbmUgZnVuY3Rpb25hbGl0eVxyXG4gKiAtIGlwYy9oYW5kbGVycy5qczogSVBDIGhhbmRsZXIgcmVnaXN0cmF0aW9uXHJcbiAqIC0gcHJlbG9hZC5qczogQVBJIGV4cG9zdXJlIHRvIHJlbmRlcmVyXHJcbiAqL1xyXG5cclxuY29uc3QgeyBpcGNNYWluIH0gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xyXG5jb25zdCBPZmZsaW5lU2VydmljZSA9IHJlcXVpcmUoJy4uLy4uLy4uL3NlcnZpY2VzL09mZmxpbmVTZXJ2aWNlJyk7XHJcblxyXG4vKipcclxuICogUmVnaXN0ZXJzIGFsbCBvZmZsaW5lLXJlbGF0ZWQgSVBDIGhhbmRsZXJzXHJcbiAqL1xyXG5mdW5jdGlvbiByZWdpc3Rlck9mZmxpbmVIYW5kbGVycygpIHtcclxuICAvLyBHZXQgb2ZmbGluZSBzdGF0dXNcclxuICBpcGNNYWluLmhhbmRsZSgnY29kZXg6b2ZmbGluZTpzdGF0dXMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBvbmxpbmU6IE9mZmxpbmVTZXJ2aWNlLmdldE9ubGluZVN0YXR1cygpLFxyXG4gICAgICBhcGlTdGF0dXM6IE9mZmxpbmVTZXJ2aWNlLmdldEFwaVN0YXR1cygpXHJcbiAgICB9O1xyXG4gIH0pO1xyXG5cclxuICAvLyBHZXQgcXVldWVkIG9wZXJhdGlvbnNcclxuICBpcGNNYWluLmhhbmRsZSgnY29kZXg6b2ZmbGluZTpxdWV1ZWQtb3BlcmF0aW9ucycsIGFzeW5jICgpID0+IHtcclxuICAgIHJldHVybiBPZmZsaW5lU2VydmljZS5nZXRRdWV1ZWRPcGVyYXRpb25zKCk7XHJcbiAgfSk7XHJcblxyXG4gIC8vIFF1ZXVlIGFuIG9wZXJhdGlvblxyXG4gIGlwY01haW4uaGFuZGxlKCdjb2RleDpvZmZsaW5lOnF1ZXVlLW9wZXJhdGlvbicsIGFzeW5jIChldmVudCwgb3BlcmF0aW9uKSA9PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBvcGVyYXRpb25JZCA9IE9mZmxpbmVTZXJ2aWNlLnF1ZXVlT3BlcmF0aW9uKG9wZXJhdGlvbik7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICBvcGVyYXRpb25JZFxyXG4gICAgICB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHF1ZXVlIG9wZXJhdGlvbjonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2VcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9KTtcclxuXHJcbiAgLy8gQ2FjaGUgZGF0YVxyXG4gIGlwY01haW4uaGFuZGxlKCdjb2RleDpvZmZsaW5lOmNhY2hlLWRhdGEnLCBhc3luYyAoZXZlbnQsIHsga2V5LCBkYXRhIH0pID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHN1Y2Nlc3MgPSBhd2FpdCBPZmZsaW5lU2VydmljZS5jYWNoZURhdGEoa2V5LCBkYXRhKTtcclxuICAgICAgcmV0dXJuIHsgc3VjY2VzcyB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIGNhY2hlIGRhdGE6JywgZXJyb3IpO1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfSk7XHJcblxyXG4gIC8vIEdldCBjYWNoZWQgZGF0YVxyXG4gIGlwY01haW4uaGFuZGxlKCdjb2RleDpvZmZsaW5lOmdldC1jYWNoZWQtZGF0YScsIGFzeW5jIChldmVudCwgeyBrZXksIG1heEFnZSB9KSA9PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBkYXRhID0gYXdhaXQgT2ZmbGluZVNlcnZpY2UuZ2V0Q2FjaGVkRGF0YShrZXksIG1heEFnZSk7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICBkYXRhXHJcbiAgICAgIH07XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gZ2V0IGNhY2hlZCBkYXRhOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogZXJyb3IubWVzc2FnZVxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH0pO1xyXG5cclxuICAvLyBJbnZhbGlkYXRlIGNhY2hlXHJcbiAgaXBjTWFpbi5oYW5kbGUoJ2NvZGV4Om9mZmxpbmU6aW52YWxpZGF0ZS1jYWNoZScsIGFzeW5jIChldmVudCwgeyBrZXkgfSkgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3Qgc3VjY2VzcyA9IGF3YWl0IE9mZmxpbmVTZXJ2aWNlLmludmFsaWRhdGVDYWNoZShrZXkpO1xyXG4gICAgICByZXR1cm4geyBzdWNjZXNzIH07XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gaW52YWxpZGF0ZSBjYWNoZTonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2VcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9KTtcclxuXHJcbiAgLy8gQ2xlYXIgY2FjaGVcclxuICBpcGNNYWluLmhhbmRsZSgnY29kZXg6b2ZmbGluZTpjbGVhci1jYWNoZScsIGFzeW5jICgpID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHN1Y2Nlc3MgPSBhd2FpdCBPZmZsaW5lU2VydmljZS5jbGVhckNhY2hlKCk7XHJcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3MgfTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBjbGVhciBjYWNoZTonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2VcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9KTtcclxuXHJcbiAgLy8gU2V0IHVwIGV2ZW50IGZvcndhcmRpbmcgZnJvbSBPZmZsaW5lU2VydmljZSB0byByZW5kZXJlclxyXG4gIE9mZmxpbmVTZXJ2aWNlLmFkZExpc3RlbmVyKChldmVudCkgPT4ge1xyXG4gICAgLy8gRm9yd2FyZCBldmVudHMgdG8gYW55IHJlbmRlcmVyIHRoYXQgbWlnaHQgYmUgbGlzdGVuaW5nXHJcbiAgICBjb25zdCB3aW5kb3dzID0gcmVxdWlyZSgnZWxlY3Ryb24nKS5Ccm93c2VyV2luZG93LmdldEFsbFdpbmRvd3MoKTtcclxuICAgIGZvciAoY29uc3Qgd2luZG93IG9mIHdpbmRvd3MpIHtcclxuICAgICAgaWYgKCF3aW5kb3cuaXNEZXN0cm95ZWQoKSkge1xyXG4gICAgICAgIHdpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdjb2RleDpvZmZsaW5lOmV2ZW50JywgZXZlbnQpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfSk7XHJcblxyXG4gIGNvbnNvbGUubG9nKCfwn5OhIFJlZ2lzdGVyZWQgb2ZmbGluZSBJUEMgaGFuZGxlcnMnKTtcclxufVxyXG5cclxuLyoqXHJcbiAqIENsZWFucyB1cCBvZmZsaW5lIGhhbmRsZXJzIGFuZCByZXNvdXJjZXNcclxuICovXHJcbmZ1bmN0aW9uIGNsZWFudXBPZmZsaW5lSGFuZGxlcnMoKSB7XHJcbiAgLy8gQ2xlYW4gdXAgdGhlIE9mZmxpbmVTZXJ2aWNlXHJcbiAgT2ZmbGluZVNlcnZpY2UuY2xlYW51cCgpO1xyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IHtcclxuICByZWdpc3Rlck9mZmxpbmVIYW5kbGVycyxcclxuICBjbGVhbnVwT2ZmbGluZUhhbmRsZXJzXHJcbn07XHJcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTTtFQUFFQTtBQUFRLENBQUMsR0FBR0MsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUN2QyxNQUFNQyxjQUFjLEdBQUdELE9BQU8sQ0FBQyxrQ0FBa0MsQ0FBQzs7QUFFbEU7QUFDQTtBQUNBO0FBQ0EsU0FBU0UsdUJBQXVCQSxDQUFBLEVBQUc7RUFDakM7RUFDQUgsT0FBTyxDQUFDSSxNQUFNLENBQUMsc0JBQXNCLEVBQUUsWUFBWTtJQUNqRCxPQUFPO01BQ0xDLE1BQU0sRUFBRUgsY0FBYyxDQUFDSSxlQUFlLENBQUMsQ0FBQztNQUN4Q0MsU0FBUyxFQUFFTCxjQUFjLENBQUNNLFlBQVksQ0FBQztJQUN6QyxDQUFDO0VBQ0gsQ0FBQyxDQUFDOztFQUVGO0VBQ0FSLE9BQU8sQ0FBQ0ksTUFBTSxDQUFDLGlDQUFpQyxFQUFFLFlBQVk7SUFDNUQsT0FBT0YsY0FBYyxDQUFDTyxtQkFBbUIsQ0FBQyxDQUFDO0VBQzdDLENBQUMsQ0FBQzs7RUFFRjtFQUNBVCxPQUFPLENBQUNJLE1BQU0sQ0FBQywrQkFBK0IsRUFBRSxPQUFPTSxLQUFLLEVBQUVDLFNBQVMsS0FBSztJQUMxRSxJQUFJO01BQ0YsTUFBTUMsV0FBVyxHQUFHVixjQUFjLENBQUNXLGNBQWMsQ0FBQ0YsU0FBUyxDQUFDO01BQzVELE9BQU87UUFDTEcsT0FBTyxFQUFFLElBQUk7UUFDYkY7TUFDRixDQUFDO0lBQ0gsQ0FBQyxDQUFDLE9BQU9HLEtBQUssRUFBRTtNQUNkQyxPQUFPLENBQUNELEtBQUssQ0FBQyw0QkFBNEIsRUFBRUEsS0FBSyxDQUFDO01BQ2xELE9BQU87UUFDTEQsT0FBTyxFQUFFLEtBQUs7UUFDZEMsS0FBSyxFQUFFQSxLQUFLLENBQUNFO01BQ2YsQ0FBQztJQUNIO0VBQ0YsQ0FBQyxDQUFDOztFQUVGO0VBQ0FqQixPQUFPLENBQUNJLE1BQU0sQ0FBQywwQkFBMEIsRUFBRSxPQUFPTSxLQUFLLEVBQUU7SUFBRVEsR0FBRztJQUFFQztFQUFLLENBQUMsS0FBSztJQUN6RSxJQUFJO01BQ0YsTUFBTUwsT0FBTyxHQUFHLE1BQU1aLGNBQWMsQ0FBQ2tCLFNBQVMsQ0FBQ0YsR0FBRyxFQUFFQyxJQUFJLENBQUM7TUFDekQsT0FBTztRQUFFTDtNQUFRLENBQUM7SUFDcEIsQ0FBQyxDQUFDLE9BQU9DLEtBQUssRUFBRTtNQUNkQyxPQUFPLENBQUNELEtBQUssQ0FBQyx1QkFBdUIsRUFBRUEsS0FBSyxDQUFDO01BQzdDLE9BQU87UUFDTEQsT0FBTyxFQUFFLEtBQUs7UUFDZEMsS0FBSyxFQUFFQSxLQUFLLENBQUNFO01BQ2YsQ0FBQztJQUNIO0VBQ0YsQ0FBQyxDQUFDOztFQUVGO0VBQ0FqQixPQUFPLENBQUNJLE1BQU0sQ0FBQywrQkFBK0IsRUFBRSxPQUFPTSxLQUFLLEVBQUU7SUFBRVEsR0FBRztJQUFFRztFQUFPLENBQUMsS0FBSztJQUNoRixJQUFJO01BQ0YsTUFBTUYsSUFBSSxHQUFHLE1BQU1qQixjQUFjLENBQUNvQixhQUFhLENBQUNKLEdBQUcsRUFBRUcsTUFBTSxDQUFDO01BQzVELE9BQU87UUFDTFAsT0FBTyxFQUFFLElBQUk7UUFDYks7TUFDRixDQUFDO0lBQ0gsQ0FBQyxDQUFDLE9BQU9KLEtBQUssRUFBRTtNQUNkQyxPQUFPLENBQUNELEtBQUssQ0FBQyw0QkFBNEIsRUFBRUEsS0FBSyxDQUFDO01BQ2xELE9BQU87UUFDTEQsT0FBTyxFQUFFLEtBQUs7UUFDZEMsS0FBSyxFQUFFQSxLQUFLLENBQUNFO01BQ2YsQ0FBQztJQUNIO0VBQ0YsQ0FBQyxDQUFDOztFQUVGO0VBQ0FqQixPQUFPLENBQUNJLE1BQU0sQ0FBQyxnQ0FBZ0MsRUFBRSxPQUFPTSxLQUFLLEVBQUU7SUFBRVE7RUFBSSxDQUFDLEtBQUs7SUFDekUsSUFBSTtNQUNGLE1BQU1KLE9BQU8sR0FBRyxNQUFNWixjQUFjLENBQUNxQixlQUFlLENBQUNMLEdBQUcsQ0FBQztNQUN6RCxPQUFPO1FBQUVKO01BQVEsQ0FBQztJQUNwQixDQUFDLENBQUMsT0FBT0MsS0FBSyxFQUFFO01BQ2RDLE9BQU8sQ0FBQ0QsS0FBSyxDQUFDLDZCQUE2QixFQUFFQSxLQUFLLENBQUM7TUFDbkQsT0FBTztRQUNMRCxPQUFPLEVBQUUsS0FBSztRQUNkQyxLQUFLLEVBQUVBLEtBQUssQ0FBQ0U7TUFDZixDQUFDO0lBQ0g7RUFDRixDQUFDLENBQUM7O0VBRUY7RUFDQWpCLE9BQU8sQ0FBQ0ksTUFBTSxDQUFDLDJCQUEyQixFQUFFLFlBQVk7SUFDdEQsSUFBSTtNQUNGLE1BQU1VLE9BQU8sR0FBRyxNQUFNWixjQUFjLENBQUNzQixVQUFVLENBQUMsQ0FBQztNQUNqRCxPQUFPO1FBQUVWO01BQVEsQ0FBQztJQUNwQixDQUFDLENBQUMsT0FBT0MsS0FBSyxFQUFFO01BQ2RDLE9BQU8sQ0FBQ0QsS0FBSyxDQUFDLHdCQUF3QixFQUFFQSxLQUFLLENBQUM7TUFDOUMsT0FBTztRQUNMRCxPQUFPLEVBQUUsS0FBSztRQUNkQyxLQUFLLEVBQUVBLEtBQUssQ0FBQ0U7TUFDZixDQUFDO0lBQ0g7RUFDRixDQUFDLENBQUM7O0VBRUY7RUFDQWYsY0FBYyxDQUFDdUIsV0FBVyxDQUFFZixLQUFLLElBQUs7SUFDcEM7SUFDQSxNQUFNZ0IsT0FBTyxHQUFHekIsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDMEIsYUFBYSxDQUFDQyxhQUFhLENBQUMsQ0FBQztJQUNqRSxLQUFLLE1BQU1DLE1BQU0sSUFBSUgsT0FBTyxFQUFFO01BQzVCLElBQUksQ0FBQ0csTUFBTSxDQUFDQyxXQUFXLENBQUMsQ0FBQyxFQUFFO1FBQ3pCRCxNQUFNLENBQUNFLFdBQVcsQ0FBQ0MsSUFBSSxDQUFDLHFCQUFxQixFQUFFdEIsS0FBSyxDQUFDO01BQ3ZEO0lBQ0Y7RUFDRixDQUFDLENBQUM7RUFFRk0sT0FBTyxDQUFDaUIsR0FBRyxDQUFDLG9DQUFvQyxDQUFDO0FBQ25EOztBQUVBO0FBQ0E7QUFDQTtBQUNBLFNBQVNDLHNCQUFzQkEsQ0FBQSxFQUFHO0VBQ2hDO0VBQ0FoQyxjQUFjLENBQUNpQyxPQUFPLENBQUMsQ0FBQztBQUMxQjtBQUVBQyxNQUFNLENBQUNDLE9BQU8sR0FBRztFQUNmbEMsdUJBQXVCO0VBQ3ZCK0I7QUFDRixDQUFDIiwiaWdub3JlTGlzdCI6W119