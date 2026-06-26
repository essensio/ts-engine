// Парсер: токены → AST. Рекурсивный спуск по сводной грамматике (essensio/notation).
//
// ПЯТЬ ВХОДОВ (по нонтерминалу-корню):
//   parseDeclaration(src) -> Decl       (объявление = имя "=" тип)
//   parseType(src)        -> TypeExpr   (тип)
//   parseLiteral(src)     -> Expr       (литерал = значение | селектор)
//   parseExpression(src)  -> Expr       (выражение)
//   parseQuery(src)       -> Query      (запрос = "?" источник { шаг })
//
// ИНВАРИАНТЫ
//   * Приоритет операторов задаётся иерархией: or < and < not < comparison <
//     sum < product < unary < postfix < atom.
//   * Сравнение НЕ цепляется: comparison берёт максимум один оператор сравнения.
//   * Каждый вход требует EOF в конце.
//   * Отношение — постфикс: T[] (отношение-тип). Тип поля — отношение-тип (без верхнего "|");
//     уточнение поля только в скобках.
//   * Кортеж-тип: необязательный ведущий "#," — признак сущности (entity); далее ≥1 поле.
//   * Запрос ведёт "?": источник (имя сущности или под-запрос в скобках), затем
//     шаги слева направо — выборка "[…]" σ, проекция ".(…)" π, развёртка ".имя" μ.
//
// КРАЕВЫЕ → ParseError: неполный вход, лишний хвост, цепочка сравнений,
//   "|" в типе поля без скобок, ссылка "#" не на имя, имя как литерал,
//   "#" в кортеже-типе без полей, шаг запроса не после источника.

import { tokenize, type Token } from "./lexer";
import * as N from "./nodes";

export class ParseError extends Error {}

const CMP_OPS: Record<string, string> = {
  EQ: "=", NE: "!=", LT: "<", LE: "<=", GT: ">", GE: ">=", TILDE: "~",
};

class Parser {
  private readonly toks: Token[];
  private i = 0;

  constructor(src: string) {
    this.toks = tokenize(src);
  }

  private peek(): Token { return this.toks[this.i]; }
  private at(kind: string): boolean { return this.toks[this.i].kind === kind; }
  private next(): Token { const t = this.toks[this.i]; this.i += 1; return t; }
  private eat(kind: string): Token {
    const t = this.toks[this.i];
    if (t.kind !== kind) throw new ParseError(`ожидался ${kind}, получено ${t.kind} ${JSON.stringify(t.value)} на ${t.pos}`);
    this.i += 1;
    return t;
  }
  expectEof(): void {
    if (!this.at("EOF")) { const t = this.peek(); throw new ParseError(`лишний хвост ${JSON.stringify(t.value)} на ${t.pos}`); }
  }

  // ── объявления и типы ──
  declaration(): N.Decl {
    const name = this.eat("NAME").value;
    this.eat("EQ");
    return N.Decl(name, this.type());
  }

  type(): N.TypeExpr {
    const t = this.relType();
    if (this.at("BAR")) { this.next(); return N.TConstraint(t, this.expression()); }
    return t;
  }

  // отношение-тип = атом-тип , { "[" "]" }  — отношение постфиксом: T[], T[][]
  private relType(): N.TypeExpr {
    let t = this.atomType();
    while (this.at("LBRACK")) { this.eat("LBRACK"); this.eat("RBRACK"); t = N.TRel(t); }
    return t;
  }

  private atomType(): N.TypeExpr {
    const t = this.peek();
    if (t.kind === "NAME") { this.next(); return N.TName(t.value); }
    if (t.kind === "LBRACE") return this.tupleType();
    if (t.kind === "HASH") { this.next(); return N.TRef(this.eat("NAME").value); }
    if (t.kind === "LPAREN") { this.next(); const inner = this.type(); this.eat("RPAREN"); return inner; }
    throw new ParseError(`ожидался тип, получено ${t.kind} на ${t.pos}`);
  }

