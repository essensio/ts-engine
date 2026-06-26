// Публичный API: парсер и проверка типов нотации из essensio/notation.
//
// Рекомендации по использованию (подробнее — README, «Рекомендации по использованию»):
//   * `nodes` — единственный источник AST; потребитель не заводит параллельную
//     модель типов, а строит/разбирает эти узлы и навешивает своё ПОВЕРХ.
//   * разбирая `TypeExpr`/`Expr`, делай `switch` исчерпывающим (ветка `never`) —
//     пропущенный случай ловится компилятором, а не рантаймом.
//   * печать ↔ разбор — инверсии: `parseX(writeX(ast)) ≡ ast`. Имя — через `isName`.

export { tokenize, isName, LexError } from "./lexer";
export type { Token } from "./lexer";
export * as nodes from "./nodes";
export { parseDeclaration, parseType, parseLiteral, parseExpression, parseQuery, ParseError } from "./parser";
export { writeLiteral, writeExpression, writeType, writeDecl, writeQuery, WriteError } from "./writer";
export { Env, TypeErr, root, same, foldSemType } from "./checker";
export type { SemType, Scalar, Sub, Tup, Rel, RefT, Uni, SemTypeCases } from "./checker";
