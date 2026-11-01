async function get(path: string) { return (await fetch('/test/ifrs/'+path)).json(); }
export async function loadCloseMetadataAction() { return get('metadata'); }
export async function loadCloseAction(id: string) { return get('close/'+encodeURIComponent(id)); }
export async function loadValuationAction() {
  const [inventory,metadata]=await Promise.all([get('valuation'),get('metadata')]);
  return {success:true,data:{inventory,accounts:metadata.data.accounts,suppliers:metadata.data.suppliers}};
}
export async function valuationCommandAction(operation: string,input: unknown) { return (await fetch('/test/ifrs/write',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,input})})).json(); }
export async function submitCloseAction(input: unknown) { return (await fetch('/test/ifrs/close',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).json(); }
export async function approveCloseAction(id: string,evidence: string) { return (await fetch('/test/ifrs/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,evidence})})).json(); }
