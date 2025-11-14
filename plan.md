
currently the extension and server code assume there is only one tab attached to debugger only. i want instead to be able to manage multiple tabs. we should update all classes fields that manage tab state to a array  {tabId, dsessionId, targetId}[], then we should send relevant commands to the right chrome.debugger debugee tab, finding the right tab for a specific CDP command (based on sessionId or targetId)

---

now see where attachToTab is sent and received. see that we basically attach to the tab as soon as the playwright instance connects. I want to change this: instead attach to the tab when we click on the extension icon, meaning inside onClicked in background.ts. when this happens we should also send also a cdp message from the extension for Target.attachedToTarget after we are connected. so playwright knows of this new page and will list it in browser.pages()

now see where we already are sending Target.attachedToTarget. this is now sent after setAutoAttach, meaning as soon as playwright connects. let's change this. we should not do anything during setAutoAttach, leave it empty for now.

at the end the extension should basically:
- let the server know of new pages only when the user clicks one
- support multiple tabs, the extension icon should not be gray if a tab is in the array of tabs. this icon state should be switched also during onActivate so that we know when user changes current tab
- we should remove the code that currently closes the previous tab debugger session. this was there because it assumed there can only be one session at a time
- simplify overall code. for example removing methods that are only used once and inlining them in the parent method.
- remove a tab from the array when playwright sends command Target.closeTarget, based on passed targetId


notice that we can know what a command and response is for which target based on sessionId or targetId in the payloads. we can know which messages have these thanks to the d
devtools-protocol package types


at the end typecheck. try not to use as any or other as.

remember: each tab will have different sessionId and targetId. based on these we can associate each CDP command to a specific tab.



playwright usually will basically discover pages thanks to our messages Target.attachedToTarget. those messages will let playwright know what is the sessionId for each target.

playwright will use Target.createTarget to create a new page. we will return a targetId and right after trigger a Target.attachedToTarget to let playwright know also the session to use.

remember that we must use same id field for CDP responses. to associate a response to a CDP command, using the same id. this let us send interpolated and concurrent messages
