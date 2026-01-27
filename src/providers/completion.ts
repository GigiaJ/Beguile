import * as vscode from 'vscode';
import { GuileClient } from '../guileClient';
import { LispParser } from '../parser';

export class SchemeCompletionProvider implements vscode.CompletionItemProvider {

    constructor(private client: GuileClient) { }

    // fast name resolve
    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.CompletionItem[]> {

        const range = document.getWordRangeAtPosition(position);
        if (!range) return [];

        const word = document.getText(range);
        if (word.length < 2) return [];

        // Local Symbols
        const localSymbols = LispParser.getLocalSymbols(document.getText());
        const localMatches = localSymbols.filter(s => s.startsWith(word));

        // Server Symbols
        let serverMatches: string[] = [];
        try {
            // 'prefix' based lookup on the server
            serverMatches = await this.client.getCompletions(word);
        } catch (e) { }

        const allSymbols = new Set([...localMatches, ...serverMatches]);

        return Array.from(allSymbols).map(label => {
            const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Function);
            return item;
        });
    }

    // Lazy def resolve
    async resolveCompletionItem(item: vscode.CompletionItem, token: vscode.CancellationToken): Promise<vscode.CompletionItem> {
        if (!item.label) return item;
        const label = typeof item.label === 'string' ? item.label : item.label.label;

        try {
            const docText = await this.client.getDocs(label, "", []);

            if (docText && !docText.includes("No documentation found")) {
                // The docText is markdown like "**(sig)**\n\nDocs..."
                item.documentation = new vscode.MarkdownString(docText);
                const lines = docText.split('\n');
                if (lines.length > 0 && lines[0].startsWith('**')) {
                    // Clean up the markdown **(sig)** -> (sig)
                    item.detail = lines[0].replace(/\*\*/g, '');
                }
            }
        } catch (e) {
            // return the item without docs
        }

        return item;
    }
}