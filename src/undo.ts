/**
 * Undo/redo stack using state snapshots.
 *
 * Before each undoable action, the caller saves a snapshot of the current
 * state. Undo pops from the undo stack and pushes the current state onto
 * the redo stack (and vice versa for redo).
 */

import type { Slice } from './slicer.js';

export interface Snapshot {
  slices: Slice[];
  pendingStart: number | null;
  selectedSlice: number | null;
}

const MAX_UNDO = 50;

const undoStack: Snapshot[] = [];
const redoStack: Snapshot[] = [];

/** Save a snapshot before mutating state. Clears the redo stack. */
export function pushUndo(snapshot: Snapshot): void {
  undoStack.push(snapshot);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
}

/**
 * Undo: pass the *current* state so it can be pushed to redo.
 * Returns the snapshot to restore, or null if nothing to undo.
 */
export function undo(current: Snapshot): Snapshot | null {
  const prev = undoStack.pop();
  if (!prev) return null;
  redoStack.push(current);
  return prev;
}

/**
 * Redo: pass the *current* state so it can be pushed to undo.
 * Returns the snapshot to restore, or null if nothing to redo.
 */
export function redo(current: Snapshot): Snapshot | null {
  const next = redoStack.pop();
  if (!next) return null;
  undoStack.push(current);
  return next;
}

/** Deep-clone a snapshot (slices are small objects, structuredClone is fine). */
export function cloneSnapshot(s: Snapshot): Snapshot {
  return {
    slices: s.slices.map(sl => ({ start: sl.start, end: sl.end, name: sl.name })),
    pendingStart: s.pendingStart,
    selectedSlice: s.selectedSlice,
  };
}

export const canUndo = (): boolean => undoStack.length > 0;
export const canRedo = (): boolean => redoStack.length > 0;

/** Reset both stacks (e.g. when loading a new file). */
export function clearHistory(): void {
  undoStack.length = 0;
  redoStack.length = 0;
}
