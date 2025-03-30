---
title: "Process Sandboxing | Electron"
description: "One key security feature in Chromium is that processes can be executed within a sandbox. The sandbox limits the harm that malicious code can cause by limiting access to most system resources — sandboxed processes can only freely use CPU cycles and memory. In order to perform operations requiring additional privilege, sandboxed processes use dedicated communication channels to delegate tasks to more privileged processes."
clipdate: 2025-03-13
source: "https://www.electronjs.org/docs/latest/tutorial/sandbox"
published:
tags:
  - "electronSecurity"
  - "processSandboxing"
  - "chromiumSecurity"
  - "rendererProcesses"
  - "webSecurity"
  - "electronApp"
  - "nodeJsSecurity"
---
> [!summary]- Summary
> - Process sandboxing is a security feature in Chromium and Electron that limits processes' access to system resources
> - Sandboxed processes can only use CPU cycles and memory freely
> - Renderer processes are sandboxed by default in Electron since version 20
> - Sandboxed renderers cannot access Node.js environment directly
> - Preload scripts in sandboxed renderers have limited access to Node.js and Electron APIs
> - Developers can disable sandboxing for specific processes or globally
> - Rendering untrusted content in Electron has inherent security challenges

One key security feature in Chromium is that processes can be executed within a sandbox. The sandbox limits the harm that malicious code can cause by limiting access to most system resources — sandboxed processes can only freely use CPU cycles and memory. In order to perform operations requiring additional privilege, sandboxed processes use dedicated communication channels to delegate tasks to more privileged processes.

In Chromium, sandboxing is applied to most processes other than the main process. This includes renderer processes, as well as utility processes such as the audio service, the GPU service and the network service.

See Chromium's [Sandbox design document](https://chromium.googlesource.com/chromium/src/+/main/docs/design/sandbox.md) for more information.

