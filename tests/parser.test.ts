// Тесты парсера: валидные входы дают ожидаемый AST, невалидные — ошибку.
// Покрытие по сводной грамматике: объявления, литералы, выражения; плюс края
// (приоритеты, нецепляемость сравнений, уточнение поля без скобок, лишний хвост).

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { LexError } from "../src/lexer";
import * as N from "../src/nodes";
import { ParseError, parseDeclaration, parseExpression, parseLiteral, parseQuery } from "../src/parser";

describe("объявления", () => {
  test("подтип", () => {
    assert.deepStrictEqual(
      parseDeclaration("Положительное = Число & _ > 0"),
      N.Decl("Положительное", N.TConstraint(N.TName("Число"), N.BinOp(">", N.Underscore(), N.Num("0")))),
    );
  });

  test("кортеж", () => {
    assert.deepStrictEqual(
      parseDeclaration("Точка = {x: Число, y: Число}"),
      N.Decl("Точка", N.TTuple([["x", N.TName("Число")], ["y", N.TName("Число")]])),
    );
  });

  test("кортеж-сущность (#)", () => {
    assert.deepStrictEqual(
      parseDeclaration("Задача = {#, название: Строка, статус: Строка}"),
      N.Decl("Задача", N.TTuple([["название", N.TName("Строка")], ["статус", N.TName("Строка")]], true)),
    );
  });

  test("кортеж-сущность без полей ({#})", () => {
    assert.deepStrictEqual(parseDeclaration("X = {#}"), N.Decl("X", N.TTuple([], true)));
  });

  test("пустой кортеж ({})", () => {
    assert.deepStrictEqual(parseDeclaration("X = {}"), N.Decl("X", N.TTuple([])));
  });

  test("строковый ключ поля", () => {
    assert.deepStrictEqual(
      parseDeclaration('X = {"order-id": Число}'),
      N.Decl("X", N.TTuple([["order-id", N.TName("Число")]])),
    );
  });

  test("объединение (union)", () => {
    assert.deepStrictEqual(
      parseDeclaration("X = Число | Строка"),
      N.Decl("X", N.TUnion([N.TName("Число"), N.TName("Строка")])),
    );
  });

  test("union как элемент отношения — в скобках", () => {
    assert.deepStrictEqual(
      parseDeclaration("X = (Число | Строка)[]"),
      N.Decl("X", N.TRel(N.TUnion([N.TName("Число"), N.TName("Строка")]))),
    );
  });

  test("необязательность T | Пусто", () => {
    assert.deepStrictEqual(
      parseDeclaration("X = Дата | Пусто"),
      N.Decl("X", N.TUnion([N.TName("Дата"), N.TName("Пусто")])),
    );
  });

  test("подтип крепче union: A & p | B", () => {
    assert.deepStrictEqual(
      parseDeclaration("X = Число & _ > 0 | Строка"),
      N.Decl("X", N.TUnion([
        N.TConstraint(N.TName("Число"), N.BinOp(">", N.Underscore(), N.Num("0"))),
        N.TName("Строка"),
      ])),
    );
  });

  test("отношение (постфикс T[])", () => {
    assert.deepStrictEqual(parseDeclaration("Заказы = Заказ[]"), N.Decl("Заказы", N.TRel(N.TName("Заказ"))));
  });

  test("поле-ссылка", () => {
    assert.deepStrictEqual(
      parseDeclaration("Клиент = {имя: Строка, заказ: #Заказ}"),
      N.Decl("Клиент", N.TTuple([["имя", N.TName("Строка")], ["заказ", N.TRef("Заказ")]])),
    );
  });

  test("поле-отношение (RVA)", () => {
    assert.deepStrictEqual(
      parseDeclaration("Клиент = {имя: Строка, заказы: Заказ[]}"),
      N.Decl("Клиент", N.TTuple([["имя", N.TName("Строка")], ["заказы", N.TRel(N.TName("Заказ"))]])),
    );
  });

  test("ограничение кортежа", () => {
    assert.deepStrictEqual(
      parseDeclaration("Прямоугольник = {ширина: Число, высота: Число} & ширина >= высота"),
      N.Decl("Прямоугольник", N.TConstraint(
        N.TTuple([["ширина", N.TName("Число")], ["высота", N.TName("Число")]]),
        N.BinOp(">=", N.Ref("ширина"), N.Ref("высота")),
      )),
    );
  });

  test("уточнение поля без скобок → ошибка", () => {
    assert.throws(() => parseDeclaration("X = {цена: Число & _ > 0}"), ParseError);
  });

  test("уточнение поля в скобках — ок", () => {
    assert.deepStrictEqual(
      parseDeclaration("X = {цена: (Число & _ > 0)}"),
      N.Decl("X", N.TTuple([["цена", N.TConstraint(N.TName("Число"), N.BinOp(">", N.Underscore(), N.Num("0")))]])),
    );
  });

  test("нет типа → ошибка", () => {
    assert.throws(() => parseDeclaration("X ="), ParseError);
  });

  test("лишний хвост → ошибка", () => {
    assert.throws(() => parseDeclaration("X = Число лишнее"), ParseError);
  });
});

