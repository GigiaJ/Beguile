import * as vscode from 'vscode';
import { ASTManager } from '../astManager';
import { ASTNode, LispParser, NodeType } from '../parser';
import { GuileClient } from '../guileClient';

export class Formatter {
    private static client: GuileClient;
    private static targetCols = new Map<ASTNode, number>();
    private static readonly MAX_WIDTH = 80;

    public static updateRules(client: GuileClient, doc: vscode.TextDocument) {
        this.client = client;
    }

    public static format(doc: vscode.TextDocument): vscode.TextEdit[] {
        const root = ASTManager.getTree(doc);
        // abort any unbalanced AST
        if (!root || (root as any).hasError) {
            return [];
        }

        this.targetCols.clear();
        const edits: vscode.TextEdit[] = [];
        this.targetCols.set(root, 0);
        this.formatNode(doc, root, 0, edits);
        return edits;
    }


    private static calculateTargetIndent(doc: vscode.TextDocument, node: ASTNode): number {
        const parent = node.parent;
        if (!parent || parent.type === NodeType.Root) return 0;

        // 1. STICKY PREFIX CHECK
        // If the node itself is a prefix (like #$), its indent is determined by its siblings.
        // If the node's PARENT is a prefix, we must recurse to find the parent of the prefix.
        const stickyPrefixes = new Set(["#$", "#$@", "#~", "'", "`", ",", ",@"]);
        const parentText = doc.getText(new vscode.Range(
            doc.positionAt(parent.start),
            doc.positionAt(parent.end)
        ));

        if (stickyPrefixes.has(parentText)) {
            return this.calculateTargetIndent(doc, parent);
        }

        // 2. USE CACHED IDEAL POSITION
        // We check targetCols first. If we are in a bulk format, the parent was 
        // already processed. If we are in tabulateLine, we calculate the parent's ideal.
        const anchorCol = this.targetCols.has(parent)
            ? this.targetCols.get(parent)!
            : this.calculateTargetIndent(doc, parent);

        const type = this.getIndentType(doc, parent);
        const nodeText = doc.getText(new vscode.Range(
            doc.positionAt(node.start),
            doc.positionAt(node.end)
        ));

        // 3. APPLY RULES
        if (nodeText.startsWith('#:')) return anchorCol + 2;
        if (type === 'body') return anchorCol + 2;

        // Align Logic
        if (parent.children.length > 1) {
            const op = parent.children[0];
            const firstArg = parent.children[1];
            if (doc.positionAt(op.start).line === doc.positionAt(firstArg.start).line) {
                // Use the actual character position of the first arg for alignment
                return doc.positionAt(firstArg.start).character;
            }
        }

        return anchorCol + 2;
    }

