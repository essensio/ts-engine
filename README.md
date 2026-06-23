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
```

- [`src/lexer.ts`](src/lexer.ts) — `tokenize(src) → Token[]` (прилегание значимо: `r"…"`, `#имя`, селекторы).
- [`src/nodes.ts`](src/nodes.ts) — AST-узлы трёх грамматик (типы · литералы · выражения), размеченные объединения по `kind`.
- [`src/parser.ts`](src/parser.ts) — рекурсивный спуск: `parseDeclaration` · `parseType` · `parseLiteral` · `parseExpression`. Приоритет задан иерархией продукций; сравнения не цепляются.
- [`src/checker.ts`](src/checker.ts) — `Env`: среда типов (системные + объявленные), проверка well-typed и допустимости значений (ограничения вычисляются константно).
- [`src/index.ts`](src/index.ts) — публичный API.

## Публичный API

```ts
import {
  tokenize, parseDeclaration, parseType, parseLiteral, parseExpression,
  Env, root, same, nodes,
} from "@essensio/engine";

const env = new Env();
env.declare("Положительное = Число | _ > 0");
env.checkLiteralAs("5", "Положительное");   // ок
env.checkLiteralAs("-2", "Положительное");  // TypeErr: нарушение ограничения
```

Ошибки — `LexError` · `ParseError` · `TypeErr`. Семантические типы — `SemType`
(`Scalar` · `Sub` · `Tup` · `Rel` · `RefT`).

## Разработка

```bash
npm install        # tsx + typescript (dev)
npm test           # node --import tsx --test tests/*.test.ts
npm run typecheck  # tsc (строгий режим)
```

## Статус

Реализованы парсер и тайпчекер **объявлений типов**, **литералов** и
**выражений** — согласно нормативной грамматике. Открытый пункт (как и в
`notation`) — реляционная алгебра: запросы и операции над relvar.
