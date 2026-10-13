"use client";
import {useEffect,useId,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {readAdjustmentHistoryAction} from '@/app/catalog/actions';
import {useBusiness} from '@/components/business-provider';
type Movement={id:string;delta:number;before_quantity:number;after_quantity:number;entry_date:string;reason:string;created_at:string;actor_id:string};
export function StockAdjustmentHistory({itemId}:{itemId:string}){
 const {business}=useBusiness();const headingId=useId();const [rows,setRows]=useState<Movement[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(0),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const generation=useRef(0);
 useEffect(()=>{const requests=generation,token=++requests.current;setLoading(true);setRows([]);setTotal(0);setError('');
  void readAdjustmentHistoryAction(itemId,page).then(result=>{if(token===requests.current){setRows(result.data);setTotal(result.total);}}).catch(()=>{if(token===requests.current)setError('Stock adjustment history could not be loaded. Retry to refresh your access and records.');}).finally(()=>{if(token===requests.current)setLoading(false);});
  return()=>{requests.current++;};
 },[itemId,page,revision,business?.id]);
 return <section aria-labelledby={headingId} className="space-y-3"><h3 id={headingId} className="font-semibold">Opening stock and adjustments</h3><p className="text-xs text-muted-foreground">Recorded opening balances and quantity corrections. View transaction history for sales activity.</p>
  {loading?<p role="status">Loading stock adjustments...</p>:error?<div><p role="alert">{error}</p><Button size="sm" variant="outline" onClick={()=>setRevision(v=>v+1)}>Retry history</Button></div>:<>
   {rows.length===0?<p className="text-sm text-muted-foreground">No opening stock or adjustments recorded.</p>:<ol className="space-y-2">{rows.map(row=><li key={row.id} className="rounded border p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><time dateTime={row.entry_date}>{row.entry_date}</time><span className="font-medium">{row.delta>0?'+':''}{row.delta} units</span></div><p className="mt-1 break-words">{row.reason}</p><p className="text-xs text-muted-foreground">Stock: {row.before_quantity} → {row.after_quantity}</p><details className="mt-2"><summary className="cursor-pointer text-xs">Recorded details</summary><p className="break-all text-xs">Member ID: {row.actor_id}</p><time className="text-xs" dateTime={row.created_at}>{new Date(row.created_at).toLocaleString()}</time></details></li>)}</ol>}
   <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs">{total} recorded entries</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page===0} onClick={()=>setPage(p=>p-1)}>Previous adjustments</Button><Button size="sm" variant="outline" disabled={(page+1)*20>=total} onClick={()=>setPage(p=>p+1)}>Next adjustments</Button></div></div>
  </>}
 </section>;
}
