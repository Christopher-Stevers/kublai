"""Private, bounded ForemanHQ inference. No database or app-action access."""
import asyncio, io, json, secrets, time
import numpy as np
import torch
from fastapi import Request, HTTPException
from fastapi.responses import Response
from transformers import TextStreamer

def install(app, state, lock, key):
    @app.post('/foreman/infer')
    async def infer(request: Request):
        if not secrets.compare_digest(request.headers.get('x-voice-key',''), key):
            raise HTTPException(401)
        data=bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data)>1500000: raise HTTPException(413)
        try: payload=json.loads(data)
        except Exception: raise HTTPException(400)
        mode=payload.get('mode')
        if mode not in ('transcribe','plan','speak'): raise HTTPException(400)
        if not state.get('ready'): raise HTTPException(503, 'Voice is warming up.')
        if not lock.acquire(blocking=False): raise HTTPException(429,'Voice server is busy. Try again shortly.')
        def run():
            import base64, wave
            try:
                processor,model=state['processor'],state['model']
                if mode=='transcribe':
                    raw=base64.b64decode(payload.get('audio',''),validate=True)
                    if len(raw)<1600 or len(raw)>16000*2*25 or len(raw)%2: raise ValueError('Audio length invalid')
                    audio=np.frombuffer(raw,dtype='<i2').astype(np.float32)/32768
                    messages=[{'role':'system','content':'Perform ASR in English.'},{'role':'user','content':[{'type':'audio','audio':audio}]}]
                else:
                    messages=payload.get('messages')
                    if not isinstance(messages,list) or len(messages)>20 or len(json.dumps(messages))>60000: raise ValueError('Prompt invalid')
                if mode=='speak':
                    text=payload.get('text','')
                    if not isinstance(text,str) or len(text)>1200: raise ValueError('Speech length invalid')
                    messages=[{'role':'system','content':'Perform TTS in American English using a female voice.'},{'role':'user','content':text},{'role':'assistant','content':'<|audio_start|>'}]
                    inputs=processor.apply_chat_template(messages,continue_final_message=True,tokenize=True,return_dict=True,return_tensors='pt').to('cuda')
                else:
                    inputs=processor.apply_chat_template(messages,add_generation_prompt=True,tokenize=True,return_dict=True,return_tensors='pt').to('cuda')
                deadline=time.monotonic()+45
                class Deadline(TextStreamer):
                    def on_finalized_text(self, text, stream_end=False):
                        if time.monotonic()>deadline: raise RuntimeError('Inference timed out')
                opts={'max_new_tokens':700 if mode=='speak' else 450,'streamer':Deadline(processor.tokenizer,skip_prompt=True,skip_special_tokens=True),'return_dict_in_generate':True}
                if mode=='speak': opts.update(audio_temperature=1.0,audio_top_k=128,audio_repetition_penalty=1.1,audio_repetition_window=4096)
                else: opts.update(suppress_mixed=True,suppress_audio_out=True,do_sample=False)
                with torch.inference_mode(): result=model.generate(**inputs,**opts)
                if time.monotonic()>deadline: raise RuntimeError('Inference timed out')
                if mode=='speak':
                    with torch.inference_mode(): wav=state['codec'].decode(result.audio_codes[:1,:,:result.audio_lengths[0]]).audio_values[0]
                    pcm=(wav.float().clamp(-1,1).cpu().numpy()*32767).astype('<i2').tobytes()
                    out=io.BytesIO()
                    with wave.open(out,'wb') as w: w.setnchannels(1);w.setsampwidth(2);w.setframerate(24000);w.writeframes(pcm)
                    return out.getvalue()
                return processor.decode(result.sequences[0,inputs['input_ids'].shape[1]:],skip_special_tokens=True).strip()
            finally: lock.release()
        try: result=await asyncio.to_thread(run)
        except Exception as e:
            import logging
            logging.exception('Foreman inference failed')
            raise HTTPException(502,'Voice inference failed. Try again.')
        if mode=='speak': return Response(result,media_type='audio/wav',headers={'Cache-Control':'no-store'})
        return {'text':result}