  private tupleType(): N.TTuple {
    this.eat("LBRACE");
    let entity = false;
    if (this.at("HASH")) { this.next(); this.eat("COMMA"); entity = true; }
    const fields: Array<[string, N.TypeExpr]> = [this.typeField()];
    while (this.at("COMMA")) { this.next(); fields.push(this.typeField()); }
    this.eat("RBRACE");
    return N.TTuple(fields, entity);
  }

  private typeField(): [string, N.TypeExpr] {
    const name = this.eat("NAME").value;
    this.eat("COLON");
    return [name, this.relType()];
  }

  // ── выражения (по убыванию приоритета) ──
  expression(): N.Expr { return this.or(); }

  private or(): N.Expr {
    let left = this.and();
    while (this.at("OR")) { this.next(); left = N.BinOp("or", left, this.and()); }
    return left;
  }

  private and(): N.Expr {
    let left = this.not();
    while (this.at("AND")) { this.next(); left = N.BinOp("and", left, this.not()); }
    return left;
  }

  private not(): N.Expr {
    if (this.at("NOT")) { this.next(); return N.UnOp("not", this.not()); }
    return this.comparison();
  }

  private comparison(): N.Expr {
    const left = this.sum();
    const k = this.peek().kind;
    if (k in CMP_OPS) { this.next(); return N.BinOp(CMP_OPS[k], left, this.sum()); }
    return left;
  }

  private sum(): N.Expr {
    let left = this.product();
    while (this.peek().kind === "PLUS" || this.peek().kind === "MINUS") {
      const t = this.next();
      left = N.BinOp(t.kind === "PLUS" ? "+" : "-", left, this.product());
    }
    return left;
  }

  private product(): N.Expr {
    let left = this.unary();
    while (this.peek().kind === "STAR" || this.peek().kind === "SLASH") {
      const t = this.next();
      left = N.BinOp(t.kind === "STAR" ? "*" : "/", left, this.unary());
    }
    return left;
  }

  private unary(): N.Expr {
    if (this.at("MINUS")) { this.next(); return N.UnOp("-", this.unary()); }
    return this.postfix();
  }

  private postfix(): N.Expr {
    let e = this.atom();
    while (this.at("DOT")) { this.next(); e = N.Member(e, this.eat("NAME").value); }
    return e;
  }

  private atom(): N.Expr {
    const t = this.peek();
    if (t.kind === "UNDERSCORE") { this.next(); return N.Underscore(); }
    if (t.kind === "LPAREN") { this.next(); const e = this.expression(); this.eat("RPAREN"); return e; }
    if (t.kind === "HASH") {
      this.next();
      const target = this.eat("NAME").value;
      this.eat("LPAREN");
      const arg = this.value();
      this.eat("RPAREN");
      return N.RefSel(target, arg);
    }
    if (t.kind === "NAME") {
      this.next();
      const name = t.value;
      if (this.at("LPAREN")) {
        this.next();
        const args: N.Expr[] = [];
        if (!this.at("RPAREN")) {
          args.push(this.expression());
          while (this.at("COMMA")) { this.next(); args.push(this.expression()); }
        }
        this.eat("RPAREN");
        return N.Apply(name, args);
      }
      if (this.at("LBRACE")) return N.TupleSel(name, this.tupleValue());
      if (this.at("LBRACK")) return N.RelSel(name, this.relValue());
      return N.Ref(name);
    }
    return this.value();
  }

  // ── литералы ──
  literal(): N.Expr {
    const t = this.peek();
    if (t.kind === "NAME") {
      this.next();
      const name = t.value;
      if (this.at("LPAREN")) { this.next(); const arg = this.value(); this.eat("RPAREN"); return N.ScalarSel(name, arg); }
      if (this.at("LBRACE")) return N.TupleSel(name, this.tupleValue());
      if (this.at("LBRACK")) return N.RelSel(name, this.relValue());
      throw new ParseError(`имя ${JSON.stringify(name)} не литерал на ${t.pos}`);
    }
    if (t.kind === "HASH") {
      this.next();
      const target = this.eat("NAME").value;
      this.eat("LPAREN");
      const arg = this.value();
      this.eat("RPAREN");
      return N.RefSel(target, arg);
    }
    return this.value();
  }

