const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
  const page = await b.newPage({viewport:{width:1100,height:700}});
  page.setDefaultTimeout(300000);
  const errors=[]; page.on('pageerror',e=>errors.push(e.message.split('\n')[0]));
  await page.goto('file://' + path.join(__dirname,'..','voxel-bellandur.html'),{waitUntil:'load'});
  await page.waitForFunction('window.__vb!==undefined',{timeout:300000});
  await page.waitForTimeout(2500);
  const shot = async (name) => { await page.waitForTimeout(2200); await page.screenshot({path:'shots/'+name+'.png', timeout:200000}); };
  const set = (h) => page.evaluate((hh)=>window.__vb.setHour(hh), h);

  await page.evaluate(()=>window.__vb.preset(0)); await set(9.4); await shot('a-hero');
  await page.evaluate(()=>window.__vb.preset(1)); await set(17.8); await shot('b-lake-golden');
  await page.evaluate(()=>window.__vb.preset(2)); await set(20.3); await shot('c-orr-night');
  await page.evaluate(()=>window.__vb.preset(0)); await set(21.6); await shot('d-diorama-night');
  await page.evaluate(()=>{window.__vb.preset(3);}); await set(17.2); await shot('e-tech');
  await page.evaluate(()=>window.__vb.preset(4)); await set(10.6); await shot('f-layouts');
  // atlas
  await page.evaluate(()=>{window.__vb.preset(0); window.__vb.setHour(10.0); window.__vb.setAtlas(true); window.__vb.step(5);});
  await shot('g-atlas');
  await page.evaluate(()=>{window.__vb.setAtlas(false); window.__vb.step(5);});
  // chase
  await page.evaluate(()=>{window.__vb.setHour(18.9); window.__vb.setChase(true); window.__vb.step(6); document.body.classList.add('hideui');});
  await shot('h-chase');
  await page.evaluate(()=>{document.body.classList.remove('hideui'); window.__vb.setChase(false);});
  // close-up rooftops
  await page.evaluate(()=>{window.__vb.setHour(10.2); window.__vb.applyHash('#p=150,60,300&t=200,0,230');});
  await shot('i-roofs');
  console.log(JSON.stringify({errors:errors.slice(0,4)}));
  await b.close();
})();
