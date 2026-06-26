// Проверка типов и допустимости над AST (essensio/notation).
//
// Env держит среду типов (системные + объявленные) и проверяет:
//   declare(src)                — регистрирует тип; ограничение обязано быть Булево.
//   checkLiteral(src)           — тип самотипизированного литерала (селектор/скаляр).
//   checkLiteralAs(src, T)      — литерал — допустимое ЗНАЧЕНИЕ типа T (вкл. ограничения).
//   checkExpr(src, ctx, expect) — выражение well-typed в контексте ctx → его тип.
//   checkQuery(src)             — запрос well-typed → тип результата (отношение).
//
// ИНВАРИАНТЫ
//   * Системные типы: Строка, Число, Булево, Дата, Время, UUID; особняком Пусто
//     (вырожденный домен единственного значения null).
//   * Подтип подставим вместо родителя: для операций тип сводится к корню (root).
//   * Объединение (Uni): значение годится, если подходит под любой член; общие
//     операции union — только =/!=, доменные требуют сужения.
//   * «Допустимо» = проверка не падает; для ограничения дополнительно тип = Булево.
//   * Литерал-константа дополнительно проверяется на ограничение вычислением (evalConst):
//     Положительное(-2) недопустимо, хотя типизируется.
//   * Запрос: источник — сущность (кортеж-тип с `#`), его таблица — отношение этой
//     сущности; шаги замкнуты (отношение → отношение): σ сохраняет тип, π оставляет
//     поля (результат — кортеж-значение), μ входит в поле-отношение/кортеж.
//
// КРАЕВЫЕ → TypeErr: неизвестное имя/тип; несовпадение арности/типов; 5 + "текст";
//   сравнение/равенство разных типов; ~ с правым не-множеством; нарушение ограничения
//   значением; доступ к компоненте у не-кортежа; пустой литерал-отношение без тега;
//   источник запроса не сущность; предикат выборки не Булево; проекция/развёртка по
//   несуществующему полю; развёртка по полю-не-отношению/не-кортежу.

import * as N from "./nodes";
import { parseDeclaration, parseExpression, parseLiteral, parseQuery } from "./parser";

// ───────────────────────── семантические типы ─────────────────────────

export type Scalar = { kind: "Scalar"; name: string };
export type Sub = { kind: "Sub"; name: string; base: SemType; pred: N.Expr };
export type Tup = { kind: "Tup"; fields: Array<[string, SemType]>; entity: boolean };
export type Rel = { kind: "Rel"; elem: SemType };
export type RefT = { kind: "RefT"; target: string };
export type Uni = { kind: "Uni"; members: SemType[] };
export type SemType = Scalar | Sub | Tup | Rel | RefT | Uni;

export type SemTypeCases<R> = {
  Scalar: (t: Scalar) => R;
  Sub: (t: Sub) => R;
  Tup: (t: Tup) => R;
  Rel: (t: Rel) => R;
  RefT: (t: RefT) => R;
  Uni: (t: Uni) => R;
};

// Разбор семантического типа по конструктору с исчерпываемостью by construction:
// единственный switch по виду; потребитель передаёт обработчик на каждый вид и
// получает узкий вариант (рекурсию ведёт сам, где нужна). Добавится вид SemType —
// перестанут компилироваться и эта свёртка, и каждое её место вызова.
export function foldSemType<R>(t: SemType, on: SemTypeCases<R>): R {
  switch (t.kind) {
    case "Scalar": return on.Scalar(t);
    case "Sub": return on.Sub(t);
    case "Tup": return on.Tup(t);
    case "Rel": return on.Rel(t);
    case "RefT": return on.RefT(t);
    case "Uni": return on.Uni(t);
  }
}

const scalar = (name: string): Scalar => ({ kind: "Scalar", name });
// Системные домены — в порядке спеки (Строка — корень и цель сериализации — первой).
const SYSTEM = ["Строка", "Число", "Булево", "Дата", "Время", "UUID"];
const NUM = scalar("Число");
const STR = scalar("Строка");
const BOOL = scalar("Булево");
const EMPTY = scalar("Пусто");   // вырожденный домен: единственное значение null, только = / !=
const ORDERED = new Set(["Строка", "Число", "Дата", "Время"]);

export class TypeErr extends Error {}

export function root(t: SemType): SemType {
  while (t.kind === "Sub") t = t.base;
  return t;
}

function isScalar(t: SemType, name: string): boolean {
  const r = root(t);
  return r.kind === "Scalar" && r.name === name;
}

