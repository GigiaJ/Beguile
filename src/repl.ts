import * as vscode from 'vscode';
import { GuileClient } from './guileClient';
import { LispParser, NodeType } from './parser';
import { ASTManager } from './astManager';

export class Repl {
    private outputChannel: vscode.OutputChannel;

    constructor(private client: GuileClient) {
        this.outputChannel = vscode.window.createOutputChannel("Beguile REPL");
        this.outputChannel.show(true);
    }

    public async evaluateSelection(editor: vscode.TextEditor) {
        const selection = editor.selection;
        let text = editor.document.getText(selection);

        // get code
        if (text.trim().length === 0) {
            text = this.getTopLevelForm(editor);
        }
        if (!text) return;

        // detect module
        const moduleName = this.detectModule(editor.document);

        this.outputChannel.show(true);
        const contextLabel = moduleName ? `[${moduleName}] ` : "";
        this.outputChannel.appendLine(`> ${contextLabel}${text}`);

        // send for eval
        try {
            const result = await this.client.eval(text, moduleName);
            this.outputChannel.appendLine(result);
            this.outputChannel.appendLine("");
        } catch (e) {
            this.outputChannel.appendLine(`ERR: Connection failed.`);
        }
    }

    // scan for (define-module (name ...))
    private detectModule(doc: vscode.TextDocument): string | null {
        const text = doc.getText();
        // match (define-module (foo bar) ...)
        // naive regex but should work for like 99% of Scheme files
        const match = text.match(/\(define-module\s+(\([^\)]+\))/);
        if (match && match[1]) {
            return match[1];
        }
        return null;
    }

    // find "(...)" surrounding the cursor at the top level
    private getTopLevelForm(editor: vscode.TextEditor): string {
        const doc = editor.document;
        const cursor = doc.offsetAt(editor.selection.active);
        const root = ASTManager.getTree(doc);

        let node = LispParser.getNodeAtPosition(root, cursor);

        while (node && node.parent && node.parent.type !== NodeType.Root) {
            node = node.parent;
        }

        if (node && node.type === NodeType.List) {
            return doc.getText(new vscode.Range(
                doc.positionAt(node.start),
                doc.positionAt(node.end)
            ));
        }
        return "";
    }
}