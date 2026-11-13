// فصل هوامش الصفحات عن المتن (عرض فقط؛ نص المصدر في الأرشيف المضغوط لا يتغير).
//
// في النصوص المستخرجة من PDF مُحيَّنة (مثل ظهير الالتزامات والعقود) تأتي هوامش الصفحة ككتلة تبدأ
// بـ"N - " في أسفل الصفحة، وتبقى أرقام الإحالة ملتصقة بالمتن كأرقام عارية ("الأهلية 9."). فيختلط
// نص الهامش بالمتن في القارئ. نُميّز هنا الهوامش ونوسمها بعلامات غير مرئية (U+2060) يستعين بها القارئ
// لعرض رقم الإحالة صغيرًا بين قوسين ونص الهامش صغيرًا بين قوسين؛ وتبقى في النص العادي مقروءة "(9) نص".
//
// حذر الإيجابيات الكاذبة: لا تُعدّ الكتلة هامشًا إلا إذا (١) كان رقمها هو التالي في التسلسل العام للهوامش
// و(٢) وُجد في المتن السابق لها (منذ هامش الصفحة الماضية) رقم إحالة بالقيمة نفسها؛ وإن لم يتكوّن في الوثيقة
// عدد كافٍ من الهوامش المتحقق منها تُترك الوثيقة كما هي.
export const FN_MARK='\u2060'; // يحيط برقم الإحالة داخل المتن
export const NOTE_MARK='\u2063'; // يحيط برقم الهامش في أول فقرة الهامش
const SEP='\\s*[-–—]\\s*[،.؛:]?\\s*';
const ARTICLE_WORDS=['المادة','الفصل'];
const HEADING_ONLY=/^(?:المادة|الفصل|الباب|القسم|الكتاب|الفرع|الجزء)\s+\S+(?:\s+\S+){0,8}$/;
const BEFORE_BLACKLIST=/^(?:الفصل|الفصلين|الفصول|المادة|المادتين|المواد|الفقرة|الفقرتين|البند|البنود|رقم|عدد|ص|صفحة|سنة|بتاريخ|حوالي|نحو|بين|قبل|بعد|منذ|مدة|خلال|n°|no|art\.?|article|p\.?|pp\.?)$/i;
const AFTER_BLACKLIST=/^(?:يناير|فبراير|مارس|أبريل|ماي|يونيو|يوليو|غشت|شتنبر|أكتوبر|نونبر|دجنبر|محرم|صفر|ربيع|جمادى|رجب|شعبان|رمضان|شوال|ذي|ذو|يوما|أيام|يوم|سنة|سنوات|أشهر|شهرا|شهر|درهم|دراهم|ساعة|ساعات|%|bis|ter)/i;
const headingOnly=b=>b.length<=80&&HEADING_ONLY.test(b)&&!/[.؟!:]$/.test(b);
const FN_RE=new RegExp('^(\\d{1,3})'+SEP);

