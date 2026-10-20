import { toSvg } from "html-to-image";
import { screenshotBounds } from "./screenshotBounds";

const svgProperties = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "color",
  "font-size",
  "font-family",
  "font-weight",
  "opacity",
  "paint-order",
  "text-anchor",
  "dominant-baseline",
];
const excluded = (element: Element) =>
  !!element.closest(".react-flow__controls, .focusbar");

/** html-to-image deep-clones SVG children without inlining their CSS. */
export async function captureWorkspace(
  workspace: HTMLElement,
): Promise<string> {
  const background = getComputedStyle(document.documentElement)
    .getPropertyValue("--bg")
    .trim();
  const view = workspace.getBoundingClientRect();
  const crop = screenshotBounds(
    view,
    Array.from(
      workspace.querySelectorAll(
        ".react-flow__node, .react-flow__edge-path, .react-flow__edge-textwrapper, .column > b, aside > *",
      ),
    ).map((element) => {
      const r = element.getBoundingClientRect();
      // Edge paths can have zero height/width; retain their stroke and arrowhead.
      const extra = element.classList.contains("react-flow__edge-path") ? 8 : 0;
      return {
        x: r.x - extra,
        y: r.y - extra,
        width: r.width + extra * 2,
        height: r.height + extra * 2,
      };
    }),
  );
  const data = await toSvg(workspace, {
    backgroundColor: background,
    filter: (node) => !(node instanceof Element && excluded(node)),
  });
  const documentCopy = new DOMParser().parseFromString(
    decodeURIComponent(data.substring(data.indexOf(",") + 1)),
    "image/svg+xml",
  );
  const originals = Array.from(
    workspace.querySelectorAll<SVGElement>("svg *"),
  ).filter((node) => !excluded(node));
  // Scope each nested SVG explicitly: the exported document itself has an SVG
  // root, so a global `svg *` selector would also match every HTML element.
  const copies = Array.from(
    new Set(
      Array.from(
        documentCopy.querySelector("foreignObject")!.querySelectorAll("svg"),
      ).flatMap((svg) => Array.from(svg.querySelectorAll<SVGElement>("*"))),
    ),
  );
  if (originals.length !== copies.length)
    throw new Error("Workspace changed during capture");
  originals.forEach((original, index) => {
    const styles = getComputedStyle(original);
    for (const property of svgProperties)
      copies[index].style.setProperty(
        property,
        styles.getPropertyValue(property),
      );
  });
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Cannot render workspace"));
  });
  image.src =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(new XMLSerializer().serializeToString(documentCopy));
  await loaded;
  const canvas = document.createElement("canvas");
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.ceil(crop.width * ratio);
  canvas.height = Math.ceil(crop.height * ratio);
  const context = canvas.getContext("2d");
  if (
    !context ||
    !canvas.width ||
    !canvas.height ||
    canvas.width * canvas.height > 40_000_000
  )
    throw new Error("Workspace too large");
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    (crop.x * image.width) / view.width,
    (crop.y * image.height) / view.height,
    (crop.width * image.width) / view.width,
    (crop.height * image.height) / view.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas.toDataURL("image/png");
}
