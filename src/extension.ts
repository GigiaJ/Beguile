import * as vscode from "vscode";
import { GuileClient } from "./guileClient";

export function activate(context: vscode.ExtensionContext) {
  console.log("Beguile activated");

  const guile = new GuileClient();

  vscode.workspace.onDidOpenTextDocument(async (doc) => {
    if (doc.languageId === "scheme") {
      console.log("Parsing document on open");
      await guile.send(["parse", doc.getText()]);
    }
  });

  vscode.languages.registerDocumentFormattingEditProvider("scheme", {
    async provideDocumentFormattingEdits(document) {
      const code = document.getText();
      console.log("Formatter invoked, sending", code.length, "chars");

      try {
        // 1. Call the .format method specifically
        const formatted = await guile.format(code);

        // 2. Debug: Check if we actually got something back
        if (!formatted) {
          console.warn("Guile returned null/undefined");
          return [];
        }

        if (formatted === code) {
          console.log("No changes needed; code is already formatted.");
          return [];
        }

        // 3. Define the range to cover the WHOLE document
        const lastLine = document.lineAt(document.lineCount - 1);
        const fullRange = new vscode.Range(
          new vscode.Position(0, 0),
          lastLine.range.end
        );

        console.log("Applying TextEdit.replace for", formatted.length, "chars");
        return [vscode.TextEdit.replace(fullRange, formatted)];

      } catch (err) {
        console.error("Guile formatting error:", err);
        return [];
      }
    }
  });

  console.log("Formatter registered");
}
