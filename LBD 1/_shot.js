const puppeteer=require("/Users/karan/StorylineSample/story/node_modules/puppeteer-core");const path=require("path");const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function fresh(){const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new",args:["--no-sandbox","--allow-file-access-from-files","--autoplay-policy=no-user-gesture-required"]});const p=await b.newPage();await p.setViewport({width:1280,height:720,deviceScaleFactor:2});p.on("pageerror",e=>console.log("PAGEERR:",e.message));await p.goto("file://"+path.resolve(__dirname,"index.html"),{waitUntil:"networkidle0"});await wait(500);return{b,p};}
(async()=>{
  let {b,p}=await fresh();
  const info=await p.evaluate(()=>{var i=0;for(var k=0;k<window.FLOW.length;k++){if(window.FLOW[k].scene==="whole"){i=k;break;}}window.state.round=4;window.state.step=i;window.renderStep();
    var r=window.ROUNDS[4]; return {name:r.name, blockSrc:r.blockSrc, color:r.blockColor};});
  console.log("round4:", JSON.stringify(info));
  await wait(1300);
  const blk=await p.evaluate(()=>{var el=document.querySelector(".whole-block");if(!el)return"none";var cs=getComputedStyle(el);return {br:cs.borderRadius, cls:el.className, tag:el.tagName, bg:cs.backgroundColor.slice(0,20)};});
  console.log("whole-block:", JSON.stringify(blk));
  await p.screenshot({path:path.resolve(__dirname,"_circ_whole.png")}); await b.close();
  ({b,p}=await fresh());
  await p.evaluate(()=>window.__debugRenderFit(4)); await wait(700);
  await p.screenshot({path:path.resolve(__dirname,"_circ_fit.png")}); await b.close();
  console.log("done");
})().catch(e=>{console.error(e);process.exit(1);});
