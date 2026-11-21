// Sestavení aplikace do dist/: jeden app.js (klasický skript – funguje i při otevření index.html ze složky),
// app.css, service worker s seznamem souborů pro offline běh, manifest a ikony.
import * as esbuild from "esbuild";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const watch = process.argv.includes("--watch");
const OUT = "dist";
const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));

async function finish(version) {
  const html = (await fs.readFile("src/index.html", "utf8")).replaceAll("__VERSION__", version);
  await fs.writeFile(`${OUT}/index.html`, html);
  await fs.mkdir(`${OUT}/icons`, { recursive: true });
  for (const f of await fs.readdir("src/icons")) await fs.copyFile(`src/icons/${f}`, `${OUT}/icons/${f}`);
  await fs.writeFile(`${OUT}/manifest.webmanifest`, JSON.stringify({
    name: "Oskeruše – katalog a sady", short_name: "Oskeruše", lang: "cs", start_url: "./", scope: "./", display: "standalone",
    background_color: "#f6f3ec", theme_color: "#8a3b1f", description: "Katalog oskeruší Českého středohoří a evidence výsadeb",
    icons: [{ src: "icons/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }],
  }, null, 1));
  const files = ["./", "index.html", "manifest.webmanifest", ...(await list(OUT)).filter(f => !/^(index\.html|sw\.js|manifest\.webmanifest)$|\.map$/.test(f))];
  const sw = (await fs.readFile("src/sw.js", "utf8")).replace("__VERSION__", version).replace("__FILES__", JSON.stringify(files));
  await fs.writeFile(`${OUT}/sw.js`, sw);
}
async function list(dir, pre = "") {
  const out = [];
  for (const d of await fs.readdir(dir, { withFileTypes: true })) {
    if (d.isDirectory()) out.push(...await list(`${dir}/${d.name}`, `${pre}${d.name}/`)); else out.push(pre + d.name);
  }
  return out;
}
const opts = {
  entryPoints: { app: "src/main.js" }, bundle: true, format: "iife", target: ["chrome110", "safari16", "firefox115"],
  outdir: OUT, minify: !watch && process.env.MINIFY !== "0", sourcemap: true, loader: { ".png": "file", ".svg": "file" }, assetNames: "assets/[name]-[hash]",
  metafile: true, logLevel: "info",
};
await fs.rm(OUT, { recursive: true, force: true }); await fs.mkdir(OUT, { recursive: true });
const plugin = { name: "finish", setup(b) { b.onEnd(async r => {
  if (r.errors.length) return;
  const js = await fs.readFile(`${OUT}/app.js`); const css = await fs.readFile(`${OUT}/app.css`);
  const version = `${pkg.version}-${crypto.createHash("sha1").update(js).update(css).digest("hex").slice(0, 8)}`;
  // verze do app.js (zobrazuje se v aplikaci)
  await fs.writeFile(`${OUT}/app.js`, `var __VERSION__=${JSON.stringify(version)};\n` + js);
  await finish(version);
  console.log(`dist/ verze ${version}`);
}); } };
if (watch) { const ctx = await esbuild.context({ ...opts, plugins: [plugin] }); await ctx.watch(); }
else await esbuild.build({ ...opts, plugins: [plugin] });
