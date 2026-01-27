import * as vscode from 'vscode';
import { LispParser, ASTNode } from './parser';

export class ASTManager {
    private static cache = new Map<string, ASTNode>();

    public static refresh(document: vscode.TextDocument) {
        const text = document.getText();
        const root = LispParser.parse(text);
        this.cache.set(document.uri.toString(), root);
    }

    public static getTree(document: vscode.TextDocument): ASTNode {
        const key = document.uri.toString();
        if (!this.cache.has(key)) {
            this.refresh(document);
        }
        return this.cache.get(key)!;
    }

    public static remove(document: vscode.TextDocument) {
        this.cache.delete(document.uri.toString());
    }
}