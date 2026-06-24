// Печать литерала: AST → текст нотации (essensio/notation). Инверсия parseLiteral.
//
// ЧТО ДЕЛАЕТ  writeLiteral(e) печатает узел-литерал обратно в исходник нотации.
// ВХОД  e: Expr (подмножество-литерал).  ВЫХОД  string.
//
// ИНВАРИАНТ  parseLiteral(writeLiteral(x)) глубоко равно x для любого литерала x —
//   это операция «записать» (разобрать(записать(v)) = v из spec/notation.md).
//
// ПРАВИЛА
//   * Строка/регэксп: экранируются \ и " (как ждёт scanString лексера).
//   * Ключ кортежа печатается голым именем, если это валидное `имя` и не ключевое
//     слово; иначе строкой ("order-id", "true", "1x") — так держится round-trip.
//   * Число печатается своим текстом (Num.text уже валиден, в т.ч. экспонента).
//
// КРАЕВЫЕ → WriteError: не-литерал (Ref/Member/Apply/BinOp/UnOp/Underscore).

import * as N from "./nodes";

export class WriteError extends Error {}

const KEYWORDS = new Set(["true", "false", "null", "and", "or", "not"]);
const NAME = /^\p{L}[\p{L}\p{N}_]*$/u;

export function writeLiteral(e: N.Expr): string {
  switch (e.kind) {
    case "Num": return e.text;
    case "Bool": return e.value ? "true" : "false";
    case "Null": return "null";
    case "Str": return quote(e.value);
    case "Regex": return "r" + quote(e.pattern);
    case "TupleLit": return "{" + e.fields.map(([k, v]) => key(k) + ": " + writeLiteral(v)).join(", ") + "}";
    case "RelLit": return "[" + e.elems.map(writeLiteral).join(", ") + "]";
    case "ScalarSel": return e.name + "(" + writeLiteral(e.arg) + ")";
    case "RefSel": return "#" + e.target + "(" + writeLiteral(e.arg) + ")";
    case "TupleSel": return e.name + writeLiteral(e.value);
    case "RelSel": return e.name + writeLiteral(e.value);
    default: throw new WriteError(`не литерал: ${e.kind}`);
  }
}

function key(k: string): string {
  return NAME.test(k) && !KEYWORDS.has(k) ? k : quote(k);
}

function quote(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
