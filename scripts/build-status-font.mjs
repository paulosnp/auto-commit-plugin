import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";
import { URL } from "node:url";
import { deflateSync } from "node:zlib";

import { Font } from "fonteditor-core";

const SOURCE_PATH = new URL("../media/status-icon.svg", import.meta.url);
const OUTPUT_PATH = new URL("../media/caveman-commit.woff", import.meta.url);
const FULL_ICON_CODE_POINT = 0xe900;
const ADVANCE_WIDTH = 1000;

function cloneContours(contours, offsetX = 0) {
  return contours.map((contour) =>
    contour.map((point) => ({
      ...point,
      x: point.x + offsetX,
    })),
  );
}

function getBounds(contours) {
  const points = contours.flat();
  return {
    xMin: Math.min(...points.map((point) => point.x)),
    yMin: Math.min(...points.map((point) => point.y)),
    xMax: Math.max(...points.map((point) => point.x)),
    yMax: Math.max(...points.map((point) => point.y)),
  };
}

function createGlyph(name, unicode, contours, advanceWidth) {
  const bounds = getBounds(contours);
  return {
    ...bounds,
    name,
    unicode: [unicode],
    contours,
    advanceWidth,
    leftSideBearing: bounds.xMin,
  };
}

const source = Font.create(readFileSync(SOURCE_PATH, "utf8"), {
  type: "svg",
  combinePath: true,
}).get().glyf[0];

if (!source.contours?.length) {
  throw new Error("status-icon.svg não contém contornos.");
}

const width = source.xMax - source.xMin;
const height = source.yMax - source.yMin;
const scale = 840 / Math.max(width, height);
const offsetX = (ADVANCE_WIDTH - width * scale) / 2 - source.xMin * scale;
const offsetY = (ADVANCE_WIDTH - height * scale) / 2 - source.yMin * scale;
const contours = source.contours.map((contour) =>
  contour.map((point) => ({
    ...point,
    x: Math.round(point.x * scale + offsetX),
    y: Math.round(point.y * scale + offsetY),
  })),
);

const font = Font.create();
const data = font.get();
data.head.unitsPerEm = ADVANCE_WIDTH;
data.head.created = Date.UTC(2026, 0, 1);
data.head.modified = data.head.created;
data.name = {
  ...data.name,
  fontFamily: "Caveman Commit Icons",
  fontSubFamily: "Regular",
  uniqueSubFamily: "Caveman Commit Icons Regular 4",
  version: "Version 4.0",
  postScriptName: "CavemanCommitIcons-Regular",
  fullName: "Caveman Commit Icons Regular",
};
data.glyf = [
  {
    name: ".notdef",
    contours: [],
    xMin: 0,
    yMin: 0,
    xMax: 0,
    yMax: 0,
    advanceWidth: ADVANCE_WIDTH,
    leftSideBearing: 0,
  },
  createGlyph(
    "caveman-commit",
    FULL_ICON_CODE_POINT,
    cloneContours(contours),
    ADVANCE_WIDTH,
  ),
];

const output = font.write({
  type: "woff",
  toBuffer: true,
  deflate: (input) => Array.from(deflateSync(Buffer.from(input))),
});
writeFileSync(OUTPUT_PATH, output);
