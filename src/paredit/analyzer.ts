import * as vscode from 'vscode';
import { LispParser, NodeType, ASTNode } from '../parser';
import { ASTManager } from '../astManager';

export class Analyzer {

    // Returns a stack of "Parent Operators".
    // e.g. Cursor inside (package (inputs ...)) -> ["package"]
    // e.g. Cursor inside (operating-system (services ...)) -> ["operating-system"]
    static getContextStack(doc: vscode.TextDocument, position: vscode.Position): string[] {
        const text = doc.getText();
        const root = ASTManager.getTree(doc);
        const offset = doc.offsetAt(position);

        let node = LispParser.getNodeAtPosition(root, offset);
        const stack: string[] = [];

        while (node) {
            if (node.type === NodeType.List) {
                const head = this.getListHead(node, text);

                if (head) {
                    stack.push(head);
                }
            }
            node = node.parent;
        }

        return stack.reverse();
    }

    private static getListHead(node: ASTNode, text: string): string | null {
        if (node.children.length === 0) return null;

        const firstChild = node.children[0];

        if (firstChild.type === NodeType.Atom) {
            return text.substring(firstChild.start, firstChild.end);
        }
        return null;
    }
}