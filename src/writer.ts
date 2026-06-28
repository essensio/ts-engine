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
// КАК  обход семейства узлов ведут свёртки nodes (foldExpr/foldType/foldQueryStep):
//   плита «какие виды узлов есть» в одном месте, здесь — лишь алгебра «как печатать
//   каждый вид». Контекст печати (требуемый приоритет) — носитель R = (min) => string.
//
// ПРАВИЛА
//   * Строка/регэксп: экранируются \ и " (как ждёт scanString лексера).
//   * Ключ кортежа печатается голым именем, если это валидное `имя` и не ключевое
//     слово; иначе строкой ("order-id", "true", "1x") — так держится round-trip.
//   * Кортеж-сущность (entity) печатается с ведущим "#" ({#, поле: T}; без полей — {#});
//     пустой кортеж-значение — {}. Тип-объединение — "A | B"; подтип — "база & предикат".
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

// ───────────────────────────── Литералы ─────────────────────────────

// Литеральные виды печатают, выраженческие (Ref/Member/Apply/BinOp/UnOp/Underscore)
// кидают WriteError. Один обработчик notLiteral годится на все шесть (принимает
// общий Expr, возвращает never — подставим в любой узкий слот).
const notLiteral = (e: N.Expr): never => { throw new WriteError(`не литерал: ${e.kind}`); };

const literal: N.ExprCases<string> = {
  Num: (e) => e.text,
  Bool: (e) => (e.value ? "true" : "false"),
  Null: () => "null",
  Str: (e) => quote(e.value),
  Regex: (e) => "r" + quote(e.pattern),
  TupleLit: (e) => "{" + e.fields.map(([k, v]) => key(k) + ": " + N.foldExpr(v, literal)).join(", ") + "}",
  RelLit: (e) => "[" + e.elems.map((x) => N.foldExpr(x, literal)).join(", ") + "]",
  ScalarSel: (e) => e.name + "(" + N.foldExpr(e.arg, literal) + ")",
  RefSel: (e) => "#" + e.target + "(" + N.foldExpr(e.arg, literal) + ")",
  TupleSel: (e) => e.name + N.foldExpr(e.value, literal),
  RelSel: (e) => e.name + N.foldExpr(e.value, literal),
  Underscore: notLiteral,
  Ref: notLiteral,
  Member: notLiteral,
  Apply: notLiteral,
  BinOp: notLiteral,
  UnOp: notLiteral,
};

export function writeLiteral(e: N.Expr): string {
  return N.foldExpr(e, literal);
}

function key(k: string): string {
  return NAME.test(k) && !KEYWORDS.has(k) ? k : quote(k);
}

function quote(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

// ───────────────────────────── Выражения ─────────────────────────────

// Носитель: функция требуемого контекстом приоритета → текст. Каждый обработчик
// печатает свой узел и сам скобкует, если его приоритет ниже требуемого (paren);
// рекурсия в детей задаёт нужный им приоритет (как expr(child, min) прежде).
type Out = (min: number) => string;
const ATOM = 9; // приоритет атома: литералы, Ref, Apply, Underscore, селекторы

function paren(p: number, s: string, min: number): string {
  return p < min ? "(" + s + ")" : s;
}

// Уровень приоритета бинарного оператора (выше — крепче связывает), как в парсере.
function precBin(op: string): number {
  switch (op) {
    case "or": return 1;
    case "and": return 2;
    case "=": case "!=": case "<": case ">": case "<=": case ">=": case "~": return 4;
    case "+": case "-": return 5;
    case "*": case "/": return 6;
    default: return ATOM;
  }
}

// Атом-литерал печатается через writeLiteral и в скобки не берётся (приоритет ATOM
// не ниже любого требуемого). Годится на все литеральные/селекторные виды.
const asAtom = (e: N.Expr): Out => () => writeLiteral(e);

const expression: N.ExprCases<Out> = {
  Num: asAtom, Bool: asAtom, Str: asAtom, Null: asAtom, Regex: asAtom,
  TupleLit: asAtom, RelLit: asAtom, ScalarSel: asAtom, RefSel: asAtom, TupleSel: asAtom, RelSel: asAtom,
  Underscore: () => () => "_",
  Ref: (e) => () => e.name,
  Member: (e) => (min) => paren(8, N.foldExpr(e.obj, expression)(8) + "." + e.field, min),
  Apply: (e) => (min) => paren(ATOM, e.name + "(" + e.args.map((a) => N.foldExpr(a, expression)(0)).join(", ") + ")", min),
  UnOp: (e) => (min) => {
    const p = e.op === "not" ? 3 : 7;
    const s = e.op === "not" ? "not " + N.foldExpr(e.operand, expression)(3) : "-" + N.foldExpr(e.operand, expression)(7);
    return paren(p, s, min);
  },
  BinOp: (e) => (min) => {
    const p = precBin(e.op);
    const leftMin = p === 4 ? p + 1 : p; // сравнение не цепляется → левый тоже крепче
    const s = N.foldExpr(e.left, expression)(leftMin) + " " + e.op + " " + N.foldExpr(e.right, expression)(p + 1);
    return paren(p, s, min);
  },
};

export function writeExpression(e: N.Expr): string {
  return N.foldExpr(e, expression)(0);
}

// ─────────────────────────── Типы и объявления ───────────────────────────

const type: N.TypeCases<string> = {
  TName: (t) => t.name,
  TRef: (t) => "#" + t.target,
  TRel: (t) => atomType(t.elem) + "[]",
  TTuple: (t) => {
    const inner = t.fields.map(([k, ft]) => key(k) + ": " + atomType(ft)).join(", ");
    if (t.entity) return inner ? "{#, " + inner + "}" : "{#}";
    return "{" + inner + "}";
  },
  TConstraint: (t) => atomType(t.base) + " & " + writeExpression(t.pred),
  TUnion: (t) => t.members.map(unionMember).join(" | "),
};

export function writeType(t: N.TypeExpr): string {
  return N.foldType(t, type);
}

// Член объединения: вложенный union скобкуем (плоскую запись `A | B | C` парсер
// собирает обратно одним TUnion). TConstraint-член (`A & p`) пишется без скобок —
// "&" крепче "|", поэтому `A & p | B` парсится как `(A & p) | B`.
function unionMember(t: N.TypeExpr): string {
  return t.kind === "TUnion" ? "(" + writeType(t) + ")" : writeType(t);
}

export function writeDecl(d: N.Decl): string {
  return d.name + " = " + writeType(d.type);
}

// Тип в позиции, где верхний конструктор «&» (подтип) или «|» (объединение) требует
// скобок: элемент отношения (`(Число & _ > 0)[]`, `(Число | Строка)[]`), тип поля
// кортежа (`{цена: (Число & _ > 0)}`) и база ограничения (`(A | B) & p`). Скобки
// решает родитель по виду ребёнка (прямой доступ к узлу), затем рекурсия writeType.
function atomType(t: N.TypeExpr): string {
  return t.kind === "TConstraint" || t.kind === "TUnion" ? "(" + writeType(t) + ")" : writeType(t);
}

// ───────────────────────────── Запрос ─────────────────────────────

const queryStep: N.QueryStepCases<string> = {
  Select: (s) => "[" + writeExpression(s.pred) + "]",
  Project: (s) => ".(" + s.fields.join(", ") + ")",
  Unnest: (s) => "." + s.field,
};

export function writeQuery(q: N.Query): string {
  const src = typeof q.source === "string" ? q.source : "(" + writeQuery(q.source) + ")";
  return "?" + src + q.steps.map((s) => N.foldQueryStep(s, queryStep)).join("");
}
