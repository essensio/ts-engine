// Тесты foldSemType: разбор семантического типа по конструктору. Свёртка обязана
// направлять каждый вид в свой обработчик (включая Uni) и передавать обработчику
// узкий вариант — так потребитель ведёт рекурсию там, где она нужна.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { Env, foldSemType, type SemType } from "../src/checker";

function env(): Env {
  const e = new Env();
  e.declare("Положительное = Число & _ > 0");
  e.declare("Точка = {x: Число, y: Число}");
  e.declare("Числа = Число[]");
  e.declare("Разнородное = Число | Строка");
  return e;
}

const kindOf = (t: SemType): string =>
  foldSemType(t, {
    Scalar: () => "scalar",
    Sub: () => "sub",
    Tup: () => "tup",
    Rel: () => "rel",
    RefT: () => "ref",
    Uni: () => "uni",
  });

// Свёртка-метка: рекурсию ведёт сам потребитель, обработчик получает узкий вариант.
const label = (t: SemType): string =>
  foldSemType(t, {
    Scalar: (s) => s.name,
    Sub: (s) => (s.name !== "" ? s.name : `подтип(${label(s.base)})`),
    Rel: (r) => `[${label(r.elem)}]`,
    RefT: (r) => `#${r.target}`,
    Tup: (tp) => "{" + tp.fields.map(([n, ft]) => `${n}: ${label(ft)}`).join(", ") + "}",
    Uni: (u) => u.members.map(label).join(" | "),
  });

describe("foldSemType", () => {
  test("каждый вид — в свой обработчик", () => {
    const e = env();
    assert.equal(kindOf(e.types.get("Число")!), "scalar");
    assert.equal(kindOf(e.types.get("Положительное")!), "sub");
    assert.equal(kindOf(e.types.get("Точка")!), "tup");
    assert.equal(kindOf(e.types.get("Числа")!), "rel");
    assert.equal(kindOf(e.types.get("Разнородное")!), "uni");
    assert.equal(kindOf({ kind: "RefT", target: "Точка" }), "ref");
  });

  test("обработчик получает узкий вариант — рекурсия по членам", () => {
    const e = env();
    assert.equal(label(e.types.get("Разнородное")!), "Число | Строка");
    assert.equal(label(e.types.get("Точка")!), "{x: Число, y: Число}");
    assert.equal(label({ kind: "RefT", target: "Точка" }), "#Точка");
  });
});