Starting from Electron 20, the sandbox is enabled for renderer processes without any further configuration. If you want to disable the sandbox for a process, see the [Disabling the sandbox for a single process](https://www.electronjs.org/docs/latest/tutorial/#disabling-the-sandbox-for-a-single-process) section.

Sandboxed processes in Electron behave *mostly* in the same way as Chromium's do, but Electron has a few additional concepts to consider because it interfaces with Node.js.

When renderer processes in Electron are sandboxed, they behave in the same way as a regular Chrome renderer would. A sandboxed renderer won't have a Node.js environment initialized.

Therefore, when the sandbox is enabled, renderer processes can only perform privileged tasks (such as interacting with the filesystem, making changes to the system, or spawning subprocesses) by delegating these tasks to the main process via inter-process communication (IPC).

note

For more info on inter-process communication, check out our [IPC guide](https://www.electronjs.org/docs/latest/tutorial/ipc).

In order to allow renderer processes to communicate with the main process, preload scripts attached to sandboxed renderers will still have a polyfilled subset of Node.js APIs available. A `require` function similar to Node's `require` module is exposed, but can only import a subset of Electron and Node's built-in modules:

- `electron` (following renderer process modules: `contextBridge`, `crashReporter`, `ipcRenderer`, `nativeImage`, `webFrame`, `webUtils`)
- [`events`](https://nodejs.org/api/events.html)
- [`timers`](https://nodejs.org/api/timers.html)
- [`url`](https://nodejs.org/api/url.html)

[node: imports](https://nodejs.org/api/esm.html#node-imports) are supported as well:

- [`node:events`](https://nodejs.org/api/events.html)
- [`node:timers`](https://nodejs.org/api/timers.html)
- [`node:url`](https://nodejs.org/api/url.html)

In addition, the preload script also polyfills certain Node.js primitives as globals:

- [`Buffer`](https://nodejs.org/api/buffer.html)
- [`process`](https://www.electronjs.org/docs/latest/api/process)
- [`clearImmediate`](https://nodejs.org/api/timers.html#timers_clearimmediate_immediate)
- [`setImmediate`](https://nodejs.org/api/timers.html#timers_setimmediate_callback_args)

Because the `require` function is a polyfill with limited functionality, you will not be able to use [CommonJS modules](https://nodejs.org/api/modules.html#modules_modules_commonjs_modules) to separate your preload script into multiple files. If you need to split your preload code, use a bundler such as [webpack](https://webpack.js.org/) or [Parcel](https://parceljs.org/).

Note that because the environment presented to the `preload` script is substantially more privileged than that of a sandboxed renderer, it is still possible to leak privileged APIs to untrusted code running in the renderer process unless [`contextIsolation`](https://www.electronjs.org/docs/latest/tutorial/context-isolation) is enabled.

For most apps, sandboxing is the best choice. In certain use cases that are incompatible with the sandbox (for instance, when using native node modules in the renderer), it is possible to disable the sandbox for specific processes. This comes with security risks, especially if any untrusted code or content is present in the unsandboxed process.

In Electron, renderer sandboxing can be disabled on a per-process basis with the `sandbox: false` preference in the [`BrowserWindow`](https://www.electronjs.org/docs/latest/api/browser-window) constructor.

main.js

```prism
app.whenReady().then(()=>{
const win =newBrowserWindow({
webPreferences:{
sandbox:false
}
})
  win.loadURL('https://google.com')
})
```

Sandboxing is also disabled whenever Node.js integration is enabled in the renderer. This can be done through the BrowserWindow constructor with the `nodeIntegration: true` flag.

main.js

```prism
app.whenReady().then(()=>{
const win =newBrowserWindow({
webPreferences:{
nodeIntegration:true
}
})
  win.loadURL('https://google.com')
})
```

If you want to force sandboxing for all renderers, you can also use the [`app.enableSandbox`](https://www.electronjs.org/docs/latest/api/app#appenablesandbox) API. Note that this API has to be called before the app's `ready` event.

main.js

```prism
app.enableSandbox()
app.whenReady().then(()=>{
// any sandbox:false calls are overridden since \`app.enableSandbox()\` was called.
const win =newBrowserWindow()
  win.loadURL('https://google.com')
})
```

You can also disable Chromium's sandbox entirely with the [`--no-sandbox`](https://www.electronjs.org/docs/latest/api/command-line-switches#--no-sandbox) CLI flag, which will disable the sandbox for all processes (including utility processes). We highly recommend that you only use this flag for testing purposes, and **never** in production.

Note that the `sandbox: true` option will still disable the renderer's Node.js environment.

Rendering untrusted content in Electron is still somewhat uncharted territory, though some apps are finding success (e.g. [Beaker Browser](https://github.com/beakerbrowser/beaker)). Our goal is to get as close to Chrome as we can in terms of the security of sandboxed content, but ultimately we will always be behind due to a few fundamental issues:

1. We do not have the dedicated resources or expertise that Chromium has to apply to the security of its product. We do our best to make use of what we have, to inherit everything we can from Chromium, and to respond quickly to security issues, but Electron cannot be as secure as Chromium without the resources that Chromium is able to dedicate.
2. Some security features in Chrome (such as Safe Browsing and Certificate Transparency) require a centralized authority and dedicated servers, both of which run counter to the goals of the Electron project. As such, we disable those features in Electron, at the cost of the associated security they would otherwise bring.
3. There is only one Chromium, whereas there are many thousands of apps built on Electron, all of which behave slightly differently. Accounting for those differences can yield a huge possibility space, and make it challenging to ensure the security of the platform in unusual use cases.
4. We can't push security updates to users directly, so we rely on app vendors to upgrade the version of Electron underlying their app in order for security updates to reach users.

While we make our best effort to backport Chromium security fixes to older versions of Electron, we do not make a guarantee that every fix will be backported. Your best chance at staying secure is to be on the latest stable version of Electron.

**Example**
```javascript
// main.js: Example of configuring sandbox settings
const { app, BrowserWindow } = require('electron')

app.whenReady().then(() => {
  // Create a window with sandbox disabled
  const win = new BrowserWindow({
    webPreferences: {
      sandbox: false, // Disable sandbox for this renderer
      preload: path.join(__dirname, 'preload.js')
    }
  })

  win.loadURL('https://example.com')
})

// preload.js: Limited API access in sandboxed renderer
context.bridge.exposeInMainWorld('myAPI', {
  sendToMain: (data) => {
    // Use IPC to communicate with main process
    ipcRenderer.send('message', data)
  }
})
```