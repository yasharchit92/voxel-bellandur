const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
  const page = await b.newPage({viewport:{width:1100,height:700}});
  page.setDefaultTimeout(300000);
  const errors=[]; page.on('pageerror',e=>errors.push(e.message.split('\n')[0]));
  await page.goto('file://' + path.join(__dirname,'..','voxel-bellandur.html'),{waitUntil:'load'});
  await page.waitForFunction('window.__vb!==undefined',{timeout:300000});
  await page.waitForTimeout(2500);
  const out = path.join(__dirname, '..', 'screenshots') + path.sep;
  const shot = async (name) => { await page.waitForTimeout(2200); await page.screenshot({path: out + name + '.png', timeout:220000}); };
  const set = (h) => page.evaluate((hh)=>window.__vb.setHour(hh), h);
  const pre = (i) => page.evaluate((p)=>window.__vb.preset(p), i);

  await pre(0); await set(9.4); await shot('01-bellandur-diorama');
  await pre(1); await set(17.8); await shot('02-lake-golden-hour');
  await pre(2); await set(20.3); await shot('03-outer-ring-road-night');
  await pre(0); await set(21.6); await shot('04-the-city-at-night');
  await pre(3); await set(10.0); await shot('05-tech-parks');
  await pre(4); await set(10.6); await shot('06-residential-layouts');
  await page.evaluate(()=>{window.__vb.preset(0); window.__vb.setHour(10.0); window.__vb.setAtlas(true); window.__vb.step(6);});
  await shot('07-atlas-map');
  await page.evaluate(()=>{window.__vb.setAtlas(false); window.__vb.step(6);});
  await page.evaluate(()=>{window.__vb.setHour(18.95); window.__vb.setChase(true); window.__vb.step(8); document.body.classList.add('hideui');});
  await shot('08-chase-outer-ring-road');
  await page.evaluate(()=>{document.body.classList.remove('hideui'); window.__vb.setChase(false);});
  await page.evaluate(()=>{window.__vb.setHour(10.2); window.__vb.applyHash('#p=150,52,300&t=200,0,230');});
  await shot('09-rooftops');
  await page.evaluate(()=>{window.__vb.setHour(19.2); window.__vb.applyHash('#p=-150,120,330&t=-60,0,120');});
  await shot('10-dusk-neighbourhood');
  // the postcard export, written straight to disk
  const card = await page.evaluate(()=>window.__vb.postcard(1.2));
  if (typeof card === 'string') fs.writeFileSync(out + '11-postcard-export.png', Buffer.from(card.split(',')[1], 'base64'));
  console.log(JSON.stringify({errors:errors.slice(0,3)}));
  await b.close();
})();
