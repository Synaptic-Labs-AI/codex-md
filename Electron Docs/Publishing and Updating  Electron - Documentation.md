---
title: "Publishing and Updating | Electron"
description: "There are several ways to update an Electron application. The easiest and officially supported one is taking advantage of the built-in Squirrel framework and Electron's autoUpdater module."
clipdate: 2025-03-13
source: "https://www.electronjs.org/docs/latest/tutorial/tutorial-publishing-updating"
published:
tags:
  - "electronUpdates"
  - "gitHubReleases"
  - "autoUpdater"
  - "electronForge"
  - "openSourceDistribution"
  - "softwarePublishing"
  - "electronApp"
---
> [!summary]- Summary
> - Electron provides a free auto-updating service for open-source apps via update.electronjs.org
> - Requirements include public GitHub repository, GitHub releases, and code signing for macOS
> - Use Electron Forge's GitHub Publisher to automate distribution of packaged applications
> - Generate a personal access token with public_repo scope for GitHub releases
> - Use `update-electron-app` module to easily configure auto-updates
> - Recommended to use GitHub Actions for cross-platform publishing

Follow along the tutorial

This is **part 6** of the Electron tutorial.

1. [Prerequisites](https://www.electronjs.org/docs/latest/tutorial/tutorial-prerequisites)
2. [Building your First App](https://www.electronjs.org/docs/latest/tutorial/tutorial-first-app)
3. [Using Preload Scripts](https://www.electronjs.org/docs/latest/tutorial/tutorial-preload)
4. [Adding Features](https://www.electronjs.org/docs/latest/tutorial/tutorial-adding-features)
5. [Packaging Your Application](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging)
6. **[Publishing and Updating](https://www.electronjs.org/docs/latest/tutorial/tutorial-publishing-updating)**

If you've been following along, this is the last step of the tutorial! In this part, you will publish your app to GitHub releases and integrate automatic updates into your app code.

The Electron maintainers provide a free auto-updating service for open-source apps at [https://update.electronjs.org](https://update.electronjs.org/). Its requirements are:

- Your app runs on macOS or Windows
- Your app has a public GitHub repository
- Builds are published to [GitHub releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
- Builds are [code signed](https://www.electronjs.org/docs/latest/tutorial/code-signing) **(macOS only)**

At this point, we'll assume that you have already pushed all your code to a public GitHub repository.

Alternative update services

If you're using an alternate repository host (e.g. GitLab or Bitbucket) or if you need to keep your code repository private, please refer to our [step-by-step guide](https://www.electronjs.org/docs/latest/tutorial/updates) on hosting your own Electron update server.

Electron Forge has [Publisher](https://www.electronforge.io/config/publishers) plugins that can automate the distribution of your packaged application to various sources. In this tutorial, we will be using the GitHub Publisher, which will allow us to publish our code to GitHub releases.

Forge cannot publish to any repository on GitHub without permission. You need to pass in an authenticated token that gives Forge access to your GitHub releases. The easiest way to do this is to [create a new personal access token (PAT)](https://github.com/settings/tokens/new) with the `public_repo` scope, which gives write access to your public repositories. **Make sure to keep this token a secret.**

Forge's [GitHub Publisher](https://www.electronforge.io/config/publishers/github) is a plugin that needs to be installed in your project's `devDependencies`:

Once you have it installed, you need to set it up in your Forge configuration. A full list of options is documented in the Forge's [`PublisherGitHubConfig`](https://js.electronforge.io/interfaces/_electron_forge_publisher_github.PublisherGitHubConfig.html) API docs.

forge.config.js

```prism
module.exports={
publishers:[
{
name:'@electron-forge/publisher-github',
config:{
repository:{
owner:'github-user-name',
name:'github-repo-name'
},
prerelease:false,
draft:true
}
}
]
}
```

Drafting releases before publishing

Notice that you have configured Forge to publish your release as a draft. This will allow you to see the release with its generated artifacts without actually publishing it to your end users. You can manually publish your releases via GitHub after writing release notes and double-checking that your distributables work.

You also need to make the Publisher aware of your authentication token. By default, it will use the value stored in the `GITHUB_TOKEN` environment variable.

Add Forge's [publish command](https://www.electronforge.io/cli#publish) to your npm scripts.

package.json

```prism
//...
"scripts":{
"start":"electron-forge start",
"package":"electron-forge package",
"make":"electron-forge make",
"publish":"electron-forge publish"
},
//...
```

This command will run your configured makers and publish the output distributables to a new GitHub release.

By default, this will only publish a single distributable for your host operating system and architecture. You can publish for different architectures by passing in the `--arch` flag to your Forge commands.

The name of this release will correspond to the `version` field in your project's package.json file.

Tagging releases

Optionally, you can also [tag your releases in Git](https://git-scm.com/book/en/v2/Git-Basics-Tagging) so that your release is associated with a labeled point in your code history. npm comes with a handy [`npm version`](https://docs.npmjs.com/cli/v8/commands/npm-version) command that can handle the version bumping and tagging for you.

Publishing locally can be painful, especially because you can only create distributables for your host operating system (i.e. you can't publish a Windows `.exe` file from macOS).

A solution for this would be to publish your app via automation workflows such as [GitHub Actions](https://github.com/features/actions), which can run tasks in the cloud on Ubuntu, macOS, and Windows. This is the exact approach taken by [Electron Fiddle](https://www.electronjs.org/fiddle). You can refer to Fiddle's [Build and Release pipeline](https://github.com/electron/fiddle/blob/main/.circleci/config.yml) and [Forge configuration](https://github.com/electron/fiddle/blob/main/forge.config.ts) for more details.

Now that we have a functional release system via GitHub releases, we now need to tell our Electron app to download an update whenever a new release is out. Electron apps do this via the [autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater) module, which reads from an update server feed to check if a new version is available for download.

The update.electronjs.org service provides an updater-compatible feed. For example, Electron Fiddle v0.28.0 will check the endpoint at [https://update.electronjs.org/electron/fiddle/darwin/v0.28.0](https://update.electronjs.org/electron/fiddle/darwin/v0.28.0) to see if a newer GitHub release is available.

After your release is published to GitHub, the update.electronjs.org service should work for your application. The only step left is to configure the feed with the autoUpdater module.

To make this process easier, the Electron team maintains the [`update-electron-app`](https://github.com/electron/update-electron-app) module, which sets up the autoUpdater boilerplate for update.electronjs.org in one function call — no configuration required. This module will search for the update.electronjs.org feed that matches your project's package.json `"repository"` field.

First, install the module as a runtime dependency.

Then, import the module and call it immediately in the main process.

main.js

```prism
require('update-electron-app')()
```

And that is all it takes! Once your application is packaged, it will update itself for each new GitHub release that you publish.

In this tutorial, we configured Electron Forge's GitHub Publisher to upload your app's distributables to GitHub releases. Since distributables cannot always be generated between platforms, we recommend setting up your building and publishing flow in a Continuous Integration pipeline if you do not have access to machines.

Electron applications can self-update by pointing the autoUpdater module to an update server feed. update.electronjs.org is a free update server provided by Electron for open-source applications published on GitHub releases. Configuring your Electron app to use this service is as easy as installing and importing the `update-electron-app` module.

If your application is not eligible for update.electronjs.org, you should instead deploy your own update server and configure the autoUpdater module yourself.

🌟 You're done!

From here, you have officially completed our tutorial to Electron. Feel free to explore the rest of our docs and happy developing! If you have questions, please stop by our community [Discord server](https://discord.gg/electronjs).

**Example**
```javascript
// Install dependencies
npm install update-electron-app @electron-forge/publisher-github

// In forge.config.js
module.exports = {
  publishers: [{
    name: '@electron-forge/publisher-github',
    config: {
      repository: {
        owner: 'your-username',
        name: 'your-repo'
      },
      prerelease: false,
      draft: true
    }
  }]
}

// In main.js
require('update-electron-app')()
```