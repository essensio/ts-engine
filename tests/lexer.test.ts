// Тесты isName: строка — валидное `имя` грамматики (буква, далее буквы/цифры/`_`)
// и не ключевое слово. Опирается на лексер.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isName } from "../src/lexer";

describe("isName", () => {
  test("валидные имена (в т.ч. кириллица)", () => {
    for (const s of ["Число", "Заказ", "x", "x1", "имя_типа", "A_B2"]) {
      assert.equal(isName(s), true, s);
    }
  });
  test("невалидные: пусто, цифра/подчёркивание в начале, не-имя", () => {
    for (const s of ["", "1x", "_x", "order-id", "a b", "a.b", "x ", " x", "?", "{}"]) {
      assert.equal(isName(s), false, JSON.stringify(s));
    }
  });
  test("ключевые слова — не имена", () => {
    for (const s of ["true", "false", "null", "and", "or", "not"]) {
      assert.equal(isName(s), false, s);
    }
  });
});
