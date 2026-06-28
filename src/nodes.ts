// AST-узлы четырёх грамматик (essensio/notation): типы, литералы, выражения, запросы.
//
// Узлы — простые размеченные объекты (discriminated union по полю `kind`).
// Для каждого узла есть конструктор-функция того же имени: он даёт ровно тот
// «вид», что сравнивается в тестах через assert.deepStrictEqual.
//
// Литералы — частный случай выражений: их узлы (Num … TupleLit, RelLit, селекторы)
// служат и атомами выражений; узлы Underscore/Ref/Member/Apply/BinOp/UnOp — только
// в выражениях. Узлы типов (T*) — отдельное семейство (выражение-тип): у TTuple
// флаг `entity` различает кортеж-сущность (объявлен с `#`, своя таблица) и
// кортеж-значение (встраивается в поле владельца); TConstraint — подтип
// (`база & предикат`), TUnion — объединение (`A | B`). Запрос (Query) — четвёртое
// семейство-корень: источник + шаги Select σ / Project π / Unnest μ, каждый шаг —
// отношение → отношение.

// ───────────────────────── Типы (выражение-тип) ─────────────────────────

export type TName = { kind: "TName"; name: string };
export type TTuple = { kind: "TTuple"; fields: Array<[string, TypeExpr]>; entity: boolean };
export type TRel = { kind: "TRel"; elem: TypeExpr };
export type TRef = { kind: "TRef"; target: string };
export type TConstraint = { kind: "TConstraint"; base: TypeExpr; pred: Expr };
export type TUnion = { kind: "TUnion"; members: TypeExpr[] };
export type TypeExpr = TName | TTuple | TRel | TRef | TConstraint | TUnion;
export type Decl = { kind: "Decl"; name: string; type: TypeExpr };

export const TName = (name: string): TName => ({ kind: "TName", name });
export const TTuple = (fields: Array<[string, TypeExpr]>, entity = false): TTuple => ({ kind: "TTuple", fields, entity });
export const TRel = (elem: TypeExpr): TRel => ({ kind: "TRel", elem });
export const TRef = (target: string): TRef => ({ kind: "TRef", target });
export const TConstraint = (base: TypeExpr, pred: Expr): TConstraint => ({ kind: "TConstraint", base, pred });
export const TUnion = (members: TypeExpr[]): TUnion => ({ kind: "TUnion", members });
export const Decl = (name: string, type: TypeExpr): Decl => ({ kind: "Decl", name, type });

// ───────────────────── Литералы (атомы) и выражения ─────────────────────

export type Num = { kind: "Num"; text: string };
export type Bool = { kind: "Bool"; value: boolean };
export type Str = { kind: "Str"; value: string };
export type Null = { kind: "Null" };
export type Regex = { kind: "Regex"; pattern: string };
export type TupleLit = { kind: "TupleLit"; fields: Array<[string, Expr]> };
export type RelLit = { kind: "RelLit"; elems: Expr[] };
export type ScalarSel = { kind: "ScalarSel"; name: string; arg: Expr };
export type RefSel = { kind: "RefSel"; target: string; arg: Expr };
export type TupleSel = { kind: "TupleSel"; name: string; value: TupleLit };
export type RelSel = { kind: "RelSel"; name: string; value: RelLit };
export type Underscore = { kind: "Underscore" };
export type Ref = { kind: "Ref"; name: string };
export type Member = { kind: "Member"; obj: Expr; field: string };
export type Apply = { kind: "Apply"; name: string; args: Expr[] };
export type BinOp = { kind: "BinOp"; op: string; left: Expr; right: Expr };
export type UnOp = { kind: "UnOp"; op: string; operand: Expr };

export type Expr =
  | Num | Bool | Str | Null | Regex | TupleLit | RelLit
  | ScalarSel | RefSel | TupleSel | RelSel
  | Underscore | Ref | Member | Apply | BinOp | UnOp;

