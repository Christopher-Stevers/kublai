#!/usr/bin/env python3
"""Crop verified manufacturer engineering illustrations; reuse by fitting family."""
import argparse,json,hashlib
from pathlib import Path
import pdfplumber
from PIL import Image,ImageChops,ImageDraw
p=argparse.ArgumentParser();p.add_argument('--sources',type=Path,required=True);p.add_argument('--catalogue',type=Path,required=True);a=p.parse_args()
config=json.loads(Path(__file__).with_name('victaulic-stainless-image-crops.json').read_text());data=json.loads(a.catalogue.read_text());assert set(config)==set(data['images'])
out=Path('public/images/catalog/uploads');out.mkdir(parents=True,exist_ok=True);total=0
sheet=Image.new('RGB',(1000,((len(config)+4)//5)*180),'#eee');draw=ImageDraw.Draw(sheet)
for i,(key,(doc,page,bbox)) in enumerate(config.items()):
 with pdfplumber.open(a.sources/f'{doc}.pdf') as pdf:
  im=pdf.pages[page-1].crop(tuple(bbox)).to_image(resolution=250).original.convert('RGB')
 # Trim white margins, then normalize the canvas without changing the drawing.
 diff=ImageChops.difference(im,Image.new('RGB',im.size,'white')).convert('L');tight=diff.point(lambda x:255 if x>45 else 0).getbbox();assert tight,(key,'empty figure')
 im=im.crop(tight);scale=min(440/im.width,440/im.height);im=im.resize((round(im.width*scale),round(im.height*scale)),Image.Resampling.LANCZOS);canvas=Image.new('RGB',(512,512),'white');canvas.paste(im,((512-im.width)//2,(512-im.height)//2))
 import io
 buf=io.BytesIO();canvas.save(buf,format='WEBP',lossless=True,method=6);content=buf.getvalue();sha=hashlib.sha256(content).hexdigest();filename=f'part-{sha}.webp';(out/filename).write_bytes(content);total+=len(content)
 data['images'][key].update({'publication':doc,'page':page,'cropPdfPoints':bbox,'url':'/api/catalogue/images/'+filename,'path':str(out/filename),'sha256':sha,'byteSize':len(content),'kind':'Manufacturer engineering illustration','sourceUrl':f'https://assets.victaulic.com/assets/uploads/literature/{doc}.pdf#page={page}'})
 thumb=canvas.copy();thumb.thumbnail((150,150));x=i%5*200;y=i//5*180;sheet.paste(thumb,(x+25,y+20));draw.text((x+5,y+3),key,fill='black')
for r in data['rows']:r['imageUrl']=data['images'][r['imageKey']]['url']
a.catalogue.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n');sheet.save(a.sources/'image-contact-sheet.png');print(json.dumps({'images':len(config),'totalBytes':total}))
