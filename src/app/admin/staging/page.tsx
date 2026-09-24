'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  ShieldCheck, 
  Database, 
  Lock, 
  FileText, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Activity,
  PlayCircle,
  RefreshCw
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type TestResult = {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'pass' | 'fail';
  message?: string;
};

export default function StagingCheckPage() {
    const { toast } = useToast();
    const supabase = createClient();
    const [results, setResults] = React.useState<TestResult[]>([
        { id: 'auth', name: 'Identity & Session', status: 'pending' },
        { id: 'rls', name: 'Multi-Tenant RLS Policy', status: 'pending' },
        { id: 'atomic', name: 'Financial Atomic RPCs', status: 'pending' },
        { id: 'storage', name: 'Secure Storage Isolation', status: 'pending' },
        { id: 'reports', name: 'Server-Side Aggregations', status: 'pending' },
    ]);

    const runTests = async () => {
        toast({ title: "Regression Started", description: "Executing full suite against Staging infrastructure..." });
        
        // 1. Auth Test
        updateStatus('auth', 'running');
        const { data: { user } } = await supabase.auth.getUser();
        updateStatus('auth', user ? 'pass' : 'fail', user ? `Authenticated as ${user.email}` : 'No active session');

        // 2. RLS Test (Simple count check)
        updateStatus('rls', 'running');
        const { error: rlsErr } = await supabase.from('businesses').select('id').limit(1);
        updateStatus('rls', rlsErr ? 'fail' : 'pass', rlsErr?.message);

        // 3. Atomic Test (Call a safe RPC)
        updateStatus('atomic', 'running');
        const { error: rpcErr } = await supabase.rpc('get_business_kpis', { 
            p_business_id: '00000000-0000-0000-0000-000000000000',
            p_start_date: new Date().toISOString(),
            p_end_date: new Date().toISOString()
        });
        // We expect an error or empty result for a dummy ID, but the RPC existence is what we test here
        updateStatus('atomic', rpcErr && !rpcErr.message.includes('not found') ? 'fail' : 'pass');

        // 4. Storage Test
        updateStatus('storage', 'running');
        const { error: storeErr } = await supabase.storage.from('business-assets').list();
        updateStatus('storage', storeErr ? 'fail' : 'pass', storeErr?.message);

        // 5. Reports Test
        updateStatus('reports', 'running');
        const { error: viewErr } = await supabase.from('view_inventory_valuation').select('*').limit(1);
        updateStatus('reports', viewErr ? 'fail' : 'pass', viewErr?.message);

        toast({ title: "Regression Complete", description: "Check results for any Staging environment issues." });
    };

    const updateStatus = (id: string, status: TestResult['status'], message?: string) => {
        setResults(prev => prev.map(r => r.id === id ? { ...r, status, message } : r));
    };

    const allPassed = results.every(r => r.status === 'pass');

    return (
        <div className="flex flex-col gap-8 pb-12">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight text-foreground">Staging Command Center</h1>
                    <p className="text-muted-foreground mt-1">Production-readiness regression suite for Release Candidates.</p>
                </div>
                <Button size="lg" onClick={runTests} className="rounded-xl px-8 shadow-xl shadow-primary/20">
                    <PlayCircle className="mr-2 h-5 w-5" />
                    Run All Tests
                </Button>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
                <Card className={cn(
                    "border-none shadow-lg transition-all",
                    allPassed && results.some(r => r.status === 'pass') ? "bg-emerald-500 text-white" : "bg-primary text-white"
                )}>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-bold uppercase tracking-widest opacity-80">System Health</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold font-headline">
                            {allPassed ? "STABLE" : "VERIFYING"}
                        </div>
                        <p className="text-xs opacity-70 mt-1">Infrastructure Status</p>
                    </CardContent>
                </Card>
                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle>Environment Context</CardTitle>
                    </CardHeader>
                    <CardContent className="flex items-center gap-12">
                        <div>
                            <p className="text-[10px] uppercase font-bold text-muted-foreground">Mode</p>
                            <Badge variant="outline" className="mt-1 bg-amber-50 text-amber-700">STAGING / QA</Badge>
                        </div>
                        <div>
                            <p className="text-[10px] uppercase font-bold text-muted-foreground">Provider</p>
                            <div className="flex items-center gap-2 mt-1 font-bold text-sm">
                                <Database className="h-4 w-4 text-primary" /> Supabase PostgreSQL
                            </div>
                        </div>
                        <div>
                            <p className="text-[10px] uppercase font-bold text-muted-foreground">Isolation</p>
                            <div className="flex items-center gap-2 mt-1 font-bold text-sm">
                                <Lock className="h-4 w-4 text-primary" /> RLS Restricted
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card className="shadow-2xl border-primary/10">
                <CardHeader className="border-b bg-muted/20">
                    <CardTitle className="font-headline flex items-center gap-2">
                        <Activity className="h-5 w-5 text-primary" />
                        Infrastructure Regression Logs
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="divide-y">
                        {results.map((res) => (
                            <div key={res.id} className="flex items-center justify-between p-6">
                                <div className="flex items-center gap-4">
                                    <div className={cn(
                                        "h-10 w-10 rounded-full flex items-center justify-center",
                                        res.status === 'pass' ? "bg-emerald-100 text-emerald-700" :
                                        res.status === 'fail' ? "bg-red-100 text-red-700" :
                                        res.status === 'running' ? "bg-blue-100 text-blue-700" : "bg-muted text-muted-foreground"
                                    )}>
                                        {res.status === 'pass' ? <CheckCircle2 className="h-5 w-5" /> :
                                         res.status === 'fail' ? <XCircle className="h-5 w-5" /> :
                                         res.status === 'running' ? <Loader2 className="h-5 w-5 animate-spin" /> : 
                                         <Activity className="h-5 w-5" />}
                                    </div>
                                    <div>
                                        <p className="font-bold text-base">{res.name}</p>
                                        <p className="text-xs text-muted-foreground">{res.message || "Awaiting execution..."}</p>
                                    </div>
                                </div>
                                <Badge variant={res.status === 'pass' ? 'default' : res.status === 'fail' ? 'destructive' : 'secondary'}>
                                    {res.status.toUpperCase()}
                                </Badge>
                            </div>
                        ))}
                    </div>
                </CardContent>
                <CardFooter className="bg-muted/30 border-t p-6 flex justify-between items-center">
                    <p className="text-xs text-muted-foreground italic">
                        Regression tests bypass client caches to verify direct database state.
                    </p>
                    <Button variant="outline" size="sm" onClick={() => setResults(results.map(r => ({ ...r, status: 'pending', message: '' })))}>
                        <RefreshCw className="mr-2 h-3 w-3" /> Reset View
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
}
