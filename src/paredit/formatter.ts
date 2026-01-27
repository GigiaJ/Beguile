import * as vscode from 'vscode';
import { ASTManager } from '../astManager';
import { ASTNode, NodeType } from '../parser';
import { GuileClient } from '../guileClient';

export class Formatter {
    private static client: GuileClient;
    private static targetCols = new Map<ASTNode, number>();

    public static updateRules(client: GuileClient, doc: vscode.TextDocument) {
        this.client = client;
    }

    public static format(doc: vscode.TextDocument): vscode.TextEdit[] {
        const root = ASTManager.getTree(doc);
        if (!root) return [];

        this.targetCols.clear();
        const edits: vscode.TextEdit[] = [];

        this.targetCols.set(root, 0);
        this.formatNode(doc, root, 0, edits);

        return edits;
    }

    private static formatNode(
        doc: vscode.TextDocument,
        node: ASTNode,
        parentIndent: number,
        edits: vscode.TextEdit[]
    ) {
        const myStartCol = this.targetCols.get(node) ?? parentIndent;

        if (node.children && node.children.length > 0) {
            const indentType = this.getIndentType(doc, node);
            const anchorCol = myStartCol;
            const bodyIndent = anchorCol + 2;

            let prevChild: ASTNode | null = null;

            for (let i = 0; i < node.children.length; i++) {
                const child = node.children[i];

                const prevEndLine = prevChild
                    ? doc.positionAt(prevChild.end).line
                    : doc.positionAt(node.start).line;

                const isNewLine = this.isNodeOnNewLine(doc, child, prevChild ?? node);

                if (isNewLine) {
                    let targetIndent = bodyIndent;
                    if (indentType === 'align' && i > 0) {
                        if (node.children.length > 1) {
                            const firstArg = node.children[1];
                            if (!this.isNodeOnNewLine(doc, firstArg, node.children[0])) {
                                targetIndent = this.targetCols.get(firstArg) ?? (anchorCol + 2);
                            }
                        }
                    }
                    this.targetCols.set(child, targetIndent);

                    const childStartPos = doc.positionAt(child.start);
                    const childLine = childStartPos.line;

                    let firstEmptyLine = childLine;

                    for (let l = childLine - 1; l > prevEndLine; l--) {
                        if (doc.lineAt(l).isEmptyOrWhitespace) {
                            firstEmptyLine = l;
                        } else {
                            break;
                        }
                    }

                    const replaceStart = new vscode.Position(firstEmptyLine, 0);
                    const replaceEnd = childStartPos;
                    const range = new vscode.Range(replaceStart, replaceEnd);

                    const isTopLevel = node.type === NodeType.Root;
                    const allowedBlanks = isTopLevel ? 1 : 0;

                    let replacementText = " ".repeat(targetIndent);

                    if (firstEmptyLine < childLine) {
                        replacementText = "\n".repeat(allowedBlanks) + replacementText;
                    }

                    edits.push(vscode.TextEdit.replace(range, replacementText));

                } else {
                    let startCol = myStartCol + 1;
                    if (prevChild) {
                        const prevStart = this.targetCols.get(prevChild) ?? 0;
                        const prevLen = (prevChild.end - prevChild.start);
                        startCol = prevStart + prevLen + 1;
                    } else {
                        startCol = myStartCol + 1;
                    }
                    this.targetCols.set(child, startCol);
                }

                this.formatNode(doc, child, this.targetCols.get(child)!, edits);
                prevChild = child;
            }
        }
    }

    private static isNodeOnNewLine(doc: vscode.TextDocument, node: ASTNode, ref: ASTNode): boolean {
        const nodeLine = doc.positionAt(node.start).line;
        const refLine = doc.positionAt(ref.end - 1).line;
        return nodeLine > refLine;
    }

    private static getIndentType(doc: vscode.TextDocument, node: ASTNode): 'body' | 'align' {
        if (node.children.length > 0 && node.children[0].type === NodeType.Atom) {
            const op = doc.getText(new vscode.Range(
                doc.positionAt(node.children[0].start),
                doc.positionAt(node.children[0].end)
            ));

            if (op.startsWith('def')) return 'body';
            if (op === 'let' || op === 'let*' || op === 'lambda') return 'body';
            if (op.startsWith('with-')) return 'body';
            if (op === 'use-modules' || op === 'operating-system') return 'body';
        }
        // TODO: ask the Server via this.client.getIndent()
        // But for formatting, sync is better. We can cache server rules later.
        return 'align';
    }
}