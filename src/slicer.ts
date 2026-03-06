/**
 * Slice state management — overlapping paired regions.
 *
 * Each slice is an independent [start, end] pair. Slices can overlap
 * like nested parentheses: (text [with {overlapping] regions}).
 */

export interface Slice {
  start: number;   // sample frame
  end: number;     // sample frame
  name?: string;   // optional user-assigned label
}

export interface SlicerState {
  slices: Slice[];
  totalSamples: number;
  /** When non-null, a slice is being created — this is its start position. */
  pendingStart: number | null;
}

export function createSlicer(totalSamples: number): SlicerState {
  return { slices: [], totalSamples, pendingStart: null };
}

/** Begin a new slice at this sample frame. Returns true if started. */
export function beginSlice(state: SlicerState, sampleFrame: number): boolean {
  if (sampleFrame < 0 || sampleFrame >= state.totalSamples) return false;
  state.pendingStart = sampleFrame;
  return true;
}

/** Complete the pending slice at this sample frame. Returns the new slice index, or -1. */
export function endSlice(state: SlicerState, sampleFrame: number): number {
  if (state.pendingStart === null) return -1;
  if (sampleFrame < 0 || sampleFrame > state.totalSamples) return -1;

  let start = state.pendingStart;
  let end = sampleFrame;
  state.pendingStart = null;

  // Swap if placed in reverse order
  if (start > end) [start, end] = [end, start];

  // Minimum slice size: 100 samples
  if (end - start < 100) return -1;

  const slice = { start, end };
  state.slices.push(slice);
  sortSlices(state);
  return state.slices.indexOf(slice);
}

/** Cancel a pending slice creation. */
export function cancelPending(state: SlicerState): void {
  state.pendingStart = null;
}

/** Remove a slice by index. */
export function removeSlice(state: SlicerState, index: number): void {
  if (index >= 0 && index < state.slices.length) {
    state.slices.splice(index, 1);
  }
}

/** Move a slice's start or end marker. Returns the slice's new index after re-sort. */
export function moveMarker(
  state: SlicerState,
  sliceIndex: number,
  which: 'start' | 'end',
  newFrame: number
): number {
  const slice = state.slices[sliceIndex];
  if (!slice) return sliceIndex;

  newFrame = Math.max(0, Math.min(state.totalSamples, newFrame));
  slice[which] = newFrame;

  // Ensure start < end
  if (slice.start > slice.end) {
    [slice.start, slice.end] = [slice.end, slice.start];
  }

  sortSlices(state);
  return state.slices.indexOf(slice);
}

export interface MarkerHit {
  sliceIndex: number;
  which: 'start' | 'end';
}

/**
 * Hit-test all slice markers. Returns the closest one within tolerance, or null.
 */
export function hitTestMarker(
  state: SlicerState,
  sampleFrame: number,
  toleranceSamples: number
): MarkerHit | null {
  let best: MarkerHit | null = null;
  let bestDist = Infinity;

  for (let i = 0; i < state.slices.length; i++) {
    const s = state.slices[i];
    const dStart = Math.abs(s.start - sampleFrame);
    const dEnd = Math.abs(s.end - sampleFrame);

    if (dStart < bestDist && dStart <= toleranceSamples) {
      bestDist = dStart;
      best = { sliceIndex: i, which: 'start' };
    }
    if (dEnd < bestDist && dEnd <= toleranceSamples) {
      bestDist = dEnd;
      best = { sliceIndex: i, which: 'end' };
    }
  }

  return best;
}

/**
 * Find the topmost (last-added) slice containing this sample frame.
 */
export function findSliceAt(state: SlicerState, sampleFrame: number): number {
  for (let i = state.slices.length - 1; i >= 0; i--) {
    const s = state.slices[i];
    if (sampleFrame >= s.start && sampleFrame <= s.end) return i;
  }
  return -1;
}

/**
 * Find the nearest marker to a sample frame, preferring the currently
 * selected slice's markers. When two markers from different slices are
 * co-located, this ensures we grab the selected slice's edge.
 *
 * Returns null if nothing is within tolerance.
 */
export function hitTestMarkerPreferSelected(
  state: SlicerState,
  sampleFrame: number,
  toleranceSamples: number,
  selectedSlice: number | null
): MarkerHit | null {
  let best: MarkerHit | null = null;
  let bestScore = Infinity;

  for (let i = 0; i < state.slices.length; i++) {
    const s = state.slices[i];

    for (const which of ['start', 'end'] as const) {
      const markerPos = s[which];
      const dist = Math.abs(markerPos - sampleFrame);
      if (dist > toleranceSamples) continue;

      // Lower score = better. Selected slice's markers get priority.
      const isSelected = i === selectedSlice;
      const score = dist + (isSelected ? 0 : toleranceSamples * 2);

      if (score < bestScore) {
        bestScore = score;
        best = { sliceIndex: i, which };
      }
    }
  }

  return best;
}

/** Sort slices by start position, then by end position. */
function sortSlices(state: SlicerState): void {
  state.slices.sort((a, b) => a.start - b.start || a.end - b.end);
}