export const Num = (text: string): Num => ({ kind: "Num", text });
export const Bool = (value: boolean): Bool => ({ kind: "Bool", value });
export const Str = (value: string): Str => ({ kind: "Str", value });
export const Null = (): Null => ({ kind: "Null" });
export const Regex = (pattern: string): Regex => ({ kind: "Regex", pattern });
export const TupleLit = (fields: Array<[string, Expr]>): TupleLit => ({ kind: "TupleLit", fields });
export const RelLit = (elems: Expr[]): RelLit => ({ kind: "RelLit", elems });
export const ScalarSel = (name: string, arg: Expr): ScalarSel => ({ kind: "ScalarSel", name, arg });
export const RefSel = (target: string, arg: Expr): RefSel => ({ kind: "RefSel", target, arg });
export const TupleSel = (name: string, value: TupleLit): TupleSel => ({ kind: "TupleSel", name, value });
export const RelSel = (name: string, value: RelLit): RelSel => ({ kind: "RelSel", name, value });
export const Underscore = (): Underscore => ({ kind: "Underscore" });
export const Ref = (name: string): Ref => ({ kind: "Ref", name });
export const Member = (obj: Expr, field: string): Member => ({ kind: "Member", obj, field });
export const Apply = (name: string, args: Expr[]): Apply => ({ kind: "Apply", name, args });
export const BinOp = (op: string, left: Expr, right: Expr): BinOp => ({ kind: "BinOp", op, left, right });
export const UnOp = (op: string, operand: Expr): UnOp => ({ kind: "UnOp", op, operand });

// ─────────────────────── Запрос (реляционная алгебра) ───────────────────────

export type Select = { kind: "Select"; pred: Expr };
export type Project = { kind: "Project"; fields: string[] };
export type Unnest = { kind: "Unnest"; field: string };
export type QueryStep = Select | Project | Unnest;
export type Query = { kind: "Query"; source: string | Query; steps: QueryStep[] };

export const Select = (pred: Expr): Select => ({ kind: "Select", pred });
export const Project = (fields: string[]): Project => ({ kind: "Project", fields });
export const Unnest = (field: string): Unnest => ({ kind: "Unnest", field });
export const Query = (source: string | Query, steps: QueryStep[]): Query => ({ kind: "Query", source, steps });

// ───────────────────────── свёртки по виду узла ─────────────────────────
//
// Разбор узла по конструктору с исчерпываемостью by construction (по образцу
// foldSemType): запись «обработчик на КАЖДЫЙ вид», единственный switch по `kind`,
// рекурсию в детей ведёт сам обработчик (foldExpr(child, on)). Добавится вид в
// union — перестанут компилироваться и свёртка, и каждая её алгебра. Контекст
// потребителя (приоритет печати, режим разбора) ловится носителем R = (ctx) => Out;
// вид ребёнка виден прямым доступом к узлу в обработчике.
//
// Экспортируется только foldExpr (его потребляет cli); foldType/foldQueryStep —
// внутренние, их зовёт writer (узкая поверхность: API не шире нужды).

export type ExprCases<R> = { [K in Expr["kind"]]: (e: Extract<Expr, { kind: K }>) => R };

export function foldExpr<R>(e: Expr, on: ExprCases<R>): R {
  switch (e.kind) {
    case "Num": return on.Num(e);
    case "Bool": return on.Bool(e);
    case "Str": return on.Str(e);
    case "Null": return on.Null(e);
    case "Regex": return on.Regex(e);
    case "TupleLit": return on.TupleLit(e);
    case "RelLit": return on.RelLit(e);
    case "ScalarSel": return on.ScalarSel(e);
    case "RefSel": return on.RefSel(e);
    case "TupleSel": return on.TupleSel(e);
    case "RelSel": return on.RelSel(e);
    case "Underscore": return on.Underscore(e);
    case "Ref": return on.Ref(e);
    case "Member": return on.Member(e);
    case "Apply": return on.Apply(e);
    case "BinOp": return on.BinOp(e);
    case "UnOp": return on.UnOp(e);
  }
}

export type TypeCases<R> = { [K in TypeExpr["kind"]]: (t: Extract<TypeExpr, { kind: K }>) => R };

export function foldType<R>(t: TypeExpr, on: TypeCases<R>): R {
  switch (t.kind) {
    case "TName": return on.TName(t);
    case "TTuple": return on.TTuple(t);
    case "TRel": return on.TRel(t);
    case "TRef": return on.TRef(t);
    case "TConstraint": return on.TConstraint(t);
    case "TUnion": return on.TUnion(t);
  }
}

export type QueryStepCases<R> = { [K in QueryStep["kind"]]: (s: Extract<QueryStep, { kind: K }>) => R };

export function foldQueryStep<R>(s: QueryStep, on: QueryStepCases<R>): R {
  switch (s.kind) {
    case "Select": return on.Select(s);
    case "Project": return on.Project(s);
    case "Unnest": return on.Unnest(s);
  }
}
