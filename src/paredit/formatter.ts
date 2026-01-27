import * as vscode from 'vscode';
import { LispParser, NodeType, ASTNode } from '../parser';
import { GuileClient } from '../guileClient';
import { ASTManager } from '../astManager';

export class Formatter {
    private static indentCache = new Map<string, string>();

    private static specialForms = new Set([
        'define', 'define-public', 'define-module', 'lambda', 'let', 'let*', 'letrec',
        'begin', 'case', 'cond', 'if', 'when', 'unless', 'with-output-to-string',
        'match', 'syntax-rules', 'syntax-case', 'description', 'synopsis'
    ]);

    private static specialPattern = /^(def|with-|do-|mock-)/;

    static async updateRules(client: GuileClient, doc: vscode.TextDocument) {
        const root = ASTManager.getTree(doc);

        const symbolsToCheck = new Set<string>();

        const walk = (node: ASTNode) => {
            if (node.type === NodeType.List && node.children.length > 0) {
                const head = node.children[0];
                if (head.type === NodeType.Atom) {
                    const name = doc.getText(new vscode.Range(
                        doc.positionAt(head.start), doc.positionAt(head.end)
                    ));
                    if (!this.specialForms.has(name) && !this.indentCache.has(name)) {
                        symbolsToCheck.add(name);
                    }
                }
            }
            node.children.forEach(walk);
        };
        walk(root);

        // TODO: batch these
        for (const sym of symbolsToCheck) {
            client.getIndentInfo(sym).then((info: any) => {
                if (info && info.style) {
                    this.indentCache.set(sym, info.style);
                }
            }).catch(() => { });
        }
    }

    static format(doc: vscode.TextDocument): vscode.TextEdit[] {
        const root = ASTManager.getTree(doc);
        const edits: vscode.TextEdit[] = [];

        for (let i = 0; i < doc.lineCount; i++) {
            const line = doc.lineAt(i);
            if (line.isEmptyOrWhitespace) continue;

            const currentIndent = line.firstNonWhitespaceCharacterIndex;
            const firstCharOffset = doc.offsetAt(line.range.start) + currentIndent;

            let node = LispParser.getNodeAtPosition(root, firstCharOffset);

            if (node && node.type === NodeType.String) {
                const startPos = doc.positionAt(node.start);
                // handle continuation lines so to not break strings
                if (startPos.line < i) {
                    continue;
                }
            }

            let parent = node;
            while (parent && (parent.start === firstCharOffset || parent.type !== NodeType.List)) {
                parent = parent.parent || null;
            }

            // Top level -> 0 indent
            if (!parent || parent.type === NodeType.Root) {
                if (currentIndent !== 0) {
                    edits.push(vscode.TextEdit.replace(
                        new vscode.Range(line.range.start, new vscode.Position(i, currentIndent)),
                        ""
                    ));
                }
                continue;
            }

            const correctIndent = this.calculateIndent(doc, parent);

            if (correctIndent !== currentIndent) {
                const newText = " ".repeat(correctIndent);
                edits.push(vscode.TextEdit.replace(
                    new vscode.Range(line.range.start, new vscode.Position(i, currentIndent)),
                    newText
                ));
            }
        }
        return edits;
    }

    private static calculateIndent(doc: vscode.TextDocument, listNode: ASTNode): number {
        const startPos = doc.positionAt(listNode.start);
        const startCol = startPos.character;

        let firstChild = listNode.children[0];
        let isSpecial = false;

        if (firstChild && firstChild.type === NodeType.Atom) {
            const name = doc.getText(new vscode.Range(
                doc.positionAt(firstChild.start),
                doc.positionAt(firstChild.end)
            ));

            // LSP Cache
            if (this.indentCache.has(name)) {
                if (this.indentCache.get(name) === "body") return startCol + 2;
            }
            // Hardcoded Defaults
            else if (this.specialForms.has(name)) {
                isSpecial = true;
            }
            // (def*, with*)
            else if (this.specialPattern.test(name)) {
                isSpecial = true;
            }
        }

        if (isSpecial) {
            return startCol + 2;
        }

        const operatorLine = startPos.line;
        for (let i = 1; i < listNode.children.length; i++) {
            const child = listNode.children[i];
            const childStart = doc.positionAt(child.start);

            if (childStart.line === operatorLine) {
                return childStart.character;
            }
        }

        return startCol + 1;
    }
}