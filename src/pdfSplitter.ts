import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { formatBytes, getBasePdfName, getPartFilename } from './pdfUtils';

export type SplitPhase = 'loading' | 'splitting' | 'zipping' | 'done';

export type SplitProgress = {
  phase: SplitPhase;
  completed: number;
  total: number;
  message: string;
};

export type PdfPart = {
  index: number;
  filename: string;
  pageStart: number;
  pageEnd: number;
  sizeBytes: number;
  blob: Blob;
  overLimit: boolean;
};

export type SplitResult = {
  originalName: string;
  originalSizeBytes: number;
  pageCount: number;
  parts: PdfPart[];
  warnings: string[];
};

export type ZipResult = {
  blob: Blob;
  filename: string;
  sizeBytes: number;
};

export type ProgressCallback = (progress: SplitProgress) => void;

const PDF_MIME_TYPE = 'application/pdf';

async function createPdfForPages(sourcePdf: PDFDocument, pageIndexes: number[]): Promise<Uint8Array> {
  const outputPdf = await PDFDocument.create();
  const copiedPages = await outputPdf.copyPages(sourcePdf, pageIndexes);
  copiedPages.forEach((page) => outputPdf.addPage(page));

  return outputPdf.save({ useObjectStreams: true });
}

function createPdfPart(
  originalName: string,
  index: number,
  pageStart: number,
  pageEnd: number,
  bytes: Uint8Array,
  maxBytes: number
): PdfPart {
  return {
    index,
    filename: getPartFilename(originalName, index),
    pageStart,
    pageEnd,
    sizeBytes: bytes.byteLength,
    blob: new Blob([toArrayBuffer(bytes)], { type: PDF_MIME_TYPE }),
    overLimit: bytes.byteLength > maxBytes
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = bytes.buffer as ArrayBuffer;
  return buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export async function splitPdfBySize(
  file: File,
  maxBytes: number,
  onProgress?: ProgressCallback
): Promise<SplitResult> {
  const hasPdfExtension = file.name.toLowerCase().endsWith('.pdf');
  const hasPdfMimeType = file.type === PDF_MIME_TYPE || file.type === 'application/x-pdf';

  if (!hasPdfExtension && !hasPdfMimeType) {
    throw new Error('Select a PDF file.');
  }

  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error('Enter a valid maximum size.');
  }

  onProgress?.({
    phase: 'loading',
    completed: 0,
    total: 1,
    message: 'Reading PDF'
  });

  const sourceBytes = await file.arrayBuffer();
  let sourcePdf: PDFDocument;

  try {
    sourcePdf = await PDFDocument.load(sourceBytes, {
      ignoreEncryption: false,
      updateMetadata: false
    });
  } catch {
    throw new Error('This PDF could not be opened. It may be encrypted, damaged, or password protected.');
  }

  const pageCount = sourcePdf.getPageCount();
  const parts: PdfPart[] = [];
  const warnings: string[] = [];
  let currentPageIndexes: number[] = [];
  let currentBytes: Uint8Array | null = null;

  onProgress?.({
    phase: 'splitting',
    completed: 0,
    total: pageCount,
    message: 'Splitting pages'
  });

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const candidateIndexes = [...currentPageIndexes, pageIndex];
    const candidateBytes = await createPdfForPages(sourcePdf, candidateIndexes);

    if (candidateBytes.byteLength <= maxBytes || currentPageIndexes.length === 0) {
      currentPageIndexes = candidateIndexes;
      currentBytes = candidateBytes;
    } else if (currentBytes) {
      const part = createPdfPart(
        file.name,
        parts.length + 1,
        currentPageIndexes[0] + 1,
        currentPageIndexes[currentPageIndexes.length - 1] + 1,
        currentBytes,
        maxBytes
      );
      parts.push(part);

      currentPageIndexes = [pageIndex];
      currentBytes = await createPdfForPages(sourcePdf, currentPageIndexes);
    }

    onProgress?.({
      phase: 'splitting',
      completed: pageIndex + 1,
      total: pageCount,
      message: `Processed ${pageIndex + 1} of ${pageCount} pages`
    });
  }

  if (currentPageIndexes.length > 0 && currentBytes) {
    parts.push(
      createPdfPart(
        file.name,
        parts.length + 1,
        currentPageIndexes[0] + 1,
        currentPageIndexes[currentPageIndexes.length - 1] + 1,
        currentBytes,
        maxBytes
      )
    );
  }

  for (const part of parts) {
    if (part.overLimit) {
      warnings.push(
        `${part.filename} is ${formatBytes(part.sizeBytes)}, which is larger than the selected limit because page ${part.pageStart} cannot be split further.`
      );
    }
  }

  return {
    originalName: file.name,
    originalSizeBytes: file.size,
    pageCount,
    parts,
    warnings
  };
}

export async function createZip(
  parts: PdfPart[],
  baseName: string,
  onProgress?: ProgressCallback
): Promise<ZipResult> {
  const zip = new JSZip();

  parts.forEach((part) => {
    zip.file(part.filename, part.blob);
  });

  onProgress?.({
    phase: 'zipping',
    completed: 0,
    total: 100,
    message: 'Preparing ZIP'
  });

  const blob = await zip.generateAsync(
    {
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: {
        level: 6
      }
    },
    (metadata) => {
      onProgress?.({
        phase: 'zipping',
        completed: Math.round(metadata.percent),
        total: 100,
        message: 'Preparing ZIP'
      });
    }
  );

  const filename = `${getBasePdfName(baseName)}_split-parts.zip`;

  return {
    blob,
    filename,
    sizeBytes: blob.size
  };
}
