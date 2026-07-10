"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { 
    ClipboardList, 
    Sparkles, 
    Save, 
    FileText, 
    Plus, 
    History, 
    Loader2, 
    CheckCircle2,
    BookOpen
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { getBusinessInsight } from "@/ai/flows/business-insights-flow"

const standardPolicies = [
    { id: 'p1', title: 'Revenue Recognition', description: 'Revenue is recognized when services are rendered or products are delivered to customers.' },
    { id: 'p2', title: 'Inventory Valuation', description: 'Inventory is valued at the lower of cost and net realizable value using the FIFO method.' },
    { id: 'p3', title: 'Depreciation Policy', description: 'Equipment is depreciated using the straight-line method over a 5-year useful life.' },
]

export default function AccountingPoliciesPage() {
    const { toast } = useToast()
    const [isGenerating, setIsGenerating] = React.useState(false)
    const [aiNote, setAiNote] = React.useState("")
    const [userContext, setUserContext] = React.useState("")

    const handleGenerateNote = async () => {
        setIsGenerating(true)
        try {
            const result = await getBusinessInsight({
                context: "Financial Reporting - Note to Account generation",
                userQuery: `Generate a professional 'Note to Account' for a Nigerian MSME based on these policies: ${standardPolicies.map(p => p.title).join(', ')}. Additional context: ${userContext}`
            })
            setAiNote(result.insight)
            toast({
                title: "AI Note Generated",
                description: "The draft disclosure has been created based on your business context.",
            })
        } catch (error) {
            toast({
                variant: "destructive",
                title: "Generation Failed",
                description: "Could not reach the AI assistant. Please try again.",
            })
        } finally {
            setIsGenerating(false)
        }
    }

    const handleSave = () => {
        toast({
            title: "Policies Saved",
            description: "Accounting policies and notes have been updated in the master ledger.",
        })
    }

    return (
        <div className="flex flex-col gap-8 pb-12">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Accounting Policies & Notes</h1>
                    <p className="text-muted-foreground mt-1">Manage regulatory disclosures and AI-powered financial footnotes.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm">
                        <History className="mr-2 h-4 w-4" />
                        Version History
                    </Button>
                    <Button size="sm" onClick={handleSave}>
                        <Save className="mr-2 h-4 w-4" />
                        Save Master Copy
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Policies Management */}
                <div className="lg:col-span-2 space-y-6">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <CardTitle className="font-headline flex items-center gap-2">
                                        <ClipboardList className="h-5 w-5 text-primary" />
                                        Master Accounting Policies
                                    </CardTitle>
                                    <CardDescription>Formal definitions of how your business records financial data.</CardDescription>
                                </div>
                                <Button variant="outline" size="sm">
                                    <Plus className="h-4 w-4 mr-2" /> New Policy
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {standardPolicies.map((policy) => (
                                <div key={policy.id} className="p-4 rounded-xl border bg-muted/20 hover:bg-muted/30 transition-colors">
                                    <div className="flex items-center justify-between mb-2">
                                        <h4 className="font-bold text-sm text-primary">{policy.title}</h4>
                                        <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-700">Active</Badge>
                                    </div>
                                    <Textarea 
                                        defaultValue={policy.description} 
                                        className="bg-transparent border-none p-0 focus-visible:ring-0 text-sm h-auto min-h-[40px] resize-none"
                                    />
                                </div>
                            ))}
                        </CardContent>
                    </Card>

                    <Card className="border-primary/20 bg-primary/5">
                        <CardHeader>
                            <CardTitle className="font-headline flex items-center gap-2 text-primary">
                                <Sparkles className="h-5 w-5" />
                                AI Note to Account Assistant
                            </CardTitle>
                            <CardDescription>Generate professional footnotes for your Balance Sheet and P&L reports.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Report Context (Optional)</Label>
                                <Input 
                                    placeholder="e.g. Include notes about the impact of recent FX fluctuations on inventory..." 
                                    value={userContext}
                                    onChange={(e) => setUserContext(e.target.value)}
                                    className="bg-background"
                                />
                            </div>
                            <Button className="w-full" onClick={handleGenerateNote} disabled={isGenerating}>
                                {isGenerating ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Drafting Financial Disclosure...
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="mr-2 h-4 w-4" />
                                        Draft Note to Account
                                    </>
                                )}
                            </Button>
                            
                            {aiNote && (
                                <div className="mt-6 space-y-3">
                                    <Label className="flex items-center gap-2">
                                        <FileText className="h-4 w-4" /> Drafted Disclosure
                                    </Label>
                                    <div className="p-4 rounded-xl border bg-card shadow-inner">
                                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{aiNote}</p>
                                    </div>
                                    <div className="flex justify-end gap-2">
                                        <Button variant="ghost" size="sm" onClick={() => setAiNote("")}>Discard</Button>
                                        <Button variant="outline" size="sm">Copy to Report</Button>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Sidebar Guidance */}
                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <BookOpen className="h-4 w-4 text-primary" />
                                Regulatory Help
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 text-sm">
                            <div className="flex gap-3">
                                <div className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />
                                <p><strong>IFRS S1/S2:</strong> Ensure your policies account for new sustainability disclosure requirements.</p>
                            </div>
                            <div className="flex gap-3">
                                <div className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />
                                <p><strong>FRCN Compliance:</strong> These notes are formatted to meet Financial Reporting Council of Nigeria MSME standards.</p>
                            </div>
                        </CardContent>
                        <CardFooter>
                            <Button variant="link" className="p-0 text-primary h-auto text-xs" asChild>
                                <a href="https://www.ifrs.org/issued-standards/ifrs-for-smes/" target="_blank" rel="noopener noreferrer">
                                    View Reporting Guide →
                                </a>
                            </Button>
                        </CardFooter>
                    </Card>

                    <Card className="bg-muted/50 border-dashed border-2">
                        <CardHeader>
                            <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">Why Policies Matter?</CardTitle>
                        </CardHeader>
                        <CardContent className="text-xs space-y-3 text-muted-foreground">
                            <p>Consistency in accounting policies is crucial for multi-year trend analysis. Changing a policy usually requires restating previous years' results.</p>
                            <div className="flex items-center gap-2 text-emerald-600 font-bold uppercase tracking-tighter">
                                <CheckCircle2 className="h-3 w-3" /> Audit Ready
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
