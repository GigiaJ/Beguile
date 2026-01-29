pnpm add -D tree-sitter-cli

git clone https://github.com/6cdh/tree-sitter-scheme

cd tree-sitter-scheme

../node_modules/.bin/tree-sitter build --wasm

mv tree-sitter-scheme.wasm ../resources/