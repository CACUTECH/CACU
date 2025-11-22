
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
import { Check, X } from "lucide-react"

export default function AttendancePage() {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

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
                        </TableRow>
                        </TableHeader>
                        <TableBody>
                            {initialEmployees.filter(e => e.status !== 'Terminated').map(employee => (
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
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    )
}
