/** Pure placement of a non-blocking guide dialog so it never covers the highlighted control or Treatable's own frame. */

export interface PlaceRect { left: number; top: number; right: number; bottom: number }
export interface PlaceInput {
  viewport: { width: number; height: number };
  size: { width: number; height: number };
  /** The control being pointed at. The dialog must stay clear of it. */
  target?: PlaceRect | null;
  /** A larger region that holds the target, such as its whole filter list. The dialog stays clear of it too and sits beside it. */
  context?: PlaceRect | null;
  /** Other regions to keep clear, such as the collapsed Treatable frame. */
  avoid?: PlaceRect[];
  margin?: number;
  gap?: number;
}
export type PlaceSide = 'right-of' | 'left-of' | 'below' | 'above' | 'bottom-end' | 'bottom-start' | 'top-end' | 'top-start' | 'bottom-center' | 'top-center';
export interface Placement { left: number; top: number; side: PlaceSide; overlap: number }

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
function overlapArea(a: PlaceRect, b: PlaceRect) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}
export function rectOf(value: { left: number; top: number; right: number; bottom: number }): PlaceRect {
  return { left: value.left, top: value.top, right: value.right, bottom: value.bottom };
}

/**
 * Chooses the first candidate spot that clears the target and every avoided region. Spots next to the target come
 * first so the dialog reads as a callout; the viewport corners follow. If nothing is clear, the spot with the
 * least overlap wins.
 */
export function placePopup(input: PlaceInput): Placement {
  const margin = input.margin ?? 16, gap = input.gap ?? 14;
  const { width: vw, height: vh } = input.viewport, { width: w, height: h } = input.size;
  const maxLeft = vw - w - margin, maxTop = vh - h - margin;
  const target = input.target ?? undefined;
  const keepClear: PlaceRect[] = [...(input.avoid ?? [])];
  const around = (box: PlaceRect) => ({ left: box.left - gap, top: box.top - gap, right: box.right + gap, bottom: box.bottom + gap });
  if (target) keepClear.push(around(target));
  const context = input.context ?? undefined;
  if (context) keepClear.push(around(context));
  const side = context ?? target;
  const midTop = target ? (target.top + target.bottom) / 2 - h / 2 : maxTop;
  const midLeft = target ? (target.left + target.right) / 2 - w / 2 : maxLeft;
  const spots: Array<[PlaceSide, number, number]> = [];
  if (target) {
    spots.push(['right-of', side!.right + gap, midTop], ['left-of', side!.left - gap - w, midTop], ['below', midLeft, (side ?? target).bottom + gap], ['above', midLeft, (side ?? target).top - gap - h]);
  }
  spots.push(['bottom-end', maxLeft, maxTop], ['bottom-start', margin, maxTop], ['top-end', maxLeft, margin], ['top-start', margin, margin], ['bottom-center', (vw - w) / 2, maxTop], ['top-center', (vw - w) / 2, margin]);
  let best: Placement | undefined;
  for (const [side, rawLeft, rawTop] of spots) {
    const left = clamp(rawLeft, margin, maxLeft), top = clamp(rawTop, margin, maxTop);
    const box: PlaceRect = { left, top, right: left + w, bottom: top + h };
    const overlap = keepClear.reduce((sum, region) => sum + overlapArea(box, region), 0);
    // A side spot that had to be clamped no longer sits beside the target; the overlap check above catches that.
    if (overlap === 0) return { left: Math.round(left), top: Math.round(top), side, overlap };
    if (!best || overlap < best.overlap) best = { left: Math.round(left), top: Math.round(top), side, overlap };
  }
  return best!;
}
