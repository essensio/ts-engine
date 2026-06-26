// Тесты печати литерала (writeLiteral): точный текст для представительных форм и
// round-trip parseLiteral(writeLiteral(x)) ≡ x по батарее краевых случаев
// (экранирование строк, ключи-ключевые-слова и не-имена, числа, пустые/вложенные,
// селекторы, кириллица). Плюс: не-литерал → WriteError.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as N from "../src/nodes";
import { parseDeclaration, parseType, parseExpression, parseLiteral, parseQuery } from "../src/parser";
import { writeLiteral, writeExpression, writeType, writeDecl, writeQuery, WriteError } from "../src/writer";

describe("точный текст", () => {
  test("скаляры и null", () => {
    assert.equal(writeLiteral(N.Num("-3.2")), "-3.2");
    assert.equal(writeLiteral(N.Bool(false)), "false");
    assert.equal(writeLiteral(N.Null()), "null");
    assert.equal(writeLiteral(N.Str("Аня")), '"Аня"');
  });
  test("кортеж: голый ключ vs строка-ключ", () => {
    assert.equal(writeLiteral(N.TupleLit([["x", N.Num("3")], ["y", N.Num("5")]])), "{x: 3, y: 5}");
    assert.equal(writeLiteral(N.TupleLit([])), "{}");
    assert.equal(writeLiteral(N.TupleLit([["order-id", N.Num("1")]])), '{"order-id": 1}');
    assert.equal(writeLiteral(N.TupleLit([["true", N.Bool(false)]])), '{"true": false}');
    assert.equal(writeLiteral(N.TupleLit([["1x", N.Null()]])), '{"1x": null}');
  });
  test("экранирование строк", () => {
    assert.equal(writeLiteral(N.Str('a"b\\c')), '"a\\"b\\\\c"');
    assert.equal(writeLiteral(N.Regex(".+@.+")), 'r".+@.+"');
  });
  test("селекторы", () => {
    assert.equal(writeLiteral(N.ScalarSel("Дата", N.Str("2024-04-23"))), 'Дата("2024-04-23")');
    assert.equal(writeLiteral(N.RefSel("Заказ", N.Str("u-1"))), '#Заказ("u-1")');
    assert.equal(writeLiteral(N.TupleSel("Точка", N.TupleLit([["x", N.Num("3")]]))), "Точка{x: 3}");
    assert.equal(writeLiteral(N.RelSel("Заказ", N.RelLit([N.TupleLit([["n", N.Num("1")]])]))), "Заказ[{n: 1}]");
  });
});

describe("round-trip parseLiteral(writeLiteral(x)) ≡ x", () => {
  // batteries по AST (где исходник с «плохим» ключом/строкой записать руками неудобно)
  const astBattery: N.Expr[] = [
    N.Str(""),
    N.Str('кавычка " и слэш \\ и\nперевод'),
    N.TupleLit([["true", N.Num("1")], ["null", N.Bool(true)], ["and", N.Null()]]),
    N.TupleLit([["order-id", N.Num("1")], ["с пробелом", N.Str("x")], ["", N.Null()]]),
    N.TupleLit([]),
    N.RelLit([]),
    N.RelLit([N.Num("1"), N.Str("a"), N.Null(), N.Bool(false)]),
  ];
  for (const x of astBattery) {
    test(writeLiteral(x), () => {
      assert.deepStrictEqual(parseLiteral(writeLiteral(x)), x);
    });
  }

  // batteries по исходнику нотации
  for (const src of [
    "5", "-3.2", "1e3", "-1.5E-2", "true", "null", '"Пятёрочка"', 'r".+@.+"',
    "{}", "[]", "{x: 3, y: 5}", "{вложен: {a: 1, b: [1, 2, null]}}",
    '[1, "a", null, true]',
    'Дата("2024-04-23")', "Положительное(5)", "Точка{x: 3, y: 5}",
    '#Заказ("u-1")', "Заказ[{объект: \"Ленина 1\", количество: 5}]",
    '{объект: "Машиностроителей 15", "order-id": 2, тег: null}',
  ]) {
    test(src, () => {
      const ast = parseLiteral(src);
      assert.deepStrictEqual(parseLiteral(writeLiteral(ast)), ast);
    });
  }
});

describe("ошибки", () => {
  test("не-литерал → WriteError", () => {
    assert.throws(() => writeLiteral(N.BinOp("+", N.Num("1"), N.Num("2"))), WriteError);
    assert.throws(() => writeLiteral(N.Ref("x")), WriteError);
  });
});

