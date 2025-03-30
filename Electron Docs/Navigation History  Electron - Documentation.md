---
title: "Navigation History | Electron"
description: "The NavigationHistory API allows you to manage and interact with the browsing history of your Electron application."
clipdate: 2025-03-13
source: "https://www.electronjs.org/docs/latest/tutorial/navigation-history"
published:
tags:
  - "navigationHistory"
  - "browserHistory"
  - "webContentsNavigation"
  - "electronNavigation"
  - "historyManagement"
---
> [!summary]- Summary
> - NavigationHistory allows managing browsing history in Electron applications
> - Navigation history is stored per WebContents instance
> - Can navigate back and forward through history entries
> - Supports retrieving all history entries
> - Allows navigating to specific history entries by index or offset
> - Can restore navigation history between different windows
> - Provides methods like `canGoBack()`, `goBack()`, `getAllEntries()`, and `goToIndex()`

The [NavigationHistory](https://www.electronjs.org/docs/latest/api/navigation-history) class allows you to manage and interact with the browsing history of your Electron application. This powerful feature enables you to create intuitive navigation experiences for your users.

Navigation history is stored per [`WebContents`](https://www.electronjs.org/docs/latest/api/web-contents) instance. To access a specific instance of the NavigationHistory class, use the WebContents class's [`contents.navigationHistory` instance property](https://www.electronjs.org/docs/latest/api/web-contents#contentsnavigationhistory-readonly).

```prism
const{BrowserWindow}=require('electron')

const mainWindow =newBrowserWindow()
const{ navigationHistory }= mainWindow.webContents
```

Easily implement back and forward navigation:

```prism
// Go back
if(navigationHistory.canGoBack()){
  navigationHistory.goBack()
}

// Go forward
if(navigationHistory.canGoForward()){
  navigationHistory.goForward()
}
```

Retrieve and display the user's browsing history:

```prism
const entries = navigationHistory.getAllEntries()

entries.forEach((entry)=>{
console.log(\`${entry.title}: ${entry.url}\`)
})
```

Each navigation entry corresponds to a specific page. The indexing system follows a sequential order:

- Index 0: Represents the earliest visited page.
- Index N: Represents the most recent page visited.

Allow users to jump to any point in their browsing history:

```prism
// Navigate to the 5th entry in the history, if the index is valid
navigationHistory.goToIndex(4)

// Navigate to the 2nd entry forward from the current position
if(navigationHistory.canGoToOffset(2)){
  navigationHistory.goToOffset(2)
}
```

A common flow is that you want to restore the history of a webContents - for instance to implement an "undo close tab" feature. To do so, you can call `navigationHistory.restore({ index, entries })`. This will restore the webContent's navigation history and the webContents location in said history, meaning that `goBack()` and `goForward()` navigate you through the stack as expected.

```prism
const firstWindow =newBrowserWindow()

// Later, you want a second window to have the same history and navigation position
asyncfunctionrestore(){
const entries = firstWindow.webContents.navigationHistory.getAllEntries()
const index = firstWindow.webContents.navigationHistory.getActiveIndex()

const secondWindow =newBrowserWindow()
await secondWindow.webContents.navigationHistory.restore({ index, entries })
}
```

Here's a full example that you can open with Electron Fiddle:

[docs/fiddles/features/navigation-history (35.0.1)](https://github.com/electron/electron/tree/v35.0.1/docs/fiddles/features/navigation-history)[Open in Fiddle](https://fiddle.electronjs.org/launch?target=electron/v35.0.1/docs/fiddles/features/navigation-history)

**Example**
```javascript
const { BrowserWindow } = require('electron')

const mainWindow = new BrowserWindow()
const { navigationHistory } = mainWindow.webContents

// Navigate through history
if (navigationHistory.canGoBack()) {
  navigationHistory.goBack()
}

// Get all history entries
const entries = navigationHistory.getAllEntries()
entries.forEach((entry) => {
  console.log(`Page: ${entry.title}, URL: ${entry.url}`)
})

// Navigate to a specific history entry
navigationHistory.goToIndex(2)
```