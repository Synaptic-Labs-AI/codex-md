---
title: "Tray | Electron"
description: "This guide will take you through the process of creating a Tray icon with its own context menu to the system's notification area."
clipdate: 2025-03-13
source: "https://www.electronjs.org/docs/latest/tutorial/tray"
published:
tags:
  - "electron"
  - "trayIcon"
  - "desktopApplication"
  - "nativeUserInterface"
  - "systemTray"
  - "menuBar"
  - "applicationMenu"
  - "crossPlatformDevelopment"
---
> [!summary]- Summary
> - A Tray icon allows you to create a system notification area icon in Electron applications
> - Tray icons can be created using `nativeImage` and placed in the system's notification area
> - On MacOS and Ubuntu, the Tray appears in the top right corner
> - On Windows, the Tray appears in the bottom right corner
> - Tray icons can have context menus, tooltips, and titles
> - Requires importing `Tray`, `Menu`, and `nativeImage` from Electron

This guide will take you through the process of creating a [Tray](https://www.electronjs.org/docs/latest/api/tray) icon with its own context menu to the system's notification area.

On MacOS and Ubuntu, the Tray will be located on the top right corner of your screen, adjacent to your battery and wifi icons. On Windows, the Tray will usually be located in the bottom right corner.

First we must import `app`, `Tray`, `Menu`, `nativeImage` from `electron`.

```prism
const{ app,Tray,Menu, nativeImage }=require('electron')
```

Next we will create our Tray. To do this, we will use a [`NativeImage`](https://www.electronjs.org/docs/latest/api/native-image) icon, which can be created through any one of these [methods](https://www.electronjs.org/docs/latest/api/native-image#methods). Note that we wrap our Tray creation code within an [`app.whenReady`](https://www.electronjs.org/docs/latest/api/app#appwhenready) as we will need to wait for our electron app to finish initializing.

main.js

```prism
let tray

app.whenReady().then(()=>{
const icon = nativeImage.createFromPath('path/to/asset.png')
  tray =newTray(icon)

// note: your contextMenu, Tooltip and Title code will go here!
})
```

Great! Now we can start attaching a context menu to our Tray, like so:

```prism
const contextMenu =Menu.buildFromTemplate([
{label:'Item1',type:'radio'},
{label:'Item2',type:'radio'},
{label:'Item3',type:'radio',checked:true},
{label:'Item4',type:'radio'}
])

tray.setContextMenu(contextMenu)
```

The code above will create 4 separate radio-type items in the context menu. To read more about constructing native menus, click [here](https://www.electronjs.org/docs/latest/api/menu#menubuildfromtemplatetemplate).

Finally, let's give our tray a tooltip and a title.

```prism
tray.setToolTip('This is my application')
tray.setTitle('This is my title')
```

After you start your electron app, you should see the Tray residing in either the top or bottom right of your screen, depending on your operating system.

[docs/fiddles/native-ui/tray (35.0.1)](https://github.com/electron/electron/tree/v35.0.1/docs/fiddles/native-ui/tray)[Open in Fiddle](https://fiddle.electronjs.org/launch?target=electron/v35.0.1/docs/fiddles/native-ui/tray)

**Example**
```javascript
const { app, Tray, Menu, nativeImage } = require('electron')

app.whenReady().then(() => {
  // Create tray icon from image path
  const icon = nativeImage.createFromPath('app-icon.png')
  const tray = new Tray(icon)

  // Create context menu
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open App', click: () => mainWindow.show() },
    { label: 'Quit', click: () => app.quit() }
  ])

  // Set context menu and tooltip
  tray.setContextMenu(contextMenu)
  tray.setToolTip('My Electron App')
})
```