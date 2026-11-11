const {test}=require('node:test');
const assert=require('node:assert/strict');
const c=require('../src/core.cjs');
const guide=()=>c.makeGuide('Manual',[{id:'one',name:'First',text:'INTRODUCTION\n\nHello brave\nworld.\n\n  +---+\n  | X |\n  +---+'},{id:'two',name:'Second',text:'CHAPTER TWO\n\nHello hello.'}]);
test('reflows prose and preserves aligned artwork',()=>{const g=guide();assert.ok(g.files[0].blocks.some(b=>b.text==='Hello brave world.'));assert.ok(g.files[0].blocks.some(b=>b.kind==='pre'&&b.text.includes('  | X |')));});
test('always constructs TOC and stable anchors',()=>{const a=guide(),b=guide();assert.ok(a.toc.length>=2);assert.deepEqual(a.files,b.files);assert.equal(c.resolveAnchor(a,{fileId:'one',blockId:a.files[0].blocks[1].id,offset:6}).offset,6);assert.ok(c.makeGuide('Plain',[{id:'x',name:'x',text:'plain prose'}]).toc.length);});
test('literal case insensitive search across files and repetitions',()=>{const g=guide(),r=c.search(g,'HELLO');assert.equal(r.length,3);assert.equal(r[1].fileId,'two');assert.equal(r[2].offset,6);assert.equal(c.search(g,'[').length,0);assert.equal(c.search(g,'').length,0);assert.equal(c.stepMatch(r,0,-1).message,'First result');assert.equal(c.stepMatch(r,2,1).message,'Last result');assert.equal(c.stepMatch(r,0,1).index,1);assert.equal(c.resolveAnchor(g,r[2]).offset,6);});
test('color preference defaults and overrides',()=>{assert.equal(c.colorMode('system',null),'dark');assert.equal(c.colorMode('system','light'),'light');assert.equal(c.colorMode('dark','light'),'dark');});
test('pagination covers every character and restores passage',()=>{const text='hello '.repeat(100);for(const size of [19,73]){const pages=c.pageRanges(text.length,size);assert.equal(pages.map(p=>text.slice(p.start,p.end)).join(''),text);const p=c.pageForOffset(pages,217);assert.ok(p.start<=217&&p.end>217);}});
test('sanitizes active HTML and retains text/images',()=>{const s=c.extractHTML('<h1>Guide</h1><script>bad()</script><p>Hello &amp; welcome</p><img src="https://example.org/a.png" onerror="bad()">');assert.ok(s.text.includes('Hello & welcome'));assert.ok(!s.text.includes('bad()'));assert.deepEqual(s.images,['https://example.org/a.png']);});
test('guide links cannot escape selected guide',()=>{assert.equal(c.belongsToGuide('https://gamefaqs.gamespot.com/pc/123-game/faqs/456?page=2','https://gamefaqs.gamespot.com/pc/123-game/faqs/456'),true);assert.equal(c.belongsToGuide('https://evil.org/pc/123-game/faqs/456','https://gamefaqs.gamespot.com/pc/123-game/faqs/456'),false);assert.equal(c.belongsToGuide('https://gamefaqs.gamespot.com/pc/123-game/faqs/999','https://gamefaqs.gamespot.com/pc/123-game/faqs/456'),false);});
test('incomplete imports require explicit acceptance',()=>{assert.throws(()=>c.validateImport({files:[],missing:['blocked']}));assert.throws(()=>c.validateImport({files:[{}],missing:['blocked']}));assert.equal(c.validateImport({files:[{}],missing:['blocked']},true),true);});
test('indented FAQ prose reflows without turning into a diagram',()=>{const blocks=c.plainBlocks('    The Minish Cap is a portable Zelda game.\n    This paragraph should fit the reader width.\n\n  +---+\n  | X |\n  +---+\n\nName    Cost\nSword    100');assert.equal(blocks[0].kind,'paragraph');assert.equal(blocks[0].text,'The Minish Cap is a portable Zelda game. This paragraph should fit the reader width.');assert.equal(blocks[1].kind,'pre');assert.equal(blocks[2].kind,'pre');});
test('numbered decorative banners create TOC sections and subsections without capturing the contents list',()=>{
 const text="TABLE OF CONTENTS\n\n1. Version History\n2. Game Overview\n  2.01. Story\n3. Walkthrough\n\n====================\n--------------------\n 1. VERSION HISTORY\n--------------------\n====================\n\nEarlier versions are described here.\n\n====================\n 2. GAME OVERVIEW\n====================\n\nOverview prose.\n=-=-=-=-=-=-=-=-=-=-\n 2.01. Story\n=-=-=-=-=-=-=-=-=-=-\nStory prose continues here.\n\n====================\n 3. WALKTHROUGH\n====================\n\nFollow the path.";
 const g=c.makeGuide('Numbered guide',[{id:'one',name:'Guide',text}]);
 const entries=g.toc.filter(t=>/^\d/.test(t.title));
 assert.deepEqual(entries.map(t=>[t.title,t.level]),[['1. VERSION HISTORY',1],['2. GAME OVERVIEW',1],['2.01. Story',2],['3. WALKTHROUGH',1]]);
 for(const entry of entries) assert.equal(g.files[0].blocks.find(b=>b.id===entry.blockId).kind,'heading');
 assert.ok(g.files[0].blocks.some(b=>b.text.includes('Story prose continues here.')));
});
test('decimal-colon wrapped FAQ banners preserve all main sections, subsections and fractional labels',()=>{
 const text=require('node:fs').readFileSync('tests/guide-fixtures/supermetroid-heading-style.txt','utf8');
 const g=c.makeGuide('Wrapped FAQ',[{id:'one',name:'Guide',text}]);
 const entries=g.toc.filter(t=>/^\d/.test(t.title));
 assert.equal(entries.length,28);assert.equal(entries.filter(t=>t.level===1).length,10);assert.equal(entries.filter(t=>t.level===2).length,18);
 const ending=entries.findIndex(t=>t.title==='4.9 1/2: Ending.');assert.ok(ending>0);assert.match(entries[ending-1].title,/^4\.9:/);assert.match(entries[ending+1].title,/^5\.0:/);
 assert.ok(entries.some(t=>t.title==='5.0: Frequently asked questions. (FAQ.)' && t.level===1));
 for(const entry of entries){const b=g.files[0].blocks.find(b=>b.id===entry.blockId);assert.equal(b.kind,'heading');assert.equal(b.text,entry.title);assert.ok(g.files[0].blocks[g.files[0].blocks.indexOf(b)+1].text.startsWith('This is the body'));}
 assert.ok(g.files[0].blocks.some(b=>b.kind==='pre'&&b.text.includes('| X |')));
 assert.ok(g.files[0].blocks.some(b=>b.kind==='paragraph'&&b.text.includes('A reference to {<>}4.2:')));
 assert.equal(c.search(g,'Follow the marked path').length,28);
 assert.deepEqual(c.makeGuide('Wrapped FAQ',[{id:'one',name:'Guide',text}]).toc,g.toc);
});
test('ASCII-framed spaced-letter headings use compact contents titles and retain walkthrough subsections',()=>{
 const text=require('node:fs').readFileSync('tests/guide-fixtures/oracle-heading-style.txt','utf8');
 const g=c.makeGuide('Framed guide',[{id:'one',name:'Guide',text}]);
 const entries=g.toc.filter(t=>t.level>0),main=entries.filter(t=>t.level===1),sub=entries.filter(t=>t.level===2);
 assert.equal(main.length,16);assert.equal(sub.length,7);
 assert.equal(main[0].title,'1) PRELUDE');assert.equal(main[3].title,'4) FAQs');assert.equal(main[12].title,'13) LINK SYSTEM');assert.equal(main[15].title,'16) THANKS TO');
 assert.deepEqual(entries.filter(t=>t.title.startsWith('i)')).map(t=>t.title),['i) Tools','i) Passwords (Secrets)']);
 assert.ok(sub.some(t=>t.title==='Prologue'));assert.ok(sub.some(t=>t.title==='Level 1 - Example Dungeon'));
 for(const entry of entries){const b=g.files[0].blocks.find(b=>b.id===entry.blockId);assert.equal(b.kind,'heading');assert.equal(b.text,entry.title);assert.ok(g.files[0].blocks[g.files[0].blocks.indexOf(b)+1].text.startsWith('This is'));}
 assert.ok(g.files[0].blocks.some(b=>b.kind==='pre'&&b.text.includes('| Y |')));
 assert.ok(g.files[0].blocks.some(b=>b.text.includes('Is this an ordinary question?')));
 assert.equal(c.search(g,'directions carefully').length,16);
 assert.deepEqual(c.makeGuide('Framed guide',[{id:'one',name:'Guide',text}]).toc,g.toc);
});
test('bracket-code ASCII-side banners create nested destinations and distinguish console walkthroughs',()=>{
 const text=require('node:fs').readFileSync('tests/guide-fixtures/twilight-heading-style.txt','utf8');
 const g=c.makeGuide('Indexed guide',[{id:'one',name:'Guide',text}]),entries=g.toc.filter(t=>t.level>0);
 assert.equal(entries.filter(t=>t.level===1).length,12);assert.equal(entries.filter(t=>t.level===2).length,6);
 assert.ok(entries.some(t=>t.title==='Gamecube Walkthrough — Example route'));assert.ok(entries.some(t=>t.title==='Wii Walkthrough — Example route'));assert.ok(entries.some(t=>t.title==='Example inventory'));assert.ok(entries.some(t=>t.title==='Example final notes and acknowledgments'));assert.ok(!entries.some(t=>t.title.startsWith('Example final notes —')));
 assert.equal(g.files[0].anchors.length,18);assert.equal(new Set(g.files[0].anchors.map(a=>a.sourceId)).size,18);
 for(const a of g.files[0].anchors){const b=g.files[0].blocks.find(b=>b.id===a.blockId);assert.equal(b.kind,'heading');assert.ok(g.files[0].blocks[g.files[0].blocks.indexOf(b)+1].text.startsWith('This is the body'));}
 assert.ok(g.files[0].blocks.some(b=>b.text.includes('See [0301]')));assert.ok(g.files[0].blocks.some(b=>b.kind==='pre'&&b.text.includes('| Y |')));
 assert.equal(c.search(g,'This is the body').length,18);
 assert.deepEqual(c.makeGuide('Indexed guide',[{id:'one',name:'Guide',text}]).toc,g.toc);
});
test('tabular find codes resolve lettered and unnumbered headings without duplicating the source contents',()=>{
 const text=require('node:fs').readFileSync('tests/guide-fixtures/superstar-heading-style.txt','utf8');const g=c.makeGuide('Find code guide',[{id:'one',name:'Guide',text}]),entries=g.toc.filter(t=>t.level>0);
 assert.equal(entries.length,44);assert.equal(entries.filter(t=>t.level===1).length,13);assert.equal(entries.filter(t=>t.level===2).length,31);assert.ok(entries.some(t=>t.title==='1ba. Beanstar Piece III'));assert.ok(entries.some(t=>t.title==='8. Beans'));assert.ok(entries.some(t=>t.title==='Contact Details'));
 assert.equal(g.files[0].anchors.length,43);for(const a of g.files[0].anchors){const index=g.files[0].blocks.findIndex(b=>b.id===a.blockId);assert.equal(g.files[0].blocks[index].kind,'heading');assert.ok(g.files[0].blocks[index+1].text.startsWith('This is the body'));}
 assert.equal(c.search(g,'Follow the route carefully').length,43);assert.ok(g.files[0].blocks.some(b=>b.kind==='pre'&&b.text.includes('| Y |')));
});
test('guide pagination keeps one view, normalizes page zero, and permits an explicitly selected single-page view',()=>{
 const root='https://gamefaqs.gamespot.com/snes/123-game/faqs/456';
 assert.equal(c.guidePageURL('?page=0#intro',root),root);assert.equal(c.guidePageURL('?single=1',root),undefined);assert.equal(c.guidePageURL('?print=1',root),undefined);assert.equal(c.guidePageURL('?page=7#ending',root),root+'?page=7');
 assert.equal(c.guidePageURL('#intro',root+'?single=1'),root+'?single=1');assert.equal(c.guidePageURL('?page=1',root+'?single=1'),undefined);
 assert.equal(c.guidePageURL('?single=1','https://example.org/guide'),'https://example.org/guide?single=1');
});
test('numbered contents resolve differently numbered body parts, disc headings and missing heading whitespace',()=>{
 const text=require('node:fs').readFileSync('tests/guide-fixtures/mgs-heading-style.txt','utf8');const g=c.makeGuide('Numbered parts',[{id:'one',name:'Guide',text}]),entries=g.toc.filter(t=>t.level>0);
 assert.equal(entries.length,31);assert.equal(entries.filter(t=>t.level===2).length,17);assert.deepEqual(entries.map(t=>Number(t.title.match(/^\d+/)[0])),Array.from({length:31},(_,i)=>i+1));assert.ok(entries.some(t=>t.title==='7. Walkthrough - Disc 1'));assert.ok(entries.some(t=>t.title==='18. Comms Tower A & B'));assert.ok(entries.some(t=>t.title==='19. Snow Field'));
 for(let n=1;n<=31;n++){const b=g.files[0].blocks.find(b=>b.id===entries[n-1].blockId),i=g.files[0].blocks.indexOf(b);assert.equal(b.kind,'heading');assert.ok(g.files[0].blocks[i+1].text.startsWith('Body for contents entry '+n+'.'));}
 assert.equal(c.search(g,'Keep this paragraph available').length,31);assert.ok(g.files[0].blocks.some(b=>b.text.includes('Part 99 -')));
});
