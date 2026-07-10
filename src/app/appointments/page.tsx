"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { 
    CalendarClock, 
    PlusCircle, 
    ChevronLeft, 
    ChevronRight, 
    User, 
    Clock, 
    Video, 
    MapPin,
    Search,
    ListFilter
} from "lucide-react"
import { cn } from "@/lib/utils"
import { appointments as initialAppointments } from "@/lib/data"
import { format, startOfWeek, addDays, isSameDay, addHours } from "date-fns"

export default function AppointmentsPage() {
    const [currentDate, setCurrentDate] = React.useState(new Date())
    const [view, setView] = React.useState<'Day' | 'Week' | 'Month'>('Week')
    
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    
    const hours = Array.from({ length: 12 }, (_, i) => 8 + i) // 8 AM to 7 PM

    return (
        <div className="flex flex-col gap-6 pb-12">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Appointments</h1>
                    <p className="text-muted-foreground mt-1">Manage client bookings and staff availability.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm"><ListFilter className="mr-2 h-4 w-4" /> Filters</Button>
                    <Button size="sm" className="rounded-xl shadow-lg shadow-primary/20">
                        <PlusCircle className="mr-2 h-4 w-4" /> Book Appointment
                    </Button>
                </div>
            </div>

            <div className="flex items-center justify-between bg-card border rounded-xl p-2 shadow-sm">
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setCurrentDate(addDays(currentDate, -7))}><ChevronLeft className="h-4 w-4" /></Button>
                    <div className="px-4 font-bold text-lg font-headline">
                        {format(weekStart, "MMMM yyyy")}
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setCurrentDate(addDays(currentDate, 7))}><ChevronRight className="h-4 w-4" /></Button>
                </div>
                <div className="flex items-center gap-2 bg-muted/50 rounded-lg p-1">
                    {['Day', 'Week', 'Month'].map((v) => (
                        <button
                            key={v}
                            onClick={() => setView(v as any)}
                            className={cn(
                                "px-4 py-1.5 rounded-md text-xs font-bold transition-all uppercase tracking-widest",
                                view === v ? "bg-background shadow-sm text-primary" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            {v}
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Calendar View */}
                <Card className="lg:col-span-9 overflow-hidden border-primary/5 shadow-xl shadow-primary/5">
                    <CardContent className="p-0">
                        <div className="grid grid-cols-8 border-b bg-muted/30">
                            <div className="p-4 border-r"></div>
                            {weekDays.map((day) => (
                                <div key={day.toString()} className={cn(
                                    "p-4 text-center border-r last:border-r-0",
                                    isSameDay(day, new Date()) && "bg-primary/5"
                                )}>
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{format(day, "EEE")}</p>
                                    <p className={cn(
                                        "text-lg font-bold font-headline mt-1",
                                        isSameDay(day, new Date()) && "text-primary"
                                    )}>{format(day, "d")}</p>
                                </div>
                            ))}
                        </div>
                        <div className="overflow-y-auto max-h-[600px]">
                            {hours.map((hour) => (
                                <div key={hour} className="grid grid-cols-8 border-b last:border-b-0 min-h-[80px] group">
                                    <div className="p-2 border-r text-[10px] font-bold text-muted-foreground text-right pr-4 pt-1 bg-muted/10">
                                        {format(addHours(new Date().setHours(0,0,0,0), hour), "h a")}
                                    </div>
                                    {weekDays.map((day) => {
                                        const dateStr = format(day, "yyyy-MM-dd")
                                        const appointmentsOnDay = initialAppointments.filter(app => 
                                            app.startTime.startsWith(dateStr) && 
                                            new Date(app.startTime).getHours() === hour
                                        );
                                        
                                        return (
                                            <div key={day.toString()} className="border-r last:border-r-0 relative hover:bg-muted/10 transition-colors p-1">
                                                {appointmentsOnDay.map(app => (
                                                    <div key={app.id} className="absolute inset-x-1 top-1 bottom-1 bg-primary text-white rounded-lg p-2 shadow-lg overflow-hidden border border-white/20">
                                                        <p className="text-[10px] font-bold truncate leading-tight">{app.serviceName}</p>
                                                        <p className="text-[8px] opacity-90 truncate">{app.customerName}</p>
                                                        <div className="flex items-center gap-1 mt-1 opacity-80">
                                                            <User className="h-2 w-2" />
                                                            <span className="text-[8px] font-medium">{app.staffName}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* Sidebar Details */}
                <div className="lg:col-span-3 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm font-bold flex items-center gap-2">
                                <CalendarClock className="h-4 w-4 text-primary" />
                                Today's Summary
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">Total Sessions</span>
                                <span className="font-bold">4</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">Billable Hours</span>
                                <span className="font-bold">6.5h</span>
                            </div>
                            <Separator />
                            <div className="space-y-3">
                                <p className="text-[10px] font-bold text-muted-foreground uppercase">Next Up</p>
                                <div className="p-3 rounded-xl border bg-muted/20">
                                    <p className="text-sm font-bold">Business Audit</p>
                                    <p className="text-xs text-muted-foreground">11:30 AM with Jane Smith</p>
                                    <div className="flex items-center gap-2 mt-2">
                                        <Badge variant="outline" className="text-[9px] bg-primary/10 text-primary">In-Person</Badge>
                                        <Button variant="link" size="sm" className="h-auto p-0 text-[10px]">Details →</Button>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-primary border-none shadow-xl shadow-primary/20 text-white">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm">Online Booking</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-xs opacity-90 mb-4">Your clients can now book appointments directly from your storefront.</p>
                            <Button variant="secondary" className="w-full bg-white text-primary hover:bg-white/90 text-xs font-bold">
                                View Booking Page
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
