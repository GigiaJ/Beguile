import * as vscode from "vscode";
import { GuileClient } from "./guileClient";
import { GuileServer } from "./guileServer";
import { ASTManager } from "./astManager";
import { Paredit } from "./paredit/edit";
import { RainbowHighlighter } from "./paredit/rainbow";
import { Formatter } from "./paredit/formatter";
import { SchemeCompletionProvider } from "./providers/completion";
import { SchemeHoverProvider } from "./providers/hover";
import { SchemeDefinitionProvider } from "./providers/definition";
import { Repl } from "./repl";

let server: GuileServer;
let client: GuileClient;

export function activate(context: vscode.ExtensionContext) {
  console.log("Beguile activated");

  server = new GuileServer();
  server.start(context.extensionPath);
  client = new GuileClient();
  const rainbows = new RainbowHighlighter();
  const repl = new Repl(client);

  const updateIndentRules = (doc: vscode.TextDocument) => {
    if (doc.languageId === 'scheme') {
      Formatter.updateRules(client, doc);
    }
  };

  // one listener to avoid race
  const onDocumentChange = (e: vscode.TextDocumentChangeEvent) => {
    if (e.document.languageId === 'scheme') {
      ASTManager.refresh(e.document);

      // only update rainbow on active window to make lighter
      if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) {
        rainbows.updateRainbows(vscode.window.activeTextEditor);
        rainbows.matchPairs(vscode.window.activeTextEditor);
      }
    }
  };


  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(onDocumentChange),

    vscode.workspace.onDidOpenTextDocument(doc => {
      if (doc.languageId === 'scheme') {
        ASTManager.refresh(doc);
        updateIndentRules(doc);
      }
    }),

    vscode.workspace.onDidSaveTextDocument(updateIndentRules),

    vscode.workspace.onDidCloseTextDocument(doc => {
      ASTManager.remove(doc);
    }),

    vscode.window.onDidChangeTextEditorSelection(event => {
      if (event.textEditor === vscode.window.activeTextEditor) {
        rainbows.matchPairs(event.textEditor);
      }
    }),

    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor && editor.document.languageId === 'scheme') {
        ASTManager.refresh(editor.document);
        rainbows.updateRainbows(editor);
        rainbows.matchPairs(editor);
      }
    }),


    vscode.commands.registerCommand("beguile.eval", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) repl.evaluateSelection(editor);
    }),

    vscode.commands.registerCommand("beguile.restartServer", () => {
      server.restart(context.extensionPath);
      vscode.window.showInformationMessage("Beguile Server Restarted");
    }),


    vscode.languages.registerCompletionItemProvider(
      "scheme", new SchemeCompletionProvider(client)
    ),
    vscode.languages.registerHoverProvider(
      "scheme", new SchemeHoverProvider(client)
    ),
    vscode.languages.registerDefinitionProvider(
      "scheme", new SchemeDefinitionProvider(client)
    ),

    vscode.languages.registerDocumentFormattingEditProvider("scheme", {
      provideDocumentFormattingEdits(document) {
        return Formatter.format(document);
      }
    }),

    vscode.commands.registerCommand('beguile.paredit.slurpForward', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) Paredit.slurpForward(editor);
    }),
    vscode.commands.registerCommand('beguile.paredit.barfForward', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) Paredit.barfForward(editor);
    }),
    vscode.commands.registerCommand('beguile.paredit.wrap', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) Paredit.wrap(editor);
    }),
    vscode.commands.registerCommand('beguile.paredit.splice', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) Paredit.splice(editor);
    }),
    vscode.commands.registerCommand('beguile.forwardSexp', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) Paredit.forwardSexp(editor);
    }),
    vscode.commands.registerCommand('beguile.backwardSexp', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) Paredit.backwardSexp(editor);
    }),
    vscode.commands.registerCommand('beguile.selectForwardSexp', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) Paredit.selectForwardSexp(editor);
    }),
    vscode.commands.registerCommand('beguile.selectBackwardSexp', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) Paredit.selectBackwardSexp(editor);
    })
  );

  if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.languageId === 'scheme') {
    const doc = vscode.window.activeTextEditor.document;
    ASTManager.refresh(doc);
    updateIndentRules(doc);
    rainbows.updateRainbows(vscode.window.activeTextEditor);
  }
}

export function deactivate() {
  if (server) {
    server.stop();
  }
}