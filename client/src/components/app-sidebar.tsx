import { Users, MessageSquare, Settings, Trophy } from "lucide-react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Settings as SettingsType } from "@shared/schema";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
} from "@/components/ui/sidebar";

const SITE_NAME = "PadelHUB";
const LEGACY_SITE_NAME = /padel\s*loyalty/i;

const items = [
  {
    title: "Jogadores",
    url: "/",
    icon: Users,
  },
  {
    title: "Non Stop",
    url: "/nonstop",
    icon: Trophy,
  },
  {
    title: "Mensagens",
    url: "/messages",
    icon: MessageSquare,
  },
  {
    title: "Configurações",
    url: "/settings",
    icon: Settings,
  },
];

import defaultLogo from "@assets/NowPadel_1767487885301.png";

export function AppSidebar() {
  const [location] = useLocation();
  const { data: settings } = useQuery<SettingsType>({
    queryKey: ["/api/settings"]
  });
  const clubName = settings?.clubName && LEGACY_SITE_NAME.test(settings.clubName)
    ? SITE_NAME
    : settings?.clubName;

  return (
    <Sidebar>
      <SidebarHeader className="p-6">
        <div className="flex flex-col items-center gap-4">
          <img 
            src={settings?.logo || defaultLogo} 
            alt={clubName || "Now Padel & Fit"} 
            className="w-32 h-auto" 
          />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location === item.url}
                    tooltip={item.title}
                  >
                    <a href={item.url}>
                      <item.icon className="w-5 h-5" />
                      <span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