describe("литералы", () => {
  test("скаляры", () => {
    assert.deepStrictEqual(parseLiteral("5"), N.Num("5"));
    assert.deepStrictEqual(parseLiteral("-3.2"), N.Num("-3.2"));
    assert.deepStrictEqual(parseLiteral("true"), N.Bool(true));
    assert.deepStrictEqual(parseLiteral("false"), N.Bool(false));
    assert.deepStrictEqual(parseLiteral('"Пятёрочка"'), N.Str("Пятёрочка"));
    assert.deepStrictEqual(parseLiteral('r".+@.+"'), N.Regex(".+@.+"));
  });

  test("null и экспонента (JSON)", () => {
    assert.deepStrictEqual(parseLiteral("null"), N.Null());
    assert.deepStrictEqual(parseLiteral("1e3"), N.Num("1e3"));
    assert.deepStrictEqual(parseLiteral("-1.5E-2"), N.Num("-1.5E-2"));
  });

  test("пустой кортеж и строковый ключ (JSON-объект)", () => {
    assert.deepStrictEqual(parseLiteral("{}"), N.TupleLit([]));
    assert.deepStrictEqual(
      parseLiteral('{"order-id": 1, x: null}'),
      N.TupleLit([["order-id", N.Num("1")], ["x", N.Null()]]),
    );
  });

  test("голый кортеж", () => {
    assert.deepStrictEqual(parseLiteral("{x: 3, y: 5}"), N.TupleLit([["x", N.Num("3")], ["y", N.Num("5")]]));
  });

  test("голое отношение", () => {
    assert.deepStrictEqual(
      parseLiteral("[ {x: 1}, {x: 2} ]"),
      N.RelLit([N.TupleLit([["x", N.Num("1")]]), N.TupleLit([["x", N.Num("2")]])]),
    );
  });

  test("скаляр-селекторы", () => {
    assert.deepStrictEqual(parseLiteral('Дата("2024-04-23")'), N.ScalarSel("Дата", N.Str("2024-04-23")));
    assert.deepStrictEqual(parseLiteral("Положительное(5)"), N.ScalarSel("Положительное", N.Num("5")));
  });

  test("кортеж-селектор", () => {
    assert.deepStrictEqual(parseLiteral("Точка{x: 3, y: 5}"), N.TupleSel("Точка", N.TupleLit([["x", N.Num("3")], ["y", N.Num("5")]])));
  });

  test("отношение-селектор и пустое", () => {
    assert.deepStrictEqual(parseLiteral("Заказ[ {x: 1} ]"), N.RelSel("Заказ", N.RelLit([N.TupleLit([["x", N.Num("1")]])])));
    assert.deepStrictEqual(parseLiteral("Заказ[]"), N.RelSel("Заказ", N.RelLit([])));
  });

  test("ссылка-селектор", () => {
    assert.deepStrictEqual(parseLiteral('#Заказ("u-1")'), N.RefSel("Заказ", N.Str("u-1")));
  });

  test("голое имя — не литерал", () => {
    assert.throws(() => parseLiteral("Заказ"), ParseError);
  });
});

