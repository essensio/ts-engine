// Лексер: исходный текст нотации → массив токенов.
//
// ЧТО ДЕЛАЕТ  tokenize(src) разбивает строку на токены сводной грамматики.
// ВХОД  src: string.  ВЫХОД  Token[]; последний токен всегда EOF.
//
// ИНВАРИАНТЫ
//   * Пробелы (' \t\r\n') незначимы и не порождают токенов.
//   * pos указывает на начало лексемы; позиции не убывают.
//   * Любой непробельный символ попадает ровно в один токен либо → LexError.
//
// КРАЕВЫЕ СЛУЧАИ
//   * Пустой вход → [EOF].
//   * Незакрытая строка/регэксп → LexError.
//   * 'r' порождает REGEX только при прилегании к '"' (r"…"); иначе это имя.
//   * '.' между цифрами — часть числа (3.2); иначе DOT (a.x).
//   * 'e'/'E' после числа с цифрами экспоненты — часть числа (1e3, 1.5e-2); иначе имя.
//   * '_' — отдельный токен UNDERSCORE (имена начинаются с буквы).
//   * Двусимвольные '!=', '<=', '>=' распознаются раньше односимвольных.

export type Token = { kind: string; value: string; pos: number };

export class LexError extends Error {}

const KEYWORDS: Record<string, string> = { true: "TRUE", false: "FALSE", null: "NULL", and: "AND", or: "OR", not: "NOT" };
const TWO: Record<string, string> = { "!=": "NE", "<=": "LE", ">=": "GE" };
const ONE: Record<string, string> = {
  "=": "EQ", "<": "LT", ">": "GT", "~": "TILDE",
  "+": "PLUS", "-": "MINUS", "*": "STAR", "/": "SLASH",
  "|": "BAR", "#": "HASH", "?": "QUESTION", ".": "DOT", ":": "COLON", ",": "COMMA",
  "(": "LPAREN", ")": "RPAREN", "{": "LBRACE", "}": "RBRACE",
  "[": "LBRACK", "]": "RBRACK",
};

const LETTER = /\p{L}/u;
const DIGIT = /[0-9]/;
const NAMECHAR = /[\p{L}\p{N}_]/u;

function scanString(src: string, start: number): [string, number] {
  let j = start + 1;
  const n = src.length;
  const buf: string[] = [];
  while (j < n && src[j] !== '"') {
    if (src[j] === "\\" && j + 1 < n) { buf.push(src[j + 1]); j += 2; continue; }
    buf.push(src[j]); j += 1;
  }
  if (j >= n) throw new LexError(`незакрытая строка на позиции ${start}`);
  return [buf.join(""), j + 1];
}

export function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") { i += 1; continue; }
    if (c === '"') {
      const [value, end] = scanString(src, i);
      toks.push({ kind: "STRING", value, pos: i });
      i = end;
      continue;
    }
    if (c === "r" && i + 1 < n && src[i + 1] === '"') {
      const [value, end] = scanString(src, i + 1);
      toks.push({ kind: "REGEX", value, pos: i });
      i = end;
      continue;
    }
    if (LETTER.test(c)) {
      let j = i + 1;
      while (j < n && NAMECHAR.test(src[j])) j += 1;
      const word = src.slice(i, j);
      toks.push({ kind: word in KEYWORDS ? KEYWORDS[word] : "NAME", value: word, pos: i });
      i = j;
      continue;
    }
    if (DIGIT.test(c)) {
      let j = i + 1;
      while (j < n && DIGIT.test(src[j])) j += 1;
      if (j + 1 < n && src[j] === "." && DIGIT.test(src[j + 1])) {
        j += 1;
        while (j < n && DIGIT.test(src[j])) j += 1;
      }
      if (j < n && (src[j] === "e" || src[j] === "E")) {
        let k = j + 1;
        if (k < n && (src[k] === "+" || src[k] === "-")) k += 1;
        if (k < n && DIGIT.test(src[k])) {
          k += 1;
          while (k < n && DIGIT.test(src[k])) k += 1;
          j = k;
        }
      }
      toks.push({ kind: "NUMBER", value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if (c === "_") { toks.push({ kind: "UNDERSCORE", value: "_", pos: i }); i += 1; continue; }
    const two = src.slice(i, i + 2);
    if (two in TWO) { toks.push({ kind: TWO[two], value: two, pos: i }); i += 2; continue; }
    if (c in ONE) { toks.push({ kind: ONE[c], value: c, pos: i }); i += 1; continue; }
    throw new LexError(`неожиданный символ ${JSON.stringify(c)} на позиции ${i}`);
  }
  toks.push({ kind: "EOF", value: "", pos: n });
  return toks;
}

// Строка — валидное `имя` грамматики (буква, далее буквы/цифры/`_`) и не ключевое
// слово? Опирается на сам лексер — единый источник правила имени для потребителей,
// которым нужно проверить вводимое имя (типа, поля), не дублируя регулярку.
export function isName(s: string): boolean {
  let toks: Token[];
  try {
    toks = tokenize(s);
  } catch {
    return false;
  }
  return toks.length === 2 && toks[0].kind === "NAME" && toks[0].value === s;
}
