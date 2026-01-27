import * as vscode from 'vscode';
const cljsFormatter = require('../../out/formatter');

export class Formatter {
    private static client: any;

    public static updateRules(client: any) {
        this.client = client;
    }

    public static format(doc: vscode.TextDocument): vscode.TextEdit[] {
        const fullText = doc.getText();

        try {
            const formatted = cljsFormatter.format_string(fullText);

            if (formatted === fullText) return [];

            const fullRange = new vscode.Range(
                doc.positionAt(0),
                doc.positionAt(fullText.length)
            );
            return [vscode.TextEdit.replace(fullRange, formatted)];
        } catch (e) {
            console.error("CLJS Formatter crashed:", e);
            return [];
        }
    }
}