describe("выражения", () => {
  test("* крепче +", () => {
    assert.deepStrictEqual(parseExpression("a + b * c"), N.BinOp("+", N.Ref("a"), N.BinOp("*", N.Ref("b"), N.Ref("c"))));
  });

  test("not слабее сравнения", () => {
    assert.deepStrictEqual(parseExpression("not a = b"), N.UnOp("not", N.BinOp("=", N.Ref("a"), N.Ref("b"))));
  });

  test("and группирует сравнения", () => {
    assert.deepStrictEqual(
      parseExpression("_ >= 0 and _ <= 100"),
      N.BinOp("and", N.BinOp(">=", N.Underscore(), N.Num("0")), N.BinOp("<=", N.Underscore(), N.Num("100"))),
    );
  });

  test("цепочка доступа", () => {
    assert.deepStrictEqual(parseExpression("a.x.y"), N.Member(N.Member(N.Ref("a"), "x"), "y"));
  });

  test("применение операции", () => {
    assert.deepStrictEqual(parseExpression("len(s)"), N.Apply("len", [N.Ref("s")]));
  });

  test("членство по регэкспу", () => {
    assert.deepStrictEqual(parseExpression('_ ~ r".+"'), N.BinOp("~", N.Underscore(), N.Regex(".+")));
  });

  test("скобки меняют приоритет", () => {
    assert.deepStrictEqual(parseExpression("(a + b) * c"), N.BinOp("*", N.BinOp("+", N.Ref("a"), N.Ref("b")), N.Ref("c")));
  });

  test("цепочка сравнений отвергается", () => {
    assert.throws(() => parseExpression("0 <= _ <= 100"), ParseError);
  });

  test("незакрытая строка", () => {
    assert.throws(() => parseExpression('"abc'), LexError);
  });
});

describe("запрос", () => {
  test("источник без шагов", () => {
    assert.deepStrictEqual(parseQuery("?Заказ"), N.Query("Заказ", []));
  });

  test("выборка σ", () => {
    assert.deepStrictEqual(
      parseQuery("?Заказ[количество > 1]"),
      N.Query("Заказ", [N.Select(N.BinOp(">", N.Ref("количество"), N.Num("1")))]),
    );
  });

  test("проекция π", () => {
    assert.deepStrictEqual(
      parseQuery("?Заказ.(адрес, количество)"),
      N.Query("Заказ", [N.Project(["адрес", "количество"])]),
    );
  });

  test("развёртка μ", () => {
    assert.deepStrictEqual(parseQuery("?Клиент.заказы"), N.Query("Клиент", [N.Unnest("заказы")]));
  });

  test("цепочка σ → π", () => {
    assert.deepStrictEqual(
      parseQuery("?Заказ[количество > 1].(адрес)"),
      N.Query("Заказ", [N.Select(N.BinOp(">", N.Ref("количество"), N.Num("1"))), N.Project(["адрес"])]),
    );
  });

  test("под-запрос как источник", () => {
    assert.deepStrictEqual(
      parseQuery("?(?Заказ[количество > 1]).(адрес)"),
      N.Query(N.Query("Заказ", [N.Select(N.BinOp(">", N.Ref("количество"), N.Num("1")))]), [N.Project(["адрес"])]),
    );
  });

  test("без ведущего ? → ошибка", () => {
    assert.throws(() => parseQuery("Заказ"), ParseError);
  });

  test("пустая проекция → ошибка", () => {
    assert.throws(() => parseQuery("?Заказ.()"), ParseError);
  });
});