export function same(a: SemType, b: SemType): boolean {
  a = root(a);
  b = root(b);
  if (a.kind === "Scalar" && b.kind === "Scalar") return a.name === b.name;
  if (a.kind === "Rel" && b.kind === "Rel") return same(a.elem, b.elem);
  if (a.kind === "RefT" && b.kind === "RefT") return a.target === b.target;
  if (a.kind === "Tup" && b.kind === "Tup") {
    if (a.fields.length !== b.fields.length) return false;
    return a.fields.every((f, i) => f[0] === b.fields[i][0] && same(f[1], b.fields[i][1]));
  }
  if (a.kind === "Uni" && b.kind === "Uni") {
    if (a.members.length !== b.members.length) return false;
    return a.members.every((m, i) => same(m, b.members[i]));
  }
  return false;
}

// Тип элемента разнотипного отношения — объединение различных (по `same`) типов:
// один различный тип → он сам, несколько → Uni.
function unionOf(types: SemType[]): SemType {
  const distinct: SemType[] = [];
  for (const t of types) if (!distinct.some((d) => same(d, t))) distinct.push(t);
  return distinct.length === 1 ? distinct[0] : { kind: "Uni", members: distinct };
}

type Ctx = Record<string, SemType>;

export class Env {
  readonly types = new Map<string, SemType>();

  constructor() {
    for (const n of SYSTEM) this.types.set(n, scalar(n));
    this.types.set("Пусто", EMPTY); // особняком — вырожденный домен (см. spec)
  }

  // ── объявление типов ──
  declare(src: string): SemType {
    return this.define(parseDeclaration(src));
  }

  define(decl: N.Decl): SemType {
    const st = this.resolve(decl.type, decl.name);
    this.types.set(decl.name, st);
    return st;
  }

  resolve(te: N.TypeExpr, name = ""): SemType {
    switch (te.kind) {
      case "TName":
        return this.sem(te.name);
      case "TTuple":
        return { kind: "Tup", fields: te.fields.map(([fn, ft]) => [fn, this.resolve(ft)]), entity: te.entity };
      case "TRel":
        return { kind: "Rel", elem: this.resolve(te.elem) };
      case "TRef":
        this.sem(te.target);
        return { kind: "RefT", target: te.target };
      case "TConstraint": {
        const b = this.resolve(te.base);
        const ctx: Ctx = { _: b };
        const rb = root(b);
        if (rb.kind === "Tup") for (const [fn, ft] of rb.fields) ctx[fn] = ft;
        if (!same(this.infer(te.pred, ctx), BOOL)) throw new TypeErr("ограничение подтипа должно быть Булево");
        return { kind: "Sub", name, base: b, pred: te.pred };
      }
      case "TUnion":
        return { kind: "Uni", members: te.members.map((m) => this.resolve(m)) };
    }
  }

  // ── публичная проверка литералов и выражений ──
  checkLiteral(src: string): SemType {
    return this.infer(parseLiteral(src), {});
  }

  checkLiteralAs(src: string, typeName: string): SemType {
    const expected = this.sem(typeName);
    this.checkValue(parseLiteral(src), expected);
    return expected;
  }

  checkExpr(src: string, ctx: Record<string, string> = {}, expect?: string): SemType {
    const sctx: Ctx = {};
    for (const [k, v] of Object.entries(ctx)) sctx[k] = this.sem(v);
    const t = this.infer(parseExpression(src), sctx);
    if (expect !== undefined && !same(t, this.sem(expect))) throw new TypeErr(`ожидался ${expect}`);
    return t;
  }

  // ── проверка запроса: источник-сущность, затем замкнутые шаги ──
  checkQuery(src: string): Rel {
    return this.query(parseQuery(src));
  }

  private query(q: N.Query): Rel {
    let rel = this.querySource(q.source);
    for (const s of q.steps) rel = this.queryStep(rel, s);
    return rel;
  }

  // источник запроса даёт отношение: таблица сущности либо результат под-запроса.
  private querySource(s: string | N.Query): Rel {
    if (typeof s !== "string") return this.query(s);
    const t = this.sem(s);
    const r = root(t);
    if (r.kind !== "Tup" || !r.entity) throw new TypeErr(`источник запроса ${s} должен быть сущностью (кортеж с #)`);
    return { kind: "Rel", elem: t };
  }

