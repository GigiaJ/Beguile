import * as vscode from 'vscode';
import { ASTManager } from '../astManager';
import { ASTNode, NodeType } from '../parser';
import { GuileClient } from '../guileClient';

export class Formatter {
    private static client: GuileClient;

    // store computed positions for this format pass
    //maps a Node -> Column index it WILL be at after formatting
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
        // calculate target position
        // if already in the map (calculated by parent), use that
        // otherwise default to parentIndent
        const myStartCol = this.targetCols.get(node) ?? parentIndent;

        if (node.children && node.children.length > 0) {

            // look up indent style for this node (if it's a list)
            const indentType = this.getIndentType(doc, node);

            // reference point for children (usually the '(' )
            const anchorCol = myStartCol;

            // special forms (like 'define'), the body indentation is fixed (usually +2)
            const bodyIndent = anchorCol + 2;

            let prevChild: ASTNode | null = null;

            for (let i = 0; i < node.children.length; i++) {
                const child = node.children[i];

                // check if child is on a new line relative to the PREVIOUS token
                // check the SOURCE document to see if there was a newline
                const isNewLine = this.isNodeOnNewLine(doc, child, prevChild ?? node);

                if (isNewLine) {
                    let targetIndent = bodyIndent;

                    if (indentType === 'align' && i > 0) {
                        // match the column of the first argument
                        // (list a
                        //       b) <--- b aligns with a

                        // find "First Argument" (the 2nd child usually, index 1)
                        if (node.children.length > 1) {
                            const firstArg = node.children[1];
                            // if first arg is on the same line as the operator, align with it
                            if (!this.isNodeOnNewLine(doc, firstArg, node.children[0])) {
                                targetIndent = this.targetCols.get(firstArg) ?? (anchorCol + 2);
                            }
                        }
                    }

                    this.targetCols.set(child, targetIndent);

                    const line = doc.positionAt(child.start).line;
                    const currentLineStart = new vscode.Position(line, 0);
                    const currentTokenStart = doc.positionAt(child.start);

                    const range = new vscode.Range(currentLineStart, currentTokenStart);
                    edits.push(vscode.TextEdit.replace(range, " ".repeat(targetIndent)));

                } else {
                    // on same line, position = prevSiblingEnd + 1
                    // estimate the length of the previous sibling based on text
                    let startCol = myStartCol + 1; // Fallback

                    if (prevChild) {
                        const prevStart = this.targetCols.get(prevChild) ?? 0;
                        const prevLen = (prevChild.end - prevChild.start);
                        startCol = prevStart + prevLen + 1;
                    } else {
                        // first child (e.g. the function name inside parens)
                        startCol = myStartCol + 1; // '(' is 1 char
                    }

                    this.targetCols.set(child, startCol);
                }

                this.formatNode(doc, child, this.targetCols.get(child)!, edits);
                prevChild = child;
            }
        }
    }

    // check if child is on a different line than reference (prev sibling) in the SOURCE text
    private static isNodeOnNewLine(doc: vscode.TextDocument, node: ASTNode, ref: ASTNode): boolean {
        const nodeLine = doc.positionAt(node.start).line;
        // just check if node line > ref line.

        // edge case is if first child of a list then reference is the List Node itself.
        // list starts at line 10. Child starts at line 10. -> Same line.

        // reference is the Parent (List), use its start line.
        // reference is Sibling, use its start line to be safe.

        const refLine = doc.positionAt(ref.end - 1).line;
        // We use 'end - 1' to get the line where the previous token *ended*.

        return nodeLine > refLine;
    }

    private static getIndentType(doc: vscode.TextDocument, node: ASTNode): 'body' | 'align' {
        // operator symbol (first child)
        if (node.children.length > 0 && node.children[0].type === NodeType.Atom) {
            const op = doc.getText(new vscode.Range(
                doc.positionAt(node.children[0].start),
                doc.positionAt(node.children[0].end)
            ));

            // check heuristics
            if (op.startsWith('def')) return 'body';
            if (op === 'let' || op === 'let*' || op === 'lambda') return 'body';
            if (op.startsWith('with-')) return 'body';

            // TODO: ask the Server via this.client.getIndent()
            // But for formatting, sync is better. We can cache server rules later.
        }
        return 'align';
    }
}