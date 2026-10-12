import { readFileSync, writeFileSync } from "node:fs";
import { URL } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const source = readFileSync(new URL("../media/status-icon.svg", import.meta.url), "utf8");
const mark = source.match(/<path[^>]+>/)?.[0];
if (mark === undefined) throw new Error("Símbolo vetorial não encontrado.");

const light = source.replace('fill="#202020"', 'fill="#f5f5f5"');
writeFileSync(new URL("../media/status-icon-light.svg", import.meta.url), light);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="Caveman Commit">
  <rect x="8" y="8" width="240" height="240" rx="48" fill="#202020"/>
  <g transform="translate(32 32) scale(3)">${mark.replace('fill="#202020"', 'fill="#f5f5f5"')}</g>
</svg>\n`;
writeFileSync(new URL("../media/icon.svg", import.meta.url), svg);
for (const [name, width] of [["icon.png", 256], ["icon-small.png", 32]]) {
  const image = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render();
  writeFileSync(new URL(`../media/${name}`, import.meta.url), image.asPng());
}
