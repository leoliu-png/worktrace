import {writeFileSync} from 'node:fs';
import path from 'node:path';

// Fixed browser operations, never caller-provided JavaScript. Use synthetic documents only.
export async function imageSpacingProbe(page,directory){
 const editor=page.locator('.cm-content[contenteditable="true"]').first();
 if(!await editor.count())throw Error('Open a synthetic log editor before running image_spacing_probe.');
 const cases=[{name:'empty-line',before:'合成上段\n',after:'\n合成下段'},{name:'indented-empty-line',before:'1. 合成上段\n   ',after:'\n2. 合成下段'},{name:'text-line',before:'合成前文',after:'后文'}];
 const results=[];
 for(const item of cases){
  await editor.click();await editor.press('Control+A');await page.keyboard.insertText(item.before+item.after);
  for(let i=0;i<item.after.length;i++)await page.keyboard.press('ArrowLeft');
  await editor.evaluate(element=>{
   const canvas=document.createElement('canvas');canvas.width=96;canvas.height=64;const ctx=canvas.getContext('2d');ctx.fillStyle='#087e86';ctx.fillRect(0,0,96,64);
   const bytes=Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0));
   const data=new DataTransfer();data.items.add(new File([bytes],'rsi-spacing.png',{type:'image/png'}));element.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
  });
  await page.waitForTimeout(200);
  const result=await editor.evaluate(element=>{
   const image=[...element.querySelectorAll('.cm-image-widget img')].at(-1),widget=image?.closest('.cm-image-widget'),previous=widget?.previousElementSibling;
   const markdown=element.closest('.wt-markdown-editor').querySelector('input[name="markdownContent"]')?.value||'';
   const placeholder=previous?.classList.contains('cm-line')&&!previous.textContent.trim()?previous:null;
   return {markdown:markdown.slice(0,1500),imageLoaded:!!image?.complete&&image.naturalWidth>0,placeholderHeight:placeholder?.getBoundingClientRect().height||0,widgetTop:widget?.getBoundingClientRect().top??null};
  });
  const file=`spacing-${item.name}.png`;await page.screenshot({path:path.join(directory,file)});
  const index=result.markdown.indexOf('![rsi-spacing.png]'),prefix=index<0?'':result.markdown.slice(0,index);
  const noAddedBlankLine=!/\n[ \t]*\n[ \t]*$/.test(prefix);
  const passed=index>=0&&result.imageLoaded&&result.placeholderHeight<1&&noAddedBlankLine;
  results.push({name:item.name,passed,...result,noAddedBlankLine,screenshot:file});
 }
 const report={kind:'image_spacing',passed:results.every(x=>x.passed),checks:results};
 writeFileSync(path.join(directory,'image-spacing.json'),JSON.stringify(report,null,2));return report;
}
