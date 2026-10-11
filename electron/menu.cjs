const { app, Menu } = require("electron");

// The page sees each key first; a shortcut it handles never reaches the menu.
// Compile has no menu shortcut because ⌘↵ in a text field must stay inert.
function applicationMenu(send) {
  const command = (label, id, accelerator) => ({
    label,
    accelerator,
    click: () => send(id),
  });
  return Menu.buildFromTemplate([
    {
      role: "appMenu",
      submenu: [
        { role: "about" },
        { type: "separator" },
        command("Settings…", "go-settings", "CmdOrCtrl+,"),
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        command("New Project", "new-project"),
        command("Search Workspace…", "search", "CmdOrCtrl+K"),
        command("Command Palette…", "commands", "Shift+CmdOrCtrl+P"),
        { type: "separator" },
        command("Save", "save", "CmdOrCtrl+S"),
        command("Compile", "compile"),
        command("Add Reference…", "add-reference"),
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        command("Toggle Sidebar", "toggle-sidebar", "CmdOrCtrl+\\"),
        command("Toggle Dark Mode", "toggle-theme"),
        { type: "separator" },
        command("Agent", "layout-agent"),
        command("Source", "layout-edit"),
        command("Both", "layout-columns"),
        { type: "separator" },
        command("Show Cursor in PDF", "show-in-pdf", "Shift+CmdOrCtrl+J"),
        command("Build Log", "panel-build"),
        command("Terminal", "panel-terminal"),
        command("AI Panel", "panel-ai"),
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(app.isPackaged
          ? []
          : [{ role: "reload" }, { role: "toggleDevTools" }]),
      ],
    },
    {
      label: "Go",
      submenu: [
        command("Overview", "go-overview"),
        command("Project Board", "go-board"),
        command("Dates & Deadlines", "go-deadlines"),
        command("Research Collection", "go-collection"),
        command("Current Project Workbench", "go-workbench"),
      ],
    },
    { role: "windowMenu" },
  ]);
}
// Pages with their own menu prevent this event; elsewhere editable text
// gets spelling suggestions and the standard edit commands.
function editMenu(win) {
  win.webContents.on("context-menu", (_event, params) => {
    const template = [];
    if (params.misspelledWord) {
      for (const word of params.dictionarySuggestions.slice(0, 6))
        template.push({
          label: word,
          click: () => win.webContents.replaceMisspelling(word),
        });
      if (!params.dictionarySuggestions.length)
        template.push({ label: "No guesses found", enabled: false });
      template.push(
        {
          label: "Learn Spelling",
          click: () =>
            win.webContents.session.addWordToSpellCheckerDictionary(
              params.misspelledWord,
            ),
        },
        { type: "separator" },
      );
    }
    if (params.isEditable)
      template.push(
        { role: "cut", enabled: params.editFlags.canCut },
        { role: "copy", enabled: params.editFlags.canCopy },
        { role: "paste", enabled: params.editFlags.canPaste },
        { type: "separator" },
        { role: "selectAll" },
      );
    else if (params.selectionText.trim()) template.push({ role: "copy" });
    if (template.length)
      Menu.buildFromTemplate(template).popup({ window: win });
  });
}
module.exports = { applicationMenu, editMenu };
