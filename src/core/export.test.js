import { describe, it, expect, vi } from 'vitest';
import { buildCsv, buildCsvForTables, downloadCsv } from './export.js';

describe('buildCsv', () => {
  const table = {
    columns: [
      { key: 'name', label: 'Cupper' },
      { key: 'correct', label: 'Correct' },
    ],
    rows: [
      { name: 'Alex', correct: 5 },
      { name: 'Jordan', correct: 3 },
    ],
  };

  it('builds a header row from column labels, then one row per data row', () => {
    expect(buildCsv(table)).toBe('Cupper,Correct\r\nAlex,5\r\nJordan,3');
  });

  it('quotes a value containing a comma', () => {
    const withComma = { columns: table.columns, rows: [{ name: 'Rivera, Alex', correct: 1 }] };
    expect(buildCsv(withComma)).toBe('Cupper,Correct\r\n"Rivera, Alex",1');
  });

  it('quotes and doubles internal quotes in a value containing a quote', () => {
    const withQuote = {
      columns: table.columns,
      rows: [{ name: 'Alex "The Nose" Rivera', correct: 1 }],
    };
    expect(buildCsv(withQuote)).toBe('Cupper,Correct\r\n"Alex ""The Nose"" Rivera",1');
  });

  it('quotes a value containing a newline', () => {
    const withNewline = { columns: table.columns, rows: [{ name: 'Alex\nRivera', correct: 1 }] };
    expect(buildCsv(withNewline)).toBe('Cupper,Correct\r\n"Alex\nRivera",1');
  });

  it('writes null and undefined values as an empty field, not the string "null"/"undefined"', () => {
    const withNulls = { columns: table.columns, rows: [{ name: null, correct: undefined }] };
    expect(buildCsv(withNulls)).toBe('Cupper,Correct\r\n,');
  });

  it('produces just the header row for an empty table — never crashes on zero rows', () => {
    expect(buildCsv({ columns: table.columns, rows: [] })).toBe('Cupper,Correct');
  });
});

describe('buildCsvForTables', () => {
  it('combines multiple tables into one CSV, each preceded by its own title and separated by a blank line', () => {
    const tables = [
      {
        title: 'Standings',
        columns: [{ key: 'name', label: 'Cupper' }],
        rows: [{ name: 'Alex' }],
      },
      {
        title: 'Difficulty',
        columns: [{ key: 'set', label: 'Set' }],
        rows: [{ set: 'Set 1' }],
      },
    ];
    expect(buildCsvForTables(tables)).toBe(
      'Standings\r\nCupper\r\nAlex\r\n\r\nDifficulty\r\nSet\r\nSet 1',
    );
  });

  it('quotes a table title containing a comma, the same as any other value', () => {
    const tables = [{ title: 'Prelims, Round 1', columns: [{ key: 'a', label: 'A' }], rows: [] }];
    expect(buildCsvForTables(tables)).toBe('"Prelims, Round 1"\r\nA');
  });
});

describe('downloadCsv', () => {
  it('builds a Blob with the real CSV content and a csv MIME type, attaches a download link with the real filename, clicks it, then revokes the URL', async () => {
    // Captures the ACTUAL Blob passed to createObjectURL and the anchor's
    // real href/download at click time — not just that the mocked functions
    // were called some number of times. A version of downloadCsv that
    // swapped arguments, used the wrong filename, or clicked before setting
    // href/download would still call every one of these functions the same
    // number of times; only inspecting the real values it passed them
    // catches that.
    let capturedBlob = null;
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      capturedBlob = blob;
      return 'blob:fake-url';
    });
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    let capturedHref = null;
    let capturedDownload = null;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function click() {
        capturedHref = this.href;
        capturedDownload = this.download;
      });

    downloadCsv('report.csv', 'a,b\r\n1,2');

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(capturedBlob.type).toBe('text/csv;charset=utf-8;');
    // jsdom's Blob has no .text()/.arrayBuffer() (confirmed: its prototype
    // only exposes slice/size/type) and Response(blob) doesn't recognize it
    // as a real Blob either — FileReader is the one thing that actually
    // reads jsdom Blob content in this test environment.
    const blobText = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(capturedBlob);
    });
    expect(blobText).toBe('a,b\r\n1,2');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(capturedHref).toBe('blob:fake-url');
    expect(capturedDownload).toBe('report.csv');
    expect(revokeSpy).toHaveBeenCalledWith('blob:fake-url');
    // The link is removed from the DOM again after the click — nothing left
    // behind for a caller to accidentally interact with.
    expect(document.querySelector('a[download="report.csv"]')).toBeNull();

    createSpy.mockRestore();
    revokeSpy.mockRestore();
    clickSpy.mockRestore();
  });
});
