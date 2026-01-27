import * as vscode from 'vscode';
import { GuileClient } from '../guileClient';
import { Analyzer } from '../paredit/analyzer';

export class SchemeHoverProvider implements vscode.HoverProvider {

    constructor(private client: GuileClient) { }

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Hover | null> {

        const range = document.getWordRangeAtPosition(position);
        if (!range) return null;

        const word = document.getText(range);

        try {
            const contextStack = Analyzer.getContextStack(document, position);
            const docText = await this.client.getDocs(word, document.getText(), contextStack);

            if (!docText || docText.includes("No documentation found")) {
                return null;
            }

            const md = new vscode.MarkdownString();
            md.appendCodeblock(docText, "scheme");
            return new vscode.Hover(md);

        } catch (e) {
            console.error("Beguile Hover Error:", e);
            return null;
        }
    }
}