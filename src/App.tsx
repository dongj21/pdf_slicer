import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  RotateCcw,
  Upload
} from 'lucide-react';
import { formatBytes, megabytesToBytes } from './pdfUtils';
import type {
  PdfPart,
  SplitProgress,
  SplitResult,
  ZipResult
} from './pdfSplitter';

type ProcessingState = 'idle' | 'processing' | 'ready' | 'error';

const DEFAULT_LIMIT_MB = 30;
const MIN_LIMIT_MB = 1;
const MAX_LIMIT_MB = 200;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function partRangeLabel(part: PdfPart) {
  return part.pageStart === part.pageEnd
    ? `Page ${part.pageStart}`
    : `Pages ${part.pageStart}-${part.pageEnd}`;
}

export function App() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [limitMb, setLimitMb] = useState(DEFAULT_LIMIT_MB);
  const [status, setStatus] = useState<ProcessingState>('idle');
  const [progress, setProgress] = useState<SplitProgress | null>(null);
  const [result, setResult] = useState<SplitResult | null>(null);
  const [zipResult, setZipResult] = useState<ZipResult | null>(null);
  const [error, setError] = useState('');

  const maxBytes = useMemo(() => megabytesToBytes(limitMb), [limitMb]);
  const progressPercent = progress
    ? Math.min(100, Math.round((progress.completed / Math.max(progress.total, 1)) * 100))
    : 0;

  async function processFile(file: File) {
    if (limitMb < MIN_LIMIT_MB || limitMb > MAX_LIMIT_MB) {
      setStatus('error');
      setError(`Enter a limit from ${MIN_LIMIT_MB} to ${MAX_LIMIT_MB} MB.`);
      return;
    }

    setStatus('processing');
    setError('');
    setResult(null);
    setZipResult(null);
    setProgress({
      phase: 'loading',
      completed: 0,
      total: 1,
      message: 'Starting'
    });

    try {
      const { createZip, splitPdfBySize } = await import('./pdfSplitter');
      const splitResult = await splitPdfBySize(file, maxBytes, setProgress);
      const archive = await createZip(splitResult.parts, splitResult.originalName, setProgress);

      setResult(splitResult);
      setZipResult(archive);
      setProgress({
        phase: 'done',
        completed: 1,
        total: 1,
        message: 'Ready'
      });
      setStatus('ready');
    } catch (caughtError) {
      setStatus('error');
      setError(caughtError instanceof Error ? caughtError.message : 'The PDF could not be split.');
      setProgress(null);
    }
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) {
      void processFile(file);
    }
  }

  function reset() {
    setStatus('idle');
    setProgress(null);
    setResult(null);
    setZipResult(null);
    setError('');

    if (inputRef.current) {
      inputRef.current.value = '';
    }
  }

  return (
    <main className="app-shell">
      <section className="workspace" aria-label="PDF splitting workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Local PDF utility</p>
            <h1>PDF Size Splitter</h1>
          </div>

          <div className="limit-control">
            <label htmlFor="limitMb">Max part size</label>
            <div className="number-field">
              <input
                id="limitMb"
                type="number"
                min={MIN_LIMIT_MB}
                max={MAX_LIMIT_MB}
                step="1"
                value={limitMb}
                onChange={(event) => setLimitMb(Number(event.target.value))}
                disabled={status === 'processing'}
              />
              <span>MB</span>
            </div>
          </div>
        </header>

        <div className="splitter-grid">
          <section className="drop-panel" aria-label="Upload PDF">
            <button
              className={`drop-zone ${isDragging ? 'is-dragging' : ''}`}
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                handleFiles(event.dataTransfer.files);
              }}
              disabled={status === 'processing'}
            >
              <span className="upload-icon" aria-hidden="true">
                <Upload size={34} />
              </span>
              <span className="drop-title">Drop a PDF here</span>
              <span className="drop-subtitle">or select one from your computer</span>
            </button>

            <input
              ref={inputRef}
              className="visually-hidden"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => handleFiles(event.target.files)}
            />

            <div className="privacy-note">
              <FileText size={18} aria-hidden="true" />
              <span>Files are processed in this browser session.</span>
            </div>
          </section>

          <section className="status-panel" aria-live="polite" aria-label="Split status">
            {status === 'idle' && (
              <div className="empty-state">
                <Archive size={28} aria-hidden="true" />
                <h2>Ready for a large PDF</h2>
                <p>Parts are created at whole-page boundaries, share 5 pages of context, and download as one ZIP file.</p>
              </div>
            )}

            {status === 'processing' && progress && (
              <div className="progress-state">
                <Loader2 className="spin" size={28} aria-hidden="true" />
                <h2>{progress.message}</h2>
                <div className="progress-track" aria-label={`${progressPercent}% complete`}>
                  <span style={{ width: `${progressPercent}%` }} />
                </div>
                <p>{progress.phase === 'zipping' ? `${progressPercent}% complete` : `${progress.completed} / ${progress.total}`}</p>
              </div>
            )}

            {status === 'error' && (
              <div className="error-state">
                <AlertTriangle size={28} aria-hidden="true" />
                <h2>Could not split this PDF</h2>
                <p>{error}</p>
                <button className="secondary-action" type="button" onClick={reset}>
                  <RotateCcw size={18} aria-hidden="true" />
                  Reset
                </button>
              </div>
            )}

            {status === 'ready' && result && zipResult && (
              <div className="result-state">
                <div className="result-heading">
                  <CheckCircle2 size={28} aria-hidden="true" />
                  <div>
                    <h2>{result.parts.length} PDF {result.parts.length === 1 ? 'part' : 'parts'} ready</h2>
                    <p>
                      {result.pageCount} pages from {formatBytes(result.originalSizeBytes)} packaged as{' '}
                      {formatBytes(zipResult.sizeBytes)}. Adjacent parts overlap by up to {result.overlapPages} pages.
                    </p>
                  </div>
                </div>

                <button className="primary-action" type="button" onClick={() => downloadBlob(zipResult.blob, zipResult.filename)}>
                  <Download size={18} aria-hidden="true" />
                  Download ZIP
                </button>

                {result.warnings.length > 0 && (
                  <div className="warning-list" role="alert">
                    <AlertTriangle size={18} aria-hidden="true" />
                    <div>
                      <strong>Some parts exceed the limit</strong>
                      {result.warnings.map((warning) => (
                        <p key={warning}>{warning}</p>
                      ))}
                    </div>
                  </div>
                )}

                <div className="parts-table" aria-label="Generated PDF parts">
                  <div className="parts-header">
                    <span>File</span>
                    <span>Pages</span>
                    <span>Size</span>
                  </div>
                  {result.parts.map((part) => (
                    <div className={part.overLimit ? 'part-row over-limit' : 'part-row'} key={part.filename}>
                      <span title={part.filename}>{part.filename}</span>
                      <span>{partRangeLabel(part)}</span>
                      <span>{formatBytes(part.sizeBytes)}</span>
                    </div>
                  ))}
                </div>

                <button className="secondary-action" type="button" onClick={reset}>
                  <RotateCcw size={18} aria-hidden="true" />
                  Split another PDF
                </button>
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
