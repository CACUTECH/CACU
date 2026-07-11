"use client"
import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { employees as initialEmployees } from "@/lib/data"
import type { Employee } from "@/lib/data"
import { Check, X, Clock, LogOut } from "lucide-react"
import { format } from "date-fns"
import { useToast } from "@/hooks/use-toast"

export default function AttendancePage() {
    const { toast } = useToast()
    const [employees, setEmployees] = React.useState<Employee[]>(initialEmployees)
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const handleCheckIn = (id: string) => {
        const time = format(new Date(), "hh:mm a")
        setEmployees(employees.map(e => e.id === id ? { ...e, checkInTime: time } : e))
        toast({ title: "Checked In", description: `Recorded at ${time}` })
    }

    const handleCheckOut = (id: string) => {
        const time = format(new Date(), "hh:mm a")
        setEmployees(employees.map(e => e.id === id ? { ...e, checkOutTime: time } : e))
        toast({ title: "Checked Out", description: `Recorded at ${time}` })
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="font-headline">Daily Attendance</CardTitle>
                        <CardDescription>Attendance sheet for {today}</CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                        <TableRow>
                            <TableHead>Employee</TableHead>
                            <TableHead className="text-center">Check-in</TableHead>
                            <TableHead className="text-center">Check-out</TableHead>
                            <TableHead className="text-center">Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                        </TableHeader>
                        <TableBody>
                            {employees.filter(e => e.status !== 'Terminated').map(employee => (
                                <TableRow key={employee.id}>
                                    <TableCell>
                                        <div className="font-medium">{employee.name}</div>
                                        <div className="text-sm text-muted-foreground">{employee.role}</div>
                                    </TableCell>
                                     <TableCell className="text-center font-mono">
                                        {employee.checkInTime || "--:--"}
                                     </TableCell>
                                     <TableCell className="text-center font-mono">
                                        {employee.checkOutTime || "--:--"}
                                     </TableCell>
                                    <TableCell className="text-center">
                                        {employee.checkInTime ? 
                                            <Check className="h-5 w-5 text-green-500 mx-auto" /> : 
                                            <X className="h-5 w-5 text-red-500 mx-auto" />
                                        }
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {!employee.checkInTime ? (
                                            <Button size="sm" onClick={() => handleCheckIn(employee.id)}>
                                                <Clock className="h-4 w-4 mr-2" /> Check In
                                            </Button>
                                        ) : !employee.checkOutTime ? (
                                            <Button size="sm" variant="outline" onClick={() => handleCheckOut(employee.id)}>
                                                <LogOut className="h-4 w-4 mr-2" /> Check Out
                                            </Button>
                                        ) : (
                                            <span className="text-xs text-muted-foreground italic">Completed</span>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    )
}
