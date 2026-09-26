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
    ListFilter,
    MoreHorizontal,
    Phone,
    Mail,
    CheckCircle2,
    XCircle,
    Calendar as CalendarIcon
} from "lucide-react"
import { 
    Dialog, 
    DialogContent, 
    DialogDescription, 
    DialogFooter, 
    DialogHeader, 
    DialogTitle, 
    DialogTrigger,
    DialogClose 
} from "@/components/ui/dialog"
import { 
    Sheet, 
    SheetContent, 
    SheetDescription, 
    SheetHeader, 
    SheetTitle, 
    SheetTrigger 
} from "@/components/ui/sheet"
import { 
    Select, 
    SelectContent, 
    SelectItem, 
    SelectTrigger, 
    SelectValue 
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { appointments as initialAppointments, employees, catalogItems } from "@/lib/data"
import type { Appointment } from "@/lib/data"
import { format, startOfWeek, addDays, isSameDay, addHours, parseISO, startOfDay, endOfDay, isWithinInterval } from "date-fns"
import { useToast } from "@/hooks/use-toast"
import Link from "next/link"

export default function AppointmentsPage() {
    const { toast } = useToast()
    const [currentDate, setCurrentDate] = React.useState(new Date())
    const [view, setView] = React.useState<'Day' | 'Week' | 'Month'>('Week')
    const [appointments, setAppointments] = React.useState<Appointment[]>(initialAppointments)
    const [selectedAppointment, setSelectedAppointment] = React.useState<Appointment | null>(null)
    const [isBookingOpen, setIsBookingOpen] = React.useState(false)

    // Form State for New Appointment
    const [newAppt, setNewAppt] = React.useState({
        customerName: "",
        serviceId: "",
        staffId: "",
        date: format(new Date(), "yyyy-MM-dd"),
        time: "09:00"
    })

    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    const hours = Array.from({ length: 12 }, (_, i) => 8 + i) // 8 AM to 7 PM

    const handleBookAppointment = () => {
        const service = catalogItems.find(i => i.id === newAppt.serviceId)
        const staff = employees.find(e => e.id === newAppt.staffId)
        
        if (!newAppt.customerName || !service || !staff) {
            toast({
                variant: "destructive",
                title: "Missing Information",
                description: "Please fill in all fields to book the appointment."
            })
            return
        }

        const start = `${newAppt.date}T${newAppt.time}:00`
        const end = format(addHours(parseISO(start), 1), "yyyy-MM-dd'T'HH:mm:ss")

        const appointment: Appointment = {
            id: `app-${Date.now()}`,
            customerName: newAppt.customerName,
            serviceName: service.name,
            staffName: staff.name,
            startTime: start,
            endTime: end,
            status: 'Scheduled'
        }

        setAppointments(prev => [...prev, appointment])
        setIsBookingOpen(false)
        setNewAppt({
            customerName: "",
            serviceId: "",
            staffId: "",
            date: format(new Date(), "yyyy-MM-dd"),
            time: "09:00"
        })

        toast({
            title: "Appointment Booked",
            description: `${service.name} for ${newAppt.customerName} scheduled successfully.`
        })
    }

    const updateStatus = (id: string, status: Appointment['status']) => {
        setAppointments(prev => prev.map(a => a.id === id ? { ...a, status } : a))
        toast({
            title: "Status Updated",
            description: `Appointment is now ${status}.`
        })
    }

    const todayAppointments = appointments.filter(app => isSameDay(parseISO(app.startTime), new Date()))
    const billableHours = todayAppointments.reduce((acc, app) => acc + 1.5, 0) // Simplified: each appt is 1.5h for demo

    return (
        <div className="flex flex-col gap-6 pb-12">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Appointments</h1>
                    <p className="text-muted-foreground mt-1">Manage client bookings and staff availability.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => toast({ title: "Filters", description: "Filter by staff or service coming soon." })}>
                        <ListFilter className="mr-2 h-4 w-4" /> Filters
                    </Button>
                    
                    <Dialog open={isBookingOpen} onOpenChange={setIsBookingOpen}>
                        <DialogTrigger asChild>
                            <Button size="sm" className="rounded-xl shadow-lg shadow-primary/20">
                                <PlusCircle className="mr-2 h-4 w-4" /> Book Appointment
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                                <DialogTitle className="font-headline">New Booking</DialogTitle>
                                <DialogDescription>Schedule a service for a client.</DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="space-y-2">
                                    <Label>Customer Name</Label>
                                    <Input 
                                        placeholder="Search or enter name..." 
                                        value={newAppt.customerName}
                                        onChange={(e) => setNewAppt({...newAppt, customerName: e.target.value})}
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Service</Label>
                                        <Select onValueChange={(val) => setNewAppt({...newAppt, serviceId: val})}>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select service" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {catalogItems.filter(i => i.type === 'Service').map(s => (
                                                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Assigned Staff</Label>
                                        <Select onValueChange={(val) => setNewAppt({...newAppt, staffId: val})}>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select staff" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {employees.map(e => (
                                                    <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Date</Label>
                                        <Input 
                                            type="date" 
                                            value={newAppt.date}
                                            onChange={(e) => setNewAppt({...newAppt, date: e.target.value})}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Time</Label>
                                        <Input 
                                            type="time" 
                                            value={newAppt.time}
                                            onChange={(e) => setNewAppt({...newAppt, time: e.target.value})}
                                        />
                                    </div>
                                </div>
                            </div>
                            <DialogFooter>
                                <DialogClose asChild>
                                    <Button variant="outline">Cancel</Button>
                                </DialogClose>
                                <Button onClick={handleBookAppointment}>Confirm Booking</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            <div className="flex items-center justify-between bg-card border rounded-xl p-2 shadow-sm">
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setCurrentDate(addDays(currentDate, -7))}><ChevronLeft className="h-4 w-4" /></Button>
                    <div className="px-4 font-bold text-lg font-headline min-w-[180px] text-center">
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
                                        const appointmentsOnDay = appointments.filter(app => {
                                            const apptDate = parseISO(app.startTime)
                                            return isSameDay(apptDate, day) && apptDate.getHours() === hour
                                        });
                                        
                                        return (
                                            <div key={day.toString()} className="border-r last:border-r-0 relative hover:bg-muted/10 transition-colors p-1">
                                                {appointmentsOnDay.map(app => (
                                                    <Sheet key={app.id}>
                                                        <SheetTrigger asChild>
                                                            <div 
                                                                className={cn(
                                                                    "absolute inset-x-1 top-1 bottom-1 rounded-lg p-2 shadow-sm overflow-hidden border cursor-pointer transition-transform hover:scale-[1.02]",
                                                                    app.status === 'Completed' ? "bg-emerald-50 border-emerald-200 text-emerald-900" :
                                                                    app.status === 'Cancelled' ? "bg-red-50 border-red-200 text-red-900 line-through opacity-60" :
                                                                    "bg-primary text-primary-foreground border-white/20"
                                                                )}
                                                                onClick={() => setSelectedAppointment(app)}
                                                            >
                                                                <p className="text-[10px] font-bold truncate leading-tight">{app.serviceName}</p>
                                                                <p className="text-[8px] opacity-90 truncate">{app.customerName}</p>
                                                                <div className="flex items-center gap-1 mt-1 opacity-80">
                                                                    <User className="h-2 w-2" />
                                                                    <span className="text-[8px] font-medium">{app.staffName}</span>
                                                                </div>
                                                            </div>
                                                        </SheetTrigger>
                                                        <SheetContent>
                                                            <SheetHeader>
                                                                <SheetTitle className="text-2xl font-headline">{app.serviceName}</SheetTitle>
                                                                <SheetDescription>Appointment details and actions.</SheetDescription>
                                                            </SheetHeader>
                                                            <div className="py-6 space-y-6">
                                                                <div className="flex items-center gap-4 p-4 rounded-xl bg-muted/30 border">
                                                                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                                                                        <User className="h-6 w-6 text-primary" />
                                                                    </div>
                                                                    <div>
                                                                        <p className="font-bold">{app.customerName}</p>
                                                                        <p className="text-xs text-muted-foreground">Client Profile</p>
                                                                    </div>
                                                                </div>

                                                                <div className="space-y-3">
                                                                    <div className="flex items-center gap-3 text-sm">
                                                                        <CalendarIcon className="h-4 w-4 text-primary" />
                                                                        <span>{format(parseISO(app.startTime), "EEEE, MMMM do yyyy")}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-3 text-sm">
                                                                        <Clock className="h-4 w-4 text-primary" />
                                                                        <span>{format(parseISO(app.startTime), "h:mm a")} - {format(parseISO(app.endTime), "h:mm a")}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-3 text-sm">
                                                                        <User className="h-4 w-4 text-primary" />
                                                                        <span>Staff: <strong>{app.staffName}</strong></span>
                                                                    </div>
                                                                </div>

                                                                <Separator />

                                                                <div className="space-y-4">
                                                                    <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Quick Actions</p>
                                                                    <div className="grid grid-cols-2 gap-2">
                                                                        <Button variant="outline" className="justify-start gap-2" onClick={() => updateStatus(app.id, 'Confirmed')}>
                                                                            <CheckCircle2 className="h-4 w-4 text-primary" /> Confirm
                                                                        </Button>
                                                                        <Button variant="outline" className="justify-start gap-2" onClick={() => updateStatus(app.id, 'Completed')}>
                                                                            <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Complete
                                                                        </Button>
                                                                        <Button variant="outline" className="justify-start gap-2 text-red-500 hover:text-red-600" onClick={() => updateStatus(app.id, 'Cancelled')}>
                                                                            <XCircle className="h-4 w-4" /> Cancel
                                                                        </Button>
                                                                        <Button variant="outline" className="justify-start gap-2">
                                                                            <Phone className="h-4 w-4" /> Contact
                                                                        </Button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </SheetContent>
                                                    </Sheet>
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
                                Today&apos;s Summary
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">Total Sessions</span>
                                <span className="font-bold">{todayAppointments.length}</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">Billable Hours</span>
                                <span className="font-bold">{billableHours.toFixed(1)}h</span>
                            </div>
                            <Separator />
                            <div className="space-y-3">
                                <p className="text-[10px] font-bold text-muted-foreground uppercase">Upcoming Next</p>
                                {todayAppointments.length > 0 ? (
                                    <div className="p-3 rounded-xl border bg-muted/20">
                                        <p className="text-sm font-bold">{todayAppointments[0].serviceName}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {format(parseISO(todayAppointments[0].startTime), "h:mm a")} with {todayAppointments[0].customerName}
                                        </p>
                                        <div className="flex items-center gap-2 mt-2">
                                            <Badge variant="outline" className="text-[9px] bg-primary/10 text-primary uppercase">{todayAppointments[0].status}</Badge>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-xs text-muted-foreground italic">No more appointments today.</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-primary border-none shadow-xl shadow-primary/20 text-white">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm">Online Booking</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-xs opacity-90 mb-4">Your clients can now book appointments directly from your storefront.</p>
                            <Button asChild variant="secondary" className="w-full bg-white text-primary hover:bg-white/90 text-xs font-bold">
                                <Link href="/storefront">Manage Booking Page</Link>
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
