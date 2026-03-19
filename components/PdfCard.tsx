"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PdfFile } from "@/components/PdfMerger";
import type { FrpSection } from "@/lib/extractFrpSections";

interface Props {
  pdf: PdfFile;
  index: number;
  isCover: boolean;
  isFrp: boolean;
  sections: FrpSection[];
  isExtracting: boolean;
  onRemove: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onSetCover: (id: string) => void;
  onToggleFrp: (id: string) => void;
  onToggleSection: (sectionId: string) => void;
  onRenameSection: (sectionId: string, field: "reportTitle" | "portfolioName", value: string) => void;
}

export default function PdfCard({
  pdf, index, isCover, isFrp, sections, isExtracting,
  onRemove, onRename, onSetCover, onToggleFrp, onToggleSection, onRenameSection,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasSections = sections.length > 1;
  const enabledCount = sections.filter((s) => s.enabled).length;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: pdf.id });

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative flex flex-col rounded-xl border bg-white overflow-hidden select-none transition-all ${
        !hasSections || !expanded ? "aspect-[3/4]" : ""
      } ${
        isDragging
          ? "shadow-2xl border-blue-400 opacity-75 ring-2 ring-blue-300"
          : isCover
          ? "border-blue-400 shadow-md ring-2 ring-blue-300"
          : "border-stone-200 shadow-sm hover:border-stone-300 hover:shadow-md"
      }`}
    >
      {/* Position badge */}
      <div className="absolute top-2 left-2 z-10 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shadow">
        {index + 1}
      </div>

      {/* Remove button */}
      <button
        onClick={() => onRemove(pdf.id)}
        className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-white border border-stone-200 text-stone-400 hover:text-red-500 hover:border-red-200 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
        aria-label="Remove"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Drag area */}
      <div
        className="flex-1 flex flex-col items-center justify-center gap-2 cursor-grab active:cursor-grabbing min-h-[80px]"
        {...attributes}
        {...listeners}
      >
        <PdfIcon />

        {/* Action buttons — shown on hover (cover always visible) */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); onSetCover(pdf.id); }}
            onPointerDown={(e) => e.stopPropagation()}
            title={isCover ? "This PDF provides the cover page" : "Set as cover"}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all ${
              isCover
                ? "bg-blue-50 border-blue-300 text-blue-600"
                : "bg-white border-stone-200 text-stone-400 opacity-0 group-hover:opacity-100 hover:border-blue-300 hover:text-blue-500"
            }`}
          >
            <BookmarkIcon filled={isCover} />
            {isCover ? "Cover" : "Set cover"}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFrp(pdf.id); }}
            onPointerDown={(e) => e.stopPropagation()}
            title={isFrp ? "This PDF is an FRP report (click to unmark)" : "Mark as FRP report"}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all ${
              isFrp
                ? "bg-amber-50 border-amber-300 text-amber-700"
                : "bg-white border-stone-200 text-stone-400 opacity-0 group-hover:opacity-100 hover:border-amber-300 hover:text-amber-600"
            }`}
          >
            FRP
          </button>
        </div>
      </div>

      {/* Section toggle — shown when extraction found 2+ groups */}
      {(hasSections || isExtracting) && (
        <div className="px-2" onPointerDown={(e) => e.stopPropagation()}>
          {isExtracting ? (
            <div className="flex items-center gap-1.5 py-1 text-[10px] text-stone-400">
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Reading sections…
            </div>
          ) : (
            <>
              {/* Collapsed toggle */}
              {!expanded && (
                <button
                  onClick={() => setExpanded(true)}
                  className="flex items-center gap-1 w-full py-1 text-[10px] font-medium text-stone-500 hover:text-[#0083d5] transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                  {enabledCount}/{sections.length} sections
                </button>
              )}

              {/* Expanded: section list + prominent collapse bar */}
              {expanded && (
                <>
                  <p className="text-[10px] font-medium text-stone-400 py-0.5">
                    {enabledCount}/{sections.length} sections
                  </p>
                  <ul className="max-h-48 overflow-y-auto mb-1 -mx-0.5 px-0.5 space-y-px">
                    {sections.map((section) => {
                      const pageCount = section.endIdx - section.startIdx + 1;
                      return (
                        <li key={section.id} className="flex items-start gap-1.5 py-0.5">
                          <button
                            onClick={() => onToggleSection(section.id)}
                            className={`flex-shrink-0 mt-0.5 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                              section.enabled
                                ? "bg-[#0083d5] border-[#0083d5]"
                                : "bg-white border-stone-300 hover:border-stone-400"
                            }`}
                            aria-label={section.enabled ? "Exclude section" : "Include section"}
                          >
                            {section.enabled && (
                              <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                          <div className={`min-w-0 flex-1 ${section.enabled ? "" : "opacity-40"}`}>
                            <input
                              type="text"
                              value={section.reportTitle}
                              onChange={(e) => onRenameSection(section.id, "reportTitle", e.target.value)}
                              className="w-full text-[10px] leading-tight font-medium text-stone-700 bg-transparent border-b border-transparent hover:border-stone-200 focus:border-blue-300 focus:outline-none truncate py-0"
                              title={section.reportTitle}
                            />
                            <div className="flex items-center">
                              <input
                                type="text"
                                value={section.portfolioName}
                                onChange={(e) => onRenameSection(section.id, "portfolioName", e.target.value)}
                                className="flex-1 min-w-0 text-[9px] leading-tight text-stone-400 bg-transparent border-b border-transparent hover:border-stone-200 focus:border-blue-300 focus:outline-none truncate py-0"
                                title={section.portfolioName}
                              />
                              <span className="ml-1 text-[9px] text-stone-300 flex-shrink-0">· {pageCount}p</span>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <button
                    onClick={() => setExpanded(false)}
                    className="flex items-center justify-center gap-1.5 w-full py-1.5 mb-1 rounded-md bg-stone-100 hover:bg-stone-200 text-[10px] font-medium text-stone-500 hover:text-stone-700 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
                    </svg>
                    Hide sections
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="px-2 pb-2 pt-1" onPointerDown={(e) => e.stopPropagation()}>
        {/* Editable section name */}
        <input
          type="text"
          value={pdf.sectionName}
          onChange={(e) => onRename(pdf.id, e.target.value)}
          placeholder="Section name…"
          className="w-full text-xs font-medium text-stone-800 bg-transparent border-b border-transparent hover:border-stone-200 focus:border-blue-300 focus:outline-none leading-tight py-0.5 truncate"
          title={pdf.sectionName}
        />
        <p className="text-[11px] text-stone-400 mt-0.5">{formatBytes(pdf.file.size)}</p>
      </div>
    </div>
  );
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return filled ? (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
      <path d="M5 3a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2H5z" />
    </svg>
  ) : (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 3a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2H5z" />
    </svg>
  );
}

function PdfIcon() {
  return (
    <svg className="w-12 h-12 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.25}
        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.25} d="M13 3v5a1 1 0 001 1h5" />
      <text x="12" y="17" textAnchor="middle" fontSize="4.5" fontWeight="700"
        fill="currentColor" stroke="none" fontFamily="system-ui, sans-serif">
        PDF
      </text>
    </svg>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