  // шаг замкнут: отношение → отношение. σ сохраняет тип; π оставляет поля
  // (результат — кортеж-значение); μ входит в поле-отношение (плоско) либо в
  // поле-кортеж (отношение из него).
  private queryStep(rel: Rel, s: N.QueryStep): Rel {
    const elem = root(rel.elem);
    if (elem.kind !== "Tup") throw new TypeErr("шаг запроса применим к отношению кортежей");
    switch (s.kind) {
      case "Select": {
        const ctx: Ctx = {};
        for (const [fn, ft] of elem.fields) ctx[fn] = ft;
        if (!same(this.infer(s.pred, ctx), BOOL)) throw new TypeErr("предикат выборки должен быть Булево");
        return rel;
      }
      case "Project": {
        const picked: Array<[string, SemType]> = s.fields.map((f) => {
          const found = elem.fields.find(([fn]) => fn === f);
          if (found === undefined) throw new TypeErr(`проекция: нет поля ${f}`);
          return [f, found[1]];
        });
        return { kind: "Rel", elem: { kind: "Tup", fields: picked, entity: false } };
      }
      case "Unnest": {
        const found = elem.fields.find(([fn]) => fn === s.field);
        if (found === undefined) throw new TypeErr(`развёртка: нет поля ${s.field}`);
        const ft = root(found[1]);
        if (ft.kind === "Rel") return { kind: "Rel", elem: ft.elem };
        if (ft.kind === "Tup") return { kind: "Rel", elem: found[1] };
        throw new TypeErr(`развёртка: поле ${s.field} не отношение и не кортеж`);
      }
    }
  }

  private sem(name: string): SemType {
    const t = this.types.get(name);
    if (t === undefined) throw new TypeErr(`неизвестный тип ${name}`);
    return t;
  }

  // ── вывод типа выражения ──
  infer(e: N.Expr, ctx: Ctx): SemType {
    switch (e.kind) {
      case "Num": return NUM;
      case "Bool": return BOOL;
      case "Str": return STR;
      case "Null": return EMPTY;
      case "Regex": return { kind: "Rel", elem: STR };
      case "Underscore": {
        const t = ctx["_"];
        if (t === undefined) throw new TypeErr("_ вне области ограничения");
        return t;
      }
      case "Ref": {
        const t = ctx[e.name];
        if (t === undefined) throw new TypeErr(`неизвестное имя ${e.name}`);
        return t;
      }
      case "Member": {
        const ot = root(this.infer(e.obj, ctx));
        if (ot.kind !== "Tup") throw new TypeErr("доступ к компоненте не у кортежа");
        for (const [fn, ft] of ot.fields) if (fn === e.field) return ft;
        throw new TypeErr(`нет компоненты ${e.field}`);
      }
      case "TupleLit":
        return { kind: "Tup", fields: e.fields.map(([fn, v]) => [fn, this.infer(v, ctx)]), entity: false };
      case "RelLit": {
        if (e.elems.length === 0) throw new TypeErr("пустой литерал-отношение требует тега");
        return { kind: "Rel", elem: unionOf(e.elems.map((x) => this.infer(x, ctx))) };
      }
      case "UnOp": {
        const xt = this.infer(e.operand, ctx);
        if (e.op === "not") { if (!isScalar(xt, "Булево")) throw new TypeErr("not от не-Булево"); return BOOL; }
        if (e.op === "-") { if (!isScalar(xt, "Число")) throw new TypeErr("унарный - от не-Числа"); return NUM; }
        throw new TypeErr(`неизвестный унарный ${e.op}`);
      }
      case "BinOp": return this.binop(e.op, e.left, e.right, ctx);
      case "Apply": return this.apply(e.name, e.args, ctx);
      case "ScalarSel": return this.selScalar(e.name, e.arg);
      case "RefSel": {
        this.sem(e.target);
        this.checkValue(e.arg, { kind: "RefT", target: e.target });
        return { kind: "RefT", target: e.target };
      }
      case "TupleSel": {
        const st = this.sem(e.name);
        this.checkValue(e.value, st);
        return st;
      }
      case "RelSel": {
        const expected: SemType = { kind: "Rel", elem: this.sem(e.name) };
        this.checkValue(e.value, expected);
        return expected;
      }
    }
  }