    private static formatNode(
        doc: vscode.TextDocument,
        node: ASTNode,
        parentIndent: number,
        edits: vscode.TextEdit[]
    ) {
        // We still need this for internal tracking
        const myStartCol = this.targetCols.get(node) ?? parentIndent;

        if (node.children && node.children.length > 0) {
            let prevChild: ASTNode | null = null;
            let currentLineCol = myStartCol;
            let glueNext = false;

            for (let i = 0; i < node.children.length; i++) {
                const child = node.children[i];
                const childLen = child.end - child.start;

                // --- FIX 1: ALWAYS CACHE THE TARGET ---
                // This ensures G-Exps (#$) can find their parent's ideal column.
                const targetIndent = this.calculateTargetIndent(doc, child);
                this.targetCols.set(child, targetIndent);

                // Inside the for loop in formatNode
                const prevEnd = prevChild ? prevChild.end : (node.start + 1);
                const prevEndPos = doc.positionAt(prevEnd);
                const childStartPos = doc.positionAt(child.start);

                // The Gap is the source of truth
                const gapRange = new vscode.Range(prevEndPos, childStartPos);
                const gapText = doc.getText(gapRange);

                // CRITICAL: Check for newline and comments in the actual text gap
                const hasInternalNewline = gapText.includes('\n');
                const hasComment = gapText.includes(';');

                // Determine if we should treat this as a new line
                const isNewLine = hasInternalNewline || (i > 0 && (currentLineCol + 1 + childLen) > this.MAX_WIDTH);

                let isSourceNewLine = false;
                if (prevChild) {
                    isSourceNewLine = doc.positionAt(child.start).line > doc.positionAt(prevChild.end).line;
                } else {
                    isSourceNewLine = doc.positionAt(child.start).line > doc.positionAt(node.start).line;
                }

                // -------------------------------------------------
                // 1. GLUE LOGIC (Unchanged - works great)
                // -------------------------------------------------
                let appliedGlue = false;
                if (glueNext) {
                    const gapText = doc.getText(new vscode.Range(prevEndPos, childStartPos));
                    if (!gapText.includes(';')) {
                        const glueCol = (this.targetCols.get(prevChild!) ?? 0) + (prevChild!.end - prevChild!.start);
                        this.targetCols.set(child, glueCol); // Override with glued column
                        edits.push(vscode.TextEdit.replace(new vscode.Range(prevEndPos, childStartPos), ""));
                        currentLineCol = glueCol + childLen;
                        appliedGlue = true;
                    }
                    glueNext = false;
                }

                // -------------------------------------------------
                // 2. STANDARD FORMATTING (Updated to use FIX 1)
                // -------------------------------------------------
                if (!appliedGlue) {

                    if (isNewLine) {
                        const targetIndent = this.calculateTargetIndent(doc, child);
                        this.targetCols.set(child, targetIndent);

                        if (hasComment) {
                            // Find the line the child actually starts on
                            const childLine = doc.positionAt(child.start).line;
                            const lineText = doc.lineAt(childLine).text;

                            // Find the leading whitespace of that specific line
                            const leadingWhitespaceMatch = lineText.match(/^\s*/);
                            const leadingWhitespaceLen = leadingWhitespaceMatch ? leadingWhitespaceMatch[0].length : 0;

                            const currentLineIndentRange = new vscode.Range(
                                new vscode.Position(childLine, 0),
                                new vscode.Position(childLine, leadingWhitespaceLen)
                            );

                            const replacement = " ".repeat(targetIndent);
                            if (doc.getText(currentLineIndentRange) !== replacement) {
                                edits.push(vscode.TextEdit.replace(currentLineIndentRange, replacement));
                            }
                        } else {
                            // Standard code-only squash
                            const newlineCount = (gapText.match(/\n/g) || []).length;
                            const prefix = (node.type === NodeType.Root && newlineCount > 1) ? "\n\n" : "\n";
                            const replacement = prefix + " ".repeat(targetIndent);

                            if (gapText !== replacement) {
                                edits.push(vscode.TextEdit.replace(gapRange, replacement));
                            }
                        }
                        currentLineCol = targetIndent + childLen;
                    } else {
                        // --- SAME LINE LOGIC ---
                        let startCol = myStartCol + 1;
                        if (prevChild) {
                            const prevCol = this.targetCols.get(prevChild) ?? 0;
                            const prevWidth = prevChild.end - prevChild.start;
                            const gapRange = new vscode.Range(prevEndPos, childStartPos);
                            const gapText = doc.getText(gapRange);

                            startCol = prevCol + prevWidth + 1;

                            if (gapText !== " " && !gapText.includes(';')) {
                                edits.push(vscode.TextEdit.replace(gapRange, " "));
                            }
                        }
                        this.targetCols.set(child, startCol);
                        currentLineCol = startCol + childLen;
                    }
                }

                // -------------------------------------------------
                // 3. CHAIN CHECK (Unchanged)
                // -------------------------------------------------
                const childText = doc.getText(new vscode.Range(childStartPos, doc.positionAt(child.end)));
                const prefixes = ['`', "'", ',', ',@', '#$', '#$@', '#~', '#+', '#-', "#'", "#`", "#,"];

                if (prefixes.includes(childText)) {
                    glueNext = true;
                }

                // Recurse using the child's computed target
                this.formatNode(doc, child, this.targetCols.get(child)!, edits);
                prevChild = child;
            }

            // -------------------------------------------------
            // 4. CLOSING PAREN CLEANUP (Unchanged)
            // -------------------------------------------------
            const lastChild = node.children[node.children.length - 1];
            const gapRange = new vscode.Range(doc.positionAt(lastChild.end), doc.positionAt(node.end - 1));
            if (gapRange.end.isAfter(gapRange.start) && !doc.getText(gapRange).includes(';')) {
                edits.push(vscode.TextEdit.replace(gapRange, ''));
            }
        }
    }

    public static indentCurrentLine(editor: vscode.TextEditor): void {
        const doc = editor.document;
        const lineIdx = editor.selection.active.line;
        const line = doc.lineAt(lineIdx);
        const root = ASTManager.getTree(doc);
        if (!root) return;

        // Find the first non-whitespace character on this line
        const firstCharIdx = line.firstNonWhitespaceCharacterIndex;
        const offset = doc.offsetAt(new vscode.Position(lineIdx, firstCharIdx));

        // Find the node starting at that non-whitespace character
        const node = LispParser.getNodeAtPosition(root, offset);

        if (node && node.type !== NodeType.Root) {
            // Use the unified recursive calculator
            const target = this.calculateTargetIndent(doc, node);
            this.applyIndent(editor, lineIdx, target);
        }
    }

    private static applyIndent(editor: vscode.TextEditor, lineIdx: number, spaces: number) {
        editor.edit(editBuilder => {
            const line = editor.document.lineAt(lineIdx);
            const currentIndent = line.text.match(/^\s*/)?.[0].length || 0;
            const range = new vscode.Range(lineIdx, 0, lineIdx, currentIndent);
            editBuilder.replace(range, " ".repeat(spaces));
        }, { undoStopBefore: false, undoStopAfter: false });
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
            // Specific Guile/Guix keywords that usually behave like body blocks
            if (op === 'add-after' || op === 'substitute*') return 'align';
        }
        return 'align';
    }
}