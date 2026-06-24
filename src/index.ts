// Публичный API: парсер и проверка типов нотации из essensio/notation.

export { tokenize, LexError } from "./lexer";
export type { Token } from "./lexer";
export * as nodes from "./nodes";
export { parseDeclaration, parseType, parseLiteral, parseExpression, ParseError } from "./parser";
export { writeLiteral, WriteError } from "./writer";
export { Env, TypeErr, root, same } from "./checker";
export type { SemType, Scalar, Sub, Tup, Rel, RefT } from "./checker";