  private value(): N.Expr {
    const t = this.peek();
    if (t.kind === "MINUS") { this.next(); const num = this.eat("NUMBER"); return N.Num("-" + num.value); }
    if (t.kind === "NUMBER") { this.next(); return N.Num(t.value); }
    if (t.kind === "TRUE") { this.next(); return N.Bool(true); }
    if (t.kind === "FALSE") { this.next(); return N.Bool(false); }
    if (t.kind === "NULL") { this.next(); return N.Null(); }
    if (t.kind === "STRING") { this.next(); return N.Str(t.value); }
    if (t.kind === "REGEX") { this.next(); return N.Regex(t.value); }
    if (t.kind === "LBRACE") return this.tupleValue();
    if (t.kind === "LBRACK") return this.relValue();
    throw new ParseError(`ожидался литерал, получено ${t.kind} на ${t.pos}`);
  }

  private tupleValue(): N.TupleLit {
    this.eat("LBRACE");
    const fields: Array<[string, N.Expr]> = [];
    if (!this.at("RBRACE")) {
      fields.push(this.pair());
      while (this.at("COMMA")) { this.next(); fields.push(this.pair()); }
    }
    this.eat("RBRACE");
    return N.TupleLit(fields);
  }

  private pair(): [string, N.Expr] {
    const k = this.peek();
    if (k.kind !== "NAME" && k.kind !== "STRING") throw new ParseError(`ожидался ключ (имя или строка), получено ${k.kind} на ${k.pos}`);
    this.next();
    this.eat("COLON");
    return [k.value, this.value()];
  }

  private relValue(): N.RelLit {
    this.eat("LBRACK");
    const elems: N.Expr[] = [];
    if (!this.at("RBRACK")) {
      elems.push(this.value());
      while (this.at("COMMA")) { this.next(); elems.push(this.value()); }
    }
    this.eat("RBRACK");
    return N.RelLit(elems);
  }

  // ── запрос ──
  query(): N.Query {
    this.eat("QUESTION");
    const source = this.querySource();
    const steps: N.QueryStep[] = [];
    while (this.at("LBRACK") || this.at("DOT")) steps.push(this.queryStep());
    return N.Query(source, steps);
  }

  private querySource(): string | N.Query {
    if (this.at("LPAREN")) { this.next(); const q = this.query(); this.eat("RPAREN"); return q; }
    return this.eat("NAME").value;
  }

  private queryStep(): N.QueryStep {
    if (this.at("LBRACK")) { this.next(); const pred = this.expression(); this.eat("RBRACK"); return N.Select(pred); }
    this.eat("DOT");
    if (this.at("LPAREN")) {
      this.next();
      const fields: string[] = [this.eat("NAME").value];
      while (this.at("COMMA")) { this.next(); fields.push(this.eat("NAME").value); }
      this.eat("RPAREN");
      return N.Project(fields);
    }
    return N.Unnest(this.eat("NAME").value);
  }
}

export function parseDeclaration(src: string): N.Decl { const p = new Parser(src); const d = p.declaration(); p.expectEof(); return d; }
export function parseType(src: string): N.TypeExpr { const p = new Parser(src); const t = p.type(); p.expectEof(); return t; }
export function parseLiteral(src: string): N.Expr { const p = new Parser(src); const l = p.literal(); p.expectEof(); return l; }
export function parseExpression(src: string): N.Expr { const p = new Parser(src); const e = p.expression(); p.expectEof(); return e; }
export function parseQuery(src: string): N.Query { const p = new Parser(src); const q = p.query(); p.expectEof(); return q; }
