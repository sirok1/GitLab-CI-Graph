// Optional integration check against the actual browser embedded in runIde, never a standalone UI.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
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
try {
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
