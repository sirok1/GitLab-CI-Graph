export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Render vectors at export resolution, with at least 3 pixels per job layout unit
 * when zoomed out, unless the image's memory/dimension limits are reached. */
export function screenshotSize(width: number, height: number, zoom = 1) {
  if (!(width > 0 && height > 0 && Number.isFinite(width + height))) {
    throw new Error("Workspace has no renderable area");
  }
  const desired = Math.max(
    4,
    3 / (Number.isFinite(zoom) && zoom > 0 ? zoom : 1),
  );
  const scale = Math.min(
    desired,
    Math.sqrt(40_000_000 / (width * height)),
    16384 / width,
    16384 / height,
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
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
