
export const MIME_BY_EXTENSION: Record<string, string[]> = {
  pdf: ["application/pdf"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  webp: ["image/webp"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  txt: ["text/plain"],
  csv: ["text/csv", "text/plain", "application/vnd.ms-excel"],
};

const ALWAYS_FORBIDDEN = new Set(["exe", "bat", "cmd", "com", "msi", "sh", "ps1", "js", "mjs", "vbs", "jar", "scr", "dll", "html", "htm", "svg", "php", "py"]);

export function fileExtension(name: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name.trim());
  return m ? m[1]!.toLowerCase() : "";
}

export function sanitizeFileName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "file";
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").replace(/\s+/g, " ").trim();
  return (cleaned || "file").slice(0, 200);
}

/** Сигнатуры содержимого для основных форматов (защита от подмены расширения). */
function sniff(data: Buffer): string | null {
  if (data.subarray(0, 4).toString("latin1") === "%PDF") return "pdf";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpeg";
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return "zip"; // docx/xlsx
  if (data.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return "ole"; // doc/xls
  if (data.subarray(0, 2).toString("latin1") === "MZ") return "exe";
  return null;
}

const SIGNATURE_BY_EXT: Record<string, string[]> = {
  pdf: ["pdf"],
  jpg: ["jpeg"],
  jpeg: ["jpeg"],
  png: ["png"],
  webp: ["webp"],
  docx: ["zip"],
  xlsx: ["zip"],
  doc: ["ole"],
  xls: ["ole"],
};

export function validateUpload(name: string, data: Buffer, allowedExtensions: string[], maxBytes: number): { ext: string; mime: string } | { error: string } {
  const ext = fileExtension(name);
  if (!ext) return { error: "Файл без расширения не принимается" };
  if (ALWAYS_FORBIDDEN.has(ext) || !allowedExtensions.includes(ext) || !MIME_BY_EXTENSION[ext]) return { error: `Тип файла .${ext} запрещён` };
  if (data.length === 0) return { error: "Пустой файл" };
  if (data.length > maxBytes) return { error: `Файл больше допустимого размера (${Math.round(maxBytes / 1024 / 1024)} МБ)` };
  const sig = sniff(data);
  if (sig === "exe") return { error: "Исполняемые файлы запрещены" };
  const expected = SIGNATURE_BY_EXT[ext];
  if (expected && (!sig || !expected.includes(sig))) return { error: "Содержимое файла не соответствует расширению" };
  return { ext, mime: MIME_BY_EXTENSION[ext]![0]! };
}
