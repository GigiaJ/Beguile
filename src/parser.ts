export enum NodeType {
    Root,
    List,
    String,
    Comment,
    Atom,
    Whitespace
}

export interface ASTNode {
    type: NodeType;
    start: number;
    end: number;
    children: ASTNode[];
    parent?: ASTNode;
    openChar?: string;
    closeChar?: string;
}

export class LispParser {
    static parse(text: string): ASTNode {
        const root: ASTNode = {
            type: NodeType.Root,
            start: 0,
            end: text.length,
            children: []
        };

        let current = root;
        let i = 0;

        while (i < text.length) {
            const char = text[i];

            if (char === ';') {
                const start = i;
                let end = text.indexOf('\n', i);
                if (end === -1) end = text.length;
                current.children.push({
                    type: NodeType.Comment,
                    start,
                    end,
                    children: [],
                    parent: current
                });
                i = end;
                continue;
            }

            if (char === '"') {
                // read until closing quote
                const start = i;
                let end = i + 1;
                while (end < text.length) {
                    if (text[end] === '"' && text[end - 1] !== '\\') {
                        end++;
                        break;
                    }
                    end++;
                }
                current.children.push({
                    type: NodeType.String,
                    start,
                    end,
                    children: [],
                    parent: current
                });
                i = end;
                continue;
            }

            if (char === '(' || char === '[') {
                const node: ASTNode = {
                    type: NodeType.List,
                    start: i,
                    end: -1,
                    openChar: char,
                    children: [],
                    parent: current
                };
                current.children.push(node);
                current = node;
                i++;
                continue;
            }

            if (char === ')' || char === ']') {
                if (current.parent) {
                    current.end = i + 1;
                    current.closeChar = char;
                    current = current.parent;
                }
                i++;
                continue;
            }

            if (/\s/.test(char)) {
                i++; // skip generic whitespace
                continue;
            }

            // atom (Symbol, Number, etc.)
            const start = i;
            while (i < text.length && !/[\s\(\)\[\]\";]/.test(text[i])) {
                i++;
            }
            current.children.push({
                type: NodeType.Atom,
                start,
                end: i,
                children: [],
                parent: current
            });
        }

        return root;
    }

    static getLocalSymbols(text: string): string[] {
        const root = this.parse(text);
        const symbols = new Set<string>();

        // top-level children (global defines)
        for (const child of root.children) {
            if (child.type === NodeType.List && child.children.length > 1) {
                // list starts with "define"
                const head = child.children[0];
                const second = child.children[1];

                if (head.type === NodeType.Atom) {
                    const headName = text.substring(head.start, head.end);

                    if (headName.startsWith("define")) {
                        // (define (my-func args) ...)
                        if (second.type === NodeType.List && second.children.length > 0) {
                            const funcNameNode = second.children[0];
                            const funcName = text.substring(funcNameNode.start, funcNameNode.end);
                            symbols.add(funcName);
                        }
                        // (define my-var 10)
                        else if (second.type === NodeType.Atom) {
                            const varName = text.substring(second.start, second.end);
                            symbols.add(varName);
                        }
                    }
                }
            }
        }
        return Array.from(symbols);
    }

    // find deepest node covering a position
    static getNodeAtPosition(root: ASTNode, offset: number): ASTNode | null {
        // simple recursive search
        function search(node: ASTNode): ASTNode | null {
            if (offset < node.start || offset >= node.end) return null;

            for (const child of node.children) {
                if (offset >= child.start && offset < child.end) {
                    // tighter match, recurse
                    return search(child) || child;
                }
            }
            return node;
        }
        return search(root);
    }
}