---
title: "Notifications | Electron"
description: "Each operating system has its own mechanism to display notifications to users. Electron's notification APIs are cross-platform, but are different for each process type."
clipdate: 2025-03-13
source: "https://www.electronjs.org/docs/latest/tutorial/notifications"
published:
tags:
  - "electron"
  - "notifications"
  - "crossPlatform"
  - "webApi"
  - "desktopNotifications"
  - "userInterface"
  - "appDevelopment"
---
> [!summary]- Summary
> - Electron provides cross-platform notification APIs for both main and renderer processes
> - Main process notifications use Electron's Notification module
> - Renderer process notifications use Web Notifications API
> - Platform-specific considerations exist for Windows, macOS, and Linux
> - Windows requires specific shortcut and AppUserModelID configurations
> - macOS notifications are limited to 256 bytes
> - Linux notifications use libnotify and work across multiple desktop environments
> - Additional third-party modules can help with advanced notification features and state checking

Each operating system has its own mechanism to display notifications to users. Electron's notification APIs are cross-platform, but are different for each process type.

If you want to use a renderer process API in the main process or vice-versa, consider using [inter-process communication](https://www.electronjs.org/docs/latest/tutorial/ipc).

Below are two examples showing how to display notifications for each process type.

Main process notifications are displayed using Electron's [Notification module](https://www.electronjs.org/docs/latest/api/notification). Notification objects created using this module do not appear unless their `show()` instance method is called.

Main Process

```prism
const{Notification}=require('electron')

constNOTIFICATION_TITLE='Basic Notification'
constNOTIFICATION_BODY='Notification from the Main process'

newNotification({
title:NOTIFICATION_TITLE,
body:NOTIFICATION_BODY
}).show()
```

Here's a full example that you can open with Electron Fiddle:

[docs/fiddles/features/notifications/main (35.0.1)](https://github.com/electron/electron/tree/v35.0.1/docs/fiddles/features/notifications/main)[Open in Fiddle](https://fiddle.electronjs.org/launch?target=electron/v35.0.1/docs/fiddles/features/notifications/main)

Notifications can be displayed directly from the renderer process with the [web Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API).

Renderer Process

```prism
constNOTIFICATION_TITLE='Title'
constNOTIFICATION_BODY=
'Notification from the Renderer process. Click to log to console.'
constCLICK_MESSAGE='Notification clicked'

newNotification(NOTIFICATION_TITLE,{body:NOTIFICATION_BODY}).onclick=
()=>console.log(CLICK_MESSAGE)
```

Here's a full example that you can open with Electron Fiddle:

[docs/fiddles/features/notifications/renderer (35.0.1)](https://github.com/electron/electron/tree/v35.0.1/docs/fiddles/features/notifications/renderer)[Open in Fiddle](https://fiddle.electronjs.org/launch?target=electron/v35.0.1/docs/fiddles/features/notifications/renderer)

While code and user experience across operating systems are similar, there are subtle differences.

For notifications on Windows, your Electron app needs to have a Start Menu shortcut with an [AppUserModelID](https://learn.microsoft.com/en-us/windows/win32/shell/appids) and a corresponding [ToastActivatorCLSID](https://learn.microsoft.com/en-us/windows/win32/properties/props-system-appusermodel-toastactivatorclsid).

Electron attempts to automate the work around the AppUserModelID and ToastActivatorCLSID. When Electron is used together with Squirrel.Windows (e.g. if you're using electron-winstaller), [shortcuts will automatically be set correctly](https://github.com/electron/windows-installer/blob/main/README.md#handling-squirrel-events).

In production, Electron will also detect that Squirrel was used and will automatically call `app.setAppUserModelId()` with the correct value. During development, you may have to call [`app.setAppUserModelId()`](https://www.electronjs.org/docs/latest/api/app#appsetappusermodelidid-windows) yourself.

Notifications in development

To quickly bootstrap notifications during development, adding `node_modules\electron\dist\electron.exe` to your Start Menu also does the trick. Navigate to the file in Explorer, right-click and 'Pin to Start Menu'. Then, call `app.setAppUserModelId(process.execPath)` in the main process to see notifications.

Windows also allow for advanced notifications with custom templates, images, and other flexible elements.

To send those notifications from the main process, you can use the userland module [`electron-windows-notifications`](https://github.com/felixrieseberg/electron-windows-notifications), which uses native Node addons to send `ToastNotification` and `TileNotification` objects.

While notifications including buttons work with `electron-windows-notifications`, handling replies requires the use of [`electron-windows-interactive-notifications`](https://github.com/felixrieseberg/electron-windows-interactive-notifications), which helps with registering the required COM components and calling your Electron app with the entered user data.

To detect whether or not you're allowed to send a notification, use the userland module [`windows-notification-state`](https://github.com/felixrieseberg/windows-notification-state).

This module allows you to determine ahead of time whether or not Windows will silently throw the notification away.

Notifications are straightforward on macOS, but you should be aware of [Apple's Human Interface guidelines regarding notifications](https://developer.apple.com/design/human-interface-guidelines/notifications).

Note that notifications are limited to 256 bytes in size and will be truncated if you exceed that limit.

To detect whether or not you're allowed to send a notification, use the userland module [`macos-notification-state`](https://github.com/felixrieseberg/macos-notification-state).

This module allows you to detect ahead of time whether or not the notification will be displayed.

Notifications are sent using `libnotify`, which can show notifications on any desktop environment that follows [Desktop Notifications Specification](https://specifications.freedesktop.org/notification-spec/notification-spec-latest.html), including Cinnamon, Enlightenment, Unity, GNOME, and KDE.

**Example**
```javascript
// Main Process Notification Example
const { Notification } = require('electron')

const NOTIFICATION_TITLE = 'App Update'
const NOTIFICATION_BODY = 'A new version of the app is available!'

function showUpdateNotification() {
  new Notification({
    title: NOTIFICATION_TITLE, 
    body: NOTIFICATION_BODY
  }).show()
}

// Renderer Process Notification Example
const RENDERER_TITLE = 'Task Completed'
const RENDERER_BODY = 'Your background task has finished processing'

new Notification(RENDERER_TITLE, { 
  body: RENDERER_BODY,
  onclick: () => console.log('Notification clicked!')
})
```