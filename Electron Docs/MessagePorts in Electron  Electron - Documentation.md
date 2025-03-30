---
title: "MessagePorts in Electron | Electron"
description: "MessagePorts are a web feature that allow passing messages between different contexts. It's like window.postMessage, but on different channels. The goal of this document is to describe how Electron extends the Channel Messaging model, and to give some examples of how you might use MessagePorts in your app."
clipdate: 2025-03-13
source: "https://www.electronjs.org/docs/latest/tutorial/message-ports"
published:
tags:
  - "messagePort"
  - "interProcessCommunication"
  - "electronFramework"
  - "webChannelMessaging"
  - "ipcRendering"
  - "contextIsolation"
  - "crossProcessCommunication"
---
> [!summary]- Summary
> - MessagePorts allow message passing between different contexts in Electron
> - Electron extends the web Channel Messaging API with MessagePortMain and MessageChannelMain
> - MessagePorts can be created in renderer or main processes
> - Ports can be passed between processes using postMessage methods
> - Electron adds a unique 'close' event to MessagePorts
> - Use cases include:
>   * Communication between renderers
>   * Worker process messaging
>   * Streaming responses
>   * Direct communication in context-isolated environments

[`MessagePort`](https://developer.mozilla.org/en-US/docs/Web/API/MessagePort)s are a web feature that allow passing messages between different contexts. It's like `window.postMessage`, but on different channels. The goal of this document is to describe how Electron extends the Channel Messaging model, and to give some examples of how you might use MessagePorts in your app.

Here is a very brief example of what a MessagePort is and how it works:

renderer.js (Renderer Process)

```prism
// MessagePorts are created in pairs. A connected pair of message ports is
// called a channel.
const channel =newMessageChannel()

// The only difference between port1 and port2 is in how you use them. Messages
// sent to port1 will be received by port2 and vice-versa.
const port1 = channel.port1
const port2 = channel.port2

// It's OK to send a message on the channel before the other end has registered
// a listener. Messages will be queued until a listener is registered.
port2.postMessage({answer:42})

// Here we send the other end of the channel, port1, to the main process. It's
// also possible to send MessagePorts to other frames, or to Web Workers, etc.
ipcRenderer.postMessage('port',null,[port1])
```

main.js (Main Process)

```prism
// In the main process, we receive the port.
ipcMain.on('port',(event)=>{
// When we receive a MessagePort in the main process, it becomes a
// MessagePortMain.
const port = event.ports[0]

// MessagePortMain uses the Node.js-style events API, rather than the
// web-style events API. So .on('message', ...) instead of .onmessage = ...
  port.on('message',(event)=>{
// data is { answer: 42 }
const data = event.data
})

// MessagePortMain queues messages until the .start() method has been called.
  port.start()
})
```

The [Channel Messaging API](https://developer.mozilla.org/en-US/docs/Web/API/Channel_Messaging_API) documentation is a great way to learn more about how MessagePorts work.

In the renderer, the `MessagePort` class behaves exactly as it does on the web. The main process is not a web page, though—it has no Blink integration—and so it does not have the `MessagePort` or `MessageChannel` classes. In order to handle and interact with MessagePorts in the main process, Electron adds two new classes: [`MessagePortMain`](https://www.electronjs.org/docs/latest/api/message-port-main) and [`MessageChannelMain`](https://www.electronjs.org/docs/latest/api/message-channel-main). These behave similarly to the analogous classes in the renderer.

`MessagePort` objects can be created in either the renderer or the main process, and passed back and forth using the [`ipcRenderer.postMessage`](https://www.electronjs.org/docs/latest/api/ipc-renderer#ipcrendererpostmessagechannel-message-transfer) and [`WebContents.postMessage`](https://www.electronjs.org/docs/latest/api/web-contents#contentspostmessagechannel-message-transfer) methods. Note that the usual IPC methods like `send` and `invoke` cannot be used to transfer `MessagePort`s, only the `postMessage` methods can transfer `MessagePort`s.

By passing `MessagePort`s via the main process, you can connect two pages that might not otherwise be able to communicate (e.g. due to same-origin restrictions).

Electron adds one feature to `MessagePort` that isn't present on the web, in order to make MessagePorts more useful. That is the `close` event, which is emitted when the other end of the channel is closed. Ports can also be implicitly closed by being garbage-collected.

In the renderer, you can listen for the `close` event either by assigning to `port.onclose` or by calling `port.addEventListener('close', ...)`. In the main process, you can listen for the `close` event by calling `port.on('close', ...)`.

In this example, the main process sets up a MessageChannel, then sends each port to a different renderer. This allows renderers to send messages to each other without needing to use the main process as an in-between.

main.js (Main Process)

```prism
const{BrowserWindow, app,MessageChannelMain}=require('electron')

app.whenReady().then(async()=>{
// create the windows.
const mainWindow =newBrowserWindow({
show:false,
webPreferences:{
contextIsolation:false,
preload:'preloadMain.js'
}
})

const secondaryWindow =newBrowserWindow({
show:false,
webPreferences:{
contextIsolation:false,
preload:'preloadSecondary.js'
}
})

// set up the channel.
const{ port1, port2 }=newMessageChannelMain()

// once the webContents are ready, send a port to each webContents with postMessage.
  mainWindow.once('ready-to-show',()=>{
    mainWindow.webContents.postMessage('port',null,[port1])
})

  secondaryWindow.once('ready-to-show',()=>{
    secondaryWindow.webContents.postMessage('port',null,[port2])
})
})
```

Then, in your preload scripts you receive the port through IPC and set up the listeners.

preloadMain.js and preloadSecondary.js (Preload scripts)

```prism
const{ ipcRenderer }=require('electron')

ipcRenderer.on('port',e=>{
// port received, make it globally available.
window.electronMessagePort= e.ports[0]

window.electronMessagePort.onmessage=messageEvent=>{
// handle message
}
})
```

In this example messagePort is bound to the `window` object directly. It is better to use `contextIsolation` and set up specific contextBridge calls for each of your expected messages, but for the simplicity of this example we don't. You can find an example of context isolation further down this page at [Communicating directly between the main process and the main world of a context-isolated page](https://www.electronjs.org/docs/latest/tutorial/#communicating-directly-between-the-main-process-and-the-main-world-of-a-context-isolated-page)

That means window.electronMessagePort is globally available and you can call `postMessage` on it from anywhere in your app to send a message to the other renderer.

renderer.js (Renderer Process)

```prism
// elsewhere in your code to send a message to the other renderers message handler
window.electronMessagePort.postMessage('ping')
```

In this example, your app has a worker process implemented as a hidden window. You want the app page to be able to communicate directly with the worker process, without the performance overhead of relaying via the main process.

main.js (Main Process)

```prism
const{BrowserWindow, app, ipcMain,MessageChannelMain}=require('electron')

app.whenReady().then(async()=>{
// The worker process is a hidden BrowserWindow, so that it will have access
// to a full Blink context (including e.g. <canvas>, audio, fetch(), etc.)
const worker =newBrowserWindow({
show:false,
webPreferences:{nodeIntegration:true}
})
await worker.loadFile('worker.html')

// The main window will send work to the worker process and receive results
// over a MessagePort.
const mainWindow =newBrowserWindow({
webPreferences:{nodeIntegration:true}
})
  mainWindow.loadFile('app.html')

// We can't use ipcMain.handle() here, because the reply needs to transfer a
// MessagePort.
// Listen for message sent from the top-level frame
  mainWindow.webContents.mainFrame.ipc.on('request-worker-channel',(event)=>{
// Create a new channel ...
const{ port1, port2 }=newMessageChannelMain()
// ... send one end to the worker ...
    worker.webContents.postMessage('new-client',null,[port1])
// ... and the other end to the main window.
    event.senderFrame.postMessage('provide-worker-channel',null,[port2])
// Now the main window and the worker can communicate with each other
// without going through the main process!
})
})
```

worker.html

```prism
<script>
const{ ipcRenderer }=require('electron')

constdoWork=(input)=>{
// Something cpu-intensive.
return input *2
}

// We might get multiple clients, for instance if there are multiple windows,
// or if the main window reloads.
ipcRenderer.on('new-client',(event)=>{
const[ port ]= event.ports
  port.onmessage=(event)=>{
// The event data can be any serializable object (and the event could even
// carry other MessagePorts with it!)
const result =doWork(event.data)
    port.postMessage(result)
}
})
</script>
```

app.html

```prism
<script>
const{ ipcRenderer }=require('electron')

// We request that the main process sends us a channel we can use to
// communicate with the worker.
ipcRenderer.send('request-worker-channel')

ipcRenderer.once('provide-worker-channel',(event)=>{
// Once we receive the reply, we can take the port...
const[ port ]= event.ports
// ... register a handler to receive results ...
  port.onmessage=(event)=>{
console.log('received result:', event.data)
}
// ... and start sending it work!
  port.postMessage(21)
})
</script>
```

Electron's built-in IPC methods only support two modes: fire-and-forget (e.g. `send`), or request-response (e.g. `invoke`). Using MessageChannels, you can implement a "response stream", where a single request responds with a stream of data.

renderer.js (Renderer Process)

```prism
constmakeStreamingRequest=(element, callback)=>{
// MessageChannels are lightweight--it's cheap to create a new one for each
// request.
const{ port1, port2 }=newMessageChannel()

// We send one end of the port to the main process ...
  ipcRenderer.postMessage(
'give-me-a-stream',
{ element,count:10},
[port2]
)

// ... and we hang on to the other end. The main process will send messages
// to its end of the port, and close it when it's finished.
  port1.onmessage=(event)=>{
callback(event.data)
}
  port1.onclose=()=>{
console.log('stream ended')
}
}

makeStreamingRequest(42,(data)=>{
console.log('got response data:', data)
})
// We will see "got response data: 42" 10 times.
```

main.js (Main Process)

```prism
ipcMain.on('give-me-a-stream',(event, msg)=>{
// The renderer has sent us a MessagePort that it wants us to send our
// response over.
const[replyPort]= event.ports

// Here we send the messages synchronously, but we could just as easily store
// the port somewhere and send messages asynchronously.
for(let i =0; i < msg.count; i++){
    replyPort.postMessage(msg.element)
}

// We close the port when we're done to indicate to the other end that we
// won't be sending any more messages. This isn't strictly necessary--if we
// didn't explicitly close the port, it would eventually be garbage
// collected, which would also trigger the 'close' event in the renderer.
  replyPort.close()
})
```

When [context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation) is enabled, IPC messages from the main process to the renderer are delivered to the isolated world, rather than to the main world. Sometimes you want to deliver messages to the main world directly, without having to step through the isolated world.

main.js (Main Process)

```prism
const{BrowserWindow, app,MessageChannelMain}=require('electron')
const path =require('node:path')

app.whenReady().then(async()=>{
// Create a BrowserWindow with contextIsolation enabled.
const bw =newBrowserWindow({
webPreferences:{
contextIsolation:true,
preload: path.join(__dirname,'preload.js')
}
})
  bw.loadURL('index.html')

// We'll be sending one end of this channel to the main world of the
// context-isolated page.
const{ port1, port2 }=newMessageChannelMain()

// It's OK to send a message on the channel before the other end has
// registered a listener. Messages will be queued until a listener is
// registered.
  port2.postMessage({test:21})

// We can also receive messages from the main world of the renderer.
  port2.on('message',(event)=>{
console.log('from renderer main world:', event.data)
})
  port2.start()

// The preload script will receive this IPC message and transfer the port
// over to the main world.
  bw.webContents.postMessage('main-world-port',null,[port1])
})
```

preload.js (Preload Script)

```prism
const{ ipcRenderer }=require('electron')

// We need to wait until the main world is ready to receive the message before
// sending the port. We create this promise in the preload so it's guaranteed
// to register the onload listener before the load event is fired.
const windowLoaded =newPromise(resolve=>{
window.onload= resolve
})

ipcRenderer.on('main-world-port',async(event)=>{
await windowLoaded
// We use regular window.postMessage to transfer the port from the isolated
// world to the main world.
window.postMessage('main-world-port','*', event.ports)
})
```

index.html

```prism
<script>
window.onmessage=(event)=>{
// event.source === window means the message is coming from the preload
// script, as opposed to from an <iframe> or other source.
if(event.source===window&& event.data==='main-world-port'){
const[ port ]= event.ports
// Once we have the port, we can communicate directly with the main
// process.
    port.onmessage=(event)=>{
console.log('from main process:', event.data)
      port.postMessage(event.data.test*2)
}
}
}
</script>
```

**Example**
```javascript
// Main Process
const { BrowserWindow, MessageChannelMain } = require('electron')

const mainWindow = new BrowserWindow()
const secondWindow = new BrowserWindow()

const { port1, port2 } = new MessageChannelMain()

// Send each port to a different renderer
mainWindow.webContents.postMessage('port', null, [port1])
secondWindow.webContents.postMessage('port', null, [port2])

// Renderer Process
const { ipcRenderer } = require('electron')

ipcRenderer.on('port', (event) => {
  const messagePort = event.ports[0]
  
  // Send messages between renderers
  messagePort.postMessage('Hello from other renderer!')
  
  messagePort.onmessage = (msg) => {
    console.log('Received:', msg.data)
  }
})
```