import { Bell, Building2, CalendarCheck, CalendarDays, CalendarRange, CreditCard, Dumbbell, LayoutDashboard, LogOut, MessageSquare, User, Users } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import QuickNoteButton from '@/components/layout/QuickNoteButton';
import { useQuery } from '@tanstack/react-query';
import { alertApi, alertKeys } from '@/services/alerts';

const clinicItems = [
  { to: '/dashboard', label: 'Dashboard',  icon: LayoutDashboard },
  { to: '/agenda',    label: 'Agenda',     icon: CalendarRange },
  { to: '/patients',  label: 'Pacientes',  icon: Users },
  { to: '/turnos',    label: 'Turnos',     icon: CalendarCheck },
  { to: '/sessions',  label: 'Sesiones',   icon: CalendarDays },
  { to: '/payments',  label: 'Cobros',     icon: CreditCard },
  { to: '/alerts',    label: 'Alertas',    icon: Bell },
  { to: '/exercises', label: 'Ejercicios', icon: Dumbbell },
  { to: '/messages',  label: 'Mensajes',   icon: MessageSquare },
];

const settingsItems = [
  { to: '/clinic', label: 'Clínica', icon: Building2 },
  { to: '/account', label: 'Mi cuenta', icon: User },
];

function NavItems({
  items,
}: {
  items: { to: string; label: string; icon: React.ElementType; disabled?: boolean }[];
}) {
  return (
    <SidebarMenu>
      {items.map(({ to, label, icon: Icon, disabled }) =>
        disabled ? (
          <SidebarMenuItem key={to}>
            <SidebarMenuButton
              tooltip={`${label} (próximamente)`}
              className="text-muted-foreground cursor-not-allowed opacity-50"
            >
              <Icon />
              <span>{label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : (
          <SidebarMenuItem key={to}>
            <NavLink to={to}>
              {({ isActive }) => (
                <SidebarMenuButton isActive={isActive} tooltip={label}>
                  <Icon />
                  <span>{label}</span>
                </SidebarMenuButton>
              )}
            </NavLink>
          </SidebarMenuItem>
        ),
      )}
    </SidebarMenu>
  );
}

export default function AppLayout() {
  // RequireAuth garantiza que hay sesión cuando este layout se renderiza.
  const { user, logout } = useAuth();
  const displayName = user?.name ?? user?.email ?? '';

  const { data: stats } = useQuery({
    queryKey: alertKeys.stats,
    queryFn: alertApi.stats,
    refetchInterval: 60_000,
  });
  const unreadAlertCount = stats?.unread ?? 0;

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <div className="px-2 py-2">
            <span className="font-semibold text-base tracking-tight">Ficha RPG</span>
          </div>
        </SidebarHeader>
        <Separator />

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Clínica</SidebarGroupLabel>
            <SidebarGroupContent>
              <NavItems items={clinicItems} />
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Configuración</SidebarGroupLabel>
            <SidebarGroupContent>
              <NavItems items={settingsItems} />
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <Separator />
          <SidebarMenu>
            <SidebarMenuItem>
              <NavLink to="/account">
                {({ isActive }) => (
                  <SidebarMenuButton isActive={isActive} tooltip={user?.email} className="h-auto py-2">
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-semibold shrink-0">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium truncate">{displayName}</span>
                      <span className="text-xs text-muted-foreground truncate">{user?.email}</span>
                    </div>
                  </SidebarMenuButton>
                )}
              </NavLink>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Cerrar sesión" onClick={logout}>
                <LogOut />
                <span>Cerrar sesión</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="flex items-center h-12 px-4 border-b shrink-0">
          <SidebarTrigger className="-ml-1" />
          <div className="flex-1" />
          <Link to="/alerts" className="relative p-1.5 rounded-md hover:bg-muted transition-colors">
            <Bell className="h-5 w-5 text-muted-foreground" />
            {unreadAlertCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                {unreadAlertCount}
              </span>
            )}
          </Link>
        </header>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
        <QuickNoteButton />
      </SidebarInset>
    </SidebarProvider>
  );
}
