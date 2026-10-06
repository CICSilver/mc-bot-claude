import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const browser = await chromium.connectOverCDP(process.env.CPM_CDP || 'http://127.0.0.1:49523');
const context = browser.contexts()[0];
const page = context.pages().find(p => p.url().includes('tom5454.com/cpm/editor')) || context.pages()[0];
const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'click') await page.mouse.click(Number(args[0]), Number(args[1]));
  else if (command === 'key') await page.keyboard.press(args[0]);
  else if (command === 'reload-project') {
    await page.mouse.click(16, 10);
    await page.mouse.click(44, 52);
    const chooserEvent = page.waitForEvent('filechooser');
    await page.mouse.click(757, 391);
    await (await chooserEvent).setFiles(path.resolve(args[0]));
    await page.mouse.click(755, 411);
  }
  else if (command === 'text') await page.keyboard.insertText(args[0]);
  else if (command === 'shot') {
    await page.screenshot({ path: path.resolve(args[0]) });
  } else if (command === 'drag') {
    await page.mouse.move(Number(args[0]), Number(args[1]));
    await page.mouse.down({ button: args[4] || 'middle' });
    await page.mouse.move(Number(args[2]), Number(args[3]), { steps: 20 });
    await page.mouse.up({ button: args[4] || 'middle' });
  } else if (command === 'wheel') {
    await page.mouse.move(600, 330);
    await page.mouse.wheel(0, Number(args[0]));
  } else if (command === 'drop') {
    const file = path.resolve(args[0]);
    await page.evaluate(({ name, bytes }) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], name, { type: 'application/octet-stream' }));
      document.querySelector('canvas').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
    }, { name: path.basename(file), bytes: Array.from(fs.readFileSync(file)) });
  } else if (command === 'copy-export') {
    await page.evaluate(() => {
      window.xiaokeExport = null;
      navigator.clipboard.writeText = async text => { window.xiaokeExport = text; };
    });
    await page.mouse.click(Number(args[0]), Number(args[1]));
    await page.waitForFunction(() => window.xiaokeExport?.length > 100, null, { timeout: 30000 });
    const text = await page.evaluate(() => window.xiaokeExport);
    fs.writeFileSync(path.resolve(args[2]), text);
    console.log(`Captured local CPM export: ${text.length} characters; no remote upload.`);
  } else if (command === 'input') {
    await page.locator('input[type=file]').last().setInputFiles(path.resolve(args[0]));
  } else if (command === 'upload') {
    const chooserEvent = page.waitForEvent('filechooser');
    await page.mouse.click(Number(args[0]), Number(args[1]));
    const chooser = await chooserEvent;
    await chooser.setFiles(path.resolve(args[2]));
  } else if (command === 'download') {
    const event = page.waitForEvent('download', { timeout: 15000 });
    await page.mouse.click(Number(args[0]), Number(args[1]));
    const download = await event;
    await download.saveAs(path.resolve(args[2]));
    console.log(download.suggestedFilename());
  } else if (command === 'state') {
    console.log(await page.evaluate(() => ({ title: document.title, text: document.body.innerText, inputs: Array.from(document.querySelectorAll('input')).map(e => ({ type: e.type, value: e.value })) })));
  } else throw new Error(`Unknown action ${command}`);
} finally {
  await browser.close();
}
