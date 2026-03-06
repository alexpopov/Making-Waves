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
}

export class SliceList {
  private rows: HTMLLIElement[] = [];
  private emptyHint: HTMLLIElement | null = null;

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
    li.className = isSelected ? 'selected' : '';
    li.style.borderLeft = `3px solid ${sliceColor(i)}`;
    li.style.paddingLeft = '8px';

    // Rebuild children each render — fast for typical slice counts.
    // The <li> itself stays stable for future contenteditable rename support.
    li.innerHTML = '';

    const startSec = (slice.start / sampleRate).toFixed(2);
    const endSec = (slice.end / sampleRate).toFixed(2);
    const durSec = ((slice.end - slice.start) / sampleRate).toFixed(2);

    const info = document.createElement('span');
    info.textContent = `#${i + 1}  ${startSec}s – ${endSec}s  (${durSec}s)`;
    info.style.cursor = 'pointer';
    info.addEventListener('click', () => this.ctx.setSelection(i, null));

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

  private clearRows(): void {
    while (this.rows.length > 0) {
      this.ul.removeChild(this.rows.pop()!);
    }
  }
}
