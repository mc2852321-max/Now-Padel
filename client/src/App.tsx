import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Players from "@/pages/players";
import Nonstop from "@/pages/nonstop";
import Messages from "@/pages/messages";
import Settings from "@/pages/settings";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useQuery } from "@tanstack/react-query";
import type { Settings as SettingsType } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LogIn, LogOut, Loader2, AlertCircle, Eye, EyeOff, User, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Players} />
      <Route path="/nonstop" component={Nonstop} />
      <Route path="/messages" component={Messages} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

import logoUrl from "@assets/NowPadel_1767487885301.png";
import padelBgImage from "@assets/generated_images/enclosed_padel_court_glass_walls.png";

function LoginPage() {
  const { login, isLoggingIn, loginError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login({ email, password });
    } catch (err: any) {
      setError(err.message || "Erro ao fazer login");
    }
  };
  
  return (
    <div 
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        backgroundImage: `url(${padelBgImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}
    >
      <div className="absolute inset-0 bg-black/40" />
      <Card className="w-full max-w-md relative z-10 shadow-2xl">
        <CardHeader className="text-center space-y-4">
          <img src={logoUrl} alt="Now Padel & Fit" className="h-16 mx-auto" />
          <CardTitle className="text-2xl font-bold">Bem-vindo</CardTitle>
          <CardDescription>
            Faça login para aceder ao painel de gestão do clube
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {(error || loginError) && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error || loginError}</span>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="input-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative flex items-center">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="A sua password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pr-10"
                  data-testid="input-password"
                />
                <button
                  type="button"
                  className="absolute right-2 inset-y-0 flex items-center"
                  onClick={() => setShowPassword(!showPassword)}
                  data-testid="button-toggle-password"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              </div>
            </div>
            <Button 
              type="submit"
              className="w-full h-12 text-lg gap-2 bg-orange-600 hover:bg-orange-500"
              disabled={isLoggingIn}
              data-testid="button-login"
            >
              {isLoggingIn ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <LogIn className="w-5 h-5" />
              )}
              {isLoggingIn ? "A entrar..." : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-orange-50">
      <div className="text-center space-y-4">
        <Loader2 className="w-12 h-12 animate-spin text-orange-600 mx-auto" />
        <p className="text-muted-foreground">A carregar...</p>
      </div>
    </div>
  );
}

function App() {
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const { data: settings } = useQuery<SettingsType>({
    queryKey: ["/api/settings"],
    enabled: isAuthenticated
  });

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  const logoToDisplay = settings?.logo || logoUrl;

  const style = {
    "--sidebar-width": "18rem",
    "--sidebar-width-icon": "4rem",
    "--primary": settings?.primaryColor ? (function() {
      try {
        const hex = settings.primaryColor.replace('#', '');
        if (!/^[0-9A-Fa-f]{6}$/.test(hex)) return "24 95% 53%";
        const r = parseInt(hex.substring(0, 2), 16) / 255;
        const g = parseInt(hex.substring(2, 4), 16) / 255;
        const b = parseInt(hex.substring(4, 6), 16) / 255;
        if (isNaN(r) || isNaN(g) || isNaN(b)) return "24 95% 53%";
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        if (max === min) { 
          h = 0;
          s = 0; 
        } else {
          const d = max - min;
          s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
          switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
            default: h = 0;
          }
          h /= 6;
        }
        return `${Math.round((h || 0) * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
      } catch {
        return "24 95% 53%";
      }
    })() : "24 95% 53%",
  };

  return (
    <TooltipProvider>
      <SidebarProvider style={style as React.CSSProperties}>
        <div className="flex h-screen w-full bg-background">
          <AppSidebar />
          <div className="flex flex-col flex-1 overflow-hidden">
            <header className="flex items-center justify-between gap-2 sm:gap-4 px-3 sm:px-4 md:px-6 h-16 md:h-24 shrink-0 shadow-xl bg-slate-900 border-b-4 border-orange-500 z-50 relative">
              <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                <SidebarTrigger data-testid="button-sidebar-toggle" className="text-white hover:bg-slate-700" />
                <img src={logoToDisplay} alt="Logo" className="h-10 sm:h-12 md:h-14 w-auto bg-white rounded-lg p-1" />
                <h1 className="text-lg sm:text-xl md:text-2xl font-extrabold tracking-wide text-orange-500 truncate">
                  {settings?.clubName || "Painel de Gestão"}
                </h1>
              </div>
              <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                {user && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button 
                        variant="ghost" 
                        className="gap-2 text-white hover:bg-slate-700 px-2 sm:px-4 py-2"
                        data-testid="button-user-menu"
                      >
                        <User className="w-5 h-5" />
                        <span className="hidden md:inline font-medium max-w-44 truncate">{user.name || user.email}</span>
                        <ChevronDown className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel>Minha Conta</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        onClick={() => logout()}
                        data-testid="menu-logout"
                        className="text-red-600 focus:text-red-600"
                      >
                        <LogOut className="w-4 h-4 mr-2" />
                        Sair
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </header>
            <main 
              className="flex-1 overflow-auto p-3 sm:p-4 md:p-8 padel-bg"
              style={{
                backgroundImage: `linear-gradient(rgba(247, 244, 240, 0.68), rgba(247, 244, 240, 0.68)), url(${padelBgImage})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
                backgroundAttachment: 'scroll'
              }}
            >
              <Router />
            </main>
          </div>
        </div>
      </SidebarProvider>
      <Toaster />
    </TooltipProvider>
  );
}

export default function AppWrapper() {
  return (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
}

