import { describe, expect, it } from 'vitest';
import { PDFDocument, rgb } from 'pdf-lib';
import {
  createZip,
  splitPdfBySize
} from './pdfSplitter';
import { getPartFilename, megabytesToBytes } from './pdfUtils';

async function makePdfFile(pageCount: number, name = 'sample.pdf') {
  const pdf = await PDFDocument.create();

  for (let index = 0; index < pageCount; index += 1) {
    const page = pdf.addPage([300, 300]);
    page.drawText(`Page ${index + 1}`, {
      x: 40,
      y: 250,
      size: 18,
      color: rgb(0.1, 0.1, 0.1)
    });
  }

  const bytes = await pdf.save({ useObjectStreams: true });
  const arrayBuffer = bytesToArrayBuffer(bytes);
  const file = new File([arrayBuffer], name, { type: 'application/pdf' });

  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => arrayBuffer
  });

  return file;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = bytes.buffer as ArrayBuffer;
  return buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe('pdfSplitter', () => {
  it('converts decimal megabytes to bytes', () => {
    expect(megabytesToBytes(30)).toBe(30_000_000);
    expect(megabytesToBytes(1.5)).toBe(1_500_000);
  });

  it('creates predictable part filenames', () => {
    expect(getPartFilename('Quarterly Report.pdf', 3)).toBe('Quarterly Report_part-003.pdf');
    expect(getPartFilename('bad/name.pdf', 12)).toBe('bad-name_part-012.pdf');
  });

  it('keeps a small PDF as one part', async () => {
    const file = await makePdfFile(3);
    const result = await splitPdfBySize(file, megabytesToBytes(30));

    expect(result.pageCount).toBe(3);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].pageStart).toBe(1);
    expect(result.parts[0].pageEnd).toBe(3);
    expect(result.parts[0].overLimit).toBe(false);
  });

  it('splits a PDF into whole-page chunks under a small limit when possible', async () => {
    const file = await makePdfFile(4);
    const singlePage = await splitPdfBySize(file, 900);
    const firstPartSize = singlePage.parts[0].sizeBytes;
    const result = await splitPdfBySize(file, firstPartSize + 20, undefined, 0);

    expect(result.parts.length).toBeGreaterThan(1);
    expect(result.parts.every((part) => part.pageStart <= part.pageEnd)).toBe(true);
    expect(result.parts.every((part) => part.sizeBytes <= firstPartSize + 20)).toBe(true);
  });

  it('overlaps adjacent chunks by the requested number of pages', async () => {
    const file = await makePdfFile(12);
    let limit = 1_000;
    let result = await splitPdfBySize(file, limit, undefined, 2);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const firstChunkPageCount = result.parts[0].pageEnd - result.parts[0].pageStart + 1;

      if (result.parts.length >= 2 && firstChunkPageCount > 2) {
        break;
      }

      limit += 500;
      result = await splitPdfBySize(file, limit, undefined, 2);
    }

    expect(result.parts[1].pageStart).toBe(result.parts[0].pageEnd - 1);
    expect(result.parts.every((part) => part.sizeBytes <= limit)).toBe(true);
  });

  it('still advances when the configured overlap is larger than the chunk', async () => {
    const file = await makePdfFile(4);
    const result = await splitPdfBySize(file, 900, undefined, 5);

    expect(result.parts.length).toBeGreaterThan(1);
    expect(result.parts[1].pageStart).toBeGreaterThan(result.parts[0].pageStart);
  });

  it('flags a single page that is larger than the limit', async () => {
    const file = await makePdfFile(1);
    const result = await splitPdfBySize(file, 10);

    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].overLimit).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  it('accepts a PDF extension even when the browser MIME type is generic', async () => {
    const file = await makePdfFile(1, 'generic-type.pdf');
    Object.defineProperty(file, 'type', {
      value: 'application/octet-stream'
    });

    const result = await splitPdfBySize(file, megabytesToBytes(30));

    expect(result.parts).toHaveLength(1);
  });

  it('packages parts into a ZIP blob', async () => {
    const file = await makePdfFile(2);
    const result = await splitPdfBySize(file, megabytesToBytes(30));
    const archive = await createZip(result.parts, result.originalName);

    expect(archive.filename).toBe('sample_split-parts.zip');
    expect(archive.blob.size).toBeGreaterThan(0);
  });
});
