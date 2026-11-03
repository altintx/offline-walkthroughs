import { guidePageViews } from "./core.cjs";
export function gameFAQsSearchURL(query: string) {
  const term = query.trim();
  if (!term) throw Error("Enter a game title to search GameFAQs");
  const url = new URL("https://gamefaqs.gamespot.com/search");
  url.searchParams.set("game", term);
  return url.href;
}
export function isGameFAQsURL(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      /^(?:www\.)?gamefaqs\.(?:gamespot\.com|com)$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}
export function isGameFAQsGuide(value: string) {
  return (
    isGameFAQsURL(value) && /\/faqs\/\d+(?:\/|$)/.test(new URL(value).pathname)
  );
}
export type BrowserPage = { url: string; html: string };
// This script runs only in the browsing WebView, never in the offline reader.
const snapshotScript = String.raw`
 // Keep browser navigation aligned with the native importer. Use source text
 // here: Hermes bytecode functions cannot be injected through toString().
 var normalizeGuidePage=function(candidate,base){
  var next=new URL(candidate,base),root=new URL(base),views=${JSON.stringify(guidePageViews)};
  for(var i=0;i<views.length;i++)if(next.searchParams.get(views[i])!==root.searchParams.get(views[i]))return;
  if(views.some(function(view){return root.searchParams.has(view)}) && next.searchParams.get('page')!==root.searchParams.get('page'))return;
  next.hash='';if(next.searchParams.get('page')==='0')next.searchParams.delete('page');return next.href;
 };
 function snapshotGuide(doc, pageURL) {
  var root=doc.querySelector('#faqtext, .faqtext');
  var guideHTML=root && root.textContent.trim() ? root.outerHTML : '';
  if(!guideHTML){
   var sections=Array.prototype.slice.call(doc.querySelectorAll('[id^="faqspan-"]'));
   sections=sections.filter(function(section){return section.textContent.trim() && !sections.some(function(parent){return parent!==section && parent.contains(section)})});
   if(sections.length)guideHTML='<article class="faqtext">'+sections.map(function(section){return section.outerHTML}).join('')+'</article>';
  }
  if(!guideHTML){
   // Formatted chapters may have a different title from the page banner,
   // and appendices may use lists or tables rather than paragraphs.
   var headings=Array.prototype.slice.call(doc.querySelectorAll('h1, h2, h3, h4, h5, h6'));
   var bestScore=0;
   for(var h=0;h<headings.length;h++){
    if(headings[h].closest('header, footer, nav, aside, form'))continue;
    var candidate=headings[h].parentElement;
    while(candidate && !/^(BODY|HTML|MAIN)$/.test(candidate.tagName)){
     if(!candidate.querySelector('header, footer, nav, form')){
      var prose=Array.prototype.slice.call(candidate.querySelectorAll('p, li, td, th')).map(function(p){return p.textContent}).join(' ');
      var linkText=Array.prototype.slice.call(candidate.querySelectorAll('a')).map(function(a){return a.textContent}).join(' ');
      var score=prose.trim().length;
      if(score>=80 && score-linkText.length>=40 && score>bestScore){
       bestScore=score;guideHTML='<article class="faqtext">'+candidate.outerHTML+'</article>';
      }
     }
     candidate=candidate.parentElement;
    }
   }
  }
  if(!guideHTML){
   if(/just a moment|verify you are human|checking your browser/i.test(doc.title || ''))throw Error('Finish the browser check on this page before importing.');
   throw Error('This page has no recognized guide content. Open a guide section, or report this guide URL so its HTML layout can be supported.');
  }
  var title=doc.createElement('title');title.textContent=doc.title;
  var base=new URL(pageURL),faq=base.pathname.match(/^(.*\/faqs\/\d+)(?:\/|$)/),links=[];
  if(!faq) throw Error('Open a GameFAQs guide before importing.');
  var anchors=doc.querySelectorAll('a[href]');
  for(var i=0;i<anchors.length;i++){
   try {var normalized=normalizeGuidePage(anchors[i].getAttribute('href'),pageURL);if(!normalized)continue;var next=new URL(normalized);
    if(next.origin!==base.origin || !(next.pathname===faq[1] || next.pathname.indexOf(faq[1]+'/')===0))continue;
    var a=doc.createElement('a');a.href=next.href;a.textContent=anchors[i].textContent;links.push(a.outerHTML);
   } catch(e){}
  }
  return {url:pageURL,html:title.outerHTML+guideHTML+'<nav>'+links.join('')+'</nav>'};
 }
`;
export function guideBrowserScript(requestId: string, pageURL?: string) {
  return `(function(){
 const requestId=${JSON.stringify(requestId)};
 const reply=function(result){window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({type:'strattome-guide-page',requestId:requestId},result)))};
 ${snapshotScript}
 ${
   pageURL === undefined
     ? `try {reply(snapshotGuide(document,location.href))}catch(e){reply({error:String(e.message||e)})}`
     : `
 (async function(){try {
  var target=new URL(${JSON.stringify(pageURL)});
  if(target.origin!==location.origin)throw Error('Linked sections must stay on the same site.');
  var response=await fetch(target.href,{credentials:'same-origin'});
  if(!response.ok)throw Error('HTTP '+response.status);
  var doc=new DOMParser().parseFromString(await response.text(),'text/html');
  reply(snapshotGuide(doc,response.url||target.href));
 }catch(e){reply({error:String(e.message||e)})}})();`
 }
})();true;`;
}
