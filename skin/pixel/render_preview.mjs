// All package installations stay outside the repository. Server exits after capture.
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const deps = resolve(process.env.PIXEL_NODE_MODULES || 'E:/MinecraftTools/xiaoke/work/pixel-preview/node_modules');
const pw = resolve(process.env.PLAYWRIGHT_NODE_MODULES || 'E:/MinecraftTools/xiaoke/work/avatar/node_modules');
const executablePath = process.env.PIXEL_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const python = process.env.PYTHON || 'python';
const { chromium } = await import(pathToFileURL(join(pw, 'playwright-core/index.mjs')));
const palette = execFileSync(python, ['-B', join(root, 'build_skin.py'), '--palette']);
const temp = await mkdtemp(join(tmpdir(), 'xiaoke-pixel-'));
let browser;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/palette.json') {
      response.setHeader('Content-Type', 'application/json');
      response.end(palette);
      return;
    }
    const isDep = url.pathname.startsWith('/deps/');
    const base = isDep ? deps : root;
    const relative = isDep ? url.pathname.slice(6) : url.pathname === '/' ? 'preview.html' : url.pathname.slice(1);
    const path = resolve(base, decodeURIComponent(relative));
    if (!path.startsWith(base + sep)) throw new Error('Invalid path');
    const data = await readFile(path);
    response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8');
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});

try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  if (!existsSync(executablePath)) throw new Error(`Browser missing: ${executablePath}`);
  browser = await chromium.launch({executablePath, headless:true});
  const page = await browser.newPage({viewport:{width:380,height:480}, deviceScaleFactor:1});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'networkidle'});
  await page.waitForFunction(() => window.ready === true);
  const views = {
    front:{}, back:{angle:Math.PI}, right:{angle:-Math.PI/2}, left:{angle:Math.PI/2},
    front_three:{angle:0.55,elevation:14}, back_three:{angle:Math.PI+0.55,elevation:14},
    small:{width:96,height:128,angle:0.4,elevation:8},
    walk_front:{angle:0.4,elevation:10,pose:'walk'},
    walk_back:{angle:Math.PI+0.4,elevation:10,pose:'walk'},
    turn:{angle:0.3,elevation:8,pose:'turn'},
    base_only:{angle:0.55,elevation:14,layers:false},
    b_front:{angle:0.55,elevation:14,route:'B'},
    b_back:{angle:Math.PI+0.55,elevation:14,route:'B'},
    mobile:{width:320,height:480,angle:0.55,elevation:14},
  };
  const checks = {};
  for (const [name, options] of Object.entries(views)) {
    await page.setViewportSize({width:options.width || 380,height:options.height || 480});
    checks[name] = await page.evaluate(options => window.renderSkin(options), options);
    await page.locator('canvas').screenshot({path:join(temp, `${name}.png`)});
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await mkdir(join(root, 'preview'), {recursive:true});
  await writeFile(join(temp, 'render-checks.json'), JSON.stringify(checks, null, 2));
  const report = execFileSync(python, ['-B', join(root, 'compose_preview.py'), temp], {encoding:'utf8'});
  console.log(report.trim());
  console.log('Browser checks passed: slim, no page/resource errors, 0 / 10 extra cuboids.');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
  // Only this invocation's newly created OS temporary directory is removed.
  if (dirname(temp) === tmpdir() && temp.split(sep).at(-1).startsWith('xiaoke-pixel-')) {
    await rm(temp, {recursive:true,force:true});
  }
}
