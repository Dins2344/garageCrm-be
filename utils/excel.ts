import ExcelJS from 'exceljs';

export interface ExcelColumn {
  header: string;
  key: string;
  width?: number;
  numFmt?: string;
}

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Two decimals with grouping; the currency code goes in the column header, not the cell. */
export const MONEY_FORMAT = '#,##0.00';

/**
 * Excel's built-in short date (format id 14). Excel renders it in the
 * viewer's own regional format, so the file never hardcodes dd/mm vs mm/dd.
 */
export const DATE_FORMAT = 'mm-dd-yy';

/**
 * The calendar day `date` falls on in `timezone`, as midnight UTC.
 *
 * Excel dates carry no timezone, and ExcelJS writes a Date as its UTC value,
 * so a customer created at 00:30 in Kochi would otherwise show the day before.
 */
export const excelDay = (date: Date, timezone: string): Date =>
  new Date(date.toLocaleDateString('en-CA', { timeZone: timezone }));

/**
 * One worksheet, bold frozen header row, one row per object keyed by column.
 * Values are written as typed cells — a string is never evaluated as a
 * formula, so a customer named "=HYPERLINK(...)" stays plain text.
 */
// ponytail: builds the whole workbook in memory; switch to ExcelJS's streaming writer if a garage reaches ~100k rows
export const toXlsxBuffer = async (
  sheetName: string,
  columns: ExcelColumn[],
  rows: Record<string, unknown>[]
): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map(({ header, key, width = 18, numFmt }) => ({
    header,
    key,
    width,
    style: numFmt ? { numFmt } : {}
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRows(rows);
  return Buffer.from(await workbook.xlsx.writeBuffer());
};
