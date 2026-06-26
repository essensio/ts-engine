// Печать: AST → текст нотации (essensio/notation). Инверсия парсера.
//
// ЧТО ДЕЛАЕТ
//   writeLiteral(e)    печатает узел-литерал           (инверсия parseLiteral)
//   writeExpression(e) печатает любое выражение         (инверсия parseExpression)
//   writeType(t)       печатает тип                     (инверсия parseType)
//   writeDecl(d)       печатает объявление              (инверсия parseDeclaration)
//   writeQuery(q)      печатает запрос                  (инверсия parseQuery)
//
// ИНВАРИАНТ  parseX(writeX(ast)) глубоко равно ast — это операция «записать»
//   (разобрать(записать(v)) = v из spec/notation.md), теперь для всех пяти
//   входов парсера, а не только литералов.
//
// ПРАВИЛА
//   * Строка/регэксп: экранируются \ и " (как ждёт scanString лексера).
//   * Ключ кортежа печатается голым именем, если это валидное `имя` и не ключевое
//     слово; иначе строкой ("order-id", "true", "1x") — так держится round-trip.
//   * Кортеж-сущность (entity) печатается с ведущим "#," ({#, поле: T}).
//   * Число печатается своим текстом (Num.text уже валиден, в т.ч. экспонента).
//   * Выражения: скобки минимальны, по той же иерархии приоритетов, что в парсере
//     (or < and < not < сравнение < + − < * / < унарный − < постфикс «.» < атом);
//     сравнения не цепляются.
//
// КРАЕВЫЕ → WriteError: writeLiteral на не-литерале (Ref/Member/Apply/BinOp/UnOp/
//   Underscore). writeExpression печатает их штатно.

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

// ───────────────────────────── Выражения ─────────────────────────────

export function writeExpression(e: N.Expr): string {
  return expr(e, 0);
}

// Уровень приоритета узла (выше — крепче связывает), как в иерархии парсера.
function prec(e: N.Expr): number {
  switch (e.kind) {
    case "BinOp":
      switch (e.op) {
        case "or": return 1;
        case "and": return 2;
        case "=": case "!=": case "<": case ">": case "<=": case ">=": case "~": return 4;
        case "+": case "-": return 5;
        case "*": case "/": return 6;
        default: return 9;
      }
    case "UnOp": return e.op === "not" ? 3 : 7;
    case "Member": return 8;
    default: return 9; // атомы: литералы, Ref, Apply, Underscore, селекторы
  }
}

// Печатает e и скобкует, если его приоритет ниже требуемого контекстом.
function expr(e: N.Expr, min: number): string {
  const s = render(e);
  return prec(e) < min ? "(" + s + ")" : s;
}

function render(e: N.Expr): string {
  switch (e.kind) {
    case "Underscore": return "_";
    case "Ref": return e.name;
    case "Member": return expr(e.obj, 8) + "." + e.field;
    case "Apply": return e.name + "(" + e.args.map((a) => expr(a, 0)).join(", ") + ")";
    case "UnOp": return e.op === "not" ? "not " + expr(e.operand, 3) : "-" + expr(e.operand, 7);
    case "BinOp": {
      const p = prec(e);
      const leftMin = p === 4 ? p + 1 : p; // сравнение не цепляется → левый тоже крепче
      return expr(e.left, leftMin) + " " + e.op + " " + expr(e.right, p + 1);
    }
    default: return writeLiteral(e); // Num/Bool/Str/Null/Regex/TupleLit/RelLit/селекторы
  }
}

// ─────────────────────────── Типы и объявления ───────────────────────────

export function writeType(t: N.TypeExpr): string {
  switch (t.kind) {
    case "TName": return t.name;
    case "TRef": return "#" + t.target;
    case "TRel": return atomType(t.elem) + "[]";
    case "TTuple": return "{" + (t.entity ? "#, " : "") + t.fields.map(([k, ft]) => key(k) + ": " + atomType(ft)).join(", ") + "}";
    case "TConstraint": return writeType(t.base) + " | " + writeExpression(t.pred);
  }
}

export function writeDecl(d: N.Decl): string {
  return d.name + " = " + writeType(d.type);
}

// Тип в позиции, где верхний конструктор-ограничение «|» требует скобок: элемент
// отношения (`(Число | _ > 0)[]`) и тип поля кортежа (`{цена: (Число | _ > 0)}`).
function atomType(t: N.TypeExpr): string {
  return t.kind === "TConstraint" ? "(" + writeType(t) + ")" : writeType(t);
}

// ───────────────────────────── Запрос ─────────────────────────────

export function writeQuery(q: N.Query): string {
  const src = typeof q.source === "string" ? q.source : "(" + writeQuery(q.source) + ")";
  return "?" + src + q.steps.map(step).join("");
}

function step(s: N.QueryStep): string {
  switch (s.kind) {
    case "Select": return "[" + writeExpression(s.pred) + "]";
    case "Project": return ".(" + s.fields.join(", ") + ")";
    case "Unnest": return "." + s.field;
  }
}
