import { Building2, CalendarCheck, CalendarDays, CalendarRange, CreditCard, Dumbbell, LayoutDashboard, MessageSquare, Stethoscope, User, Users } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
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

const clinicItems = [
  { to: '/dashboard', label: 'Dashboard',  icon: LayoutDashboard },
  { to: '/agenda',    label: 'Agenda',     icon: CalendarRange },
  { to: '/patients',  label: 'Pacientes',  icon: Users },
  { to: '/turnos',    label: 'Turnos',     icon: CalendarCheck },
  { to: '/sessions',  label: 'Sesiones',   icon: CalendarDays },
  { to: '/payments',  label: 'Cobros',     icon: CreditCard },
  { to: '/exercises', label: 'Ejercicios', icon: Dumbbell },
  { to: '/messages',  label: 'Mensajes',   icon: MessageSquare },
];

const settingsItems = [
  { to: '/techniques', label: 'Técnicas', icon: Stethoscope },
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

// Usuario hardcodeado hasta que se implemente JWT.
const DEV_USER = { name: 'Admin Demo', email: 'admin@ficha.dev' };

export default function AppLayout() {
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
                  <SidebarMenuButton isActive={isActive} tooltip={DEV_USER.email} className="h-auto py-2">
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-semibold shrink-0">
                      {DEV_USER.name.charAt(0)}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium truncate">{DEV_USER.name}</span>
                      <span className="text-xs text-muted-foreground truncate">{DEV_USER.email}</span>
                    </div>
                  </SidebarMenuButton>
                )}
              </NavLink>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="flex items-center h-12 px-4 border-b shrink-0">
          <SidebarTrigger className="-ml-1" />
        </header>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
