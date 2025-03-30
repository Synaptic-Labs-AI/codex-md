---
title: "Multithreading | Electron"
description: "With Web Workers, it is possible to run JavaScript in OS-level threads."
clipdate: 2025-03-13
source: "https://www.electronjs.org/docs/latest/tutorial/multithreading"
published:
tags:
  - "electron"
  - "webWorkers"
  - "multithreading"
  - "nodeIntegration"
  - "browserWindow"
  - "threadSafety"
  - "nodeJsModules"
---
> [!summary]- Summary
> - Web Workers in Electron enable running JavaScript in OS-level threads
> - Node.js features can be used in Web Workers by setting `nodeIntegrationInWorker` to true
> - All built-in Node.js modules are supported in Web Workers
> - Electron's built-in modules cannot be used in multi-threaded environments
> - Native Node.js modules should be avoided in Web Workers due to potential crashes and memory corruption
> - Loading native modules in Web Workers is unsafe due to thread-unsafe `process.dlopen`

With [Web Workers](https://developer.mozilla.org/en/docs/Web/API/Web_Workers_API/Using_web_workers), it is possible to run JavaScript in OS-level threads.

It is possible to use Node.js features in Electron's Web Workers, to do so the `nodeIntegrationInWorker` option should be set to `true` in `webPreferences`.

```prism
const win =newBrowserWindow({
webPreferences:{
nodeIntegrationInWorker:true
}
})
```

The `nodeIntegrationInWorker` can be used independent of `nodeIntegration`, but `sandbox` must not be set to `true`.

**Note:** This option is not available in [`SharedWorker`s](https://developer.mozilla.org/en-US/docs/Web/API/SharedWorker) or [`Service Worker`s](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorker) owing to incompatibilities in sandboxing policies.

All built-in modules of Node.js are supported in Web Workers, and `asar` archives can still be read with Node.js APIs. However none of Electron's built-in modules can be used in a multi-threaded environment.

Any native Node.js module can be loaded directly in Web Workers, but it is strongly recommended not to do so. Most existing native modules have been written assuming single-threaded environment, using them in Web Workers will lead to crashes and memory corruptions.

Note that even if a native Node.js module is thread-safe it's still not safe to load it in a Web Worker because the `process.dlopen` function is not thread safe.

The only way to load a native module safely for now, is to make sure the app loads no native modules after the Web Workers get started.

```prism
process.dlopen=()=>{
thrownewError('Load native module is not safe')
}
const worker =newWorker('script.js')
```

**Example**
```javascript
// Enable Node.js integration in Web Workers
const win = new BrowserWindow({
  webPreferences: {
    nodeIntegrationInWorker: true
  }
})

// worker.js
const { readFile } = require('fs')

// Perform file read operation in a separate thread
onmessage = (event) => {
  const filePath = event.data
  readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      postMessage({ error: err.message })
    } else {
      postMessage({ data })
    }
  })
}
```