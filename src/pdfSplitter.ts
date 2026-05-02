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
  overlapPages: number;
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

export const DEFAULT_OVERLAP_PAGES = 5;

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
  onProgress?: ProgressCallback,
  overlapPages = DEFAULT_OVERLAP_PAGES
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
  const requestedOverlapPages = Math.max(0, Math.floor(overlapPages));
  let chunkStartIndex = 0;
  let furthestPageReached = 0;

  onProgress?.({
    phase: 'splitting',
    completed: 0,
    total: pageCount,
    message: 'Splitting pages'
  });

  while (chunkStartIndex < pageCount) {
    let currentPageIndexes: number[] = [];
    let currentBytes: Uint8Array | null = null;

    for (let pageIndex = chunkStartIndex; pageIndex < pageCount; pageIndex += 1) {
      const candidateIndexes = [...currentPageIndexes, pageIndex];
      const candidateBytes = await createPdfForPages(sourcePdf, candidateIndexes);

      if (candidateBytes.byteLength <= maxBytes || currentPageIndexes.length === 0) {
        currentPageIndexes = candidateIndexes;
        currentBytes = candidateBytes;
      } else {
        break;
      }

      furthestPageReached = Math.max(furthestPageReached, pageIndex + 1);
      onProgress?.({
        phase: 'splitting',
        completed: furthestPageReached,
        total: pageCount,
        message: `Processed ${furthestPageReached} of ${pageCount} pages`
      });
    }

    if (currentPageIndexes.length === 0 || !currentBytes) {
      break;
    }

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

    const chunkEndIndex = currentPageIndexes[currentPageIndexes.length - 1];

    if (chunkEndIndex >= pageCount - 1) {
      break;
    }

    const actualOverlapPages = Math.min(requestedOverlapPages, currentPageIndexes.length - 1);
    chunkStartIndex = actualOverlapPages > 0
      ? chunkEndIndex - actualOverlapPages + 1
      : chunkEndIndex + 1;
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
    overlapPages: requestedOverlapPages,
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
