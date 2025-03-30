---
title: "Desktop Launcher Actions | Electron"
description: "Add actions to the system launcher on Linux environments."
clipdate: 2025-03-13
source: "https://www.electronjs.org/docs/latest/tutorial/linux-desktop-actions"
published:
tags:
  - "electronApp"
  - "linuxDesktop"
  - "desktopActions"
  - "systemLauncher"
  - "applicationShortcuts"
---
> [!summary]- Summary
> - Linux environments support custom system launcher entries via .desktop files
> - These entries can add shortcut actions for applications
> - Shortcuts require Name and Exec properties
> - Actions are defined with specific syntax in the .desktop file
> - Preferred method is passing parameters that can be accessed via process.argv

On many Linux environments, you can add custom entries to the system launcher by modifying the `.desktop` file. For Canonical's Unity documentation, see [Adding Shortcuts to a Launcher](https://help.ubuntu.com/community/UnityLaunchersAndDesktopFiles#Adding_shortcuts_to_a_launcher). For details on a more generic implementation, see the [freedesktop.org Specification](https://specifications.freedesktop.org/desktop-entry-spec/desktop-entry-spec-latest.html).

![audacious](https://help.ubuntu.com/community/UnityLaunchersAndDesktopFiles?action=AttachFile&do=get&target=shortcuts.png)

> NOTE: The screenshot above is an example of launcher shortcuts in Audacious audio player

To create a shortcut, you need to provide `Name` and `Exec` properties for the entry you want to add to the shortcut menu. Unity will execute the command defined in the `Exec` field after the user clicked the shortcut menu item. An example of the `.desktop` file may look as follows:

```prism
Actions=PlayPause;Next;Previous

[Desktop Action PlayPause]
Name=Play-Pause
Exec=audacious -t
OnlyShowIn=Unity;

[Desktop Action Next]
Name=Next
Exec=audacious -f
OnlyShowIn=Unity;

[Desktop Action Previous]
Name=Previous
Exec=audacious -r
OnlyShowIn=Unity;
```

The preferred way for Unity to instruct your application on what to do is using parameters. You can find them in your application in the global variable `process.argv`.

**Example**
```desktop
[Desktop Entry]
Actions=NewDocument;OpenRecent

[Desktop Action NewDocument]
Name=New Document
Exec=electron /path/to/app --new-doc

[Desktop Action OpenRecent]
Name=Open Recent
Exec=electron /path/to/app --open-recent
```

```javascript
// In your main process
if (process.argv.includes('--new-doc')) {
  createNewDocument();
} else if (process.argv.includes('--open-recent')) {
  openRecentDocuments();
}
```