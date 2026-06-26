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
  env.declare("Положительное = Число & _ > 0");
  env.declare("Количество = Число & _ >= 1");
  env.declare("Точка = {x: Число, y: Число}");
  env.declare("Прямоугольник = {ширина: Число, высота: Число} & ширина >= высота");
  env.declare('Категория = Строка & _ ~ ["грузчик", "кассир"]');
  env.declare("Заказ = {объект: Строка, количество: Количество}");
  env.declare("Заказы = Заказ[]");
  env.declare("Клиент = {имя: Строка, заказ: #Заказ}");
  env.declare("Сотрудник = {#, имя: Строка, зарплата: Число}");
  env.declare("Отдел = {#, название: Строка, заказы: Заказ[]}");
  return env;
}

describe("объявления", () => {
  test("ограничение обязано быть Булево", () => {
    assert.throws(() => makeEnv().declare("Bad = Число & _ + 1"), TypeErr);
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
    env.declare("Имя = Строка & len(_) >= 1 and len(_) <= 3");
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

describe("запросы: допустимость", () => {
  test("источник-сущность → отношение", () => {
    assert.equal(makeEnv().checkQuery("?Сотрудник").kind, "Rel");
  });

  test("источник-значение (не сущность) → ошибка", () => {
    assert.throws(() => makeEnv().checkQuery("?Заказ"), TypeErr); // Заказ объявлен без #
  });

  test("неизвестный источник → ошибка", () => {
    assert.throws(() => makeEnv().checkQuery("?Нету"), TypeErr);
  });

  test("выборка σ по полю — ок", () => {
    makeEnv().checkQuery("?Сотрудник[зарплата > 0]");
  });

  test("предикат выборки не Булево → ошибка", () => {
    assert.throws(() => makeEnv().checkQuery("?Сотрудник[зарплата + 1]"), TypeErr);
  });

  test("выборка по несуществующему полю → ошибка", () => {
    assert.throws(() => makeEnv().checkQuery("?Сотрудник[нет > 0]"), TypeErr);
  });

  test("проекция π существующих полей — ок", () => {
    makeEnv().checkQuery("?Сотрудник.(имя, зарплата)");
  });

  test("проекция несуществующего поля → ошибка", () => {
    assert.throws(() => makeEnv().checkQuery("?Сотрудник.(нет)"), TypeErr);
  });

  test("развёртка μ в поле-отношение — ок", () => {
    assert.equal(makeEnv().checkQuery("?Отдел.заказы").kind, "Rel");
  });

  test("развёртка μ в поле-скаляр → ошибка", () => {
    assert.throws(() => makeEnv().checkQuery("?Сотрудник.имя"), TypeErr);
  });

  test("цепочка σ → π — ок", () => {
    makeEnv().checkQuery("?Сотрудник[зарплата > 0].(имя)");
  });

  test("под-запрос как источник — ок", () => {
    makeEnv().checkQuery("?(?Сотрудник[зарплата > 0]).(имя)");
  });
});

describe("Пусто и объединение", () => {
  test("Пусто — системный домен; null допустим", () => {
    assert.equal(makeEnv().checkLiteralAs("null", "Пусто").kind, "Scalar");
  });

  test("null недопустим под Число", () => {
    assert.throws(() => makeEnv().checkLiteralAs("null", "Число"), TypeErr);
  });

  test("Пусто не подставляется в арифметику", () => {
    assert.throws(() => makeEnv().checkExpr("_ + 1", { _: "Пусто" }), TypeErr);
  });

  test("равенство с null — Булево", () => {
    makeEnv().checkExpr("_ = null", { _: "Пусто" }, "Булево");
  });

  test("union: значение любого члена допустимо, чужого — нет", () => {
    const env = makeEnv();
    env.declare("ЧислоИлиСтрока = Число | Строка");
    env.checkLiteralAs("5", "ЧислоИлиСтрока");
    env.checkLiteralAs('"x"', "ЧислоИлиСтрока");
    assert.throws(() => env.checkLiteralAs("true", "ЧислоИлиСтрока"), TypeErr);
  });

  test("необязательность T | Пусто", () => {
    const env = makeEnv();
    env.declare("Отметка = Дата | Пусто");
    env.checkLiteralAs("null", "Отметка");
    env.checkLiteralAs('"2024-04-23"', "Отметка");
    assert.throws(() => env.checkLiteralAs("5", "Отметка"), TypeErr);
  });

  test("разнотипное отношение-литерал → union элемента", () => {
    assert.deepStrictEqual(makeEnv().checkLiteral('[1, "a"]'), {
      kind: "Rel",
      elem: { kind: "Uni", members: [{ kind: "Scalar", name: "Число" }, { kind: "Scalar", name: "Строка" }] },
    });
  });
});
