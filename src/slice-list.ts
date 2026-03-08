/**
 * Slice list UI — renders the sidebar <ul> of slices.
 *
 * Uses a pooled row approach: <li> elements are reused across renders
 * so their DOM identity is stable. This allows future features like
 * inline rename (contenteditable) to survive a re-render of other rows.
 */

import { sliceColor } from './waveform.js';
import type { Slice } from './slicer.js';

export interface SliceListContext {
  setSelection(i: number | null, marker: null): void;
  saveSnapshot(): void;
  playSlice(start: number, end: number): void;
  removeSlice(i: number): void;
  exportSlice(i: number): void;
  renameSlice(i: number): void;
}

export class SliceList {
  private rows: HTMLLIElement[] = [];
  private emptyHint: HTMLLIElement | null = null;
  /** Row index currently in rename mode — skipped during re-renders. */
  private renamingIndex: number | null = null;

  constructor(
    private readonly ul: HTMLUListElement,
    private readonly ctx: SliceListContext,
  ) {}

  render(slices: Slice[], sampleRate: number, selectedSlice: number | null): void {
    if (slices.length === 0) {
      this.clearRows();
      if (!this.emptyHint) {
        this.emptyHint = document.createElement('li');
        this.emptyHint.style.color = 'var(--text-dim)';
        this.emptyHint.textContent = 'Click waveform to set slice start, click again for end';
        this.ul.appendChild(this.emptyHint);
      }
      return;
    }

    // Remove empty hint once we have real slices
    if (this.emptyHint) {
      this.ul.removeChild(this.emptyHint);
      this.emptyHint = null;
    }

    // Shrink pool
    while (this.rows.length > slices.length) {
      this.ul.removeChild(this.rows.pop()!);
    }
    // Grow pool
    while (this.rows.length < slices.length) {
      const li = document.createElement('li');
      this.rows.push(li);
      this.ul.appendChild(li);
    }

    for (let i = 0; i < slices.length; i++) {
      this.updateRow(this.rows[i], slices[i], i, sampleRate, i === selectedSlice);
    }
  }

  private updateRow(
    li: HTMLLIElement,
    slice: Slice,
    i: number,
    sampleRate: number,
    isSelected: boolean,
  ): void {
    // Never rebuild a row while it is being renamed — the contenteditable
    // span would be destroyed mid-edit.
    if (i === this.renamingIndex) return;

    li.className = isSelected ? 'selected' : '';
    li.style.borderLeft = `3px solid ${sliceColor(i)}`;
    li.style.paddingLeft = '8px';

    li.innerHTML = '';

    const info = document.createElement('span');
    info.style.cursor = 'pointer';
    info.addEventListener('click', () => this.ctx.setSelection(i, null));

    const nameSpan = document.createElement('span');
    nameSpan.className = 'slice-label';
    nameSpan.textContent = slice.name ?? `#${i + 1}`;

    // Double-click on desktop, single tap on touch to rename
    nameSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.ctx.renameSlice(i);
    });
    nameSpan.addEventListener('click', (e) => {
      if ((e as PointerEvent).pointerType === 'touch' ||
          'ontouchstart' in window) {
        e.stopPropagation();
        this.ctx.renameSlice(i);
      }
    });

    const timesSpan = document.createElement('span');
    timesSpan.textContent = `  ${fmtTime(slice.start / sampleRate)} – ${fmtTime(slice.end / sampleRate)}  (${fmtTime((slice.end - slice.start) / sampleRate)})`;
    timesSpan.style.color = 'var(--text-dim)';
    timesSpan.style.fontSize = '11px';

    info.appendChild(nameSpan);
    info.appendChild(timesSpan);

    const btnGroup = document.createElement('span');

    const playBtn = document.createElement('button');
    playBtn.textContent = '▶';
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ctx.setSelection(i, null);
      this.ctx.playSlice(slice.start, slice.end);
    });

    const exportBtn = document.createElement('button');
    exportBtn.textContent = '⬇';
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ctx.exportSlice(i);
    });

    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ctx.saveSnapshot();
      this.ctx.removeSlice(i);
    });

    btnGroup.appendChild(delBtn);
    btnGroup.appendChild(playBtn);
    btnGroup.appendChild(exportBtn);
    li.appendChild(info);
    li.appendChild(btnGroup);
  }

  /**
   * Make a row's label inline-editable.
   *
   * @param currentName  Pre-filled text (empty string = no current name).
   * @param onCommit     Called with the final string when the user presses
   *                     Enter or blurs — even if unchanged, so callers can
   *                     re-render without special-casing.
   * @param onCancel     Called when the user presses Escape.
   */
  startRename(
    i: number,
    currentName: string,
    onCommit: (name: string) => void,
    onCancel: () => void,
  ): void {
    const li = this.rows[i];
    if (!li) return;

    const nameSpan = li.querySelector('.slice-label') as HTMLSpanElement | null;
    if (!nameSpan) return;

    this.renamingIndex = i;
    nameSpan.textContent = currentName;
    nameSpan.setAttribute('contenteditable', 'true');
    nameSpan.focus();

    // Select all text so the user can immediately type a replacement
    const range = document.createRange();
    range.selectNodeContents(nameSpan);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    let settled = false;

    const commit = () => {
      if (settled) return;
      settled = true;
      nameSpan.setAttribute('contenteditable', 'false');
      this.renamingIndex = null;
      onCommit(nameSpan.textContent?.trim() ?? '');
    };

    const cancel = () => {
      if (settled) return;
      settled = true;
      nameSpan.setAttribute('contenteditable', 'false');
      this.renamingIndex = null;
      onCancel();
    };

    nameSpan.addEventListener('blur', commit, { once: true });
    nameSpan.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); nameSpan.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); nameSpan.blur(); }
      // Swallow all keystrokes so app shortcuts don't fire while typing
      e.stopPropagation();
    });
  }

  private clearRows(): void {

    while (this.rows.length > 0) {
      this.ul.removeChild(this.rows.pop()!);
    }
  }
}

/** Format seconds as "ss.xx" or "m:ss.xx" when >= 60s. */
function fmtTime(sec: number): string {
  if (sec < 60) return `${sec.toFixed(2)}s`;
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}
