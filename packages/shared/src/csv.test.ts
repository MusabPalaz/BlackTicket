import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from './csv';

describe('parseCsv', () => {
  it('reads a plain file and lower-cases the header', () => {
    const result = parseCsv('Username,FullName,Role\njdoe,Jane Doe,ANALYST');
    expect(result.header).toEqual(['username', 'fullname', 'role']);
    expect(result.rows).toEqual([['jdoe', 'Jane Doe', 'ANALYST']]);
  });

  it('handles quoted fields with commas and quotes inside', () => {
    const result = parseCsv('username,fullname\njdoe,"Doe, Jane ""JD"""');
    expect(result.rows[0]).toEqual(['jdoe', 'Doe, Jane "JD"']);
  });

  it('handles embedded newlines inside quotes', () => {
    const result = parseCsv('a,b\n1,"line one\nline two"');
    expect(result.rows[0]?.[1]).toBe('line one\nline two');
  });

  it('accepts CRLF line endings and a BOM', () => {
    const result = parseCsv('﻿username,role\r\njdoe,ANALYST\r\n');
    expect(result.header).toEqual(['username', 'role']);
    expect(result.rows).toEqual([['jdoe', 'ANALYST']]);
  });

  it('drops blank lines rather than importing empty accounts', () => {
    const result = parseCsv('username,role\n\njdoe,ANALYST\n   \n');
    expect(result.rows).toHaveLength(1);
  });

  it('keeps short rows short instead of inventing values', () => {
    // The caller decides what a missing column means; the parser does not guess.
    const result = parseCsv('username,fullname,role\njdoe,Jane Doe');
    expect(result.rows[0]).toEqual(['jdoe', 'Jane Doe']);
  });

  it('returns an empty result for empty input', () => {
    expect(parseCsv('')).toEqual({ header: [], rows: [] });
  });
});

describe('toCsv', () => {
  it('quotes only what needs quoting', () => {
    const output = toCsv(['a', 'b'], [['plain', 'has,comma'], ['has"quote', null]]);
    expect(output).toBe('a,b\r\nplain,"has,comma"\r\n"has""quote",');
  });

  it('round-trips through the parser', () => {
    const rows = [['jdoe', 'Doe, Jane "JD"', 'ANALYST']];
    const parsed = parseCsv(toCsv(['username', 'fullname', 'role'], rows));
    expect(parsed.rows).toEqual(rows);
  });
});
