import test from 'node:test';
import assert from 'node:assert/strict';
import { placePopup, type PlaceRect } from '../src/guide-place';

const box = (left: number, top: number, width: number, height: number): PlaceRect => ({ left, top, right: left + width, bottom: top + height });
const overlaps = (a: PlaceRect, b: PlaceRect) => Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
const popupBox = (spot: { left: number; top: number }, size: { width: number; height: number }) => box(spot.left, spot.top, size.width, size.height);
const viewport = { width: 1280, height: 900 };
const size = { width: 352, height: 210 };

test('the dialog sits beside the control and never over it', () => {
  const target = box(40, 440, 140, 24);
  const spot = placePopup({ viewport, size, target });
  assert.equal(spot.side, 'right-of');
  assert.equal(spot.overlap, 0);
  assert.equal(overlaps(popupBox(spot, size), target), false);
});

test('a context region (the whole filter list) is cleared too, so neighbouring options stay readable', () => {
  const target = box(40, 440, 140, 24), context = box(24, 340, 380, 520);
  const spot = placePopup({ viewport, size, target, context });
  assert.equal(overlaps(popupBox(spot, size), context), false);
  assert.ok(spot.left >= context.right, 'beside the list, not over it');
});

test('regions to avoid, such as the small Treatable frame, are respected', () => {
  const target = box(900, 400, 200, 30), frame = box(884, 16, 380, 104);
  const spot = placePopup({ viewport, size, target, avoid: [frame] });
  assert.equal(overlaps(popupBox(spot, size), frame), false);
  assert.equal(overlaps(popupBox(spot, size), target), false);
});

test('the dialog stays inside the viewport with a margin', () => {
  for (const target of [box(0, 0, 50, 20), box(1230, 880, 50, 20), box(600, 0, 100, 20), box(600, 880, 100, 20)]) {
    const spot = placePopup({ viewport, size, target, margin: 16 });
    assert.ok(spot.left >= 16 && spot.top >= 16 && spot.left + size.width <= viewport.width - 16 && spot.top + size.height <= viewport.height - 16, JSON.stringify(spot));
  }
});

test('without a target the dialog goes to the bottom corner; on a tiny viewport the least-overlapping spot wins', () => {
  assert.equal(placePopup({ viewport, size }).side, 'bottom-end');
  const tiny = { width: 360, height: 300 };
  const big = box(0, 0, 360, 300);
  const spot = placePopup({ viewport: tiny, size: { width: 330, height: 200 }, target: big });
  assert.ok(spot.overlap > 0, 'nothing is clear, so the report says so');
  assert.ok(Number.isFinite(spot.left) && Number.isFinite(spot.top));
});
