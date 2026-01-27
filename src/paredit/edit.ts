import * as vscode from "vscode";
import { LispParser, NodeType, ASTNode } from "../parser";
import { ASTManager } from "../astManager";

export class Paredit {

    private static getForwardSexpTarget(doc: vscode.TextDocument, offset: number): number | null {
        const root = ASTManager.getTree(doc);
        let node = LispParser.getNodeAtPosition(root, offset);
        if (!node) return null;

        if (node.type !== NodeType.List && node.type !== NodeType.Root && offset < node.end) {
            return node.end;
        }

        if (node.type === NodeType.List && offset === node.start) {
            return node.end;
        }

        if (offset === node.end && node.parent) {
            node = node.parent;
        }

        const nextNode = node.children.find(c => c.start >= offset);

        if (nextNode) {
            return nextNode.end;
        } else {
            if (node.type === NodeType.List) {
                return node.end;
            }
        }
        return null;
    }

    private static getBackwardSexpTarget(doc: vscode.TextDocument, offset: number): number | null {
        const root = ASTManager.getTree(doc);
        let node = LispParser.getNodeAtPosition(root, offset);
        if (!node) return null;

        while (node && node.parent && offset === node.start) {
            node = node.parent;
        }

        if (node.type !== NodeType.List && node.type !== NodeType.Root && offset > node.start) {
            return node.start;
        }

        let prevNode: ASTNode | undefined;
        for (let i = node.children.length - 1; i >= 0; i--) {
            if (node.children[i].end <= offset) {
                prevNode = node.children[i];
                break;
            }
        }

        if (prevNode) {
            return prevNode.start;
        } else {
            return node.start;
        }
    }

    static forwardSexp(editor: vscode.TextEditor) {
        const target = this.getForwardSexpTarget(editor.document, editor.document.offsetAt(editor.selection.active));
        if (target !== null) {
            const pos = editor.document.positionAt(target);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos));
        }
    }

    static backwardSexp(editor: vscode.TextEditor) {
        const target = this.getBackwardSexpTarget(editor.document, editor.document.offsetAt(editor.selection.active));
        if (target !== null) {
            const pos = editor.document.positionAt(target);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos));
        }
    }

    static selectForwardSexp(editor: vscode.TextEditor) {
        const target = this.getForwardSexpTarget(editor.document, editor.document.offsetAt(editor.selection.active));
        if (target !== null) {
            const pos = editor.document.positionAt(target);
            editor.selection = new vscode.Selection(editor.selection.anchor, pos);
            editor.revealRange(new vscode.Range(pos, pos));
        }
    }

    static selectBackwardSexp(editor: vscode.TextEditor) {
        const target = this.getBackwardSexpTarget(editor.document, editor.document.offsetAt(editor.selection.active));
        if (target !== null) {
            const pos = editor.document.positionAt(target);
            editor.selection = new vscode.Selection(editor.selection.anchor, pos);
            editor.revealRange(new vscode.Range(pos, pos));
        }
    }


    // (foo |) bar  -> (foo bar |)
    static async slurpForward(editor: vscode.TextEditor) {
        const doc = editor.document;
        const root = ASTManager.getTree(doc);
        const offset = doc.offsetAt(editor.selection.active);

        let listNode = LispParser.getNodeAtPosition(root, offset);

        while (listNode && listNode.type !== NodeType.List) {
            listNode = listNode.parent || null;
        }

        if (!listNode || !listNode.parent || listNode.end === -1) return;

        const parent = listNode.parent;
        const myIndex = parent.children.indexOf(listNode);
        const victim = parent.children[myIndex + 1];

        if (!victim) return;

        await editor.edit(edit => {
            const oldClosePos = doc.positionAt(listNode!.end - 1);

            const newClosePos = doc.positionAt(victim.end);

            edit.delete(new vscode.Range(oldClosePos, oldClosePos.translate(0, 1)));
            edit.insert(newClosePos, listNode!.closeChar || ")");
        });
    }

    // (foo bar |) -> (foo |) bar
    static async barfForward(editor: vscode.TextEditor) {
        const doc = editor.document;
        const root = ASTManager.getTree(doc);
        const offset = doc.offsetAt(editor.selection.active);

        let listNode = LispParser.getNodeAtPosition(root, offset);
        while (listNode && listNode.type !== NodeType.List) {
            listNode = listNode.parent || null;
        }

        if (!listNode || listNode.end === -1 || listNode.children.length === 0) return;

        const lastChild = listNode.children[listNode.children.length - 1];

        await editor.edit(edit => {
            const oldClosePos = doc.positionAt(listNode!.end - 1);
            const newClosePos = doc.positionAt(lastChild.start);

            edit.delete(new vscode.Range(oldClosePos, oldClosePos.translate(0, 1)));
            edit.insert(newClosePos, listNode!.closeChar || ")");
        });
    }

    // foo -> (foo) or selection -> (selection)
    static async wrap(editor: vscode.TextEditor) {
        const doc = editor.document;
        const sel = editor.selection;
        let range = new vscode.Range(sel.start, sel.end);

        if (sel.isEmpty) {
            const word = doc.getWordRangeAtPosition(sel.active);
            if (word) {
                range = word;
            } else {
                return editor.edit(e => e.insert(sel.active, "()"))
                    .then(() => {
                        const pos = sel.active.translate(0, 1);
                        editor.selection = new vscode.Selection(pos, pos);
                    });
            }
        }

        const text = doc.getText(range);
        await editor.edit(e => e.replace(range, `(${text})`));
    }

    // (foo (bar baz) qux) -> (foo bar baz qux)
    static async splice(editor: vscode.TextEditor) {
        const doc = editor.document;
        const root = ASTManager.getTree(doc);
        const offset = doc.offsetAt(editor.selection.active);

        let listNode = LispParser.getNodeAtPosition(root, offset);
        while (listNode && listNode.type !== NodeType.List) {
            listNode = listNode.parent || null;
        }

        if (!listNode || listNode.type !== NodeType.List || listNode.end === -1) return;

        const contentRange = new vscode.Range(
            doc.positionAt(listNode.start + 1),
            doc.positionAt(listNode.end - 1)
        );
        const contentText = doc.getText(contentRange);

        const fullListRange = new vscode.Range(
            doc.positionAt(listNode.start),
            doc.positionAt(listNode.end)
        );

        await editor.edit(edit => {
            edit.replace(fullListRange, contentText);
        });
    }
}