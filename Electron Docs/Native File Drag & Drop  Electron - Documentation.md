---
title: "Native File Drag & Drop | Electron"
description: "Certain kinds of applications that manipulate files might want to support the operating system's native file drag & drop feature. Dragging files into web content is common and supported by many websites. Electron additionally supports dragging files and content out from web content into the operating system's world."
clipdate: 2025-03-13
source: "https://www.electronjs.org/docs/latest/tutorial/native-file-drag-drop"
published:
tags:
  - "electronDragDrop"
  - "nativeFileTransfer"
  - "webContentDrag"
  - "crossPlatformFileSharing"
  - "interactiveUserInterface"
---
> [!summary]- Summary
> - Native file drag and drop is a feature in Electron that allows applications to support OS-level file dragging
> - Users can drag files into web content and drag files/content out of web content
> - Requires using `webContents.startDrag(item)` API in response to ondragstart event
> - Involves coordination between preload, renderer, and main processes
> - Supports creating and dragging files dynamically

Certain kinds of applications that manipulate files might want to support the operating system's native file drag & drop feature. Dragging files into web content is common and supported by many websites. Electron additionally supports dragging files and content out from web content into the operating system's world.

To implement this feature in your app, you need to call the [`webContents.startDrag(item)`](https://www.electronjs.org/docs/latest/api/web-contents#contentsstartdragitem) API in response to the `ondragstart` event.

An example demonstrating how you can create a file on the fly to be dragged out of the window.

In `preload.js` use the [`contextBridge`](https://www.electronjs.org/docs/latest/api/context-bridge) to inject a method `window.electron.startDrag(...)` that will send an IPC message to the main process.

```prism
const{ contextBridge, ipcRenderer }=require('electron')

contextBridge.exposeInMainWorld('electron',{
startDrag:(fileName)=> ipcRenderer.send('ondragstart', fileName)
})
```

Add a draggable element to `index.html`, and reference your renderer script:

```prism
<divstyle="border:2px solid black;border-radius:3px;padding:5px;display:inline-block"draggable="true"id="drag">Drag me</div>
<scriptsrc="renderer.js"></script>
```

In `renderer.js` set up the renderer process to handle drag events by calling the method you added via the [`contextBridge`](https://www.electronjs.org/docs/latest/api/context-bridge) above.

```prism
document.getElementById('drag').ondragstart=(event)=>{
  event.preventDefault()
window.electron.startDrag('drag-and-drop.md')
}
```

In the Main process (`main.js` file), expand the received event with a path to the file that is being dragged and an icon:

[docs/fiddles/features/drag-and-drop (35.0.1)](https://github.com/electron/electron/tree/v35.0.1/docs/fiddles/features/drag-and-drop)[Open in Fiddle](https://fiddle.electronjs.org/launch?target=electron/v35.0.1/docs/fiddles/features/drag-and-drop)

After launching the Electron application, try dragging and dropping the item from the BrowserWindow onto your desktop. In this guide, the item is a Markdown file located in the root of the project:

![Drag and drop](https://www.electronjs.org/assets/images/drag-and-drop-67d61d654b54bcc6bd497a1d1608dc29.gif)

**Example**
```javascript
// Preload.js
contextBridge.exposeInMainWorld('electron', {
  startDrag: (fileName) => ipcRenderer.send('ondragstart', fileName)
})

// Renderer.js
document.getElementById('dragElement').ondragstart = (event) => {
  event.preventDefault()
  window.electron.startDrag('example-file.txt')
}

// Main.js
ipcMain.on('ondragstart', (event, filePath) => {
  event.sender.startDrag({
    file: path.join(__dirname, filePath),
    icon: iconPath
  })
})
```