/**
 * Slice marker state management.
 *
 * Markers are stored as sample frame positions in sorted order.
 * Regions are the spans between markers (including 0 and end).
 */

export interface SlicerState {
  markers: number[];
  totalSamples: number;
}

export function createSlicer(totalSamples: number): SlicerState {
  return { markers: [], totalSamples };
}

/** Add a marker and keep the array sorted. Returns the new index. */
export function addMarker(state: SlicerState, sampleFrame: number): number {
  // Don't add at 0 or at the very end — those are implicit boundaries
  if (sampleFrame <= 0 || sampleFrame >= state.totalSamples) return -1;

  // Don't add duplicates (within 100 samples)
  for (const m of state.markers) {
    if (Math.abs(m - sampleFrame) < 100) return -1;
  }

  state.markers.push(sampleFrame);
  state.markers.sort((a, b) => a - b);
  return state.markers.indexOf(sampleFrame);
}

/** Remove a marker by index. */
export function removeMarker(state: SlicerState, index: number): void {
  if (index >= 0 && index < state.markers.length) {
    state.markers.splice(index, 1);
  }
}

/** Move a marker to a new position. Re-sorts after move. */
export function moveMarker(state: SlicerState, index: number, newFrame: number): void {
  if (index < 0 || index >= state.markers.length) return;
  newFrame = Math.max(1, Math.min(state.totalSamples - 1, newFrame));
  state.markers[index] = newFrame;
  state.markers.sort((a, b) => a - b);
}

/** Get all regions as [start, end] pairs in sample frames. */
export function getRegions(state: SlicerState): [number, number][] {
  const boundaries = [0, ...state.markers, state.totalSamples];
  const regions: [number, number][] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    regions.push([boundaries[i], boundaries[i + 1]]);
  }
  return regions;
}

/**
 * Hit-test: find the marker closest to a given sample frame,
 * within a tolerance (in samples). Returns index or -1.
 */
export function hitTestMarker(
  state: SlicerState,
  sampleFrame: number,
  toleranceSamples: number
): number {
  let bestIdx = -1;
  let bestDist = Infinity;

  for (let i = 0; i < state.markers.length; i++) {
    const dist = Math.abs(state.markers[i] - sampleFrame);
    if (dist < bestDist && dist <= toleranceSamples) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  return bestIdx;
}

/**
 * Find which region (slice) a given sample frame falls in.
 * Returns the region index.
 */
export function findRegionAt(state: SlicerState, sampleFrame: number): number {
  const regions = getRegions(state);
  for (let i = 0; i < regions.length; i++) {
    if (sampleFrame >= regions[i][0] && sampleFrame < regions[i][1]) {
      return i;
    }
  }
  return regions.length - 1;
}
