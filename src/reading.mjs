// Presentation-only reflow. Source wording stays in the compressed archive.
import {headingsOf} from './text.mjs';
import {createHash} from 'node:crypto';
export function pageSpans(pages){let at=0;return pages.map((p,i)=>{const text=String(typeof p==='string'?p:p.text).trim(),start=at;at+=text.length;const span={page:i+1,start,end:at};at+=2;return span;});}
function stripPageEdges(text,spans){
  if(!Array.isArray(spans)||spans.length<2||spans[0].start!==0||spans.at(-1).end!==text.length||spans.some((s,i)=>s.end<s.start||(i&&s.start!==spans[i-1].end+2)))return {text,removed:0};
  const parts=spans.map(s=>text.slice(s.start,s.end));
  const trailing=parts.map(t=>t.trim().match(/(?:^|\n)\s*([0-9٠-٩]{1,4})\s*$/)?.[1]);
  const number=s=>Number(String(s).replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-0x660)));
  const edges=trailing.map((n,i)=>n===undefined?null:number(n)-(spans[i].page||i+1));
  const counts=new Map();for(const n of edges)if(n!==null)counts.set(n,(counts.get(n)||0)+1);
  const best=[...counts].sort((a,b)=>b[1]-a[1])[0];let removed=0;
  return {text:parts.map((p,i)=>{if(best&&best[1]>=Math.max(2,Math.ceil(parts.length*.6))&&(best[0]===0||best[1]>=3)&&edges[i]===best[0]){removed++;return p.replace(/(?:^|\n)\s*[0-9٠-٩]{1,4}\s*$/,'');}return p;}).join('\n\n'),removed};
}
function tidyPunctuation(value){
  return value
    .replace(/[ \t]+([،؛:؟!])/g,'$1')
    .replace(/([،؛:؟!])(?=[\p{L}\p{N}(])/gu,'$1 ')
    .replace(/[ \t]+([.۔])/g,'$1')
    .replace(/([.۔])(?=[\p{L}])/gu,'$1 ')
    .replace(/\(\s+/g,'(').replace(/\s+\)/g,')')
    .replace(/([\p{L}\p{N}])\(/gu,'$1 (').replace(/\)(?=[\p{L}\p{N}])/gu,') ')
    .replace(/[ \t]{2,}/g,' ').trim();
}
export function reflowReading(raw,{sourcePageSpans}={}){
  const paged=stripPageEdges(String(raw||''),sourcePageSpans);
  const lines=paged.text.replace(/\r\n?/g,'\n').replace(/[\u200b\ufeff]/g,'').replace(/\u00a0/g,' ').split('\n');
  const pageMarkers=lines.map(s=>s.trim()).filter(s=>/^[-–—ـ]\s*[0-9٠-٩]{1,4}\s*[-–—ـ]$/.test(s));
  const removeDecorated=pageMarkers.length>=2;
  const blocks=[];let paragraph=[],removed=paged.removed;
  const flush=()=>{if(paragraph.length){blocks.push(paragraph.join(' '));paragraph=[];}};
  for(let i=0;i<lines.length;i++){
    let line=lines[i].replace(/[\t ]+/g,' ').trim();
    if(removeDecorated&&/^[-–—ـ]\s*[0-9٠-٩]{1,4}\s*[-–—ـ]$/.test(line)){removed++;continue;}
    if(!line){flush();continue;}
    if(/^[_ـ]{4,}$/.test(line))continue;
    if(/^(المادة|الفصل|الباب|القسم|الكتاب|الفرع|الجزء)$/.test(line)&&/^\s*(?:[0-9٠-٩]+|الأول|الأولى|الثاني|الثانية|الثالث|الثالثة|الرابع|الرابعة)(?=\s|$)/.test(lines[i+1]||''))line+=' '+lines[++i].trim();
    const h=line.match(/^(المادة|الفصل)\s*([0-9٠-٩]+(?:[.\/-][0-9٠-٩]+)*|الأول|الأولى|الثاني|الثانية|الثالث|الثالثة|الرابع|الرابعة|الخامس|الخامسة|السادس|السادسة|السابع|السابعة|الثامن|الثامنة|التاسع|التاسعة|العاشر|العاشرة)(?:\s*[:：]\s*|\s+|$)(.*)$/);
    if(h&&!/^(?:من\s|و\s*[0-9٠-٩]|منه|منها|المشار)/.test(h[3])){flush();blocks.push(h[1]+' '+h[2]);if(h[3])paragraph.push(h[3]);continue;}
    if(/^(?:[-–—]\s*)?(?:الباب|القسم|الكتاب|الفرع|الجزء)\s+/.test(line)){
      /* عناوين الأقسام/الأبواب/الفروع تظهر أحيانًا كترويسة متعددة الأسطر في مصدر الاستخراج، كل مستوى
         (القسم ثم — الباب ثم — الفرع) في سطر مستقل تتصدره شرطة طويلة؛ نعاملها كعنوان مستقل خاص بها
         (نزع الشرطة فقط) بدل تركها تنزلق إلى نص الفقرة العادي بلا تمييز. */
      line=line.replace(/^[-–—]\s*/,'');
      /* عناوين الأقسام/الأبواب/الفروع تُقطَع أحيانًا وسط الكلمة الأخيرة في مصدر الاستخراج (عمود ضيق في
         ترويسة الصفحة)، فتُستأنف في السطر التالي كشظية قصيرة بلا مسافة فاصلة؛ نُلحقها بالعنوان نفسه
         بدل تركها فقرة منفصلة تظهر معزولة في القارئ. قد يتخلل بينهما أيضًا سطر فارغ وحيد (فصل فقرات
         تلقائي زائف في مصدر الاستخراج)؛ نتجاوزه مرة واحدة إذا كان ما بعده يبدو تتمة فعلية للعنوان. */
      if(!(lines[i+1]||'').trim()&&lines[i+2]!==undefined){
        const afterBlank=lines[i+2].replace(/[\t ]+/g,' ').trim();
        if(afterBlank&&afterBlank.length<=80&&!/[.؟!:]$/.test(afterBlank)&&!/^(?:[-–—]\s*)?(?:المادة|الفصل|الباب|القسم|الكتاب|الفرع|الجزء)(?:\s|$)/.test(afterBlank))i++;
      }
      while(lines[i+1]!==undefined){
        const next=lines[i+1].replace(/[\t ]+/g,' ').trim();
        /* السطر التالي قد يحمل تتمة الكلمة المقطوعة فقط ("راء")، أو تلك التتمة مع بقية العنوان معها
           ("راء من الالتزام" تتمةً لـ"الإب" لتصبح "الإبراء من الالتزام")، فلا نحصر طول التتمة بعدد
           قليل من الأحرف. نستبعد فقط فقرة مستقلة تنتهي بعلامة ترقيم ختامية (مثل "ملغى.") أو تبدأ
           بعنوان جديد — عكس تتمة العنوان المقطوعة وسط الكلمة. */
        if(!next||next.length>80||/[.؟!:]$/.test(next)||/^(?:[-–—]\s*)?(?:المادة|الفصل|الباب|القسم|الكتاب|الفرع|الجزء)(?:\s|$)/.test(next))break;
        line+=next;i++;
      }
      flush();
      /* قد يضمّ السطر الخام الواحد عدة مستويات من الترويسة معًا (القسم — الباب — الفرع)، مفصولة
         بشرطة طويلة على نفس السطر لا في أسطر مستقلة؛ نقسم كل مستوى إلى عنوان مستقل بخط عريض
         في سطره الخاص بدل تركها ملتصقة في عنوان واحد طويل. */
      const levels=line.split(/\s*[-–—]\s*(?=(?:الباب|القسم|الكتاب|الفرع|الجزء)\s)/).map(s=>s.trim()).filter(Boolean);
      for(const level of levels)blocks.push(level);
      continue;
    }
    paragraph.push(line);
  }
  flush();
  const text=blocks.map(b=>tidyPunctuation(b.replace(/\s+/g,' ').replace(/([0-9٠-٩])\s*([.\/-])\s*(?=[0-9٠-٩])/g,'$1$2').replace(/([\u0621-\u064a])(?=[0-9٠-٩])/g,'$1 ').replace(/([0-9٠-٩])(?=[\u0621-\u064a])/g,'$1 '))).filter(Boolean).join('\n\n');
  return {text,headings:headingsOf(text),sha256:createHash('sha256').update(text).digest('hex'),presentation:{mode:'continuous_legal_text',removedPageMarkers:removed,sourceWordingRewritten:false,typographyNormalized:true}};
}
