/**
 * A small, strict CSV reader and writer.
 *
 * Used for the bulk account import and the audit-log export. Written by hand
 * rather than pulled from a dependency because the requirement is narrow and
 * the failure mode matters: a parser that quietly mangles row 431 of a 600-row
 * import is worse than one that refuses the file.
 *
 * Handles: quoted fields, embedded commas and newlines, doubled quotes ("")
 * as an escaped quote, CRLF or LF line endings, and a UTF-8 BOM.
 */

export interface CsvParseResult {
  header: string[];
  rows: string[][];
}

export function parseCsv(input: string, delimiter = ','): CsvParseResult {
  const text = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      // Swallow the LF of a CRLF pair.
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      field = '';
      row = [];
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const cleaned = rows.filter((entry) => entry.some((value) => value.trim() !== ''));
  const [header = [], ...body] = cleaned;

  return {
    header: header.map((value) => value.trim().toLowerCase()),
    rows: body,
  };
}

/** Serialises a table, quoting only what needs it. */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const escape = (value: string | number | null | undefined): string => {
    const text = value === null || value === undefined ? '' : String(value);
    return /["\n\r,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return [header.map(escape).join(','), ...rows.map((row) => row.map(escape).join(','))].join('\r\n');
}
