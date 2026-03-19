import type { TextItem } from "pdfjs-dist/types/src/display/api";

export interface FrpPageInfo {
  /** Text from the top-right area of the page (section/report title). */
  reportTitle: string;
  /** Text from the top-left area — subheading if present, else primary name. */
  portfolioName: string;
}

/** A group of consecutive FRP pages sharing the same report title / portfolio. */
export interface FrpSection {
  id: string;
  reportTitle: string;
  portfolioName: string;
  /** Inclusive start index into the FrpPageInfo[] array. */
  startIdx: number;
  /** Inclusive end index into the FrpPageInfo[] array. */
  endIdx: number;
  enabled: boolean;
}

/**
 * Report titles that represent the whole book rather than a specific
 * sub-portfolio.  Used both for TOC display (portfolio column shows the
 * file name) and for section grouping (portfolioName is ignored so
 * consecutive pages aren't split).
 */
export const AGGREGATE_REPORTS = new Set([
  "Disclosures",
  "Aggregate Portfolio Summary",
  "Aggregate Portfolio Performance",
  "Summary of Net Assets",
  "Glossary",
]);

/**
 * Groups a flat FrpPageInfo[] into consecutive sections.
 *
 * Consecutive pages with the same (reportTitle, portfolioName) key are merged
 * into a single FrpSection so the user can toggle whole sections on or off.
 * For aggregate report titles (Glossary, Disclosures, etc.) the portfolioName
 * is ignored when building the grouping key so they aren't split.
 *
 * `startIdx` lets callers skip leading pages (e.g. pass 1 for a cover PDF so
 * the cover page isn't included in the toggleable sections).  Indices stored
 * in each FrpSection remain relative to the original `pages` array so they
 * map directly to PDF page indices.
 */
export function groupFrpSections(pages: FrpPageInfo[], startIdx = 0): FrpSection[] {
  const sections: FrpSection[] = [];
  let lastKey = "";
  for (let i = startIdx; i < pages.length; i++) {
    const title = pages[i].reportTitle;
    const key = AGGREGATE_REPORTS.has(title)
      ? title
      : `${title}|${pages[i].portfolioName}`;
    if (key !== lastKey) {
      sections.push({
        id: `frp-${i}`,
        reportTitle: pages[i].reportTitle,
        portfolioName: pages[i].portfolioName,
        startIdx: i,
        endIdx: i,
        enabled: true,
      });
      lastKey = key;
    } else {
      sections[sections.length - 1].endIdx = i;
    }
  }
  return sections;
}

/**
 * Extracts per-page header info from an FRP PDF for use in the TOC.
 *
 * Reads every page (1…N) and for each page collects text items from the
 * top 20 % of the page, splitting on the horizontal midpoint:
 *   - right half → report / section title
 *   - left half  → portfolio / entity name (prefers the second visual line,
 *                  i.e. the subheading, when two or more lines are present)
 *
 * The result array maps 1-to-1 with PDF pages: result[0] = page 1, etc.
 *
 * pdfjs-dist is imported dynamically so this module can be included in
 * "use client" components without triggering SSR prerender errors.
 */
export async function extractFrpPageInfo(file: File): Promise<FrpPageInfo[]> {
  // Dynamic import keeps pdfjs-dist out of the SSR bundle entirely.
  const pdfjsLib = await import("pdfjs-dist");

  // Serve the worker from public/ — no webpack/turbopack config needed.
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;

  const results: FrpPageInfo[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const { width: pageWidth, height: pageHeight } = page.getViewport({ scale: 1 });

    // PDF y-coordinates increase upward from 0 at the bottom.
    // "Top 20%" means y > pageHeight * 0.80.
    const topThreshold = pageHeight * 0.8;
    const midX         = pageWidth  / 2;

    const textContent = await page.getTextContent();

    const leftItems:  Array<{ str: string; y: number }> = [];
    const rightItems: Array<{ str: string; y: number }> = [];

    for (const raw of textContent.items) {
      const item = raw as TextItem;
      if (!item.str?.trim()) continue;
      const x = item.transform[4];
      const y = item.transform[5];
      if (y < topThreshold) continue;
      (x < midX ? leftItems : rightItems).push({ str: item.str.trim(), y });
    }

    // Right side: group into visual lines (items within 3 pt share a line)
    // and take only the first (topmost) line as the report title.
    // This prevents subtitle text on aggregate pages from polluting the title.
    const rightSorted = rightItems.sort((a, b) => b.y - a.y);
    const rightLines: string[][] = [];
    let rightCurrentLine: typeof rightSorted = [];
    for (const item of rightSorted) {
      if (rightCurrentLine.length === 0 || Math.abs(rightCurrentLine[0].y - item.y) <= 3) {
        rightCurrentLine.push(item);
      } else {
        rightLines.push(rightCurrentLine.map((i) => i.str));
        rightCurrentLine = [item];
      }
    }
    if (rightCurrentLine.length) rightLines.push(rightCurrentLine.map((i) => i.str));

    const reportTitle = stripTrailingDate(
      (rightLines[0] ?? []).join(" ").trim(),
    ) || "—";

    // Left side: group into visual lines (items within 3 pt share a line).
    const leftSorted = leftItems.sort((a, b) => b.y - a.y);
    const lines: string[][] = [];
    let currentLine: typeof leftSorted = [];
    for (const item of leftSorted) {
      if (currentLine.length === 0 || Math.abs(currentLine[0].y - item.y) <= 3) {
        currentLine.push(item);
      } else {
        lines.push(currentLine.map((i) => i.str));
        currentLine = [item];
      }
    }
    if (currentLine.length) lines.push(currentLine.map((i) => i.str));

    // Prefer the second line (subheading / specific entity) when present.
    const portfolioName = (lines[1] ?? lines[0] ?? []).join(" ").trim() || "—";

    results.push({ reportTitle, portfolioName });
  }

  return results;
}

/**
 * Removes a trailing month-day-year date from a string.
 * e.g. "Portfolio Summary December 31, 2025" → "Portfolio Summary"
 */
function stripTrailingDate(text: string): string {
  return text
    .replace(
      /\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4}.*/i,
      "",
    )
    .trim();
}
