// Тесты свёрток по узлам AST: foldExpr / foldType / foldQueryStep.
//
// Главное свойство — fold = id: алгебра из конструкторов узлов восстанавливает
// исходный AST глубоко равным. Так проверяется и рекурсия в детей, и что каждый
// вид попал в свой обработчик. Исчерпанность видов гарантирует компилятор: запись
// ExprCases/TypeCases/QueryStepCases — тотальная по `kind`, пропуск вида не
// скомпилируется (отдельным рантайм-тестом не проверить — это статика tsc).
// Плюс пример полезной алгебры (счётчик узлов) — что носитель R произвольный.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as N from "../src/nodes";

// ───────────────────────── id-алгебры (fold = id) ─────────────────────────

const idExpr: N.ExprCases<N.Expr> = {
  Num: (e) => N.Num(e.text),
  Bool: (e) => N.Bool(e.value),
  Str: (e) => N.Str(e.value),
  Null: () => N.Null(),
  Regex: (e) => N.Regex(e.pattern),
  TupleLit: (e) => N.TupleLit(e.fields.map(([k, v]) => [k, N.foldExpr(v, idExpr)])),
  RelLit: (e) => N.RelLit(e.elems.map((x) => N.foldExpr(x, idExpr))),
  ScalarSel: (e) => N.ScalarSel(e.name, N.foldExpr(e.arg, idExpr)),
  RefSel: (e) => N.RefSel(e.target, N.foldExpr(e.arg, idExpr)),
  TupleSel: (e) => N.TupleSel(e.name, N.foldExpr(e.value, idExpr) as N.TupleLit),
  RelSel: (e) => N.RelSel(e.name, N.foldExpr(e.value, idExpr) as N.RelLit),
  Underscore: () => N.Underscore(),
  Ref: (e) => N.Ref(e.name),
  Member: (e) => N.Member(N.foldExpr(e.obj, idExpr), e.field),
  Apply: (e) => N.Apply(e.name, e.args.map((a) => N.foldExpr(a, idExpr))),
  BinOp: (e) => N.BinOp(e.op, N.foldExpr(e.left, idExpr), N.foldExpr(e.right, idExpr)),
  UnOp: (e) => N.UnOp(e.op, N.foldExpr(e.operand, idExpr)),
};

const idType: N.TypeCases<N.TypeExpr> = {
  TName: (t) => N.TName(t.name),
  TRef: (t) => N.TRef(t.target),
  TRel: (t) => N.TRel(N.foldType(t.elem, idType)),
  TTuple: (t) => N.TTuple(t.fields.map(([k, ft]) => [k, N.foldType(ft, idType)]), t.entity),
  TConstraint: (t) => N.TConstraint(N.foldType(t.base, idType), t.pred),
  TUnion: (t) => N.TUnion(t.members.map((m) => N.foldType(m, idType))),
};

const idStep: N.QueryStepCases<N.QueryStep> = {
  Select: (s) => N.Select(s.pred),
  Project: (s) => N.Project([...s.fields]),
  Unnest: (s) => N.Unnest(s.field),
};

// ───────────────────────── корпуса (все виды каждого семейства) ─────────────────────────

// 17 видов Expr + вложенность.
const exprs: N.Expr[] = [
  N.Num("3.14"), N.Bool(true), N.Str("hi"), N.Null(), N.Regex(".+@.+"),
  N.Underscore(), N.Ref("x"),
  N.Member(N.Ref("t"), "f"),
  N.Apply("len", [N.Ref("s")]),
  N.BinOp("+", N.Num("1"), N.Num("2")),
  N.UnOp("not", N.Bool(false)),
  N.TupleLit([["a", N.Num("1")], ["b", N.Str("z")]]),
  N.RelLit([N.Num("1"), N.Num("2")]),
  N.ScalarSel("Дата", N.Str("2024-01-01")),
  N.RefSel("Заказ", N.Str("u-1")),
  N.TupleSel("Точка", N.TupleLit([["x", N.Num("3")]])),
  N.RelSel("Числа", N.RelLit([N.Num("1")])),
  N.BinOp("and", N.BinOp(">", N.Underscore(), N.Num("0")), N.UnOp("not", N.Apply("len", [N.Ref("s")]))),
];

// 6 видов TypeExpr + вложенность.
const types: N.TypeExpr[] = [
  N.TName("Число"),
  N.TRef("Заказ"),
  N.TRel(N.TName("Строка")),
  N.TTuple([["x", N.TName("Число")], ["y", N.TName("Число")]], false),
  N.TTuple([], true),
  N.TConstraint(N.TName("Число"), N.BinOp(">", N.Underscore(), N.Num("0"))),
  N.TUnion([N.TName("Число"), N.TName("Строка")]),
  N.TRel(N.TConstraint(N.TName("Число"), N.BinOp(">", N.Underscore(), N.Num("0")))),
];

// 3 вида QueryStep.
const steps: N.QueryStep[] = [
  N.Select(N.BinOp(">", N.Ref("x"), N.Num("0"))),
  N.Project(["a", "b"]),
  N.Unnest("items"),
];

describe("fold = id (восстановление исходного AST)", () => {
  test("foldExpr — все 17 видов и вложенность", () => {
    for (const e of exprs) assert.deepStrictEqual(N.foldExpr(e, idExpr), e);
  });
  test("foldType — все 6 видов и вложенность", () => {
    for (const t of types) assert.deepStrictEqual(N.foldType(t, idType), t);
  });
  test("foldQueryStep — все 3 вида", () => {
    for (const s of steps) assert.deepStrictEqual(N.foldQueryStep(s, idStep), s);
  });
});

describe("произвольный носитель R", () => {
  // Счётчик узлов: показывает, что обработчик ведёт рекурсию сам и R любой.
  const size = (e: N.Expr): number =>
    N.foldExpr(e, {
      Num: () => 1, Bool: () => 1, Str: () => 1, Null: () => 1, Regex: () => 1,
      Underscore: () => 1, Ref: () => 1,
      Member: (x) => 1 + size(x.obj),
      Apply: (x) => 1 + x.args.reduce((n, a) => n + size(a), 0),
      UnOp: (x) => 1 + size(x.operand),
      BinOp: (x) => 1 + size(x.left) + size(x.right),
      TupleLit: (x) => 1 + x.fields.reduce((n, [, v]) => n + size(v), 0),
      RelLit: (x) => 1 + x.elems.reduce((n, v) => n + size(v), 0),
      ScalarSel: (x) => 1 + size(x.arg),
      RefSel: (x) => 1 + size(x.arg),
      TupleSel: (x) => 1 + size(x.value),
      RelSel: (x) => 1 + size(x.value),
    });

  test("счётчик узлов считает по всему дереву", () => {
    assert.equal(size(N.Num("1")), 1);
    assert.equal(size(N.BinOp("+", N.Num("1"), N.Num("2"))), 3);
    assert.equal(size(N.UnOp("not", N.BinOp(">", N.Ref("x"), N.Num("0")))), 4);
  });
});
