import { PDFDocument, PDFFont, rgb, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { AGGREGATE_REPORTS } from "@/lib/extractFrpSections";
import type { FrpPageInfo } from "@/lib/extractFrpSections";

export interface Section {
  file: File;
  name: string;
}

export interface BookMetadata {
  clientName: string;
  periodDate: string; // e.g. "December 31, 2025"
}

/** Per-section FRP extraction data passed to the book builder. */
export interface SectionFrpData {
  /** Full page-info array (index 0 = PDF page 1). */
  pageInfo: FrpPageInfo[];
  /** Indices into `pageInfo` for pages the user wants included. */
  includedPages: Set<number>;
}

interface TocEntry {
  reportTitle: string;
  portfolioName: string;
  page: number;
}

/** Optional custom font bytes for the TOC. */
export interface CustomFonts {
  georgiaRegular?: Uint8Array;
  neueHaasGroteskBold?: Uint8Array;
}

// ─── colours (matched to the ArchBridge TOC example) ───────────────────────
const BLUE       = rgb(0,     0.514, 0.835);  // #0083d5 — titles / headers
const NAVY       = rgb(0.090, 0.259, 0.455);  // #174274 — data rows (dark blue)
const BLACK      = rgb(0,     0,     0);

// ─── page dimensions (landscape letter, same as the source PDFs) ────────────
const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN = 54;

// ─── column x-positions for the TOC table ───────────────────────────────────
const COL_SECTION   = MARGIN;
const COL_REPORT    = MARGIN + 90;
const COL_PORTFOLIO = MARGIN + 340;
const COL_PAGE_R    = PAGE_W - MARGIN; // right-edge for right-aligned page numbers

// ─── TOC pagination constants ───────────────────────────────────────────────
const ROW_HEIGHT = 14;
const BOTTOM_CUTOFF = 54;   // keep clear of logo area

// Every TOC page has the title + date above the table, so layout is uniform.
const TABLE_TOP    = PAGE_H - 148;
const FIRST_ROW_Y  = TABLE_TOP - 40;
const ROWS_PER_PAGE = Math.floor((FIRST_ROW_Y - BOTTOM_CUTOFF) / ROW_HEIGHT);

/** How many landscape pages are needed for `n` TOC rows? */
function tocPageCount(n: number): number {
  if (n <= ROWS_PER_PAGE) return 1;
  return Math.ceil(n / ROWS_PER_PAGE);
}

/**
 * Build the performance book.
 *
 * Structure of the output:
 *   Page 1        — cover page  (page 1 of the section at coverIndex)
 *   Pages 2…T     — generated Table of Contents (T pages, paginated)
 *   Pages T+1…    — all sections in display order; the cover section contributes
 *                    only its pages 2… (page 1 was used as the cover above)
 *
 * `frpData` is an optional map keyed by section index.  For each section that
 * has FRP extraction data the TOC expands into one row per unique
 * (reportTitle, portfolioName) run, and only the pages in `includedPages` are
 * copied into the output.
 */
export async function buildPerformanceBook(
  sections: Section[],
  coverIndex: number,
  metadata: BookMetadata,
  frpData?: Map<number, SectionFrpData>,
  logoBytes?: Uint8Array,
  customFonts?: CustomFonts,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const fontBold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontOblique = await doc.embedFont(StandardFonts.HelveticaOblique);

  // Custom fonts for TOC (fall back to standard fonts if not provided)
  const fontGeorgia = customFonts?.georgiaRegular
    ? await doc.embedFont(customFonts.georgiaRegular)
    : await doc.embedFont(StandardFonts.TimesRoman);
  const fontNeueHaas = customFonts?.neueHaasGroteskBold
    ? await doc.embedFont(customFonts.neueHaasGroteskBold)
    : fontBold;

  // Embed logo PNG if provided
  const logoImage = logoBytes ? await doc.embedPng(logoBytes) : null;

  // ── load all PDFs ──────────────────────────────────────────────────────────
  const pdfs = await Promise.all(
    sections.map(async (s) => PDFDocument.load(await s.file.arrayBuffer())),
  );

  // ── calculate TOC entries (preliminary — page numbers assume 1 TOC page) ──
  const tocEntries: TocEntry[] = [];
  let curPage = 3; // cover = 1, TOC = 2, content starts at 3

  for (let i = 0; i < sections.length; i++) {
    const data = frpData?.get(i);
    if (data && data.pageInfo.length > 0) {
      // FRP section — one TOC row per unique (reportTitle, portfolioName) run.
      // For the cover PDF, skip index 0 (that page is the book cover).
      const startIdx = i === coverIndex ? 1 : 0;
      let lastKey = "";
      for (let pi = startIdx; pi < data.pageInfo.length; pi++) {
        if (!data.includedPages.has(pi)) continue;
        const info = data.pageInfo[pi];
        const key = AGGREGATE_REPORTS.has(info.reportTitle)
          ? info.reportTitle
          : `${info.reportTitle}|${info.portfolioName}`;
        if (key !== lastKey) {
          const portfolioName = AGGREGATE_REPORTS.has(info.reportTitle)
            ? sections[i].name
            : info.portfolioName;
          tocEntries.push({
            reportTitle:   info.reportTitle,
            portfolioName,
            page:          curPage,
          });
          lastKey = key;
        }
        curPage++;
      }
    } else {
      // Plain section — one TOC row.
      const contentPages =
        i === coverIndex
          ? Math.max(0, pdfs[i].getPageCount() - 1)
          : pdfs[i].getPageCount();
      tocEntries.push({
        reportTitle:   sections[i].name,
        portfolioName: metadata.clientName,
        page:          curPage,
      });
      curPage += contentPages;
    }
  }

  // ── adjust page numbers if the TOC spills onto multiple pages ─────────────
  const numTocPages = tocPageCount(tocEntries.length);
  const pageShift   = numTocPages - 1; // extra pages beyond the assumed 1
  if (pageShift > 0) {
    for (const entry of tocEntries) entry.page += pageShift;
  }

  // ── assemble the document ─────────────────────────────────────────────────
  // 1. Cover page (page 1 of the designated cover PDF)
  const [coverPage] = await doc.copyPages(pdfs[coverIndex], [0]);
  doc.addPage(coverPage);

  // 2. TOC pages
  const numTocPagesActual = tocPageCount(tocEntries.length);
  buildTocPages(doc, metadata, tocEntries, fontBold, fontRegular, fontOblique, fontGeorgia, fontNeueHaas);

  // 3. Section content in display order
  for (let i = 0; i < sections.length; i++) {
    const pdf  = pdfs[i];
    const data = frpData?.get(i);

    if (i === coverIndex) {
      // Cover section: page 0 is the cover (already added above).
      if (pdf.getPageCount() > 1) {
        if (data) {
          // Copy only included pages, skipping page 0.
          const indices: number[] = [];
          for (let pi = 1; pi < data.pageInfo.length; pi++) {
            if (data.includedPages.has(pi)) indices.push(pi);
          }
          if (indices.length > 0) {
            for (const p of await doc.copyPages(pdf, indices)) doc.addPage(p);
          }
        } else {
          // No FRP data — copy all pages except page 0.
          const indices = Array.from({ length: pdf.getPageCount() - 1 }, (_, j) => j + 1);
          for (const p of await doc.copyPages(pdf, indices)) doc.addPage(p);
        }
      }
    } else if (data) {
      // Non-cover FRP section: copy only included pages.
      const indices: number[] = [];
      for (let pi = 0; pi < data.pageInfo.length; pi++) {
        if (data.includedPages.has(pi)) indices.push(pi);
      }
      if (indices.length > 0) {
        for (const p of await doc.copyPages(pdf, indices)) doc.addPage(p);
      }
    } else {
      // Plain section: copy all pages.
      for (const p of await doc.copyPages(pdf, pdf.getPageIndices())) doc.addPage(p);
    }
  }

  // 4. Stamp footer on all pages except the cover (index 0) and TOC pages.
  //    Footer layout: [Logo far-left] ... [ArchBridge Family Office  PageNum]
  const tocEndIndex = 1 + numTocPagesActual; // cover(0) + TOC pages
  const totalPages = doc.getPageCount();
  for (let i = tocEndIndex; i < totalPages; i++) {
    const pg = doc.getPage(i);
    const { width } = pg.getSize();
    const pageNum = String(i + 1);

    // Logo on far left
    if (logoImage) {
      const logoH = 18;
      const logoW = (logoImage.width / logoImage.height) * logoH;
      pg.drawImage(logoImage, {
        x: 18,
        y: 14,
        width: logoW,
        height: logoH,
      });
    }

    // Page number (bold navy, right-aligned)
    const numW = fontBold.widthOfTextAtSize(pageNum, 9);
    pg.drawText(pageNum, {
      x: width - MARGIN - numW,
      y: 18,
      size: 9,
      font: fontBold,
      color: NAVY,
    });

    // "ArchBridge Family Office" to the left of the page number
    const label = "ArchBridge Family Office";
    const labelW = fontBold.widthOfTextAtSize(label, 8);
    pg.drawText(label, {
      x: width - MARGIN - numW - 10 - labelW,
      y: 18,
      size: 8,
      font: fontBold,
      color: NAVY,
    });
  }

  return doc.save();
}

// ─── TOC page builder (paginated) ────────────────────────────────────────────

function buildTocPages(
  doc: PDFDocument,
  metadata: BookMetadata,
  entries: TocEntry[],
  fontBold: PDFFont,
  fontRegular: PDFFont,
  fontOblique: PDFFont,
  fontGeorgia: PDFFont,
  fontNeueHaas: PDFFont,
): void {
  const MAX_REPORT_W    = COL_PORTFOLIO - COL_REPORT    - 8;
  const MAX_PORTFOLIO_W = COL_PAGE_R    - COL_PORTFOLIO - 40;

  let entryIdx = 0;
  let pageNum  = 0;

  while (entryIdx < entries.length) {
    const page = doc.addPage([PAGE_W, PAGE_H]);

    // ── title & date (every TOC page) ────────────────────────────────────
    page.drawText("Table of Contents", {
      x: MARGIN, y: PAGE_H - 70,
      size: 26, font: fontNeueHaas, color: BLUE,
    });
    page.drawText(metadata.periodDate, {
      x: MARGIN, y: PAGE_H - 98,
      size: 13, font: fontGeorgia, color: NAVY,
    });

    // ── table header ──────────────────────────────────────────────────────
    const headerY = TABLE_TOP - 18;
    page.drawText("Section",   { x: COL_SECTION,   y: headerY, size: 11, font: fontNeueHaas, color: NAVY });
    page.drawText("Report",    { x: COL_REPORT,     y: headerY, size: 11, font: fontNeueHaas, color: NAVY });
    page.drawText("Portfolio", { x: COL_PORTFOLIO,  y: headerY, size: 11, font: fontNeueHaas, color: NAVY });
    const pageHeaderW = fontNeueHaas.widthOfTextAtSize("Page", 11);
    page.drawText("Page", { x: COL_PAGE_R - pageHeaderW, y: headerY, size: 11, font: fontNeueHaas, color: NAVY });

    page.drawLine({
      start: { x: MARGIN, y: TABLE_TOP - 28 },
      end:   { x: PAGE_W - MARGIN, y: TABLE_TOP - 28 },
      thickness: 0.5, color: NAVY,
    });

    // ── data rows ─────────────────────────────────────────────────────────
    const rowsThisPage = Math.min(ROWS_PER_PAGE, entries.length - entryIdx);
    for (let r = 0; r < rowsThisPage; r++) {
      const { reportTitle, portfolioName, page: startPage } = entries[entryIdx];
      const rowY = TABLE_TOP - 40 - r * ROW_HEIGHT;

      const reportText    = truncateText(reportTitle,   fontRegular, 10, MAX_REPORT_W);
      const portfolioText = truncateText(portfolioName, fontRegular, 10, MAX_PORTFOLIO_W);

      page.drawText(String(entryIdx + 1), { x: COL_SECTION,   y: rowY, size: 10, font: fontRegular, color: NAVY });
      page.drawText(reportText,           { x: COL_REPORT,     y: rowY, size: 10, font: fontRegular, color: NAVY });
      page.drawText(portfolioText,        { x: COL_PORTFOLIO,  y: rowY, size: 10, font: fontRegular, color: NAVY });

      const numStr = String(startPage);
      const numW   = fontRegular.widthOfTextAtSize(numStr, 10);
      page.drawText(numStr, { x: COL_PAGE_R - numW, y: rowY, size: 10, font: fontRegular, color: NAVY });

      entryIdx++;
    }

    pageNum++;
  }

  // Handle edge case: no entries at all — still need one blank TOC page
  if (entries.length === 0) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    page.drawText("Table of Contents", {
      x: MARGIN, y: PAGE_H - 70,
      size: 26, font: fontNeueHaas, color: BLUE,
    });
    page.drawText(metadata.periodDate, {
      x: MARGIN, y: PAGE_H - 98,
      size: 13, font: fontGeorgia, color: NAVY,
    });
  }
}

/** Truncates text with an ellipsis so it fits within maxWidth pts at the given size. */
function truncateText(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && font.widthOfTextAtSize(t + "…", size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

