import {useEffect, useState} from 'react';
import {safeImage} from './utils';

export function Poster({url, live=false}:{url?:string;live?:boolean}) {
  const source=safeImage(url);const [failed,setFailed]=useState(false);const [attempt,setAttempt]=useState(0);
  useEffect(()=>{setFailed(false);setAttempt(0);},[source]);
  useEffect(()=>{if(!failed||attempt>=2)return;const timer=setTimeout(()=>{setAttempt(n=>n+1);setFailed(false);},1000*2**attempt);return()=>clearTimeout(timer);},[failed,attempt]);
  return <>{source&&!failed?<img key={`${source}:${attempt}`} loading="lazy" src={source} alt="" onError={()=>setFailed(true)}/>:<span className="placeholder" aria-label="Image unavailable">{live?'◉':'▷'}</span>}</>;
}
