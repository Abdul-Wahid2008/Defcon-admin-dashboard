/**
 * One CSV cell: quotes escaped, always quoted, and a leading formula character (= + - @ tab CR) is neutralised with
 * a single quote so spreadsheets do not execute it (OWASP "CSV injection").
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',');
}