  private binop(op: string, l: N.Expr, r: N.Expr, ctx: Ctx): SemType {
    if (op === "and" || op === "or") {
      for (const x of [l, r]) if (!isScalar(this.infer(x, ctx), "Булево")) throw new TypeErr(`${op} от не-Булево`);
      return BOOL;
    }
    if (op === "+" || op === "-" || op === "*" || op === "/") {
      const lt = root(this.infer(l, ctx));
      const rt = root(this.infer(r, ctx));
      if (op === "+" && isScalar(lt, "Строка") && isScalar(rt, "Строка")) return STR;
      if (isScalar(lt, "Число") && isScalar(rt, "Число")) return NUM;
      if (op === "-" && lt.kind === "Scalar" && rt.kind === "Scalar" && lt.name === rt.name
          && (lt.name === "Дата" || lt.name === "Время")) return NUM;
      throw new TypeErr(`${op} неприменимо к ${show(lt)}/${show(rt)}`);
    }
    if (op === "<" || op === "<=" || op === ">" || op === ">=") {
      const lt = root(this.infer(l, ctx));
      const rt = root(this.infer(r, ctx));
      if (lt.kind === "Scalar" && rt.kind === "Scalar" && lt.name === rt.name && ORDERED.has(lt.name)) return BOOL;
      throw new TypeErr(`${op} неприменимо к ${show(lt)}/${show(rt)}`);
    }
    if (op === "=" || op === "!=") {
      if (!same(this.infer(l, ctx), this.infer(r, ctx))) throw new TypeErr(`${op} над несовместимыми типами`);
      return BOOL;
    }
    if (op === "~") {
      const lt = this.infer(l, ctx);
      const rt = root(this.infer(r, ctx));
      if (rt.kind === "Rel" && same(rt.elem, lt)) return BOOL;
      throw new TypeErr("~ требует справа множество того же типа");
    }
    throw new TypeErr(`неизвестный оператор ${op}`);
  }

  private apply(name: string, args: N.Expr[], ctx: Ctx): SemType {
    if (name === "len") {
      if (args.length !== 1 || !isScalar(this.infer(args[0], ctx), "Строка")) throw new TypeErr("len : Строка -> Число");
      return NUM;
    }
    if (this.types.has(name)) {
      if (args.length !== 1) throw new TypeErr(`селектор ${name} ждёт один аргумент`);
      return this.selScalar(name, args[0]);
    }
    throw new TypeErr(`неизвестная операция/тип ${name}`);
  }

  private selScalar(name: string, arg: N.Expr): SemType {
    const st = this.sem(name);
    this.checkValue(arg, st);
    return st;
  }

  // ── проверка ЗНАЧЕНИЯ против ожидаемого типа (вкл. ограничения) ──
  checkValue(node: N.Expr, expected: SemType): void {
    // Объединение: значение допустимо, если подходит хотя бы под один член
    // (сами члены несут свои ограничения); внешний подтип проверяется после.
    const re = root(expected);
    if (re.kind === "Uni") {
      for (const m of re.members) {
        try { this.checkValue(node, m); this.evalConstraints(expected, node); return; }
        catch (e) { if (!(e instanceof TypeErr)) throw e; }
      }
      throw new TypeErr("значение не подходит ни под один член объединения");
    }
    if (node.kind === "ScalarSel" || node.kind === "TupleSel" || node.kind === "RelSel"
        || node.kind === "RefSel" || node.kind === "Apply") {
      if (!same(this.infer(node, {}), expected)) throw new TypeErr("тип селектора не совпадает с ожидаемым");
      return;
    }
    const rb = root(expected);
    if (rb.kind === "Scalar") {
      if (!scalarLitOk(rb, node)) throw new TypeErr(`литерал не подходит под ${show(rb)}`);
    } else if (rb.kind === "Tup") {
      if (node.kind !== "TupleLit") throw new TypeErr("ожидался кортеж-значение");
      const ln = node.fields.map(([fn]) => fn);
      const rn = rb.fields.map(([fn]) => fn);
      if (ln.length !== rn.length || ln.some((fn, i) => fn !== rn[i])) throw new TypeErr("состав полей кортежа не совпадает");
      node.fields.forEach(([, fv], i) => this.checkValue(fv, rb.fields[i][1]));
    } else if (rb.kind === "Rel") {
      if (node.kind !== "RelLit") throw new TypeErr("ожидалось отношение-значение");
      for (const x of node.elems) this.checkValue(x, rb.elem);
    } else if (rb.kind === "RefT") {
      if (node.kind !== "Str") throw new TypeErr("значение ссылки — строка-uuid");
    }
    this.evalConstraints(expected, node);
  }

  private evalConstraints(st: SemType, node: N.Expr): void {
    if (st.kind !== "Sub") return;
    this.evalConstraints(st.base, node);
    const value = this.evalConst(node, {});
    const ctx: Record<string, EvalVal> = { _: value };
    if (isRecord(value)) for (const [k, v] of Object.entries(value)) ctx[k] = v;
    if (this.evalConst(st.pred, ctx) !== true) {
      throw new TypeErr(`значение нарушает ограничение ${st.name || "подтипа"}`.trim());
    }
  }

