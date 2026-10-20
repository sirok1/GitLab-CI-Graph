import { expect, it } from "vitest";
import { screenshotBounds } from "./screenshotBounds";

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
