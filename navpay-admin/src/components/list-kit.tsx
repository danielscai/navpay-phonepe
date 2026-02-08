"use client";

import { useMemo } from "react";

export function ListToolbar({
  left,
  right,
  error,
}: {
  left: React.ReactNode;
  right?: React.ReactNode;
  error?: string | null;
}) {
  return (
    <div className="np-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">{left}</div>
        {right ? <div className="flex items-center gap-2">{right}</div> : null}
      </div>
      {error ? <div className="mt-3 text-sm text-[var(--np-danger)]">{error}</div> : null}
    </div>
  );
}

export function ListPager({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (nextPage: number) => void;
  onPageSize: (nextPageSize: number) => void;
}) {
  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / Math.max(1, pageSize))), [total, pageSize]);
  return (
    <div className="mt-3 np-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="text-[var(--np-muted)]">
          共 {total} 条，当前第 {page} / {pageCount} 页
        </div>
        <div className="flex items-center gap-2">
          <select
            className="np-input h-[38px] w-[120px] text-sm"
            value={String(pageSize)}
            onChange={(e) => onPageSize(Number(e.target.value))}
            aria-label="pageSize"
          >
            <option value="10">10 / 页</option>
            <option value="20">20 / 页</option>
            <option value="50">50 / 页</option>
            <option value="100">100 / 页</option>
          </select>
          <button className="np-btn px-3 py-2 text-sm" onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1}>
            上一页
          </button>
          <button
            className="np-btn px-3 py-2 text-sm"
            onClick={() => onPage(Math.min(pageCount, page + 1))}
            disabled={page >= pageCount}
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}

