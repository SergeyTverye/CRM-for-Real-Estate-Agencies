import { fail, LIMITS, type Manifest } from "./manifest";
export type Context = Record<string, unknown>;
type Node = { kind: "text"; value: string } | { kind: "value"; path: string } | { kind: "if" | "each"; path: string; children: Node[] };
const PATH = /^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*$/;
export function safeGet(root: unknown, path: string): unknown {
  if (!PATH.test(path) || path.split(".").some(p => ["constructor", "prototype", "__proto__"].includes(p))) fail("Недопустимое имя переменной");
  let value = root;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, part)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, part);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) fail("Вычисляемые свойства запрещены");
    value = descriptor.value;
  }
  return value;
}
export function parseTemplate(text: string): Node[] {
  if (text.length > LIMITS.text) fail("Шаблон слишком большой");
  const root: Node[] = [], stack: { kind: string; children: Node[] }[] = [{ kind: "root", children: root }];
  let last = 0;
  for (const match of text.matchAll(/{{([\s\S]*?)}}/g)) {
    const list = stack.at(-1)!.children;
    list.push({ kind: "text", value: text.slice(last, match.index) });
    const token = match[1]!.trim(); last = match.index! + match[0].length;
    if (token.startsWith("/")) {
      if (stack.length < 2 || stack.at(-1)!.kind !== token.slice(1)) fail("Несогласованные блоки шаблона");
      stack.pop(); continue;
    }
    const block = /^(#if|#each)\s+(.+)$/.exec(token);
    const path = block ? block[2]! : token;
    safeGet({}, path);
    if (block) {
      if (stack.length > LIMITS.depth) fail("Превышена вложенность шаблона");
      const node: Extract<Node, {children: Node[]}> = { kind: block[1] === "#if" ? "if" : "each", path, children: [] };
      list.push(node); stack.push(node);
    } else list.push({ kind: "value", path });
  }
  stack.at(-1)!.children.push({ kind: "text", value: text.slice(last) });
  if (stack.length !== 1 || root.some(n => n.kind === "text" && /{{|}}/.test(n.value))) fail("Незакрытый блок или переменная");
  return root;
}
export function formatValue(value: unknown, type: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") fail("Ожидалось скалярное значение");
  if (type === "date") { const date = new Date(String(value)); if (!Number.isFinite(+date)) fail("Некорректная дата"); return new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Novosibirsk" }).format(date); }
  if (type === "money" || type === "area") {
    if (!/^-?\d+(\.\d+)?$/.test(String(value))) fail("Некорректное числовое значение");
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2, minimumFractionDigits: type === "money" ? 2 : 0 }).format(value as number) + (type === "money" ? " ₽" : " м²");
  }
  return String(value);
}
export function renderText(text: string, context: Context, manifest: Manifest, role = "manager"): string {
  let steps = 0, size = 0;
  const fields = new Map(manifest.fields.map(f => [f.path, f]));
  function read(path: string, row?: Context) {
    const canonical = path.startsWith("this.") ? `properties.${path.slice(5)}` : path;
    const field = fields.get(canonical);
    if (!field || !field.roles.includes(role as "manager" | "realtor")) fail("Переменная не разрешена манифестом или ролью");
    const value = path.startsWith("this.") ? safeGet(row, path.slice(5)) : safeGet(context, path);
    if (field.required && (value === null || value === undefined || value === "")) fail(`Не заполнено обязательное поле «${field.label}»`);
    return { value, field };
  }
  function walk(nodes: Node[], row?: Context): string {
    return nodes.map(n => {
      if (++steps > LIMITS.iterations * 50) fail("Превышен лимит вычислений");
      let out: string;
      if (n.kind === "text") out = n.value;
      else if (n.kind === "value") { const { value, field } = read(n.path, row); out = formatValue(value, field.type); }
      else if (n.kind === "if") { const { value } = read(n.path, row); out = value ? walk(n.children, row) : ""; }
      else {
        if (n.path !== "properties" || !manifest.sources.includes("properties")) fail("Цикл разрешён только по properties");
        const values = safeGet(context, n.path);
        if (!Array.isArray(values) || values.length > LIMITS.iterations) fail("Превышен лимит строк или неверный источник цикла");
        out = values.map(v => walk(n.children, v)).join("");
      }
      size += out.length; if (size > LIMITS.expanded) fail("Результат слишком большой"); return out;
    }).join("");
  }
  for (const field of manifest.fields.filter(f => f.required && f.roles.includes(role as "manager" | "realtor"))) {
    if (field.path.startsWith("properties.")) {
      const rows = context.properties;
      if (!Array.isArray(rows) || !rows.length) fail("Нет обязательных объектов");
      for (const row of rows) read(`this.${field.path.slice(11)}`, row);
    } else read(field.path);
  }
  return walk(parseTemplate(text));
}
export function escapeSpreadsheet(value: string): string { return /^[\s\p{Cf}\u0000-\u001f]*[=+\-@]/u.test(value) ? `'${value}` : value; }
