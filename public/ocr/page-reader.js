// Shared with Qalam office Arabic OCR layout and deskew.
function allWords(d){if(!d)return [];if(d.words&&d.words.length)return d.words;var out=[];(d.blocks||[]).forEach(function(B){(B.paragraphs||[]).forEach(function(P){(P.lines||[]).forEach(function(L){(L.words||[]).forEach(function(W){out.push(W);});});});});return out;}
  function gray(c){var g=c.getContext('2d',{willReadFrequently:true}),d=g.getImageData(0,0,c.width,c.height),p=d.data,n=c.width*c.height,a=new Float32Array(n);for(var i=0;i<n;i++)a[i]=(p[4*i]*299+p[4*i+1]*587+p[4*i+2]*114)/1000;return a;}
  function put(c,a){var g=c.getContext('2d',{willReadFrequently:true}),d=g.createImageData(c.width,c.height),p=d.data;for(var i=0;i<a.length;i++){var v=a[i]<0?0:a[i]>255?255:a[i];p[4*i]=p[4*i+1]=p[4*i+2]=v;p[4*i+3]=255;}g.putImageData(d,0,0);return c;}
  function stretch(a){var hist=new Uint32Array(256),n=a.length,i,lo,hi,acc=0;for(i=0;i<n;i++)hist[a[i]<0?0:a[i]>255?255:a[i]|0]++;for(lo=0;lo<254&&(acc+=hist[lo])<n*0.005;lo++);acc=0;for(hi=255;hi>1&&(acc+=hist[hi])<n*0.02;hi--);if(hi-lo<24){lo=0;hi=255;}var k=255/(hi-lo);for(i=0;i<n;i++)a[i]=(a[i]-lo)*k;return a;}
  function flat(c,a){var w=c.width,h=c.height,k=Math.max(1,Math.round(Math.max(w,h)/64)),sw=Math.max(1,Math.round(w/k)),sh=Math.max(1,Math.round(h/k));
    var t=document.createElement('canvas');t.width=w;t.height=h;put(t,a);var s=document.createElement('canvas');s.width=sw;s.height=sh;var sg=s.getContext('2d',{willReadFrequently:true});sg.imageSmoothingQuality='high';sg.drawImage(t,0,0,sw,sh);t.width=t.height=0;
    var sd=sg.getImageData(0,0,sw,sh),sp=sd.data,m=new Float32Array(sw*sh),x,y,dx,dy;
    for(y=0;y<sh;y++)for(x=0;x<sw;x++){var mx=0;for(dy=-2;dy<=2;dy++)for(dx=-2;dx<=2;dx++){var yy=Math.min(sh-1,Math.max(0,y+dy)),xx=Math.min(sw-1,Math.max(0,x+dx)),v=sp[4*(yy*sw+xx)];if(v>mx)mx=v;}m[y*sw+x]=mx;}
    for(var i=0;i<sw*sh;i++)sp[4*i]=sp[4*i+1]=sp[4*i+2]=m[i];sg.putImageData(sd,0,0);
    var b=document.createElement('canvas');b.width=w;b.height=h;var bg=b.getContext('2d',{willReadFrequently:true});bg.imageSmoothingQuality='high';try{bg.filter='blur('+(k*1.5)+'px)';}catch(e){}bg.drawImage(s,0,0,w,h);var bd=bg.getImageData(0,0,w,h).data;
    for(var j=0;j<a.length;j++){a[j]=Math.min(255,a[j]*235/Math.max(bd[4*j]||1,40));}b.width=b.height=s.width=s.height=0;return a;}
  function skew(c,a){var w=c.width,h=c.height,sc=Math.min(1,900/w),sw=Math.round(w*sc),sh=Math.round(h*sc),pts=[];
    for(var y=0;y<sh;y++)for(var x=0;x<sw;x++){if(a[Math.min(h-1,Math.round(y/sc))*w+Math.min(w-1,Math.round(x/sc))]<110)pts.push(x,y);}
    if(pts.length<200)return 0;
    function sc2(ang){var t=Math.tan(ang*Math.PI/180),rows=new Float32Array(sh*2+10),i,s=0;for(i=0;i<pts.length;i+=2){var r=Math.round(pts[i+1]-pts[i]*t)+sh/2|0;if(r>=0&&r<rows.length)rows[r]++;}for(i=1;i<rows.length;i++){var d=rows[i]-rows[i-1];s+=d*d;}return s;}
    var best=0,bs=-1,ang;for(ang=-6;ang<=6.001;ang+=0.5){var s1=sc2(ang);if(s1>bs){bs=s1;best=ang;}}
    for(ang=best-0.5;ang<=best+0.5;ang+=0.1){var s2=sc2(ang);if(s2>bs){bs=s2;best=ang;}}return best;}
  function rotate(c,ang){if(Math.abs(ang)<0.15)return c;var r=ang*Math.PI/180,w=c.width,h=c.height,o=document.createElement('canvas');o.width=Math.ceil(w*Math.abs(Math.cos(r))+h*Math.abs(Math.sin(r)));o.height=Math.ceil(h*Math.abs(Math.cos(r))+w*Math.abs(Math.sin(r)));var g=o.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,o.width,o.height);g.imageSmoothingQuality='high';g.translate(o.width/2,o.height/2);g.rotate(-r);g.drawImage(c,-w/2,-h/2);return o;}
  function prep(c){try{var a=gray(c);a=flat(c,a);a=stretch(a);put(c,a);return rotate(c,skew(c,a));}catch(e){return c;}}
  /* ---------- the page put back in reading order ---------- */
  function arC(s){return (String(s).match(/[ء-ي]/g)||[]).length;}function laC(s){return (String(s).match(/[A-Za-zÀ-ÿ]/g)||[]).length;}
  function wtxt(W){if(W._del)return '';return String(W._new||W.text||'').replace(/[‎‏‪-‮]/g,'').trim();}
  function kind(t){return arC(t)?'R':laC(t)?'L':'N';}
  /* the words of a line in reading order from where they stand: from the right on an Arabic line, a run of Latin words (with the numbers between them) from the left */
  function orderTok(ts){if(!ts.length)return ts;var all=ts.map(function(x){return x.t;}).join(' '),rtl=arC(all)>laC(all),other=rtl?'L':'R',out=[],run=[];
    ts=ts.slice().sort(function(a,b){return rtl?b.x1-a.x1:a.x0-b.x0;});
    function flush(){var tail=[];while(run.length&&kind(run[run.length-1].t)==='N')tail.unshift(run.pop());if(run.length)out=out.concat(run.reverse());out=out.concat(tail);run=[];}
    ts.forEach(function(x){var k=kind(x.t);if(k===other||(k==='N'&&run.length))run.push(x);else{flush();out.push(x);}});flush();return out;}
  function bidiWords(ws){return orderTok(ws.map(function(W){return {t:wtxt(W),x0:W.bbox.x0,x1:W.bbox.x1};}).filter(function(x){return x.t;})).map(function(x){return x.t;}).join(' ');}
  /* pieces of a PDF line (a word may come in several pieces): a space only where the pieces stand apart */
  function joinTok(ts){var s='',pv=null;ts.forEach(function(x){if(pv){var gap=Math.max(pv.x0-x.x1,x.x0-pv.x1);if(gap>Math.min(pv.h,x.h)*0.18&&!/\s$/.test(s)&&!/^\s/.test(x.t))s+=' ';}s+=x.t;pv=x;});return s.replace(/\s+/g,' ').trim();}
  /* the lines cut where their words stand far apart (two columns read as one line, a signature line), the pieces gathered into blocks of lines that follow one another */
  function segBlocks(d,rows){var segs=[];
    (d.blocks||[]).forEach(function(B){(B.paragraphs||[]).forEach(function(P){(P.lines||[]).forEach(function(L){var ws=L.words||[],lh=Math.max(8,L.bbox.y1-L.bbox.y0);if(!ws.length)return;
      var parts=rows?[ws]:cutLine(L);
      parts.forEach(function(pw){if(!pw.length)return;var x0=1e9,x1=0,y0=1e9,y1=0;pw.forEach(function(W){x0=Math.min(x0,W.bbox.x0);x1=Math.max(x1,W.bbox.x1);y0=Math.min(y0,W.bbox.y0);y1=Math.max(y1,W.bbox.y1);});
        var t=bidiWords(pw);if(t)segs.push({x0:x0,x1:x1,y0:y0,y1:y1,t:t,par:P});});});});});
    return segs;}
  function cluster(segs){segs.sort(function(a,b){return a.y0-b.y0||b.x1-a.x1;});
    var hs=segs.map(function(s){return s.y1-s.y0;}).sort(function(a,b){return a-b;}),lh=hs.length?hs[hs.length>>1]:20,blocks=[];
    segs.forEach(function(s){var best=null,bd=1e9;blocks.forEach(function(b){var l=b.lines[b.lines.length-1],gap=s.y0-l.y1,ov=Math.min(l.x1,s.x1)-Math.max(l.x0,s.x0),wn=Math.min(l.x1-l.x0,s.x1-s.x0),wx=Math.max(l.x1-l.x0,s.x1-s.x0);
        if(gap>-lh*0.4&&gap<lh*0.9&&ov>wn*0.5&&wn>wx*0.4&&gap<bd){bd=gap;best=b;}});
      if(best){best.lines.push(s);best.x0=Math.min(best.x0,s.x0);best.x1=Math.max(best.x1,s.x1);best.y1=Math.max(best.y1,s.y1);}else blocks.push({x0:s.x0,x1:s.x1,y0:s.y0,y1:s.y1,lines:[s]});});
    return {blocks:blocks,lh:lh};}
  /* the order of the blocks: the page cut in strips where nothing crosses; strips that share a gutter at the same place make one region of columns,
     read column by column (from the right on an Arabic page), each column read the same way */
  function xyOrder(B,rtl,lh){if(B.length<=1)return B.slice();var g=lh*1.5;
    function free(list,a,b,lo,hi){var iv=list.map(function(x){return [x[a],x[b]];}).sort(function(p,q){return p[0]-q[0];}),out=[],end=lo;iv.forEach(function(v){if(v[0]>end)out.push([end,v[0]]);end=Math.max(end,v[1]);});return out.filter(function(v){return v[0]>lo&&v[1]<hi;});}
    var y0=Math.min.apply(null,B.map(function(b){return b.y0;})),y1=Math.max.apply(null,B.map(function(b){return b.y1;})),cuts=[y0-1].concat(free(B,'y0','y1',y0-1,y1+1).map(function(v){return (v[0]+v[1])/2;}),[y1+1]),strips=[];
    for(var i=0;i<cuts.length-1;i++){var it=B.filter(function(b){var m=(b.y0+b.y1)/2;return m>cuts[i]&&m<=cuts[i+1];});if(it.length)strips.push({it:it});}
    strips.forEach(function(st){var a=Math.min.apply(null,st.it.map(function(b){return b.x0;})),z=Math.max.apply(null,st.it.map(function(b){return b.x1;}));st.gut=free(st.it,'x0','x1',a,z).filter(function(v){return v[1]-v[0]>=g;});});
    var regs=[];strips.forEach(function(st){var pv=regs[regs.length-1];
      if(pv&&pv.gut.length&&st.gut.length){var inter=[];pv.gut.forEach(function(a){st.gut.forEach(function(b){var lo=Math.max(a[0],b[0]),hi=Math.min(a[1],b[1]);if(hi-lo>=g*0.5)inter.push([lo,hi]);});});if(inter.length){pv.it=pv.it.concat(st.it);pv.gut=inter;return;}}
      regs.push({it:st.it.slice(),gut:st.gut});});
    if(regs.length===1&&!regs[0].gut.length)return B.slice().sort(function(a,b){return a.y0-b.y0||(rtl?b.x1-a.x1:a.x0-b.x0);});
    var out=[];regs.forEach(function(r){if(!r.gut.length){out=out.concat(r.it.length>1?xyOrder(r.it,rtl,lh):r.it);return;}
      var xs=r.gut.map(function(v){return (v[0]+v[1])/2;}).sort(function(a,b){return a-b;}),cols=[];for(var k=0;k<=xs.length;k++)cols.push([]);
      r.it.forEach(function(b){var m=(b.x0+b.x1)/2,k=0;while(k<xs.length&&m>xs[k])k++;cols[k].push(b);});if(rtl)cols.reverse();cols.forEach(function(c){if(c.length)out=out.concat(xyOrder(c,rtl,lh));});});
    return out;}
  /* a block's lines; in a paragraph whose lines run the full width, a line that reaches the edge goes on with the next one (the paragraph flows as one) */
  function blockText(b,flow,PW){var t='',pv=null,W=b.x1-b.x0;b.lines.sort(function(a,c){return a.y0-c.y0;});
    var full=function(s){return s.x1-s.x0>=W*0.9;},fl=flow&&((b.lines.length>=3&&b.lines.filter(full).length>=2)||(b.lines.length===2&&PW&&W>=PW*0.6));
    b.lines.forEach(function(s){if(pv){var brk=s.par!==pv.par || Math.abs((s.y1-s.y0)/(pv.y1-pv.y0 || 1)-1)>0.35;
        if(brk)t+='\n\n';else if(fl&&full(pv)&&!/[.:؛!؟?]$/.test(pv.t)){if(/[A-Za-zÀ-ÿ]-$/.test(t)&&/^[a-zà-ÿ]/.test(s.t))t=t.slice(0,-1);else t+=' ';}else t+='\n';}
      t+=s.t;pv=s;});return t;}
  function layoutSegs(segs,flow){var sb=cluster(segs);if(!sb.blocks.length)return '';var all=segs.map(function(l){return l.t;}).join(' ');
    var PW=Math.max.apply(null,segs.map(function(l){return l.x1;}))-Math.min.apply(null,segs.map(function(l){return l.x0;}));
    return xyOrder(sb.blocks,arC(all)>=laC(all),sb.lh).map(function(bk){return blockText(bk,flow,PW);}).join('\n\n');}
  function layout(d,rows){if(!d||!d.blocks||!d.blocks.length)return d?d.text||'':'';return layoutSegs(segBlocks(d,rows),!rows)||d.text||'';}
  /* the words of an Arabic line taken for Latin letters (a word the French reader thought its own): the line is read again by the Arabic reader alone,
     and these words take what it read at the same place */
  var KEEP=/^(N°|Réf|SARL|SA|CIN|RC|ICE|IF|TVA|Tél|Fax|Tel|Email|PDF)$/i;
  /* the words of a line cut where they stand far apart (the same cut as for the order) */
  function cutLine(L){var ws=L.words||[],lh=Math.max(8,L.bbox.y1-L.bbox.y0);if(!ws.length)return [];var vis=ws.slice().sort(function(a,b){return a.bbox.x0-b.bbox.x0;}),cutx=[],far=vis[0].bbox.x1;
    for(var i=1;i<vis.length;i++){if(vis[i].bbox.x0-far>lh*2.2)cutx.push((far+vis[i].bbox.x0)/2);far=Math.max(far,vis[i].bbox.x1);}
    var parts=[];for(var q=0;q<=cutx.length;q++)parts.push([]);ws.forEach(function(W){var m=(W.bbox.x0+W.bbox.x1)/2,k=0;while(k<cutx.length&&m>cutx[k])k++;parts[k].push(W);});return parts.filter(function(p){return p.length;});}
  async function fixLatin(c,d,getAra){var A=null;
    for(var bi=0;bi<(d.blocks||[]).length;bi++){var B=d.blocks[bi];for(var pi=0;pi<(B.paragraphs||[]).length;pi++){var P=B.paragraphs[pi];for(var li=0;li<(P.lines||[]).length;li++){var L=P.lines[li],parts=cutLine(L);
      for(var qi=0;qi<parts.length;qi++){var pw=parts[qi],lt=pw.map(wtxt).join(' ');
        if(arC(lt)<5||arC(lt)<laC(lt)*2)continue;
        var sus=pw.filter(function(W){var t=wtxt(W);return /^[A-Za-zÀ-ÿ'’().,;:«»\-|]{1,6}$/.test(t)&&W.confidence<88&&!KEEP.test(t);});if(!sus.length)continue;
        var x0=1e9,x1=0;pw.forEach(function(W){x0=Math.min(x0,W.bbox.x0);x1=Math.max(x1,W.bbox.x1);});
        var lh=L.bbox.y1-L.bbox.y0,px=Math.round(lh*0.3);x0=Math.max(0,x0-px);x1=Math.min(c.width,x1+px);var y0=Math.max(0,L.bbox.y0-px),y1=Math.min(c.height,L.bbox.y1+px);if(x1-x0<8||y1-y0<8)continue;
        var cc=document.createElement('canvas');cc.width=x1-x0;cc.height=y1-y0;var g=cc.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,cc.width,cc.height);g.drawImage(c,x0,y0,cc.width,cc.height,0,0,cc.width,cc.height);
        if(!A){A=await getAra();await A.setParameters({tessedit_pageseg_mode:'7'});}var r=await A.recognize(cc,{},{blocks:true,text:true});cc.width=cc.height=0;
        var aw=allWords(r.data).map(function(w){return {t:wtxt(w),x0:w.bbox.x0+x0,x1:w.bbox.x1+x0};});
        /* each word of the Arabic reading goes to one place only: two slips over one word make one word */
        sus.forEach(function(W){var all=aw.filter(function(w){var ov=Math.min(w.x1,W.bbox.x1)-Math.max(w.x0,W.bbox.x0);return ov>(w.x1-w.x0)*0.5||ov>(W.bbox.x1-W.bbox.x0)*0.6;}),m=all.filter(function(w){return !w.used;}),t2=m.map(function(w){return w.t;}).join(' ').trim();
          if(t2&&arC(t2)>=2&&!laC(t2)&&m.length<=2){W._new=t2;m.forEach(function(w){w.used=1;});}else if(all.length&&!m.length&&all.every(function(w){return arC(w.t)>=2;}))W._del=1;});}}}}}
  /* one page: the layout found by the reader (a second reading as one block when it is not sure of itself), the Latin slips mended, the reading order rebuilt.
     rows: the lines kept whole (for the import, where a label and its value stand on one line) */
  async function readPage(w,c,o){o=o||{};var d=null;
    try{await w.setParameters({tessedit_pageseg_mode:'3'});d=(await w.recognize(c,{},{blocks:true,text:true})).data;}catch(e){d=null;}
    if(!d||d.confidence<70){if(o.again)o.again();try{await w.setParameters({tessedit_pageseg_mode:'6'});var d2=(await w.recognize(c,{},{blocks:true,text:true})).data;if(!d||d2.confidence>d.confidence+3)d=d2;}catch(e){}}
    if(!d)return '';
    if(o.ara)try{await fixLatin(c,d,o.ara);}catch(e){}
    try{return layout(d,o.rows).trim() || d.text || '';}catch(e){return d.text||'';}}

export { prep, readPage };
