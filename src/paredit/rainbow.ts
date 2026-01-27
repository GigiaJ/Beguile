import * as vscode from "vscode";
import { LispParser, NodeType, ASTNode } from "../parser";
import { ASTManager } from "../astManager";

export class RainbowHighlighter {
    private rainbowColors = ["#FFD700", "#DA70D6", "#87CEFA", "#FFA500", "#7FFF00"];
    private rainbowDecorations: vscode.TextEditorDecorationType[];
    private matchDecoration: vscode.TextEditorDecorationType;

    constructor() {
        this.rainbowDecorations = this.rainbowColors.map(color =>
            vscode.window.createTextEditorDecorationType({ color })
        );

        this.matchDecoration = vscode.window.createTextEditorDecorationType({
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "rgba(255, 255, 255, 0.5)",
            fontWeight: "bold",
            backgroundColor: "rgba(255, 255, 255, 0.1)"
        });
    }

    updateRainbows(editor: vscode.TextEditor) {
        if (!editor || editor.document.languageId !== "scheme") return;

        const root = ASTManager.getTree(editor.document);
        const ranges: vscode.Range[][] = this.rainbowColors.map(() => []);

        const walk = (node: ASTNode, depth: number) => {
            if (node.type === NodeType.List) {
                const colorIdx = depth % this.rainbowColors.length;

                ranges[colorIdx].push(new vscode.Range(
                    editor.document.positionAt(node.start),
                    editor.document.positionAt(node.start + 1)
                ));

                if (node.end > -1) {
                    ranges[colorIdx].push(new vscode.Range(
                        editor.document.positionAt(node.end - 1),
                        editor.document.positionAt(node.end)
                    ));
                }
                node.children.forEach(c => walk(c, depth + 1));
            } else {
                node.children.forEach(c => walk(c, depth));
            }
        };

        walk(root, 0);

        for (let i = 0; i < this.rainbowColors.length; i++) {
            editor.setDecorations(this.rainbowDecorations[i], ranges[i]);
        }
    }

    matchPairs(editor: vscode.TextEditor) {
        if (!editor || editor.document.languageId !== "scheme") return;

        const offset = editor.document.offsetAt(editor.selection.active);
        const root = ASTManager.getTree(editor.document);
        // check at and before for lookahead and lookbehind
        let node = LispParser.getNodeAtPosition(root, offset);

        // if not directly on a list node, check directly after one
        if (!node || node.type !== NodeType.List) {
            node = LispParser.getNodeAtPosition(root, offset - 1);
        }

        // If we found a list and it is closed
        if (node && node.type === NodeType.List && node.end > -1) {
            const touchingStart = (offset === node.start || offset === node.start + 1);
            const touchingEnd = (offset === node.end || offset === node.end - 1);

            // highlight if touching one of the delimiters
            if (touchingStart || touchingEnd) {
                const start = editor.document.positionAt(node.start);
                const end = editor.document.positionAt(node.end - 1);

                editor.setDecorations(this.matchDecoration, [
                    new vscode.Range(start, start.translate(0, 1)),
                    new vscode.Range(end, end.translate(0, 1))
                ]);
                return;
            }
        }

        // no match
        editor.setDecorations(this.matchDecoration, []);
    }
}