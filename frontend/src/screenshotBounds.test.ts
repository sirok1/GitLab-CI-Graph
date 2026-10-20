import { expect, it } from "vitest";
import { screenshotBounds, screenshotSize } from "./screenshotBounds";

it("exports at 4x screen resolution independently of display DPI", () => {
  expect(screenshotSize(800, 400)).toEqual({ width: 3200, height: 1600 });
});
it("compensates for graph zoom so small job text remains readable", () => {
  expect(screenshotSize(600, 300, 0.25)).toEqual({ width: 7200, height: 3600 });
});
it("limits large exports by memory and browser canvas dimensions", () => {
  for (const [width, height] of [
    [5000, 3000],
    [20000, 100],
    [300, 20000],
  ]) {
    const size = screenshotSize(width, height, 0.1);
    expect(size.width * size.height).toBeLessThanOrEqual(40_000_000);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(16384);
  }
});

const view = { x: 100, y: 200, width: 1000, height: 800 };
it("removes empty margins and retains 24px padding", () => {
  expect(
    screenshotBounds(view, [{ x: 300, y: 400, width: 500, height: 200 }]),
  ).toEqual({ x: 176, y: 176, width: 548, height: 248 });
});
it("includes headers, edges and details in the content union", () => {
  expect(
    screenshotBounds(view, [
      { x: 300, y: 400, width: 500, height: 200 },
      { x: 300, y: 350, width: 60, height: 20 },
      { x: 850, y: 400, width: 150, height: 350 },
    ]),
  ).toEqual({ x: 176, y: 126, width: 748, height: 448 });
});
it("clips partially visible content and ignores offscreen jobs", () => {
  expect(
    screenshotBounds(view, [
      { x: 50, y: 150, width: 200, height: 200 },
      { x: 2000, y: 2000, width: 500, height: 500 },
    ]),
  ).toEqual({ x: 0, y: 0, width: 174, height: 174 });
});
it("keeps the view when no content is visible", () => {
  expect(screenshotBounds(view, [])).toEqual({
    x: 0,
    y: 0,
    width: 1000,
    height: 800,
  });
});
