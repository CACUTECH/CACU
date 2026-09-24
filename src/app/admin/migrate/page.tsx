
'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { 
  Database, 
  ArrowRightLeft, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  PlayCircle,
  FileText,
  ShieldCheck,
  RefreshCw
} from 'lucide-react';
import { MigrationEngine, type MigrationStats } from '@/lib/migration/firebase-to-supabase';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export default function MigrationPage() {
    const { toast } = useToast();
    const [isMigrating, setIsMigrating] = React.useState(false);
    const [report, setReport] = React.useState<MigrationStats[]>([]);
    const [lastRun, setLastRun] = React.useState<Date | null>(null);

    const runMigration = async () => {
        setIsMigrating(true);
        toast({ title: "Migration Started", description: "Fetching and mapping data from Firebase..." });
        
        try {
            const engine = new MigrationEngine();
            const results = await engine.runMigration();
            setReport(results);
            setLastRun(new Date());
            
            const totalErrors = results.reduce((acc, curr) => acc + curr.errors.length, 0);
            if (totalErrors === 0) {
                toast({ title: "Migration Successful", description: "All entities reconciled." });
            } else {
                toast({ variant: "destructive", title: "Migration Complete with Warnings", description: `Encountered ${totalErrors} mapping errors.` });
            }
        } catch (error: any) {
            toast({ variant: "destructive", title: "Engine Failure", description: error.message });
        } finally {
            setIsMigrating(false);
        }
    };

    return (
        <div className="flex flex-col gap-8 pb-12">
            <div>
                <h1 className="font-headline text-3xl font-bold tracking-tight">Database Migration Control</h1>
                <p className="text-muted-foreground mt-1">High-integrity data transfer from Firebase Firestore to PostgreSQL.</p>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
                <Card className="bg-primary/5 border-primary/20">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <ShieldCheck className="h-4 w-4 text-primary" />
                            Pre-Flight Status
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs">
                                <span>Firebase Auth Session</span>
                                <Badge variant="outline" className="bg-emerald-50 text-emerald-700">Verified</Badge>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                                <span>Supabase RLS Bypass</span>
                                <Badge variant="outline" className="bg-amber-50 text-amber-700">Restricted</Badge>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle>Migration Summary</CardTitle>
                        <CardDescription>System of record reconciliation and financial audit trail.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex items-center justify-between">
                         <div className="flex gap-8">
                            <div>
                                <p className="text-[10px] uppercase font-bold text-muted-foreground">Entities Processed</p>
                                <p className="text-2xl font-bold font-headline">{report.length}</p>
                            </div>
                            <div>
                                <p className="text-[10px] uppercase font-bold text-muted-foreground">Failed Records</p>
                                <p className="text-2xl font-bold font-headline text-red-600">
                                    {report.reduce((acc, curr) => acc + curr.errors.length, 0)}
                                </p>
                            </div>
                         </div>
                         <Button size="lg" onClick={runMigration} disabled={isMigrating} className="rounded-xl h-14 px-8 shadow-xl shadow-primary/20">
                            {isMigrating ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <PlayCircle className="mr-2 h-5 w-5" />}
                            Execute Sync
                         </Button>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between border-b py-4">
                    <div>
                        <CardTitle>Reconciliation Report</CardTitle>
                        {lastRun && <CardDescription>Last execution: {lastRun.toLocaleTimeString()}</CardDescription>}
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setReport([])} className="text-[10px] uppercase font-bold tracking-widest">
                        <RefreshCw className="mr-2 h-3 w-3" /> Clear History
                    </Button>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-muted/50">
                            <TableRow>
                                <TableHead className="pl-6">Entity (Collection)</TableHead>
                                <TableHead className="text-center">Firestore</TableHead>
                                <TableHead className="text-center">PostgreSQL</TableHead>
                                <TableHead className="text-center">Status</TableHead>
                                <TableHead className="text-right pr-6">Financial Variance</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {report.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-32 text-center text-muted-foreground italic">
                                        No migration data recorded. Launch a new sync to begin.
                                    </TableCell>
                                </TableRow>
                            ) : report.map((r, i) => (
                                <TableRow key={i} className="group">
                                    <TableCell className="pl-6 font-bold text-sm">{r.entity}</TableCell>
                                    <TableCell className="text-center font-mono text-xs">{r.sourceCount}</TableCell>
                                    <TableCell className="text-center font-mono text-xs font-bold">{r.destCount}</TableCell>
                                    <TableCell className="text-center">
                                        {r.success ? (
                                            <Badge className="bg-emerald-500/10 text-emerald-700">Reconciled</Badge>
                                        ) : (
                                            <Badge variant="destructive">Mismatch</Badge>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right pr-6 font-mono text-xs">
                                        {r.totalFinancials ? (
                                            <span className={cn(
                                                "font-bold",
                                                Math.abs(r.totalFinancials.source - r.totalFinancials.dest) < 0.01 ? "text-emerald-600" : "text-red-600"
                                            )}>
                                                ₦{(r.totalFinancials.dest - r.totalFinancials.source).toLocaleString()}
                                            </span>
                                        ) : "--"}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {report.some(r => r.errors.length > 0) && (
                <Card className="border-red-200 bg-red-50/30">
                    <CardHeader>
                        <CardTitle className="text-red-800 text-base flex items-center gap-2">
                            <AlertCircle className="h-4 w-4" />
                            Mapping Conflict Logs
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ScrollArea className="h-48 rounded-md border bg-background p-4">
                            <div className="space-y-2">
                                {report.flatMap(r => r.errors).map((err, i) => (
                                    <p key={i} className="text-[10px] font-mono text-red-600 border-b pb-1 last:border-0">{err}</p>
                                ))}
                            </div>
                        </ScrollArea>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
