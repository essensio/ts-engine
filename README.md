# ts-engine

TypeScript-движок нотации **Essensio** — эталонная реализация грамматики
[`essensio/notation`](https://github.com/essensio/notation): парсер и проверка
типов (тайпчекер) над нотацией системы типов, где **тип = домен**.

Это первый из движков; ожидаются реализации той же грамматики на других языках
(один нормативный источник синтаксиса — `notation`, много движков). Языковой
префикс в имени (`ts-`) отличает их.

Ядро **чистое** — нулевые внешние зависимости в рантайме (только dev: `tsx` +
`typescript` для тестов и проверки типов).

## Конвейер

```
исходник нотации ──tokenize──▶ Token[] ──parse──▶ AST ──check──▶ семантический тип / ошибка
                                              AST ──write──▶ исходник нотации (инверсия parse)
```

- [`src/lexer.ts`](src/lexer.ts) — `tokenize(src) → Token[]` (прилегание значимо: `r"…"`, `#имя`, селекторы); `isName(s)` — строка есть `имя` по грамматике.
- [`src/nodes.ts`](src/nodes.ts) — AST-узлы четырёх грамматик (типы · литералы · выражения · запросы), размеченные объединения по `kind`. Кортеж-тип несёт флаг `entity` (сущность с `#` vs значение).
- [`src/parser.ts`](src/parser.ts) — рекурсивный спуск: `parseDeclaration` · `parseType` · `parseLiteral` · `parseExpression` · `parseQuery`. Приоритет задан иерархией продукций; сравнения не цепляются.
- [`src/writer.ts`](src/writer.ts) — печать AST → текст (инверсия парсера): `writeDecl` · `writeType` · `writeExpression` · `writeLiteral` · `writeQuery`. Скобки минимальны (та же иерархия приоритетов); `parseX(writeX(ast)) ≡ ast`.
- [`src/checker.ts`](src/checker.ts) — `Env`: среда типов (системные + объявленные), проверка well-typed и допустимости значений (ограничения вычисляются константно).
- [`src/index.ts`](src/index.ts) — публичный API.

## Публичный API

```ts
import {
  tokenize, isName, parseDeclaration, parseType, parseLiteral, parseExpression, parseQuery,
  writeDecl, writeType, writeExpression, writeLiteral, writeQuery,
  Env, root, same, nodes,
} from "@essensio/engine";

const env = new Env();
env.declare("Положительное = Число & _ > 0");   // подтип: база "&" предикат
env.checkLiteralAs("5", "Положительное");   // ок
env.checkLiteralAs("-2", "Положительное");  // TypeErr: нарушение ограничения

// объединение (union) "|" — значение одного из членов; необязательность = T | Пусто
env.declare("Отметка = Дата | Пусто");
env.checkLiteralAs("null", "Отметка");                 // ок (Пусто — домен null)

// сущность (#) и запрос (реляционная алгебра σ · π · μ)
env.declare("Сотрудник = {#, имя: Строка, зарплата: Число}");
env.checkQuery("?Сотрудник[зарплата > 0].(имя)");      // Rel (отношение → отношение)

// печать (инверсия парсера): AST → текст нотации
writeType(nodes.TRel(nodes.TName("Заказ")));            // "Заказ[]"
writeDecl(parseDeclaration("Точка = {x: Число, y: Число}"));
isName("Заказ");  // true   ·   isName("order-id");  // false
```

Ошибки — `LexError` · `ParseError` · `TypeErr`. Семантические типы — `SemType`
(`Scalar` · `Sub` · `Tup` · `Rel` · `RefT` · `Uni`).

## Рекомендации по использованию

- **`nodes` — единственный источник AST.** Узлы (`TypeExpr`, `Expr`, `Decl`, …)
  живут здесь; потребитель **не заводит параллельную модель типов**. Строй и
  разбирай эти узлы, а свою специфику (позиции, метаданные вывода, JSON-частности)
  навешивай **поверх**, не копируя виды узлов вниз по слою.
- **Исчерпывающий `switch`.** Разбирая размеченное объединение (`TypeExpr` / `Expr`),
  закрывай все `kind` и добавляй ветку `never`:
  ```ts
  function f(t: nodes.TypeExpr): string {
    switch (t.kind) {
      case "TName": /* … */ return t.name;
      // … остальные ветки …
      default: { const _exhaustive: never = t; return _exhaustive; }
    }
  }
  ```
  Пропущенный случай станет ошибкой компиляции, а не багом в рантайме — в этом и
  смысл размеченного объединения.
- **Печать ↔ разбор — инверсии.** Собрал узлы → `writeType` / `writeDecl` /
  `writeExpression` / `writeLiteral`; текст → `parseType` / …; `parseX(writeX(ast)) ≡ ast`.
- **Имя проверяй `isName`**, а не своей регуляркой — правило имени задаёт лексер.

## Разработка

```bash
npm install        # tsx + typescript (dev)
npm test           # node --import tsx --test tests/*.test.ts
npm run typecheck  # tsc (строгий режим)
```

## Статус

Реализованы парсер и тайпчекер **объявлений типов** (включая кортеж-сущность
`#`), **литералов**, **выражений** и **запросов** (реляционная алгебра: выборка
σ · проекция π · развёртка μ) — согласно нормативной грамматике. Открытый пункт
(как и в `notation`) — остальная реляционная алгебра (соединение / объединение /
пересечение / разность) и операции над relvar (вставка / обновление / удаление).
