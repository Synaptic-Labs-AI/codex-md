---
title: "Online/Offline Event Detection | Electron"
description: "Online and offline event detection can be implemented in the Renderer process using the navigator.onLine attribute, part of standard HTML5 API."
clipdate: 2025-03-13
source: "https://www.electronjs.org/docs/latest/tutorial/online-offline-events"
published:
tags:
  - "electronApp"
  - "onlineOfflineEvents"
  - "networkStatus"
  - "rendererProcess"
  - "htmlFiveApi"
  - "connectionDetection"
---
> [!summary]- Summary
> - Online/offline event detection uses HTML5's `navigator.onLine` attribute in the Renderer process
> - `navigator.onLine` returns `false` if network requests are guaranteed to fail
> - Returns `true` in most cases, so additional verification may be needed
> - Can use window event listeners for 'online' and 'offline' events
> - Useful for creating connection status indicators in Electron apps
> - Recommended to use IPC renderer for communicating status to main process

[Online and offline event](https://developer.mozilla.org/en-US/docs/Online_and_offline_events) detection can be implemented in the Renderer process using the [`navigator.onLine`](http://html5index.org/Offline%20-%20NavigatorOnLine.html) attribute, part of standard HTML5 API.

The `navigator.onLine` attribute returns:

- `false` if all network requests are guaranteed to fail (e.g. when disconnected from the network).
- `true` in all other cases.

Since many cases return `true`, you should treat with care situations of getting false positives, as we cannot always assume that `true` value means that Electron can access the Internet. For example, in cases when the computer is running a virtualization software that has virtual Ethernet adapters in "always connected" state. Therefore, if you want to determine the Internet access status of Electron, you should develop additional means for this check.

Starting with an HTML file `index.html`, this example will demonstrate how the `navigator.onLine` API can be used to build a connection status indicator.

index.html

```prism
<!DOCTYPEhtml>
<html>
<head>
<metacharset="UTF-8">
<title>Hello World!</title>
<metahttp-equiv="Content-Security-Policy"content="script-src 'self' 'unsafe-inline';"/>
</head>
<body>
<h1>Connection status: <strongid='status'></strong></h1>
<scriptsrc="renderer.js"></script>
</body>
</html>
```

In order to mutate the DOM, create a `renderer.js` file that adds event listeners to the `'online'` and `'offline'` `window` events. The event handler sets the content of the `<strong id='status'>` element depending on the result of `navigator.onLine`.

renderer.js

```prism
constupdateOnlineStatus=()=>{
document.getElementById('status').innerHTML=navigator.onLine?'online':'offline'
}

window.addEventListener('online', updateOnlineStatus)
window.addEventListener('offline', updateOnlineStatus)

updateOnlineStatus()
```

Finally, create a `main.js` file for main process that creates the window.

main.js

```prism
const{ app,BrowserWindow}=require('electron')

constcreateWindow=()=>{
const onlineStatusWindow =newBrowserWindow({
width:400,
height:100
})

  onlineStatusWindow.loadFile('index.html')
}

app.whenReady().then(()=>{
createWindow()

  app.on('activate',()=>{
if(BrowserWindow.getAllWindows().length===0){
createWindow()
}
})
})

app.on('window-all-closed',()=>{
if(process.platform!=='darwin'){
    app.quit()
}
})
```

After launching the Electron application, you should see the notification:

![Connection status](https://www.electronjs.org/assets/images/connection-status-5cafe8cb88bae305085f0c7cd5dc1e6d.png)

> Note: If you need to communicate the connection status to the main process, use the [IPC renderer](https://www.electronjs.org/docs/latest/api/ipc-renderer) API.

**Example**
```javascript
// index.html
<!DOCTYPE html>
<html>
<body>
  <h1>Connection Status: <strong id='status'></strong></h1>
  <script src='renderer.js'></script>
</body>
</html>

// renderer.js
const updateOnlineStatus = () => {
  document.getElementById('status').innerHTML = 
    navigator.onLine ? 'Online' : 'Offline';
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();
```