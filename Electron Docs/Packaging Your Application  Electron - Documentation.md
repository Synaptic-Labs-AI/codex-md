---
title: "Packaging Your Application | Electron"
description: "To distribute your app with Electron, you need to package it and create installers."
clipdate: 2025-03-13
source: "https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging"
published:
tags:
  - "electronApp"
  - "packaging"
  - "distribution"
  - "electronForge"
  - "desktopDevelopment"
  - "codeSigning"
  - "applicationBundle"
  - "crossPlatform"
---
> [!summary]- Summary
> - Electron requires additional tooling to package and distribute applications
> - Electron Forge is an all-in-one tool for packaging and distribution
> - Steps to package an app:
>   * Install Electron Forge CLI
>   * Import existing project using conversion script
>   * Use `npm run make` to create distributables
> - Code signing is highly recommended for desktop applications
> - Signing ensures application authenticity and trust
> - Supports different distributable formats per operating system

Follow along the tutorial

This is **part 5** of the Electron tutorial.

1. [Prerequisites](https://www.electronjs.org/docs/latest/tutorial/tutorial-prerequisites)
2. [Building your First App](https://www.electronjs.org/docs/latest/tutorial/tutorial-first-app)
3. [Using Preload Scripts](https://www.electronjs.org/docs/latest/tutorial/tutorial-preload)
4. [Adding Features](https://www.electronjs.org/docs/latest/tutorial/tutorial-adding-features)
5. **[Packaging Your Application](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging)**
6. [Publishing and Updating](https://www.electronjs.org/docs/latest/tutorial/tutorial-publishing-updating)

In this part of the tutorial, we'll be going over the basics of packaging and distributing your app with [Electron Forge](https://www.electronforge.io/).

Electron does not have any tooling for packaging and distribution bundled into its core modules. Once you have a working Electron app in dev mode, you need to use additional tooling to create a packaged app you can distribute to your users (also known as a **distributable**). Distributables can be either installers (e.g. MSI on Windows) or portable executable files (e.g. `.app` on macOS).

Electron Forge is an all-in-one tool that handles the packaging and distribution of Electron apps. Under the hood, it combines a lot of existing Electron tools (e.g. [`@electron/packager`](https://github.com/electron/packager), [`@electron/osx-sign`](https://github.com/electron/osx-sign), [`electron-winstaller`](https://github.com/electron/windows-installer), etc.) into a single interface so you do not have to worry about wiring them all together.

You can install Electron Forge's CLI in your project's `devDependencies` and import your existing project with a handy conversion script.

Once the conversion script is done, Forge should have added a few scripts to your `package.json` file.

package.json

```prism
//...
"scripts":{
"start":"electron-forge start",
"package":"electron-forge package",
"make":"electron-forge make"
},
//...
```

CLI documentation

For more information on `make` and other Forge APIs, check out the [Electron Forge CLI documentation](https://www.electronforge.io/cli#commands).

You should also notice that your package.json now has a few more packages installed under `devDependencies`, and a new `forge.config.js` file that exports a configuration object. You should see multiple makers (packages that generate distributable app bundles) in the pre-populated configuration, one for each target platform.

To create a distributable, use your project's new `make` script, which runs the `electron-forge make` command.

This `make` command contains two steps:

1. It will first run `electron-forge package` under the hood, which bundles your app code together with the Electron binary. The packaged code is generated into a folder.
2. It will then use this packaged app folder to create a separate distributable for each configured maker.

After the script runs, you should see an `out` folder containing both the distributable and a folder containing the packaged application code.

macOS output example

```prism
out/
├── out/make/zip/darwin/x64/my-electron-app-darwin-x64-1.0.0.zip
├── ...
└── out/my-electron-app-darwin-x64/my-electron-app.app/Contents/MacOS/my-electron-app
```

The distributable in the `out/make` folder should be ready to launch! You have now created your first bundled Electron application.

Distributable formats

Electron Forge can be configured to create distributables in different OS-specific formats (e.g. DMG, deb, MSI, etc.). See Forge's [Makers](https://www.electronforge.io/config/makers) documentation for all configuration options.

Creating and adding application icons

Setting custom application icons requires a few additions to your config. Check out [Forge's icon tutorial](https://www.electronforge.io/guides/create-and-add-icons) for more information.

Packaging without Electron Forge

If you want to manually package your code, or if you're just interested understanding the mechanics behind packaging an Electron app, check out the full [Application Packaging](https://www.electronjs.org/docs/latest/tutorial/application-distribution) documentation.

In order to distribute desktop applications to end users, we *highly recommend* that you **code sign** your Electron app. Code signing is an important part of shipping desktop applications, and is mandatory for the auto-update step in the final part of the tutorial.

Code signing is a security technology that you use to certify that a desktop app was created by a known source. Windows and macOS have their own OS-specific code signing systems that will make it difficult for users to download or launch unsigned applications.

On macOS, code signing is done at the app packaging level. On Windows, distributable installers are signed instead. If you already have code signing certificates for Windows and macOS, you can set your credentials in your Forge configuration.

info

For more information on code signing, check out the [Signing macOS Apps](https://www.electronforge.io/guides/code-signing) guide in the Forge docs.

Electron applications need to be packaged to be distributed to users. In this tutorial, you imported your app into Electron Forge and configured it to package your app and generate installers.

In order for your application to be trusted by the user's system, you need to digitally certify that the distributable is authentic and untampered by code signing it. Your app can be signed through Forge once you configure it to use your code signing certificate information.

**Example**
```javascript
// Install Electron Forge
npm install --save-dev @electron-forge/cli

// Import project
npx electron-forge import

// Update package.json scripts
{
  \\"scripts\\": {
    \\"start\\": \\"electron-forge start\