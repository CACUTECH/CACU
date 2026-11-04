// Renders video.html frame by frame. Usage: node render.js stills  |  node render.js frames
const path = require('path');
const { chromium } = require('C:/Users/olayiwolao/CACU_NEW/node_modules/playwright');
const FPS = 30, DURATION = 25;
(async () => {
  const mode = process.argv[2] || 'stills';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('file:///' + path.join(__dirname, 'video.html').replace(/\\/g, '/'));
  await page.evaluate(() => window.ready);
  if (mode === 'rects') {
    await page.evaluate(() => window.render(9.0));
    console.log(await page.evaluate(() => {
      const s = document.getElementById('screen').getBoundingClientRect();
      return ['milkplus', 'cash', 'confirm'].map(id => { const r = document.getElementById(id).getBoundingClientRect();
        return `${id} ${Math.round(r.x - s.x + r.width / 2)},${Math.round(r.y - s.y + r.height / 2)}`; }).join('\n');
    }));
  } else if (mode === 'stills') {
    const times = process.argv.slice(3).map(Number);
    for (const t of times) {
      await page.evaluate(t => window.render(t), t);
      await page.screenshot({ path: path.join(__dirname, `still-${t.toFixed(2)}.jpg`), type: 'jpeg', quality: 80 });
    }
  } else {
    for (let f = 0; f < FPS * DURATION; f++) {
      await page.evaluate(t => window.render(t), f / FPS);
      await page.screenshot({ path: path.join(__dirname, 'frames', `f${String(f).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 93 });
    }
  }
  await browser.close();
})();
