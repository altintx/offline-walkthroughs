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
          const tag =
            b.kind === "pre" ? "pre" : b.kind === "heading" ? "h2" : "p";
          return `<${tag} ${attrs}${b.kind === "pre" ? ` onclick="send({type:'fixed',blockId:this.id})"` : ""}>${text}</${tag}>`;
        })
        .join(""),
    )
    .join("");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data:; font-src file: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>
 ${fontUri ? `@font-face{font-family:Manual;src:url('${escape(fontUri)}')}` : ""}
 *{box-sizing:border-box}html{overflow:hidden}body{margin:0;background:${colors.surface};color:${colors.text};font:${font}px ${fontUri ? "Manual," : ""}monospace;line-height:1.55}
 #book{height:calc(100vh - 32px);margin:16px;column-width:calc(100vw - 32px);column-gap:32px;column-fill:auto}
 p,h2,pre{margin:0 0 1em;white-space:pre-wrap;overflow-wrap:break-word}h2{font-size:1.2em}
 pre{white-space:pre;overflow:auto;font-size:.85em;max-height:calc(100vh - 64px);break-inside:avoid;border:1px inset #888;padding:6px}
 img{display:block;max-width:100%;max-height:calc(100vh - 64px);object-fit:contain;break-inside:avoid}mark{background:#e6c04b;color:#211735}
 </style></head><body><main id="book">${content}</main><script>
 let page=0;let lastAnchor=${JSON.stringify(anchor)};
 const width=()=>innerWidth;
 const send=o=>window.ReactNativeWebView.postMessage(JSON.stringify(o));
 function rangeAt(el,offset){const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){if(offset<n.length){const r=document.createRange();r.setStart(n,offset);r.setEnd(n,offset+1);return r}offset-=n.length}return null}
 function locationAt(el,offset){const r=rangeAt(el,offset);return r?r.getBoundingClientRect():el.getBoundingClientRect()}
 function restore(a){const el=document.getElementById(a.blockId);if(!el)return;const x=locationAt(el,a.offset).left+scrollX;page=Math.max(0,Math.floor(x/width()));scrollTo(page*width(),0);lastAnchor=a;send({type:'position',...a,page:page+1,pages:Math.ceil(document.documentElement.scrollWidth/width())})}
 function report(){
  for(const el of document.querySelectorAll('[data-file]')){
   if(!Array.from(el.getClientRects()).some(r=>r.right>0&&r.left<width()))continue;
   let low=0,high=el.textContent.length;
   if(el.tagName!=='PRE')while(low<high){const mid=Math.floor((low+high)/2),r=locationAt(el,mid);if(r.left<0)low=mid+1;else high=mid;}
   lastAnchor={fileId:el.dataset.file,blockId:el.id,offset:low};
   send({type:'position',...lastAnchor,page:page+1,pages:Math.ceil(document.documentElement.scrollWidth/width())});return;
  }
 }
 function command(c){
  if(c.type==='turn'){const max=Math.max(0,Math.ceil(document.documentElement.scrollWidth/width())-1);const next=Math.max(0,Math.min(max,page+c.direction));if(next===page)send({type:'boundary',message:page===0?'First page':'Last page'});page=next;scrollTo(page*width(),0);report()}
  if(c.type==='anchor')restore(c.anchor);
 }
 window.addEventListener('message',e=>{try{command(JSON.parse(e.data))}catch{}});
 document.addEventListener('message',e=>{try{command(JSON.parse(e.data))}catch{}});
 window.addEventListener('resize',()=>requestAnimationFrame(()=>restore(lastAnchor)));
 window.onload=()=>restore(${JSON.stringify(anchor)});
 let start=0;document.addEventListener('touchstart',e=>start=e.changedTouches[0].clientX);document.addEventListener('touchend',e=>{const d=e.changedTouches[0].clientX-start;if(Math.abs(d)>65)command({type:'turn',direction:d<0?1:-1})});
 </script></body></html>`;
}
