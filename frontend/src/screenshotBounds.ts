export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Union visible content only; stage lanes and canvas decorations are not content. */
export function screenshotBounds(
  view: Rectangle,
  content: Rectangle[],
  padding = 24,
): Rectangle {
  const visible = content
    .map((r) => ({
      x: Math.max(view.x, r.x),
      y: Math.max(view.y, r.y),
      right: Math.min(view.x + view.width, r.x + r.width),
      bottom: Math.min(view.y + view.height, r.y + r.height),
    }))
    .filter((r) => r.right > r.x && r.bottom > r.y);
  if (!visible.length)
    return { x: 0, y: 0, width: view.width, height: view.height };
  const x = Math.max(
    view.x,
    Math.floor(Math.min(...visible.map((r) => r.x)) - padding),
  );
  const y = Math.max(
    view.y,
    Math.floor(Math.min(...visible.map((r) => r.y)) - padding),
  );
  const right = Math.min(
    view.x + view.width,
    Math.ceil(Math.max(...visible.map((r) => r.right)) + padding),
  );
  const bottom = Math.min(
    view.y + view.height,
    Math.ceil(Math.max(...visible.map((r) => r.bottom)) + padding),
  );
  return { x: x - view.x, y: y - view.y, width: right - x, height: bottom - y };
}
