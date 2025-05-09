"use strict";

/**
 * menu.js
 * Handles platform-specific menu creation and customization.
 * Provides native menu experience for macOS while maintaining
 * consistent functionality across all platforms.
 */

const {
  app,
  Menu
} = require('electron');

/**
 * Creates the macOS application menu
 * Ensures native macOS menu behavior and keyboard shortcuts
 */
function createMacMenu() {
  const template = [{
    label: app.name,
    submenu: [{
      role: 'about'
    }, {
      type: 'separator'
    }, {
      role: 'services'
    }, {
      type: 'separator'
    }, {
      role: 'hide'
    }, {
      role: 'hideOthers'
    }, {
      role: 'unhide'
    }, {
      type: 'separator'
    }, {
      role: 'quit'
    }]
  }, {
    label: 'File',
    submenu: [{
      label: 'New Conversion',
      accelerator: 'CmdOrCtrl+N',
      click: () => {
        // Send event to renderer to start new conversion
        if (global.mainWindow) {
          global.mainWindow.webContents.send('menu:new-conversion');
        }
      }
    }, {
      type: 'separator'
    }, {
      role: 'close'
    }]
  }, {
    label: 'Edit',
    submenu: [{
      role: 'undo'
    }, {
      role: 'redo'
    }, {
      type: 'separator'
    }, {
      role: 'cut'
    }, {
      role: 'copy'
    }, {
      role: 'paste'
    }, {
      role: 'delete'
    }, {
      type: 'separator'
    }, {
      role: 'selectAll'
    }]
  }, {
    label: 'View',
    submenu: [{
      role: 'reload'
    }, {
      role: 'forceReload'
    }, {
      role: 'toggleDevTools'
    }, {
      type: 'separator'
    }, {
      role: 'resetZoom'
    }, {
      role: 'zoomIn'
    }, {
      role: 'zoomOut'
    }, {
      type: 'separator'
    }, {
      role: 'togglefullscreen'
    }]
  }, {
    label: 'Window',
    submenu: [{
      role: 'minimize'
    }, {
      role: 'zoom'
    }, {
      type: 'separator'
    }, {
      role: 'front'
    }, {
      type: 'separator'
    }, {
      role: 'window'
    }]
  }, {
    role: 'help',
    submenu: [{
      label: 'Learn More',
      click: async () => {
        const {
          shell
        } = require('electron');
        await shell.openExternal('https://github.com/Synaptic-Labs-AI/codex-md');
      }
    }]
  }];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Export menu functions
module.exports = {
  createMacMenu
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJhcHAiLCJNZW51IiwicmVxdWlyZSIsImNyZWF0ZU1hY01lbnUiLCJ0ZW1wbGF0ZSIsImxhYmVsIiwibmFtZSIsInN1Ym1lbnUiLCJyb2xlIiwidHlwZSIsImFjY2VsZXJhdG9yIiwiY2xpY2siLCJnbG9iYWwiLCJtYWluV2luZG93Iiwid2ViQ29udGVudHMiLCJzZW5kIiwic2hlbGwiLCJvcGVuRXh0ZXJuYWwiLCJzZXRBcHBsaWNhdGlvbk1lbnUiLCJidWlsZEZyb21UZW1wbGF0ZSIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZWxlY3Ryb24vZmVhdHVyZXMvbWVudS5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogbWVudS5qc1xyXG4gKiBIYW5kbGVzIHBsYXRmb3JtLXNwZWNpZmljIG1lbnUgY3JlYXRpb24gYW5kIGN1c3RvbWl6YXRpb24uXHJcbiAqIFByb3ZpZGVzIG5hdGl2ZSBtZW51IGV4cGVyaWVuY2UgZm9yIG1hY09TIHdoaWxlIG1haW50YWluaW5nXHJcbiAqIGNvbnNpc3RlbnQgZnVuY3Rpb25hbGl0eSBhY3Jvc3MgYWxsIHBsYXRmb3Jtcy5cclxuICovXHJcblxyXG5jb25zdCB7IGFwcCwgTWVudSB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuXHJcbi8qKlxyXG4gKiBDcmVhdGVzIHRoZSBtYWNPUyBhcHBsaWNhdGlvbiBtZW51XHJcbiAqIEVuc3VyZXMgbmF0aXZlIG1hY09TIG1lbnUgYmVoYXZpb3IgYW5kIGtleWJvYXJkIHNob3J0Y3V0c1xyXG4gKi9cclxuZnVuY3Rpb24gY3JlYXRlTWFjTWVudSgpIHtcclxuICAgIGNvbnN0IHRlbXBsYXRlID0gW1xyXG4gICAgICAgIHtcclxuICAgICAgICAgICAgbGFiZWw6IGFwcC5uYW1lLFxyXG4gICAgICAgICAgICBzdWJtZW51OiBbXHJcbiAgICAgICAgICAgICAgICB7IHJvbGU6ICdhYm91dCcgfSxcclxuICAgICAgICAgICAgICAgIHsgdHlwZTogJ3NlcGFyYXRvcicgfSxcclxuICAgICAgICAgICAgICAgIHsgcm9sZTogJ3NlcnZpY2VzJyB9LFxyXG4gICAgICAgICAgICAgICAgeyB0eXBlOiAnc2VwYXJhdG9yJyB9LFxyXG4gICAgICAgICAgICAgICAgeyByb2xlOiAnaGlkZScgfSxcclxuICAgICAgICAgICAgICAgIHsgcm9sZTogJ2hpZGVPdGhlcnMnIH0sXHJcbiAgICAgICAgICAgICAgICB7IHJvbGU6ICd1bmhpZGUnIH0sXHJcbiAgICAgICAgICAgICAgICB7IHR5cGU6ICdzZXBhcmF0b3InIH0sXHJcbiAgICAgICAgICAgICAgICB7IHJvbGU6ICdxdWl0JyB9XHJcbiAgICAgICAgICAgIF1cclxuICAgICAgICB9LFxyXG4gICAgICAgIHtcclxuICAgICAgICAgICAgbGFiZWw6ICdGaWxlJyxcclxuICAgICAgICAgICAgc3VibWVudTogW1xyXG4gICAgICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnTmV3IENvbnZlcnNpb24nLFxyXG4gICAgICAgICAgICAgICAgICAgIGFjY2VsZXJhdG9yOiAnQ21kT3JDdHJsK04nLFxyXG4gICAgICAgICAgICAgICAgICAgIGNsaWNrOiAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFNlbmQgZXZlbnQgdG8gcmVuZGVyZXIgdG8gc3RhcnQgbmV3IGNvbnZlcnNpb25cclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGdsb2JhbC5tYWluV2luZG93KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBnbG9iYWwubWFpbldpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdtZW51Om5ldy1jb252ZXJzaW9uJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgeyB0eXBlOiAnc2VwYXJhdG9yJyB9LFxyXG4gICAgICAgICAgICAgICAgeyByb2xlOiAnY2xvc2UnIH1cclxuICAgICAgICAgICAgXVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgICBsYWJlbDogJ0VkaXQnLFxyXG4gICAgICAgICAgICBzdWJtZW51OiBbXHJcbiAgICAgICAgICAgICAgICB7IHJvbGU6ICd1bmRvJyB9LFxyXG4gICAgICAgICAgICAgICAgeyByb2xlOiAncmVkbycgfSxcclxuICAgICAgICAgICAgICAgIHsgdHlwZTogJ3NlcGFyYXRvcicgfSxcclxuICAgICAgICAgICAgICAgIHsgcm9sZTogJ2N1dCcgfSxcclxuICAgICAgICAgICAgICAgIHsgcm9sZTogJ2NvcHknIH0sXHJcbiAgICAgICAgICAgICAgICB7IHJvbGU6ICdwYXN0ZScgfSxcclxuICAgICAgICAgICAgICAgIHsgcm9sZTogJ2RlbGV0ZScgfSxcclxuICAgICAgICAgICAgICAgIHsgdHlwZTogJ3NlcGFyYXRvcicgfSxcclxuICAgICAgICAgICAgICAgIHsgcm9sZTogJ3NlbGVjdEFsbCcgfVxyXG4gICAgICAgICAgICBdXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7XHJcbiAgICAgICAgICAgIGxhYmVsOiAnVmlldycsXHJcbiAgICAgICAgICAgIHN1Ym1lbnU6IFtcclxuICAgICAgICAgICAgICAgIHsgcm9sZTogJ3JlbG9hZCcgfSxcclxuICAgICAgICAgICAgICAgIHsgcm9sZTogJ2ZvcmNlUmVsb2FkJyB9LFxyXG4gICAgICAgICAgICAgICAgeyByb2xlOiAndG9nZ2xlRGV2VG9vbHMnIH0sXHJcbiAgICAgICAgICAgICAgICB7IHR5cGU6ICdzZXBhcmF0b3InIH0sXHJcbiAgICAgICAgICAgICAgICB7IHJvbGU6ICdyZXNldFpvb20nIH0sXHJcbiAgICAgICAgICAgICAgICB7IHJvbGU6ICd6b29tSW4nIH0sXHJcbiAgICAgICAgICAgICAgICB7IHJvbGU6ICd6b29tT3V0JyB9LFxyXG4gICAgICAgICAgICAgICAgeyB0eXBlOiAnc2VwYXJhdG9yJyB9LFxyXG4gICAgICAgICAgICAgICAgeyByb2xlOiAndG9nZ2xlZnVsbHNjcmVlbicgfVxyXG4gICAgICAgICAgICBdXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7XHJcbiAgICAgICAgICAgIGxhYmVsOiAnV2luZG93JyxcclxuICAgICAgICAgICAgc3VibWVudTogW1xyXG4gICAgICAgICAgICAgICAgeyByb2xlOiAnbWluaW1pemUnIH0sXHJcbiAgICAgICAgICAgICAgICB7IHJvbGU6ICd6b29tJyB9LFxyXG4gICAgICAgICAgICAgICAgeyB0eXBlOiAnc2VwYXJhdG9yJyB9LFxyXG4gICAgICAgICAgICAgICAgeyByb2xlOiAnZnJvbnQnIH0sXHJcbiAgICAgICAgICAgICAgICB7IHR5cGU6ICdzZXBhcmF0b3InIH0sXHJcbiAgICAgICAgICAgICAgICB7IHJvbGU6ICd3aW5kb3cnIH1cclxuICAgICAgICAgICAgXVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgICByb2xlOiAnaGVscCcsXHJcbiAgICAgICAgICAgIHN1Ym1lbnU6IFtcclxuICAgICAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0xlYXJuIE1vcmUnLFxyXG4gICAgICAgICAgICAgICAgICAgIGNsaWNrOiBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHsgc2hlbGwgfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IHNoZWxsLm9wZW5FeHRlcm5hbCgnaHR0cHM6Ly9naXRodWIuY29tL1N5bmFwdGljLUxhYnMtQUkvY29kZXgtbWQnKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIF1cclxuICAgICAgICB9XHJcbiAgICBdO1xyXG5cclxuICAgIE1lbnUuc2V0QXBwbGljYXRpb25NZW51KE1lbnUuYnVpbGRGcm9tVGVtcGxhdGUodGVtcGxhdGUpKTtcclxufVxyXG5cclxuLy8gRXhwb3J0IG1lbnUgZnVuY3Rpb25zXHJcbm1vZHVsZS5leHBvcnRzID0ge1xyXG4gICAgY3JlYXRlTWFjTWVudVxyXG59O1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU07RUFBRUEsR0FBRztFQUFFQztBQUFLLENBQUMsR0FBR0MsT0FBTyxDQUFDLFVBQVUsQ0FBQzs7QUFFekM7QUFDQTtBQUNBO0FBQ0E7QUFDQSxTQUFTQyxhQUFhQSxDQUFBLEVBQUc7RUFDckIsTUFBTUMsUUFBUSxHQUFHLENBQ2I7SUFDSUMsS0FBSyxFQUFFTCxHQUFHLENBQUNNLElBQUk7SUFDZkMsT0FBTyxFQUFFLENBQ0w7TUFBRUMsSUFBSSxFQUFFO0lBQVEsQ0FBQyxFQUNqQjtNQUFFQyxJQUFJLEVBQUU7SUFBWSxDQUFDLEVBQ3JCO01BQUVELElBQUksRUFBRTtJQUFXLENBQUMsRUFDcEI7TUFBRUMsSUFBSSxFQUFFO0lBQVksQ0FBQyxFQUNyQjtNQUFFRCxJQUFJLEVBQUU7SUFBTyxDQUFDLEVBQ2hCO01BQUVBLElBQUksRUFBRTtJQUFhLENBQUMsRUFDdEI7TUFBRUEsSUFBSSxFQUFFO0lBQVMsQ0FBQyxFQUNsQjtNQUFFQyxJQUFJLEVBQUU7SUFBWSxDQUFDLEVBQ3JCO01BQUVELElBQUksRUFBRTtJQUFPLENBQUM7RUFFeEIsQ0FBQyxFQUNEO0lBQ0lILEtBQUssRUFBRSxNQUFNO0lBQ2JFLE9BQU8sRUFBRSxDQUNMO01BQ0lGLEtBQUssRUFBRSxnQkFBZ0I7TUFDdkJLLFdBQVcsRUFBRSxhQUFhO01BQzFCQyxLQUFLLEVBQUVBLENBQUEsS0FBTTtRQUNUO1FBQ0EsSUFBSUMsTUFBTSxDQUFDQyxVQUFVLEVBQUU7VUFDbkJELE1BQU0sQ0FBQ0MsVUFBVSxDQUFDQyxXQUFXLENBQUNDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQztRQUM3RDtNQUNKO0lBQ0osQ0FBQyxFQUNEO01BQUVOLElBQUksRUFBRTtJQUFZLENBQUMsRUFDckI7TUFBRUQsSUFBSSxFQUFFO0lBQVEsQ0FBQztFQUV6QixDQUFDLEVBQ0Q7SUFDSUgsS0FBSyxFQUFFLE1BQU07SUFDYkUsT0FBTyxFQUFFLENBQ0w7TUFBRUMsSUFBSSxFQUFFO0lBQU8sQ0FBQyxFQUNoQjtNQUFFQSxJQUFJLEVBQUU7SUFBTyxDQUFDLEVBQ2hCO01BQUVDLElBQUksRUFBRTtJQUFZLENBQUMsRUFDckI7TUFBRUQsSUFBSSxFQUFFO0lBQU0sQ0FBQyxFQUNmO01BQUVBLElBQUksRUFBRTtJQUFPLENBQUMsRUFDaEI7TUFBRUEsSUFBSSxFQUFFO0lBQVEsQ0FBQyxFQUNqQjtNQUFFQSxJQUFJLEVBQUU7SUFBUyxDQUFDLEVBQ2xCO01BQUVDLElBQUksRUFBRTtJQUFZLENBQUMsRUFDckI7TUFBRUQsSUFBSSxFQUFFO0lBQVksQ0FBQztFQUU3QixDQUFDLEVBQ0Q7SUFDSUgsS0FBSyxFQUFFLE1BQU07SUFDYkUsT0FBTyxFQUFFLENBQ0w7TUFBRUMsSUFBSSxFQUFFO0lBQVMsQ0FBQyxFQUNsQjtNQUFFQSxJQUFJLEVBQUU7SUFBYyxDQUFDLEVBQ3ZCO01BQUVBLElBQUksRUFBRTtJQUFpQixDQUFDLEVBQzFCO01BQUVDLElBQUksRUFBRTtJQUFZLENBQUMsRUFDckI7TUFBRUQsSUFBSSxFQUFFO0lBQVksQ0FBQyxFQUNyQjtNQUFFQSxJQUFJLEVBQUU7SUFBUyxDQUFDLEVBQ2xCO01BQUVBLElBQUksRUFBRTtJQUFVLENBQUMsRUFDbkI7TUFBRUMsSUFBSSxFQUFFO0lBQVksQ0FBQyxFQUNyQjtNQUFFRCxJQUFJLEVBQUU7SUFBbUIsQ0FBQztFQUVwQyxDQUFDLEVBQ0Q7SUFDSUgsS0FBSyxFQUFFLFFBQVE7SUFDZkUsT0FBTyxFQUFFLENBQ0w7TUFBRUMsSUFBSSxFQUFFO0lBQVcsQ0FBQyxFQUNwQjtNQUFFQSxJQUFJLEVBQUU7SUFBTyxDQUFDLEVBQ2hCO01BQUVDLElBQUksRUFBRTtJQUFZLENBQUMsRUFDckI7TUFBRUQsSUFBSSxFQUFFO0lBQVEsQ0FBQyxFQUNqQjtNQUFFQyxJQUFJLEVBQUU7SUFBWSxDQUFDLEVBQ3JCO01BQUVELElBQUksRUFBRTtJQUFTLENBQUM7RUFFMUIsQ0FBQyxFQUNEO0lBQ0lBLElBQUksRUFBRSxNQUFNO0lBQ1pELE9BQU8sRUFBRSxDQUNMO01BQ0lGLEtBQUssRUFBRSxZQUFZO01BQ25CTSxLQUFLLEVBQUUsTUFBQUEsQ0FBQSxLQUFZO1FBQ2YsTUFBTTtVQUFFSztRQUFNLENBQUMsR0FBR2QsT0FBTyxDQUFDLFVBQVUsQ0FBQztRQUNyQyxNQUFNYyxLQUFLLENBQUNDLFlBQVksQ0FBQyw4Q0FBOEMsQ0FBQztNQUM1RTtJQUNKLENBQUM7RUFFVCxDQUFDLENBQ0o7RUFFRGhCLElBQUksQ0FBQ2lCLGtCQUFrQixDQUFDakIsSUFBSSxDQUFDa0IsaUJBQWlCLENBQUNmLFFBQVEsQ0FBQyxDQUFDO0FBQzdEOztBQUVBO0FBQ0FnQixNQUFNLENBQUNDLE9BQU8sR0FBRztFQUNibEI7QUFDSixDQUFDIiwiaWdub3JlTGlzdCI6W119