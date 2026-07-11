"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { UserPlus, MoreHorizontal, UserCog, Trash2, Mail, ShieldCheck, Lock } from 'lucide-react';
import { 
    DropdownMenu, 
    DropdownMenuContent, 
    DropdownMenuItem, 
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogClose,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type UserRole = "Owner" | "Admin" | "Editor" | "Viewer";
type UserStatus = "Active" | "Pending" | "Inactive";

const MODULES = [
    { id: 'pos', label: 'POS Checkout' },
    { id: 'appointments', label: 'Appointments' },
    { id: 'jobs', label: 'Work Orders' },
    { id: 'transactions', label: 'Transactions' },
    { id: 'invoices', label: 'Invoices & Billing' },
    { id: 'catalog', label: 'Catalog / Inventory' },
    { id: 'accounting', label: 'Accounting' },
    { id: 'reports', label: 'Financial Reports' },
    { id: 'hr', label: 'Human Resources' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'customers', label: 'Customers (CRM)' },
    { id: 'community', label: 'Community' },
    { id: 'apps', label: 'Integrations' },
];

interface User {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    status: UserStatus;
    permissions: string[]; // List of module IDs they can see
}

const initialUsers: User[] = [
    { id: "1", name: "Jane Doe", email: "jane@example.com", role: "Owner", status: "Active", permissions: MODULES.map(m => m.id) },
    { id: "2", name: "John Smith", email: "john@example.com", role: "Admin", status: "Active", permissions: MODULES.map(m => m.id) },
    { id: "3", name: "Samuel Okoro", email: "samuel@example.com", role: "Editor", status: "Active", permissions: ['pos', 'catalog', 'customers'] },
    { id: "4", name: "Grace Adebayo", email: "grace@example.com", role: "Viewer", status: "Pending", permissions: ['reports', 'analytics'] },
];

function PermissionSelector({ 
    selected, 
    onChange, 
    disabled 
}: { 
    selected: string[], 
    onChange: (ids: string[]) => void, 
    disabled?: boolean 
}) {
    const toggle = (id: string) => {
        if (selected.includes(id)) {
            onChange(selected.filter(i => i !== id));
        } else {
            onChange([...selected, id]);
        }
    };

    return (
        <div className="space-y-3 mt-4">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Lock className="h-3 w-3" /> Module Access Control
            </Label>
            <div className={cn("grid grid-cols-1 gap-2 p-4 rounded-xl border bg-muted/30", disabled && "opacity-50 grayscale")}>
                {MODULES.map((mod) => (
                    <div key={mod.id} className="flex items-center space-x-2 py-1">
                        <Checkbox 
                            id={`mod-${mod.id}`} 
                            checked={disabled ? true : selected.includes(mod.id)} 
                            onCheckedChange={() => !disabled && toggle(mod.id)}
                            disabled={disabled}
                        />
                        <label htmlFor={`mod-${mod.id}`} className="text-sm font-medium leading-none cursor-pointer select-none">
                            {mod.label}
                        </label>
                    </div>
                ))}
                {disabled && (
                    <p className="text-[10px] text-primary font-bold mt-2 italic">
                        * Admins and Owners have full access to all modules by default.
                    </p>
                )}
            </div>
        </div>
    );
}

function InviteUserDialog({ onInvite }: { onInvite: (user: Omit<User, "id" | "status">) => void }) {
    const [name, setName] = React.useState("");
    const [email, setEmail] = React.useState("");
    const [role, setRole] = React.useState<UserRole>("Viewer");
    const [permissions, setPermissions] = React.useState<string[]>([]);
    const [isOpen, setIsOpen] = React.useState(false);

    const handleInvite = () => {
        if (name && email && role) {
            onInvite({ name, email, role, permissions: (role === 'Admin' || role === 'Owner') ? MODULES.map(m => m.id) : permissions });
            setIsOpen(false);
            setName("");
            setEmail("");
            setRole("Viewer");
            setPermissions([]);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button className="rounded-xl shadow-lg shadow-primary/20">
                    <UserPlus className="mr-2 h-4 w-4" />
                    Invite Member
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col p-0 overflow-hidden">
                <DialogHeader className="p-6 pb-2">
                    <DialogTitle className="font-headline text-xl">Invite Team Member</DialogTitle>
                    <DialogDescription>
                        Send an invitation to join your business ecosystem.
                    </DialogDescription>
                </DialogHeader>
                <ScrollArea className="flex-1 px-6">
                    <div className="grid gap-4 py-4 pb-12">
                        <div className="space-y-2">
                            <Label htmlFor="invite-name">Full Name</Label>
                            <Input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. John Doe" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="invite-email">Email Address</Label>
                            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="invite-role">Access Role</Label>
                            <Select value={role} onValueChange={(val: UserRole) => setRole(val)}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select a role" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Admin">Admin (Full Access)</SelectItem>
                                    <SelectItem value="Editor">Editor (Can edit records)</SelectItem>
                                    <SelectItem value="Viewer">Viewer (Read-only)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        
                        <PermissionSelector 
                            selected={permissions} 
                            onChange={setPermissions} 
                            disabled={role === 'Admin' || role === 'Owner'} 
                        />
                    </div>
                </ScrollArea>
                <DialogFooter className="p-6 border-t bg-muted/10">
                    <DialogClose asChild>
                        <Button type="button" variant="secondary">Cancel</Button>
                    </DialogClose>
                    <Button type="submit" onClick={handleInvite} disabled={!name || !email}>Send Invitation</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function EditRoleDialog({ user, onUpdate, open, onOpenChange }: { user: User | null, onUpdate: (id: string, role: UserRole, perms: string[]) => void, open: boolean, onOpenChange: (open: boolean) => void }) {
    const [role, setRole] = React.useState<UserRole>(user?.role || "Viewer");
    const [permissions, setPermissions] = React.useState<string[]>(user?.permissions || []);

    React.useEffect(() => {
        if (user) {
            setRole(user.role);
            setPermissions(user.permissions);
        }
    }, [user]);

    const handleSave = () => {
        if (user) {
            const finalPerms = (role === 'Admin' || role === 'Owner') ? MODULES.map(m => m.id) : permissions;
            onUpdate(user.id, role, finalPerms);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col p-0 overflow-hidden">
                <DialogHeader className="p-6 pb-2">
                    <DialogTitle className="font-headline text-xl">Manage Permissions</DialogTitle>
                    <DialogDescription>
                        Update the access level and modules for {user?.name}.
                    </DialogDescription>
                </DialogHeader>
                <ScrollArea className="flex-1 px-6">
                    <div className="grid gap-4 py-4 pb-12">
                        <div className="space-y-2">
                            <Label>Role</Label>
                            <Select value={role} onValueChange={(val: UserRole) => setRole(val)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Owner">Owner</SelectItem>
                                    <SelectItem value="Admin">Admin</SelectItem>
                                    <SelectItem value="Editor">Editor</SelectItem>
                                    <SelectItem value="Viewer">Viewer</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        
                        <PermissionSelector 
                            selected={permissions} 
                            onChange={setPermissions} 
                            disabled={role === 'Admin' || role === 'Owner'} 
                        />
                    </div>
                </ScrollArea>
                <DialogFooter className="p-6 border-t bg-muted/10">
                    <DialogClose asChild>
                        <Button type="button" variant="secondary">Cancel</Button>
                    </DialogClose>
                    <Button type="submit" onClick={handleSave}>Update Access</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default function UserManagementPage() {
    const [users, setUsers] = React.useState<User[]>(initialUsers);
    const [editingUser, setEditingUser] = React.useState<User | null>(null);
    const [isEditOpen, setIsEditOpen] = React.useState(false);
    const { toast } = useToast();

    const handleInvite = (userData: Omit<User, "id" | "status">) => {
        const newUser: User = {
            id: crypto.randomUUID(),
            ...userData,
            status: "Pending"
        };
        setUsers(prev => [...prev, newUser]);
        toast({
            title: "Invitation Sent",
            description: `We've sent an invite to ${userData.email}.`,
        });
    };

    const handleUpdateRole = (id: string, role: UserRole, permissions: string[]) => {
        setUsers(prev => prev.map(u => u.id === id ? { ...u, role, permissions } : u));
        setIsEditOpen(false);
        toast({
            title: "Access Updated",
            description: "Permissions and roles have been successfully modified.",
        });
    };

    const handleRemoveUser = (id: string) => {
        setUsers(prev => prev.filter(u => u.id !== id));
        toast({
            title: "User Removed",
            description: "The team member has been removed from your workspace.",
        });
    };

    const handleResendInvite = (email: string) => {
        toast({
            title: "Invite Resent",
            description: `A fresh invitation has been sent to ${email}.`,
        });
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">User Management</h1>
                    <p className="text-muted-foreground mt-1">Manage team permissions and role-based module access.</p>
                </div>
                <InviteUserDialog onInvite={handleInvite} />
            </div>

            <Card className="shadow-xl shadow-primary/5 border-primary/10">
                <CardHeader>
                    <CardTitle className="font-headline">Team Members</CardTitle>
                    <CardDescription>Collaborate with fine-grained control over what each staff member can see.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-xl border overflow-hidden">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead>User</TableHead>
                                    <TableHead>Role</TableHead>
                                    <TableHead className="hidden md:table-cell">Module Access</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {users.map((user) => (
                                    <TableRow key={user.id} className="hover:bg-primary/5 transition-colors">
                                        <TableCell>
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs uppercase">
                                                    {user.name.split(' ').map(n => n[0]).join('')}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-sm">{user.name}</span>
                                                    <span className="text-xs text-muted-foreground">{user.email}</span>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="bg-background flex items-center gap-1 w-fit">
                                                <ShieldCheck className="h-3 w-3 text-primary" />
                                                {user.role}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="hidden md:table-cell">
                                            <div className="flex flex-wrap gap-1 max-w-[200px]">
                                                {user.role === 'Admin' || user.role === 'Owner' ? (
                                                    <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-tighter">Full Suite Access</span>
                                                ) : user.permissions.length === 0 ? (
                                                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tighter italic">No Access Assigned</span>
                                                ) : (
                                                    user.permissions.slice(0, 3).map(p => (
                                                        <Badge key={p} variant="secondary" className="text-[9px] h-4 py-0 px-1">
                                                            {MODULES.find(m => m.id === p)?.label.split(' ')[0]}
                                                        </Badge>
                                                    ))
                                                )}
                                                {user.permissions.length > 3 && !(user.role === 'Admin' || user.role === 'Owner') && (
                                                    <span className="text-[9px] text-muted-foreground font-bold">+{user.permissions.length - 3} more</span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={user.status === 'Active' ? 'default' : 'secondary'} className={
                                                user.status === 'Active' ? 'bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20' : ''
                                            }>
                                                {user.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="rounded-full">
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="rounded-xl">
                                                    <DropdownMenuLabel>Member Actions</DropdownMenuLabel>
                                                    <DropdownMenuItem onClick={() => {
                                                        setEditingUser(user);
                                                        setIsEditOpen(true);
                                                    }}>
                                                        <UserCog className="mr-2 h-4 w-4" />
                                                        Manage Permissions
                                                    </DropdownMenuItem>
                                                    {user.status === 'Pending' && (
                                                        <DropdownMenuItem onClick={() => handleResendInvite(user.email)}>
                                                            <Mail className="mr-2 h-4 w-4" />
                                                            Resend Invite
                                                        </DropdownMenuItem>
                                                    )}
                                                    <DropdownMenuSeparator />
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <DropdownMenuItem 
                                                                className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                                                onSelect={(e) => e.preventDefault()}
                                                            >
                                                                <Trash2 className="mr-2 h-4 w-4" />
                                                                Remove User
                                                            </DropdownMenuItem>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    This will revoke all access for <strong>{user.name}</strong>. They will no longer be able to view or edit business data.
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                <AlertDialogAction 
                                                                    onClick={() => handleRemoveUser(user.id)}
                                                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                                >
                                                                    Confirm Removal
                                                                </AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <EditRoleDialog 
                user={editingUser} 
                onUpdate={handleUpdateRole} 
                open={isEditOpen} 
                onOpenChange={setIsEditOpen} 
            />

            <Card className="bg-primary/5 border-dashed border-2">
                <CardHeader>
                    <CardTitle className="text-base">Security & Access Note</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                    Owners and Admins always have unrestricted access to all features. Use the "Editor" or "Viewer" roles to grant limited access to specific sub-modules like POS or Reports for your operational staff.
                </CardContent>
            </Card>
        </div>
    );
}
