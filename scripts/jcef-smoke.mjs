// Optional integration check against the actual browser embedded in runIde, never a standalone UI.
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const port = process.argv[2] ?? "9222";
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = targets.find((t) => t.title === "GitLab CI Graph");
assert(target, "Open GitLab CI Graph in the sandbox IDE first");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let id = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const result = JSON.parse(event.data);
  const entry = pending.get(result.id);
  if (entry) {
    pending.delete(result.id);
    result.error
      ? entry.reject(new Error(JSON.stringify(result.error)))
      : entry.resolve(result.result);
  }
});
async function call(method, params = {}) {
  const request = ++id;
  const response = new Promise((resolve, reject) =>
    pending.set(request, { resolve, reject }),
  );
  socket.send(JSON.stringify({ id: request, method, params }));
  return Promise.race([
    response,
    delay(8000).then(() => {
      throw new Error(`${method} timed out`);
    }),
  ]);
}
async function evaluate(expression) {
  const response = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  assert(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
async function button(text) {
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(b => b.textContent === ${JSON.stringify(text)})?.click()`,
  );
  await delay(350);
}
async function selectLayout(layout) {
  await evaluate(
    `(()=>{const s=document.querySelector('select[aria-label="Layout"]');s.value=${JSON.stringify(layout)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await delay(450);
}
async function search(text) {
  await evaluate(
    `(()=>{const s=document.querySelector('input[aria-label="Search jobs"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(s,${JSON.stringify(text)});s.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await delay(150);
}
async function waitFor(expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(expression)) return;
    await delay(100);
  }
  assert.fail(`Timed out waiting for ${expression}`);
}
async function checkLocalInheritance() {
  // Exclusive creation avoids replacing an existing example or a user's configuration.
  const fixturePath = "examples/.gitlab-ci.yaml";
  let created = false;
  let originalFile = ".gitlab-ci.yml";
  try {
    await writeFile(
      fixturePath,
      await readFile("src/test/resources/fixtures/inheritance.yml"),
      { flag: "wx" },
    );
    created = true;
    await evaluate(
      `window.addEventListener('pipeline:update',e=>window.__inheritanceSmoke=e.detail);window.ideSend({type:'graph:refresh'})`,
    );
    await waitFor(
      `window.__inheritanceSmoke?.configs.includes('.gitlab-ci.yaml')`,
    );
    originalFile = await evaluate(`window.__inheritanceSmoke.selectedFile`);
    await evaluate(
      `window.ideSend({type:'source:change',file:'.gitlab-ci.yaml',mode:'LOCAL'})`,
    );
    await waitFor(
      `window.__inheritanceSmoke?.pipeline?.jobs.some(j=>j.name==='publish Android dev') && !window.__inheritanceSmoke.loading`,
    );
    await delay(400);
    const result = await evaluate(`(()=>{
      const p=window.__inheritanceSmoke.pipeline;
      return {jobs:p.jobs.length,hidden:p.jobs.some(j=>j.name.startsWith('.')),
        publish:p.jobs.filter(j=>j.name.startsWith('publish Android')).map(j=>({stage:j.stage,parent:j.stageInheritedFrom})),
        badges:Array.from(document.querySelectorAll('.extends-badge')).map(e=>e.textContent),
        warnings:p.warnings.map(w=>w.message)};
    })()`);
    assert.equal(result.jobs, 8);
    assert.equal(result.hidden, false);
    assert.equal(result.publish.length, 2);
    assert(
      result.publish.every(
        (j) =>
          j.stage === "publish_android" &&
          j.parent === ".publish Android release",
      ),
    );
    assert(result.badges.some((b) => b.includes(".publish Android release")));
    assert(
      result.warnings.some(
        (w) =>
          w.includes("build_android_apk_dev") && w.includes("not in stages"),
      ),
    );
    await evaluate(
      `document.querySelector('.react-flow__node[data-id="publish Android dev"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`,
    );
    await delay(100);
    assert.match(
      await evaluate(`document.querySelector('aside').textContent`),
      /Stage inherited from.*\.publish Android release/,
    );
    await button("Fit View");
    await evaluate(`document.querySelector('.react-flow__controls-zoomin').click()`);
    await delay(400);
    const pane = await evaluate(`(()=>{const r=document.querySelector('.react-flow').getBoundingClientRect();return {x:r.right-30,y:r.top+20}})()`);
    await call("Input.dispatchMouseEvent", { type: "mousePressed", ...pane, button: "left", clickCount: 1 });
    await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: pane.x - 65, y: pane.y + 40, button: "left", buttons: 1 });
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: pane.x - 65, y: pane.y + 40, button: "left", clickCount: 1 });
    await delay(350);
    const camera = await evaluate(`document.querySelector('.react-flow__viewport').style.transform`);
    // Exercise the exact backend event protocol without relying on the IDE's
    // external-disk refresh timing while its window is in the background.
    await evaluate(`(()=>{window.__viewportOriginal=structuredClone(window.__inheritanceSmoke);const s=structuredClone(window.__viewportOriginal);s.pipeline.jobs.push({...s.pipeline.jobs[0],id:'viewport-regression',name:'viewport-regression'});window.dispatchEvent(new CustomEvent('pipeline:update',{detail:s}));})()`);
    await waitFor(`window.__inheritanceSmoke?.pipeline?.jobs.some(j=>j.name==='viewport-regression') && !window.__inheritanceSmoke.loading`);
    await delay(700);
    assert.equal(await evaluate(`document.querySelector('.react-flow__viewport').style.transform`), camera, "Auto-refresh must preserve zoom and pan when jobs change");
    await evaluate(`(()=>{const s=structuredClone(window.__viewportOriginal);s.pipeline.jobs=[];s.pipeline.edges=[];s.pipeline.valid=false;s.pipeline.errors=['Invalid YAML'];window.dispatchEvent(new CustomEvent('pipeline:update',{detail:s}));})()`);
    await waitFor(`window.__inheritanceSmoke?.pipeline?.valid === false && !window.__inheritanceSmoke.loading`);
    await evaluate(`window.dispatchEvent(new CustomEvent('pipeline:update',{detail:window.__viewportOriginal}))`);
    await waitFor(`window.__inheritanceSmoke?.pipeline?.jobs.length === 8 && !window.__inheritanceSmoke.loading`);
    await delay(700);
    assert.equal(await evaluate(`document.querySelector('.react-flow__viewport').style.transform`), camera, "Recovering from invalid YAML must preserve zoom and pan");
    console.log("Viewport regression passed: zoom and pan survive pipeline:update events and invalid YAML recovery.");
    console.log(
      "Inheritance JCEF regression passed: hidden templates, inherited publish stages, EXTENDS badges, details and undeclared-stage warnings.",
    );
  } finally {
    if (created) {
      await evaluate(
        `window.ideSend({type:'source:change',file:${JSON.stringify(originalFile)},mode:'LOCAL'})`,
      );
      await unlink(fixturePath);
      await waitFor(
        `window.__inheritanceSmoke?.pipeline?.jobs.some(j=>j.name==='test-web') && !window.__inheritanceSmoke.loading`,
      );
      await delay(350);
    }
  }
}
try {
  await button("Fit View");
  await evaluate(`document.querySelector('.react-flow__controls-zoomout').click()`);
  await delay(350);
  const cameraBeforeScreenshot = await evaluate(`document.querySelector('.react-flow__viewport').style.transform`);
  await evaluate(`(()=>{window.__serializeScreenshot=XMLSerializer.prototype.serializeToString;XMLSerializer.prototype.serializeToString=function(node){const root=node.documentElement??node;if(root.tagName==='svg' && root.getAttribute('preserveAspectRatio')==='none')window.__screenshotVector={width:Number(root.getAttribute('width')),height:Number(root.getAttribute('height')),viewBox:root.getAttribute('viewBox').split(' ').map(Number)};return window.__serializeScreenshot.call(this,node);};})()`);
  await evaluate(`(()=>{const send=window.ideSend;window.ideSend=m=>{if(m.type==='screenshot:copy')window.__screenshotSmoke=m.image;send(m);};})()`);
  await button("Copy screenshot");
  await waitFor(`document.querySelector('[role="status"]')?.textContent.includes('Screenshot copied')`);
  await evaluate(`XMLSerializer.prototype.serializeToString=window.__serializeScreenshot`);
  const screenshot = await evaluate(`window.__screenshotSmoke`);
  assert(screenshot.startsWith("data:image/png;base64,"));
  assert(await evaluate(`(async()=>{
    const image=new Image();image.src=window.__screenshotSmoke;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
    const path=document.querySelector('.react-flow__edge-path');
    const point=path.getPointAtLength(path.getTotalLength()/2);
    const screen=new DOMPoint(point.x,point.y).matrixTransform(path.getScreenCTM());
    const bounds=document.querySelector('.workspace').getBoundingClientRect();
    const vector=window.__screenshotVector;
    if(image.width!==vector.width || image.height!==vector.height)throw new Error('SVG must rasterize at final PNG resolution');
    const [cropX,cropY,cropWidth,cropHeight]=vector.viewBox;
    if(cropHeight>=bounds.height*.9)throw new Error('Empty vertical margins were not cropped');
    if(image.width<cropWidth*3.9)throw new Error('Screenshot must render at high resolution regardless of display DPI');
    const x=Math.round((screen.x-bounds.x-cropX)*image.width/cropWidth);
    const y=Math.round((screen.y-bounds.y-cropY)*image.height/cropHeight);
    const pixels=ctx.getImageData(x-2,y-2,5,5).data;
    return Array.from(pixels).some((v,i)=>i%4===0 && v>40);
  })()`), "Exported PNG must contain the dependency arrow, not just job cards");
  assert.equal(await evaluate(`document.querySelector('.react-flow__viewport').style.transform`), cameraBeforeScreenshot, "Screenshot cropping must not change zoom/pan");
  await mkdir("build", { recursive: true });
  await writeFile("build/workspace-screenshot.png", Buffer.from(screenshot.split(",")[1], "base64"));
  console.log("Screenshot regression passed: actual JCEF workspace exported to native clipboard.");
  await button("Fit View");
  const initial = await evaluate(
    `({jobs:document.querySelectorAll('.job').length,edges:document.querySelectorAll('.react-flow__edge').length,stages:document.querySelectorAll('.column').length,status:document.querySelector('.status').textContent})`,
  );
  assert.equal(initial.jobs, 5);
  assert.equal(initial.edges, 4);
  assert.equal(initial.stages, 3);
  assert.match(initial.status, /LOCAL/);
  const clipping = await evaluate(
    `(()=>{const c=document.querySelector('.canvas').getBoundingClientRect();return Array.from(document.querySelectorAll('.job')).map(n=>({name:n.querySelector('strong').textContent,r:n.getBoundingClientRect()})).filter(({r})=>r.left<c.left-1||r.right>c.right+1||r.top<c.top-1||r.bottom>c.bottom+1).map(n=>n.name)})()`,
  );
  assert.deepEqual(clipping, [], `Fit View clipped jobs: ${clipping}`);
  await search("deploy");
  assert.equal(
    await evaluate(`document.querySelectorAll('.job.match').length`),
    1,
  );
  await evaluate(
    `document.querySelector('input[aria-label="Search jobs"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`,
  );
  await delay(100);
  assert.equal(
    await evaluate(
      `document.querySelector('input[aria-label="Search jobs"]').value`,
    ),
    "",
  );
  await selectLayout("DAG");
  assert.equal(
    await evaluate(`document.querySelectorAll('.column').length`),
    0,
  );
  await selectLayout("Stages");
  await evaluate(
    `document.querySelector('.react-flow__node[data-id="test-web"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`,
  );
  await delay(100);
  assert.equal(
    await evaluate(`document.querySelector('aside h3')?.textContent`),
    "test-web",
  );
  await button("Show dependencies");
  assert.equal(
    await evaluate(`document.querySelectorAll('.job.dimmed').length`),
    3,
  );
  await button("Show dependencies");
  await button("Fit View");
  // Real pointer input catches viewport refits and nodes snapping back during drag.
  const dragStart = await evaluate(`(()=>{
    const node=document.querySelector('.react-flow__node[data-id="test-web"]');
    const r=node.getBoundingClientRect();
    window.dragProbe={viewport:document.querySelector('.react-flow__viewport').style.transform,
      nodes:new Map(Array.from(document.querySelectorAll('.react-flow__node')).map(n=>[n.dataset.id,n.style.transform])),
      card:node.querySelector('.job'),viewportChanges:0,remounts:0};
    window.dragObserver=new MutationObserver(records=>{for(const record of records){
      if(record.target.classList?.contains('react-flow__viewport')&&record.attributeName==='style')window.dragProbe.viewportChanges++;
      for(const removed of record.removedNodes)if(removed.nodeType===1&&(removed.matches('.job,.react-flow__node')||removed.querySelector('.job')))window.dragProbe.remounts++;
    }});
    window.dragObserver.observe(document.querySelector('.react-flow'),{subtree:true,childList:true,attributes:true,attributeFilter:['style']});
    return {x:r.left+r.width/2,y:r.top+30};
  })()`);
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", ...dragStart });
  await call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...dragStart,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  for (let step = 1; step <= 20; step++) {
    await call("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: dragStart.x + step * 2,
      y: dragStart.y + step,
      button: "left",
      buttons: 1,
    });
    await delay(25);
  }
  await call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: dragStart.x + 40,
    y: dragStart.y + 20,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  await delay(400);
  const dragResult = await evaluate(`(()=>{
    window.dragObserver.disconnect();
    const p=window.dragProbe;
    return {viewportChanges:p.viewportChanges,remounts:p.remounts,
      moved:document.querySelector('.react-flow__node[data-id="test-web"]').style.transform!==p.nodes.get('test-web'),
      sameCard:document.querySelector('.react-flow__node[data-id="test-web"] .job')===p.card,
      stableOthers:Array.from(document.querySelectorAll('.react-flow__node')).filter(n=>n.dataset.id!=='test-web').every(n=>n.style.transform===p.nodes.get(n.dataset.id))};
  })()`);
  assert.equal(
    dragResult.viewportChanges,
    0,
    "Dragging must not restart Fit View",
  );
  assert.equal(dragResult.remounts, 0, "Dragging must not remount nodes");
  assert(
    dragResult.moved && dragResult.sameCard && dragResult.stableOthers,
    JSON.stringify(dragResult),
  );
  console.log(
    "Drag regression passed: stable viewport, no node remounts, other nodes retain positions.",
  );
  await button("Reset layout");
  await button("Fit View");
  await checkLocalInheritance();
  await mkdir("docs/screenshots", { recursive: true });
  const shot = await call("Page.captureScreenshot", { format: "png" });
  await writeFile(
    "docs/screenshots/stages-dark.png",
    Buffer.from(shot.data, "base64"),
  );
  console.log(
    "JCEF smoke passed: 5 jobs, 4 edges, stage columns, Fit View bounds, search/Escape, DAG/Stages, details, upstream focus.",
  );
  console.log(
    "Saved actual embedded-browser screenshot: docs/screenshots/stages-dark.png",
  );
} finally {
  socket.close();
}
