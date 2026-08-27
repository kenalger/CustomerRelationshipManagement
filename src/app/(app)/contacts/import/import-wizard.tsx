"use client";

import { AlertCircle, FileUp, TableProperties, Upload } from "lucide-react";
import Link from "next/link";
import Papa from "papaparse";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Callout } from "@/components/ui/callout";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Td, TableShell, Th, Tr } from "@/components/ui/table";
import {
  HEADER_ALIASES,
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  type ImportField,
} from "@/lib/validation/import";
import { importContactsAction } from "@/server/actions/import";
import { fetchSheetAction } from "@/server/actions/sheets";
import type { ImportSummary } from "@/server/services/import";

type Parsed = { headers: string[]; rows: Record<string, string>[] };

/** Guesses a mapping so a clean export needs no manual work. */
function autoMap(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const taken = new Set<string>();

  for (const header of headers) {
    const normalized = header.trim().toLowerCase();
    const match = (Object.keys(HEADER_ALIASES) as ImportField[]).find(
      (field) => !taken.has(field) && HEADER_ALIASES[field].includes(normalized),
    );
    if (match) {
      mapping[header] = match;
      taken.add(match);
    }
  }
  return mapping;
}

export function ImportWizard() {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [onDuplicate, setOnDuplicate] = useState<"skip" | "update">("skip");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [importing, startImport] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [loadingSheet, startSheet] = useTransition();

  /** Papa takes a File or a string; the completion handling is identical. */
  function ingest(input: File | string) {
    Papa.parse<Record<string, string>>(input as never, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (result) => {
        const headers = (result.meta.fields ?? []).filter(Boolean);
        if (headers.length === 0) {
          toast.error("That file has no header row");
          return;
        }
        setParsed({ headers, rows: result.data });
        setMapping(autoMap(headers));
        setSummary(null);
      },
      error: (error: { message: string }) =>
        toast.error(`Could not read that data: ${error.message}`),
    });
  }

  const onFile = (file: File) => ingest(file);

  function loadSheet() {
    const url = sheetUrl.trim();
    if (url === "") return;
    startSheet(async () => {
      const result = await fetchSheetAction(url);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      ingest(result.csv);
    });
  }

  function runImport() {
    if (!parsed) return;
    startImport(async () => {
      const result = await importContactsAction({ rows: parsed.rows, mapping, onDuplicate });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSummary(result.summary);
      toast.success(`Imported ${result.summary.created} contacts`);
    });
  }

  const mappedFields = new Set(Object.values(mapping).filter(Boolean));
  const hasFirstName = mappedFields.has("firstName");
  const tooLarge = (parsed?.rows.length ?? 0) > MAX_IMPORT_ROWS;
  const preview = parsed?.rows.slice(0, 5) ?? [];

  // ── Step 3: result ──────────────────────────────────────────────────────
  if (summary) {
    return (
      <div className="space-y-4">
        <Callout tone={summary.failed > 0 ? "warning" : "success"}>
          Imported <strong>{summary.created}</strong> new contacts
          {summary.updated > 0 ? `, updated ${summary.updated}` : ""}
          {summary.companiesCreated > 0
            ? `, and created ${summary.companiesCreated} companies`
            : ""}
          .
        </Callout>

        <div className="grid gap-3 sm:grid-cols-4">
          {(
            [
              ["Created", summary.created],
              ["Updated", summary.updated],
              ["Skipped", summary.skipped],
              ["Failed", summary.failed],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border-subtle bg-surface p-3">
              <p className="text-[12px] uppercase tracking-[0.04em] text-muted">{label}</p>
              <p className="mt-1 text-[22px] font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>

        {summary.errors.length > 0 ? (
          <div className="rounded-lg border border-border-subtle bg-surface">
            <header className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
              <AlertCircle size={14} strokeWidth={1.75} aria-hidden className="text-warning" />
              <h2 className="text-[13px] font-semibold">Rows that could not be imported</h2>
            </header>
            <ul className="max-h-64 divide-y divide-border-subtle overflow-y-auto">
              {summary.errors.map((error) => (
                <li key={`${error.row}-${error.message}`} className="flex gap-3 px-4 py-2 text-[12px]">
                  <span className="w-14 shrink-0 text-muted tabular-nums">line {error.row}</span>
                  <span className="text-secondary">{error.message}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex gap-2">
          <Link href="/contacts">
            <Button size="sm">View contacts</Button>
          </Link>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setParsed(null);
              setSummary(null);
            }}
          >
            Import another file
          </Button>
        </div>
      </div>
    );
  }

  // ── Step 1: pick a file ─────────────────────────────────────────────────
  if (!parsed) {
    return (
      <div className="space-y-4">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) onFile(file);
          }}
          className="flex flex-col items-center rounded-lg border border-dashed border-border-strong bg-surface px-6 py-12 text-center"
        >
          <span className="mb-3 flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <FileUp size={17} strokeWidth={1.75} aria-hidden />
          </span>
          <p className="text-[13px] font-medium">Drop a CSV here</p>
          <p className="mt-1 text-[12px] text-muted">
            Up to {MAX_IMPORT_ROWS.toLocaleString()} rows. The first row must be your column
            headers.
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
            }}
          />
          <Button size="sm" className="mt-4" onClick={() => inputRef.current?.click()}>
            <Upload size={14} strokeWidth={2} aria-hidden />
            Choose a file
          </Button>
        </div>

        <div className="rounded-lg border border-border-subtle bg-surface p-4">
          <p className="text-[13px] font-[560]">…or paste a Google Sheets link</p>
          <p className="mt-0.5 text-[12px] text-muted">
            The sheet has to be shared — set it to “Anyone with the link can view”. Nothing is
            connected and nothing stays in sync; the rows are read once, now.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Input
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") loadSheet();
              }}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              aria-label="Google Sheets link"
              className="min-w-[18rem] flex-1"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={loadSheet}
              loading={loadingSheet}
              disabled={sheetUrl.trim() === ""}
            >
              <TableProperties size={14} strokeWidth={2} aria-hidden />
              Read the sheet
            </Button>
          </div>
        </div>

        <p className="text-[12px] text-muted">
          Nothing is imported until you confirm the mapping — a file is parsed in your browser, and
          a sheet is read by the server and shown to you before anything is written.
        </p>
      </div>
    );
  }

  // ── Step 2: map columns ─────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <Callout tone="info">
        Found <strong>{parsed.rows.length.toLocaleString()}</strong> rows and{" "}
        {parsed.headers.length} columns. Check the mapping below — we guessed from your headers.
      </Callout>

      <div className="rounded-lg border border-border-subtle bg-surface">
        <header className="border-b border-border-subtle px-4 py-2.5">
          <h2 className="text-[13px] font-semibold">Column mapping</h2>
        </header>
        <ul className="divide-y divide-border-subtle">
          {parsed.headers.map((header) => (
            <li key={header} className="flex items-center gap-3 px-4 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{header}</span>
              <span aria-hidden className="text-muted">
                →
              </span>
              <label className="sr-only" htmlFor={`map-${header}`}>
                Map column {header}
              </label>
              <Select
                id={`map-${header}`}
                value={mapping[header] ?? ""}
                onChange={(e) =>
                  setMapping((prev) => ({ ...prev, [header]: e.target.value }))
                }
                className="h-7 w-44 text-[12px]"
              >
                <option value="">Ignore this column</option>
                {IMPORT_FIELDS.map((field) => (
                  <option
                    key={field.key}
                    value={field.key}
                    // One CSV column per field; a second would silently win.
                    disabled={mappedFields.has(field.key) && mapping[header] !== field.key}
                  >
                    {field.label}
                    {field.required ? " (required)" : ""}
                  </option>
                ))}
              </Select>
            </li>
          ))}
        </ul>
      </div>

      {tooLarge ? (
        <Callout tone="danger">
          This file has {parsed.rows.length.toLocaleString()} rows, over the{" "}
          {MAX_IMPORT_ROWS.toLocaleString()} limit. Split it and import each part — nothing is
          imported until it fits, so no rows are silently dropped.
        </Callout>
      ) : null}

      {!hasFirstName ? (
        <Callout tone="danger">Map a column to <strong>First name</strong> to continue.</Callout>
      ) : null}

      {preview.length > 0 ? (
        <TableShell caption="First five rows as they will be imported">
          <thead>
            <tr>
              {IMPORT_FIELDS.filter((f) => mappedFields.has(f.key)).map((field) => (
                <Th key={field.key}>{field.label}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, i) => (
              <Tr key={i}>
                {IMPORT_FIELDS.filter((f) => mappedFields.has(f.key)).map((field) => {
                  const header = Object.keys(mapping).find((h) => mapping[h] === field.key);
                  const value = header ? row[header] : "";
                  return (
                    <Td key={field.key} className="text-secondary">
                      {value?.trim() || <span className="text-muted">—</span>}
                    </Td>
                  );
                })}
              </Tr>
            ))}
          </tbody>
        </TableShell>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border-subtle bg-surface p-4">
        <div className="space-y-1.5">
          <label htmlFor="onDuplicate" className="block text-[12px] font-medium">
            If an email already exists
          </label>
          <Select
            id="onDuplicate"
            value={onDuplicate}
            onChange={(e) => setOnDuplicate(e.target.value as "skip" | "update")}
            className="w-56"
          >
            <option value="skip">Skip the row (safest)</option>
            <option value="update">Update the existing contact</option>
          </Select>
          <p className="text-[12px] text-muted">
            Matching is by email only. Rows without an email are always created.
          </p>
        </div>

        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setParsed(null)}>
            Start over
          </Button>
          <Button
            size="sm"
            onClick={runImport}
            loading={importing}
            disabled={!hasFirstName || tooLarge}
          >
            {importing ? "Importing" : `Import ${parsed.rows.length.toLocaleString()} rows`}
          </Button>
        </div>
      </div>
    </div>
  );
}
