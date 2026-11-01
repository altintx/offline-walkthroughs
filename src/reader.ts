import { Guide, Anchor } from "./storage";
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function readerHTML(
  g: Guide,
  anchor: Anchor,
  font: number,
  colors: { surface: string; text: string },
  match?: Anchor & { length: number },
  fontUri?: string,
) {
  const content = g.files
    .map((f) =>
      f.blocks
        .map((b) => {
          const attrs = `data-file="${escape(f.id)}" id="${escape(b.id)}"`;
          if (b.kind === "image") {
            const asset = g.assets.find((a) => a.source === b.text);
            return asset
              ? `<img ${attrs} src="${escape(asset.uri)}" alt="${escape((b as any).alt || "Guide image")}" onclick="send({type:'image',uri:this.src})">`
              : `<p ${attrs}>[Missing image: ${escape((b as any).alt || b.text)}]</p>`;
          }
          let text = escape(b.text);
          if (match?.blockId === b.id)
            text =
              escape(b.text.slice(0, match.offset)) +
              "<mark>" +
              escape(b.text.slice(match.offset, match.offset + match.length)) +
              "</mark>" +
              escape(b.text.slice(match.offset + match.length));
          if (b.kind === "pre") {
            return `<figure style="margin:0 0 1em"><button class="open-fixed" onclick="send({type:'fixed',blockId:'${escape(b.id)}'})">Open full diagram / fixed-width text</button><pre ${attrs}>${text}</pre></figure>`;
          }
          const tag =
            b.kind === "pre" ? "pre" : b.kind === "heading" ? "h2" : "p";
          return `<${tag} ${attrs}${b.kind === "list" ? " data-list" : ""}${b.kind === "pre" ? ` onclick="send({type:'fixed',blockId:this.id})"` : ""}>${text}</${tag}>`;
        })
        .join(""),
    )
    .join("");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data:; font-src file: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>
 ${fontUri ? `@font-face{font-family:Manual;src:url('${escape(fontUri)}')}` : ""}
 *{box-sizing:border-box}html{overflow:hidden;height:100%;touch-action:none}body{width:100vw;height:100%;margin:0;background:${colors.surface};color:${colors.text};font:${font}px ${fontUri ? "Manual," : ""}monospace;line-height:1.55}
 #viewport{position:fixed;inset:16px;overflow:hidden;contain:paint}#book{width:100%;height:100%;margin:0;column-count:1;column-gap:32px;column-fill:auto}
 p,h2,pre{margin:0 0 1em;white-space:normal;overflow-wrap:anywhere}h2{font-size:1.2em}p[data-list]{white-space:pre-wrap}
 pre{white-space:pre;overflow:hidden;width:100%;max-width:100%;font-size:.85em;max-height:calc(100vh - 160px);break-inside:avoid;border:0;padding:6px;}
 .open-fixed{display:block;width:100%;padding:10px;border:1px solid currentColor;background:transparent;color:inherit;font:inherit;white-space:normal}figure{break-inside:avoid}img{display:block;max-width:100%;max-height:calc(100vh - 64px);object-fit:contain;break-inside:avoid}mark{background:#e6c04b;color:#211735}
 </style></head><body><div id="viewport"><main id="book">${content}</main></div><script>
 let page=0, renderedOffset=0;let lastAnchor=${JSON.stringify(anchor)};
 const viewport=()=>document.getElementById('viewport').getBoundingClientRect();
 const width=()=>document.getElementById('book').getBoundingClientRect().width+32;
 const contentOffset=()=>renderedOffset;
 const pageCount=()=>Math.max(1,Math.round((document.getElementById('book').scrollWidth+32)/width()));
 function applyPage(){renderedOffset=page*width();document.getElementById('book').style.transform='translateX(-'+renderedOffset+'px)'}
 const send=o=>window.ReactNativeWebView.postMessage(JSON.stringify(o));
 function rangeAt(el,offset){const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){if(offset<n.length){const r=document.createRange();r.setStart(n,offset);r.setEnd(n,offset+1);return r}offset-=n.length}return null}
 function locationAt(el,offset){const r=rangeAt(el,offset);return r?r.getBoundingClientRect():el.getBoundingClientRect()}
 function restore(a){const el=document.getElementById(a.blockId);if(!el)return;const x=locationAt(el,a.offset).left+contentOffset();page=Math.max(0,Math.floor((x-viewport().left)/width()));applyPage();lastAnchor=a;send({type:'position',...a,page:page+1,pages:pageCount()})}
 function report(){
  for(const el of document.querySelectorAll('[data-file]')){
   if(!Array.from(el.getClientRects()).some(r=>r.right>viewport().left&&r.left<viewport().right))continue;
   let low=0,high=el.textContent.length;
   if(el.tagName!=='PRE')while(low<high){const mid=Math.floor((low+high)/2),r=locationAt(el,mid);if(r.left<viewport().left)low=mid+1;else high=mid;}
   lastAnchor={fileId:el.dataset.file,blockId:el.id,offset:low};
   send({type:'position',...lastAnchor,page:page+1,pages:pageCount()});return;
  }
 }
 function command(c){
  if(c.type==='turn'){const max=Math.max(0,pageCount()-1);const next=Math.max(0,Math.min(max,page+c.direction));if(next===page)send({type:'boundary',message:page===0?'First page':'Last page'});page=next;applyPage();report()}
  if(c.type==='anchor')restore(c.anchor);
 }
 const handled=new WeakSet();let lastCommandId=0;
 function receive(e){if(handled.has(e))return;handled.add(e);try{const c=JSON.parse(e.data);if(c.commandId){if(c.commandId<=lastCommandId)return;lastCommandId=c.commandId}command(c)}catch{}}
 window.addEventListener('message',receive);
 document.addEventListener('message',receive);
 window.addEventListener('resize',()=>requestAnimationFrame(()=>restore(lastAnchor)));
 window.onload=()=>{restore(${JSON.stringify(anchor)});document.fonts.ready.then(()=>restore(lastAnchor))};
 let gesture=null, suppressClickUntil=0;
 const interactive=target=>target?.closest?.('button,a,img');
 function edgeTurn(x){if(x<innerWidth*.2){command({type:'turn',direction:-1});return true}if(x>innerWidth*.8){command({type:'turn',direction:1});return true}return false}
 document.addEventListener('touchstart',e=>{if(e.touches?.length>1){gesture=null;return}const t=e.changedTouches[0];gesture={x:t.clientX,y:t.clientY,moved:0,time:Date.now(),target:e.target}},{passive:true});
 document.addEventListener('touchmove',e=>{if(gesture){const t=e.changedTouches[0];gesture.moved=Math.max(gesture.moved,Math.abs(t.clientX-gesture.x),Math.abs(t.clientY-gesture.y))}e.preventDefault()},{passive:false});
 document.addEventListener('touchend',e=>{if(!gesture)return;const g=gesture;gesture=null;const t=e.changedTouches[0],dx=t.clientX-g.x,dy=t.clientY-g.y;
  if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)){command({type:'turn',direction:dx<0?1:-1});suppressClickUntil=Date.now()+500;e.preventDefault();return}
  if(g.moved>12||Math.abs(dx)>12||Math.abs(dy)>12||Date.now()-g.time>=450){suppressClickUntil=Date.now()+500;return}
  if(g.moved<=12&&Math.abs(dx)<=12&&Math.abs(dy)<=12&&Date.now()-g.time<450&&!interactive(g.target)&&edgeTurn(t.clientX)){suppressClickUntil=Date.now()+500;e.preventDefault()}
 },{passive:false});
 document.addEventListener('touchcancel',()=>gesture=null);
 document.addEventListener('click',e=>{if(Date.now()<suppressClickUntil){e.preventDefault();e.stopPropagation();return}if(!interactive(e.target)&&edgeTurn(e.clientX)){e.preventDefault()}},true);
 </script></body></html>`;
}
