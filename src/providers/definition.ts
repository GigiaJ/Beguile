import * as vscode from 'vscode';
import { GuileClient } from '../guileClient';
import { Analyzer } from '../paredit/analyzer';

export class SchemeDefinitionProvider implements vscode.DefinitionProvider {

    constructor(private client: GuileClient) { }

    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Definition | null> {

        const range = document.getWordRangeAtPosition(position);
        if (!range) return null;
        const word = document.getText(range);

        const contextStack = Analyzer.getContextStack(document, position);

        try {
            const loc = await this.client.getDefinition(word, document.getText(), contextStack);

            if (loc && loc.file) {
                const uri = vscode.Uri.file(loc.file);
                let line = loc.line || 0;
                let col = loc.column || 0;

                // Heuristic search for when the server returns line 0 we need to try to find it ourself
                if (line === 0) {
                    try {
                        const targetDoc = await vscode.workspace.openTextDocument(uri);
                        const text = targetDoc.getText();

                        const regex = new RegExp(`\\b${word}\\b`);
                        const match = text.match(regex);

                        if (match && match.index !== undefined) {
                            const newPos = targetDoc.positionAt(match.index);
                            line = newPos.line;
                            col = newPos.character;
                        }
                    } catch (e) {
                        // Line 0 if fail
                    }
                }

                const pos = new vscode.Position(line, col);
                return new vscode.Location(uri, new vscode.Range(pos, pos));
            }
        } catch (e) {
            console.error("Beguile Definition Error:", e);
        }
        return null;
    }
}