describe("точный текст: типы и объявления", () => {
  test("имя, отношение, кортеж, ссылка", () => {
    assert.equal(writeType(N.TName("Число")), "Число");
    assert.equal(writeType(N.TRel(N.TName("Заказ"))), "Заказ[]");
    assert.equal(writeType(N.TRel(N.TRel(N.TName("Заказ")))), "Заказ[][]");
    assert.equal(writeType(N.TTuple([["x", N.TName("Число")], ["y", N.TName("Число")]])), "{x: Число, y: Число}");
    assert.equal(writeType(N.TRef("Заказ")), "#Заказ");
  });
  test("ограничение и скобки в позициях элемента/поля", () => {
    const pos = N.TConstraint(N.TName("Число"), N.BinOp(">", N.Underscore(), N.Num("0")));
    assert.equal(writeType(pos), "Число | _ > 0");
    assert.equal(writeType(N.TRel(pos)), "(Число | _ > 0)[]");
    assert.equal(writeType(N.TTuple([["цена", pos]])), "{цена: (Число | _ > 0)}");
    assert.equal(writeDecl(N.Decl("Положительное", pos)), "Положительное = Число | _ > 0");
  });
  test("ключ-не-имя печатается строкой", () => {
    assert.equal(writeType(N.TTuple([["order-id", N.TName("Число")]])), '{"order-id": Число}');
  });
  test("кортеж-сущность печатается с #", () => {
    assert.equal(writeType(N.TTuple([["название", N.TName("Строка")]], true)), "{#, название: Строка}");
    assert.equal(writeType(N.TTuple([["x", N.TName("Число")]], false)), "{x: Число}");
  });
});

describe("точный текст: выражения и приоритеты", () => {
  test("связки и сравнения (без лишних скобок)", () => {
    const band = N.BinOp("and", N.BinOp(">=", N.Underscore(), N.Num("0")), N.BinOp("<=", N.Underscore(), N.Num("100")));
    assert.equal(writeExpression(band), "_ >= 0 and _ <= 100");
    assert.equal(writeExpression(N.UnOp("not", N.BinOp("or", N.Ref("a"), N.Ref("b")))), "not (a or b)");
  });
  test("арифметика: скобки только где нужно", () => {
    assert.equal(writeExpression(N.BinOp("+", N.Ref("a"), N.BinOp("*", N.Ref("b"), N.Ref("c")))), "a + b * c");
    assert.equal(writeExpression(N.BinOp("*", N.BinOp("+", N.Ref("a"), N.Ref("b")), N.Ref("c"))), "(a + b) * c");
  });
  test("доступ, применение, членство", () => {
    assert.equal(writeExpression(N.Member(N.Ref("a"), "x")), "a.x");
    assert.equal(writeExpression(N.Apply("len", [N.Ref("s")])), "len(s)");
    assert.equal(writeExpression(N.BinOp("~", N.Underscore(), N.Regex(".+@.+"))), '_ ~ r".+@.+"');
  });
});

describe("round-trip parseType(writeType(x)) ≡ x", () => {
  for (const src of [
    "Число", "Строка", "Заказ[]", "Заказ[][]",
    "{x: Число, y: Число}", "{адрес: {улица: Строка}}",
    "#Заказ", "Число | _ > 0", "{цена: (Число | _ > 0)}", "(Число | _ > 0)[]",
    "{a: Точка, b: Точка} | a != b", "{имя: Строка, заказы: Заказ[]}",
  ]) {
    test(src, () => {
      const ast = parseType(src);
      assert.deepStrictEqual(parseType(writeType(ast)), ast);
    });
  }
});

describe("round-trip parseDeclaration(writeDecl(x)) ≡ x", () => {
  for (const src of [
    "Точка = {x: Число, y: Число}",
    "Положительное = Число | _ > 0",
    "Клиент = {имя: Строка, заказы: Заказ[]}",
    'Категория = Строка | _ ~ ["грузчик", "кассир"]',
    "Прямоугольник = {ширина: Положительное, высота: Положительное} | ширина >= высота",
    "Задача = {#, название: Строка, статус: Строка}",
    "Заказ = {#, объект: Строка, количество: Число} | количество >= 1",
  ]) {
    test(src, () => {
      const ast = parseDeclaration(src);
      assert.deepStrictEqual(parseDeclaration(writeDecl(ast)), ast);
    });
  }
});

describe("запрос: точный текст и round-trip", () => {
  test("точный текст", () => {
    const q = N.Query("Заказ", [N.Select(N.BinOp(">", N.Ref("количество"), N.Num("1"))), N.Project(["адрес", "количество"])]);
    assert.equal(writeQuery(q), "?Заказ[количество > 1].(адрес, количество)");
    assert.equal(writeQuery(N.Query("Клиент", [N.Unnest("заказы")])), "?Клиент.заказы");
  });
  for (const src of [
    "?Заказ", "?Заказ[количество > 1]", "?Заказ.(адрес, количество)", "?Клиент.заказы",
    "?Заказ[количество > 1].(адрес)", "?(?Заказ[количество > 1]).(адрес)",
  ]) {
    test(src, () => {
      const ast = parseQuery(src);
      assert.deepStrictEqual(parseQuery(writeQuery(ast)), ast);
    });
  }
});

describe("round-trip parseExpression(writeExpression(x)) ≡ x", () => {
  for (const src of [
    "_ > 0", "_ >= 0 and _ <= 100", "ширина >= высота", "a != b",
    "len(s)", '_ ~ r".+@.+"', "not (a or b)", "a + 1", "a + b * c", "(a + b) * c",
    "a.x", '_ ~ ["a", "b", "c"]', "a and b or c", "(a or b) and c",
  ]) {
    test(src, () => {
      const ast = parseExpression(src);
      assert.deepStrictEqual(parseExpression(writeExpression(ast)), ast);
    });
  }
});
