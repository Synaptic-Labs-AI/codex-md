---
title: "Introduction | Electron"
description: "Welcome to the Electron documentation! If this is your first time developing an Electron app, read through this Getting Started section to get familiar with the basics. Otherwise, feel free to explore our guides and API documentation!"
clipdate: 2025-03-13
source: "https://www.electronjs.org/docs/latest"
published:
tags:
  - "electronFramework"
  - "desktopDevelopment"
  - "crossPlatform"
  - "webTechnologies"
  - "nodeJs"
  - "chromium"
  - "javascriptFramework"
---
> [!summary]- Summary
> - Electron is a framework for building cross-platform desktop applications using web technologies
> - Supports Windows, macOS, and Linux
> - Combines Chromium and Node.js in a single runtime
> - Provides comprehensive documentation covering tutorials, processes, best practices, development, distribution, and testing
> - Offers resources like Electron Fiddle for learning and prototyping
> - Provides community support through Discord and GitHub issue tracking

Electron is a framework for building desktop applications using JavaScript, HTML, and CSS. By embedding [Chromium](https://www.chromium.org/) and [Node.js](https://nodejs.org/) into its binary, Electron allows you to maintain one JavaScript codebase and create cross-platform apps that work on Windows, macOS, and Linux — no native development experience required.

We recommend you to start with the [tutorial](https://www.electronjs.org/docs/latest/tutorial/tutorial-prerequisites), which guides you through the process of developing an Electron app and distributing it to users. The [examples](https://www.electronjs.org/docs/latest/tutorial/examples) and [API documentation](https://www.electronjs.org/docs/latest/api/app) are also good places to browse around and discover new things.

[Electron Fiddle](https://www.electronjs.org/fiddle) is a sandbox app written with Electron and supported by Electron's maintainers. We highly recommend installing it as a learning tool to experiment with Electron's APIs or to prototype features during development.

Fiddle also integrates nicely with our documentation. When browsing through examples in our tutorials, you'll frequently see an "Open in Electron Fiddle" button underneath a code block. If you have Fiddle installed, this button will open a `fiddle.electronjs.org` link that will automatically load the example into Fiddle, no copy-pasting required.

[docs/fiddles/quick-start (35.0.1)](https://github.com/electron/electron/tree/v35.0.1/docs/fiddles/quick-start)[Open in Fiddle](https://fiddle.electronjs.org/launch?target=electron/v35.0.1/docs/fiddles/quick-start)

All the official documentation is available from the sidebar. These are the different categories and what you can expect on each one:

- **Tutorial**: An end-to-end guide on how to create and publish your first Electron application.
- **Processes in Electron**: In-depth reference on Electron processes and how to work with them.
- **Best Practices**: Important checklists to keep in mind when developing an Electron app.
- **Examples**: Quick references to add features to your Electron app.
- **Development**: Miscellaneous development guides.
- **Distribution**: Learn how to distribute your app to end users.
- **Testing And Debugging**: How to debug JavaScript, write tests, and other tools used to create quality Electron applications.
- **References**: Useful links to better understand how the Electron project works and is organized.
- **Contributing**: Compiling Electron and making contributions can be daunting. We try to make it easier in this section.

Are you getting stuck anywhere? Here are a few links to places to look:

- If you need help with developing your app, our [community Discord server](https://discord.gg/electronjs) is a great place to get advice from other Electron app developers.
- If you suspect you're running into a bug with the `electron` package, please check the [GitHub issue tracker](https://github.com/electron/electron/issues) to see if any existing issues match your problem. If not, feel free to fill out our bug report template and submit a new issue.

**Example**
```javascript
// Basic Electron app example
const { app, BrowserWindow } = require('electron')

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600
  })

  win.loadFile('index.html')
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
```