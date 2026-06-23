// Тесты проверки типов: задаём типы, задаём литералы, проверяем допустимые выражения.
// «Допустимо» = проверка не падает; «недопустимо» = TypeErr. Покрыты: ограничение
// обязано быть Булево; значение нарушает ограничение; несовпадение типов операций;
// членство ~; доступ к компоненте; вложенные ограничения внутри отношения.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { Env, TypeErr } from "../src/checker";

const BOOL = { kind: "Scalar", name: "Булево" };

function makeEnv(): Env {
  const env = new Env();
  env.declare("Положительное = Число | _ > 0");
  env.declare("Количество = Число | _ >= 1");
  env.declare("Точка = {x: Число, y: Число}");
  env.declare("Прямоугольник = {ширина: Число, высота: Число} | ширина >= высота");
  env.declare('Категория = Строка | _ ~ ["грузчик", "кассир"]');
  env.declare("Заказ = {объект: Строка, количество: Количество}");
  env.declare("Заказы = Заказ[]");
  env.declare("Клиент = {имя: Строка, заказ: #Заказ}");
  return env;
}

describe("объявления", () => {
  test("ограничение обязано быть Булево", () => {
    assert.throws(() => makeEnv().declare("Bad = Число | _ + 1"), TypeErr);
  });

  test("неизвестный тип в объявлении", () => {
    assert.throws(() => makeEnv().declare("X = {a: Нету}"), TypeErr);
  });
});

describe("литералы: допустимость значения", () => {
  test("значение подтипа — ок", () => {
    const env = makeEnv();
    assert.deepStrictEqual(env.checkLiteralAs("5", "Положительное"), env.types.get("Положительное"));
  });

  test("нарушение ограничения подтипа", () => {
    assert.throws(() => makeEnv().checkLiteralAs("-2", "Положительное"), TypeErr);
  });

  test("неверный вид литерала", () => {
    assert.throws(() => makeEnv().checkLiteralAs('"x"', "Число"), TypeErr);
  });

  test("селектор — ок", () => {
    assert.equal(makeEnv().checkLiteral("Положительное(5)").kind, "Sub");
  });

  test("селектор нарушает ограничение", () => {
    assert.throws(() => makeEnv().checkLiteral("Положительное(-2)"), TypeErr);
  });

  test("кортеж-селектор — ок", () => {
    makeEnv().checkLiteral("Точка{x: 3, y: 5}");
  });

  test("кортеж без поля", () => {
    assert.throws(() => makeEnv().checkLiteral("Точка{x: 3}"), TypeErr);
  });

  test("ограничение кортежа — ок", () => {
    makeEnv().checkLiteralAs("{ширина: 5, высота: 3}", "Прямоугольник");
  });

  test("нарушение ограничения кортежа", () => {
    assert.throws(() => makeEnv().checkLiteralAs("{ширина: 3, высота: 5}", "Прямоугольник"), TypeErr);
  });

  test("членство в перечислении — ок", () => {
    makeEnv().checkLiteralAs('"грузчик"', "Категория");
  });

  test("нарушение перечисления", () => {
    assert.throws(() => makeEnv().checkLiteralAs('"повар"', "Категория"), TypeErr);
  });

  test("ограничение длины строки (len)", () => {
    const env = makeEnv();
    env.declare("Имя = Строка | len(_) >= 1 and len(_) <= 3");
    env.checkLiteralAs('"ab"', "Имя"); // длина 1..3 — ок
    assert.throws(() => env.checkLiteralAs('""', "Имя"), TypeErr); // пусто
    assert.throws(() => env.checkLiteralAs('"abcd"', "Имя"), TypeErr); // длинно
  });

  test("вложенное отношение — ок", () => {
    makeEnv().checkLiteral('Заказ[ {объект: "Ленина 1", количество: 2} ]');
  });

  test("вложенное ограничение нарушено", () => {
    assert.throws(() => makeEnv().checkLiteral('Заказ[ {объект: "Ленина 1", количество: 0} ]'), TypeErr);
  });
});

describe("выражения: допустимость", () => {
  test("ограничение-скаляр → Булево", () => {
    assert.deepStrictEqual(makeEnv().checkExpr("_ > 0", { _: "Число" }), BOOL);
  });

  test("ошибка типа", () => {
    assert.throws(() => makeEnv().checkExpr('5 + "текст"'), TypeErr);
  });

  test("конъюнкция", () => {
    makeEnv().checkExpr("_ >= 0 and _ <= 100", { _: "Число" }, "Булево");
  });

  test("регэксп-членство", () => {
    makeEnv().checkExpr('_ ~ r".+@.+"', { _: "Строка" }, "Булево");
  });

  test("несовпадение типа множества", () => {
    assert.throws(() => makeEnv().checkExpr("_ ~ [1, 2]", { _: "Строка" }), TypeErr);
  });

  test("доступ к компоненте", () => {
    makeEnv().checkExpr("p.x > 0", { p: "Точка" }, "Булево");
  });

  test("операция len", () => {
    makeEnv().checkExpr('len("ab") > 0', {}, "Булево");
  });

  test("неизвестное имя", () => {
    assert.throws(() => makeEnv().checkExpr("неизвестное > 0"), TypeErr);
  });
});