/* موضع أول رقم إحالة بقيمة n داخل نص الكتلة ابتداءً من from؛ يُرفض ما يبدو رقم مادة أو تاريخ أو عدّ قائمة. */
function findRef(text,n,from){
  const re=new RegExp('(?:^|(?<=\\s))'+n+'(?=[.،؛:)»"”]*(?:\\s|$))','g');re.lastIndex=from;
  let m;
  while((m=re.exec(text))){
    const after=text.slice(m.index+String(n).length);
    if(/^[.،؛:)»"”]*\s*[-–—]/.test(after))continue;
    const before=text.slice(0,m.index).trimEnd().split(/\s+/).pop()||'';
    if(before&&BEFORE_BLACKLIST.test(before.replace(/[()«»"“”]/g,'')))continue;
    const next=after.replace(/^[.،؛:)»"”]*\s*/,'').split(/\s+/)[0]||'';
    if(next&&AFTER_BLACKLIST.test(next))continue;
    return m.index;
  }
  return -1;
}

/* يقسم نص منطقة هوامش مجمَّعة إلى هوامش مفردة بحسب التسلسل المتوقع (مع تسامح بتخطي رقم واحد ناقص). */
function splitUnits(text,first){
  const head=text.match(FN_RE);if(!head)return [];
  const marks=[{n:first,at:0,body:head[0].length}];let cur=first,from=head[0].length;
  for(;;){
    let found=null;
    for(const step of [1,2]){
      const re=new RegExp('(?<![\\d])'+(cur+step)+SEP,'g');re.lastIndex=from;const m=re.exec(text);
      if(m&&(!found||m.index<found.m.index))found={m,n:cur+step};
      if(found)break;
    }
    if(!found)break;
    marks.push({n:found.n,at:found.m.index,body:found.m.index+found.m[0].length});cur=found.n;from=found.m.index+found.m[0].length;
  }
  return marks.map((mark,i)=>({n:mark.n,text:text.slice(mark.body,marks[i+1]?marks[i+1].at:text.length).replace(/\s+/g,' ').trim()}));
}

export function separateFootnotes(blocks){
  const counts=ARTICLE_WORDS.map(w=>blocks.filter(b=>headingOnly(b)&&b.startsWith(w+' ')).length);
  const [mada,fasl]=counts;
  /* في وثيقة غالب ترقيم موادها بكلمة واحدة، تكون عناوين الكلمة الأخرى المستقلة غالبًا من نص الهوامش
     ("المادة 209" من مدونة الأسرة داخل هامش) لا عناوين حقيقية. */
  const fake=new Set();if(fasl>=10&&mada*5<fasl)fake.add('المادة');if(mada>=10&&fasl*5<mada)fake.add('الفصل');
  const isFake=b=>headingOnly(b)&&fake.has(b.split(' ')[0]);
  const out=[];let expected=1,windowStart=0,lastWindowStart=0,regions=0,units=0,attached=0;
  for(let i=0;i<blocks.length;){
    const b=blocks[i],start=b.match(FN_RE);
    if(start&&+start[1]>=expected&&+start[1]<=expected+40&&!b.startsWith(NOTE_MARK)){
      /* منطقة الهوامش: كتلة البداية + (عناوين الكلمة الدخيلة ونصها + الكتل التي تبدأ بعلامة ترقيم تتميمية). */
      let text=b,j=i+1,extra=0;
      /* نص الهامش قد يتخلله سطر يبدأ بكلمة عنوان ("المادة 209: ..."، "الكتاب 2 لظهير ...") فيتحول في المصدر إلى
         "عنوان" مزيف وكتلة مستقلة؛ نضمّه إلى الهامش ما دام الهامش غير مكتمل (لم يُختم بنقطة) أو كان العنوان المزيف
         مجرد كلمة المادة/الفصل الدخيلة، ونتوقف عند أول عنوان حقيقي (الفصل N وحده في الوثيقة ذات الفصول،
         أو "الكتاب N: العنوان") أو بعد ثماني كتل. */
      const complete=t=>/[.؟!»)"”]\s*$/.test(t);
      const realHeading=x=>(headingOnly(x)&&!fake.has(x.split(' ')[0]))||/^(?:الكتاب|القسم|الباب|الفرع|الجزء)\s+\S+\s*:/.test(x);
      for(;j<blocks.length&&extra<8;){
        const nb=blocks[j];
        if(isFake(nb)){text+=' '+nb;j++;extra++;if(j<blocks.length&&!headingOnly(blocks[j])){text+=' '+blocks[j];j++;}continue;}
        if(/^[:،؛.»)]/.test(nb)){text+=' '+nb;j++;extra++;continue;}
        if(!complete(text)&&/^(?:المادة|الفصل|الباب|القسم|الكتاب|الفرع|الجزء)\s/.test(nb)&&!realHeading(nb)){text+=' '+nb;j++;extra++;continue;}
        break;
      }
      const parts=splitUnits(text,+start[1]);
      /* التحقق: رقم إحالة واحد على الأقل من أرقام هذه الهوامش موجود في متن الصفحة (الكتل التي قبل المنطقة
         منذ آخر هوامش)؛ يُحاكى الإلحاق على نسخة من نافذة المتن ولا يُعتمد إلا عند النجاح. */
      /* هوامش متتالية بلا متن بينها (صفحتان بهوامش متجاورة): نوسّع النافذة إلى متن الهوامش السابقة؛ أرقام
         إحالاتها المُلحَقة سلفًا صارت علامات فلا تُطابَق مرة ثانية. */
      const from=windowStart===out.length?lastWindowStart:windowStart;
      const win=out.slice(from);let cursor={block:0,index:0},hit=0;
      for(const part of parts){
        for(let k=cursor.block;k<win.length;k++){
          if(win[k].startsWith(NOTE_MARK))continue;
          const at=findRef(win[k],part.n,k===cursor.block?cursor.index:0);
          if(at>=0){
            const len=String(part.n).length,before=win[k].slice(0,at).replace(/[ \t]$/,''),mark=FN_MARK+'('+part.n+')'+FN_MARK;
            win[k]=before+mark+win[k].slice(at+len);hit++;cursor={block:k,index:before.length+mark.length};break;
          }
        }
      }
      if(parts.length&&hit){
        regions++;units+=parts.length;attached+=hit;
        out.length=from;out.push(...win);
        for(const part of parts)out.push(NOTE_MARK+'('+part.n+')'+NOTE_MARK+(part.text?' '+part.text:''));
        expected=parts.at(-1).n+1;lastWindowStart=from;windowStart=out.length;i=j;continue;
      }
    }
    out.push(b);i++;
  }
  if(regions<5||units<10)return {blocks,units:0,attached:0};
  return {blocks:out,units,attached};
}
