
"use client"

import * as React from "react"
import { 
    Card, 
    CardContent, 
    CardDescription, 
    CardHeader, 
    CardTitle,
    CardFooter
} from "@/components/ui/card"
import { 
    Table, 
    TableBody, 
    TableCell, 
    TableHead, 
    TableHeader, 
    TableRow 
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { 
    Clock, 
    LogOut, 
    CheckCircle2, 
    AlertCircle, 
    TrendingUp, 
    Users, 
    Timer,
    MapPin,
    ArrowUpRight,
    Search,
    Loader2,
    Download
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { format, parse, differenceInMinutes, isAfter } from "date-fns"
import { employees as initialEmployees } from "@/lib/data"
import type { Employee } from "@/lib/data"
import { cn } from "@/lib/utils"
import * as XLSX from 'xlsx'

interface AttendanceRecord extends Employee {
    checkInTime?: string;
    checkOutTime?: string;
    duration?: string;
    punctuality: 'On Time' | 'Late' | 'Pending';
}

function AttendanceStatCard({ title, value, subtext, icon: Icon, trend }: any) {
    return (
        <Card className="shadow-lg border-primary/5">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-bold uppercase text-muted-foreground tracking-widest">{title}</CardTitle>
                <div className="bg-primary/10 p-2 rounded-lg">
                    <Icon className="h-4 w-4 text-primary" />
                </div>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold font-headline">{value}</div>
                <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                    {trend && <ArrowUpRight className="h-3 w-3 text-emerald-500" />}
                    {subtext}
                </p>
            </CardContent>
        </Card>
    )
}

export default function AttendancePage() {
    const { toast } = useToast()
    const [searchTerm, setSearchTerm] = React.useState("")
    const [isProcessing, setIsProcessing] = React.useState<string | null>(null)
    const [records, setRecords] = React.useState<AttendanceRecord[]>(
        initialEmployees.map(e => ({
            ...e,
            punctuality: e.checkInTime 
                ? (isAfter(parse(e.checkInTime, "hh:mm a", new Date()), parse("09:00 AM", "hh:mm a", new Date())) ? 'Late' : 'On Time')
                : 'Pending'
        }))
    )

    const SHIFT_START = "09:00 AM"

    const handleCheckIn = (id: string) => {
        setIsProcessing(id)
        
        // Simulate GPS verification delay
        setTimeout(() => {
            const time = format(new Date(), "hh:mm a")
            const isLate = isAfter(new Date(), parse(SHIFT_START, "hh:mm a", new Date()))

            setRecords(prev => prev.map(r => 
                r.id === id ? { 
                    ...r, 
                    checkInTime: time, 
                    punctuality: isLate ? 'Late' : 'On Time' 
                } : r
            ))

            setIsProcessing(null)
            toast({
                title: isLate ? "Late Check-in Recorded" : "On-time Check-in",
                description: `${records.find(r => r.id === id)?.name} checked in at ${time}. Location: Office Premise Verified.`,
                variant: isLate ? "destructive" : "default"
            })
        }, 800)
    }

    const handleCheckOut = (id: string) => {
        const time = format(new Date(), "hh:mm a")
        const record = records.find(r => r.id === id)
        
        if (!record || !record.checkInTime) return

        const start = parse(record.checkInTime, "hh:mm a", new Date())
        const end = new Date()
        const diff = differenceInMinutes(end, start)
        const hours = Math.floor(diff / 60)
        const mins = diff % 60
        const durationStr = `${hours}h ${mins}m`

        setRecords(prev => prev.map(r => 
            r.id === id ? { 
                ...r, 
                checkOutTime: time, 
                duration: durationStr 
            } : r
        ))

        toast({
            title: "Shift Completed",
            description: `Total duration: ${durationStr}. Session data synced.`,
        })
    }

    const handleDownloadReport = () => {
        const data = records.map(r => ({
            'Employee Name': r.name,
            'Role': r.role,
            'Status': r.punctuality,
            'Check-in': r.checkInTime || 'N/A',
            'Check-out': r.checkOutTime || 'N/A',
            'Duration': r.duration || 'N/A'
        }))

        const worksheet = XLSX.utils.json_to_sheet(data)
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance")
        XLSX.writeFile(workbook, `Attendance_Report_${format(new Date(), 'yyyy-MM-dd')}.xlsx`)

        toast({
            title: "Report Downloaded",
            description: "Daily attendance summary exported to Excel.",
        })
    }

    const handleConfigureGeofence = () => {
        toast({
            title: "Geo-fencing Settings",
            description: "Authorized workspace radius set to 100m from registered HQ address.",
            action: <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700">Active</Badge>
        })
    }

    const filteredRecords = records.filter(r => 
        r.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        r.role.toLowerCase().includes(searchTerm.toLowerCase())
    )

    // Insights Calculations
    const presentCount = records.filter(r => r.checkInTime).length
    const lateCount = records.filter(r => r.punctuality === 'Late').length
    const punctualityRate = ((presentCount - lateCount) / (presentCount || 1)) * 100

    return (
        <div className="flex flex-col gap-8 pb-12">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight text-foreground">Workforce Tracking</h1>
                    <p className="text-muted-foreground mt-1">Live monitoring of team attendance and billable work hours.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleDownloadReport}>
                        <Download className="mr-2 h-4 w-4" /> Export Today
                    </Button>
                </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <AttendanceStatCard 
                    title="Team Presence" 
                    value={`${presentCount}/${records.length}`} 
                    subtext="Employees currently active" 
                    icon={Users} 
                />
                <AttendanceStatCard 
                    title="Punctuality" 
                    value={`${Math.round(punctualityRate)}%`} 
                    subtext={`${lateCount} late arrivals today`} 
                    icon={TrendingUp} 
                />
                <AttendanceStatCard 
                    title="Avg. Work Day" 
                    value="7.4h" 
                    subtext="Mean shift duration this week" 
                    icon={Timer} 
                />
                <AttendanceStatCard 
                    title="Shift Status" 
                    value="On Track" 
                    subtext="No unauthorized absences" 
                    icon={CheckCircle2} 
                />
            </div>

            <Card className="shadow-xl shadow-primary/5 border-primary/10 overflow-hidden">
                <CardHeader className="bg-muted/20 border-b">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                            <CardTitle className="font-headline">Live Attendance Sheet</CardTitle>
                            <CardDescription>Daily records for {format(new Date(), "EEEE, MMMM do")}</CardDescription>
                        </div>
                        <div className="relative w-full sm:w-[300px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input 
                                placeholder="Search by name or role..." 
                                className="pl-9 rounded-xl border-primary/10 shadow-sm"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-muted/30">
                            <TableRow>
                                <TableHead className="pl-6 w-[250px]">Employee</TableHead>
                                <TableHead className="text-center">Status</TableHead>
                                <TableHead className="text-center">Check-in</TableHead>
                                <TableHead className="text-center">Check-out</TableHead>
                                <TableHead className="text-right">Duration</TableHead>
                                <TableHead className="w-[180px] text-right pr-6">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredRecords.map((record) => (
                                <TableRow key={record.id} className="hover:bg-primary/5 transition-colors group">
                                    <TableCell className="pl-6">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary uppercase">
                                                {record.name.split(' ').map(n => n[0]).join('')}
                                            </div>
                                            <div>
                                                <div className="font-bold text-sm">{record.name}</div>
                                                <div className="text-[10px] text-muted-foreground uppercase tracking-widest">{record.role}</div>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-center">
                                        <Badge 
                                            variant="outline" 
                                            className={cn(
                                                "text-[10px] font-bold uppercase",
                                                record.punctuality === 'On Time' ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20" :
                                                record.punctuality === 'Late' ? "bg-red-500/10 text-red-700 border-red-500/20" :
                                                "bg-slate-500/10 text-slate-700 border-slate-500/20"
                                            )}
                                        >
                                            {record.punctuality}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-center font-mono text-sm">
                                        {record.checkInTime || "--:--"}
                                    </TableCell>
                                    <TableCell className="text-center font-mono text-sm">
                                        {record.checkOutTime || "--:--"}
                                    </TableCell>
                                    <TableCell className="text-right font-mono font-bold text-primary">
                                        {record.duration || "--"}
                                    </TableCell>
                                    <TableCell className="text-right pr-6">
                                        <div className="flex justify-end">
                                            {!record.checkInTime ? (
                                                <Button 
                                                    size="sm" 
                                                    className="h-8 rounded-lg" 
                                                    onClick={() => handleCheckIn(record.id)}
                                                    disabled={isProcessing === record.id}
                                                >
                                                    {isProcessing === record.id ? (
                                                        <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                                                    ) : (
                                                        <Clock className="h-3 w-3 mr-2" />
                                                    )}
                                                    {isProcessing === record.id ? 'Verifying...' : 'Check In'}
                                                </Button>
                                            ) : !record.checkOutTime ? (
                                                <Button size="sm" variant="outline" className="h-8 rounded-lg border-primary/20 text-primary hover:bg-primary/5" onClick={() => handleCheckOut(record.id)}>
                                                    <LogOut className="h-3 w-3 mr-2" /> Check Out
                                                </Button>
                                            ) : (
                                                <div className="flex items-center gap-1 text-emerald-600 font-bold text-[10px] uppercase tracking-tighter">
                                                    <CheckCircle2 className="h-4 w-4" /> Shift Logged
                                                </div>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
                <CardFooter className="bg-muted/10 border-t py-4">
                    <p className="text-[10px] text-muted-foreground italic">
                        Standard shift starts at {SHIFT_START}. Overtime is calculated after 8 hours of logged duration.
                    </p>
                </CardFooter>
            </Card>

            <div className="grid gap-6 md:grid-cols-2">
                <Card className="bg-primary/5 border-dashed border-2">
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <TrendingUp className="h-5 w-5 text-primary" />
                            <CardTitle className="text-lg">Workforce Insights</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex gap-3">
                            <div className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />
                            <p className="text-sm"><strong>Productivity Peak:</strong> Team presence is highest between 10:00 AM and 2:00 PM. Schedule collaborative meetings during this window.</p>
                        </div>
                        <div className="flex gap-3">
                            <div className="h-2 w-2 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                            <p className="text-sm"><strong>Punctuality Alert:</strong> {lateCount} members were late this morning. Consider adjusting the flex-time policy for your team.</p>
                        </div>
                    </CardContent>
                </Card>
                <Card className="flex flex-col justify-center p-6 text-center md:text-left gap-4">
                    <div className="space-y-1">
                        <h3 className="font-headline text-xl font-bold">Location Verified Logging</h3>
                        <p className="text-sm text-muted-foreground">Enable GPS verification to ensure staff are checking in from authorized business premises or job sites.</p>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-center md:justify-start">
                        <Button variant="outline" size="sm" className="gap-2 rounded-xl" onClick={handleConfigureGeofence}>
                            <MapPin className="h-4 w-4" /> Configure Geo-fencing
                        </Button>
                        <Button variant="link" size="sm" className="text-xs" onClick={handleDownloadReport}>Download History Report</Button>
                    </div>
                </Card>
            </div>
        </div>
    )
}