  // ── вычисление константного выражения (для проверки ограничений литералов) ──
  evalConst(e: N.Expr, vals: Record<string, EvalVal>): EvalVal {
    switch (e.kind) {
      case "Num": return Number(e.text);
      case "Bool": return e.value;
      case "Str": return e.value;
      case "Null": return null;
      case "Regex": return new RegexVal(e.pattern);
      case "Underscore": return vals["_"];
      case "Ref": return vals[e.name];
      case "TupleLit": {
        const r: EvalRecord = {};
        for (const [fn, v] of e.fields) r[fn] = this.evalConst(v, vals);
        return r;
      }
      case "RelLit": return e.elems.map((x) => this.evalConst(x, vals));
      case "Member": return (this.evalConst(e.obj, vals) as EvalRecord)[e.field];
      case "ScalarSel": return this.evalConst(e.arg, vals);
      case "RefSel": return this.evalConst(e.arg, vals);
      case "TupleSel": return this.evalConst(e.value, vals);
      case "RelSel": return this.evalConst(e.value, vals);
      case "UnOp":
        if (e.op === "not") return !asBool(this.evalConst(e.operand, vals));
        if (e.op === "-") return -asNum(this.evalConst(e.operand, vals));
        throw new TypeErr(`не могу вычислить унарный ${e.op}`);
      case "BinOp": return evalBin(e.op, this.evalConst(e.left, vals), this.evalConst(e.right, vals));
      case "Apply":
        if (e.name === "len") return (this.evalConst(e.args[0], vals) as string).length;
        if (e.args.length === 1) return this.evalConst(e.args[0], vals);
        throw new TypeErr(`не могу вычислить ${e.name}`);
    }
  }
}

// ───────────────────────── значения вычислителя ─────────────────────────

class RegexVal {
  constructor(readonly src: string) {}
}
type EvalRecord = { [k: string]: EvalVal };
type EvalVal = number | string | boolean | null | RegexVal | EvalVal[] | EvalRecord;

function isRecord(v: EvalVal): v is EvalRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof RegexVal);
}
function asNum(v: EvalVal): number { return v as number; }
function asBool(v: EvalVal): boolean { return v as boolean; }

function cmp(a: EvalVal, b: EvalVal): number {
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

function valueEq(a: EvalVal, b: EvalVal): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => valueEq(x, b[i]));
  if (isRecord(a) && isRecord(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    return ak.length === bk.length && ak.every((k) => k in b && valueEq(a[k], b[k]));
  }
  return false;
}

function evalBin(op: string, a: EvalVal, b: EvalVal): EvalVal {
  switch (op) {
    case "and": return asBool(a) && asBool(b);
    case "or": return asBool(a) || asBool(b);
    case "+": return typeof a === "string" && typeof b === "string" ? a + b : asNum(a) + asNum(b);
    case "-": return asNum(a) - asNum(b);
    case "*": return asNum(a) * asNum(b);
    case "/": return asNum(a) / asNum(b);
    case "<": return cmp(a, b) < 0;
    case "<=": return cmp(a, b) <= 0;
    case ">": return cmp(a, b) > 0;
    case ">=": return cmp(a, b) >= 0;
    case "=": return valueEq(a, b);
    case "!=": return !valueEq(a, b);
    case "~":
      if (b instanceof RegexVal) return new RegExp(`^(?:${b.src})$`, "u").test(a as string);
      return (b as EvalVal[]).some((x) => valueEq(x, a));
    default: throw new TypeErr(`неизвестный оператор ${op}`);
  }
}

function scalarLitOk(s: Scalar, node: N.Expr): boolean {
  switch (s.name) {
    case "Число": return node.kind === "Num";
    case "Строка": return node.kind === "Str";
    case "Булево": return node.kind === "Bool";
    case "Пусто": return node.kind === "Null";
    case "Дата":
    case "Время":
    case "UUID": return node.kind === "Str";
    default: return false;
  }
}

function show(t: SemType): string {
  switch (t.kind) {
    case "Scalar": return t.name;
    case "Sub": return t.name || `подтип(${show(t.base)})`;
    case "Rel": return `[${show(t.elem)}]`;
    case "RefT": return `#${t.target}`;
    case "Tup": return "{" + (t.entity ? "#, " : "") + t.fields.map(([fn, ft]) => `${fn}: ${show(ft)}`).join(", ") + "}";
    case "Uni": return t.members.map(show).join(" | ");
  }
}
