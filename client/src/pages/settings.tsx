import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormField, FormItem, FormLabel, FormDescription, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { useToast } from "@/hooks/use-toast";
import { Image, Loader2, Volume2, UserPlus, Trash2, Shield, Key, Eye, EyeOff } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Settings as SettingsType, AuthorizedUser } from "@shared/schema";
import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

type DurationConfig = {
  soundDurationTarget?: string;
  soundDurationSeconds?: number;
  airHornDuration?: number;
};

function getConfiguredDuration(soundType: string, config?: DurationConfig) {
  const fallback = Math.max(1, config?.airHornDuration ?? 5);
  const configured = Math.max(1, config?.soundDurationSeconds ?? fallback);
  return soundType === (config?.soundDurationTarget ?? "air-horn") ? configured : null;
}

export function playPreviewSound(soundType: string, config?: DurationConfig) {
  const frequency = soundType === 'beep-high' ? 880 : 
                    soundType === 'beep-low' ? 440 :
                    soundType === 'horn-deep' ? 60 :
                    soundType === 'air-horn' ? 85 :
                    soundType.includes('horn') ? 100 : 440;
  
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  
  const playBeep = (delay: number, duration: number = 0.4, isHorn: boolean = false) => {
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc1.type = isHorn ? 'sawtooth' : 'square';
    osc2.type = isHorn ? 'square' : 'square';
    
    osc1.frequency.setValueAtTime(frequency, ctx.currentTime + delay);
    osc2.frequency.setValueAtTime(frequency * 1.01, ctx.currentTime + delay);
    
    if (isHorn) {
      osc1.frequency.setValueAtTime(frequency, ctx.currentTime + delay);
      osc1.frequency.linearRampToValueAtTime(frequency * 0.98, ctx.currentTime + delay + duration);
      osc2.frequency.setValueAtTime(frequency * 1.01, ctx.currentTime + delay);
      osc2.frequency.linearRampToValueAtTime(frequency * 0.99, ctx.currentTime + delay + duration);
    }
    
    gain.gain.setValueAtTime(0, ctx.currentTime + delay);
    gain.gain.linearRampToValueAtTime(isHorn ? 0.4 : 0.1, ctx.currentTime + delay + 0.05);
    gain.gain.setValueAtTime(isHorn ? 0.4 : 0.1, ctx.currentTime + delay + duration - 0.1);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + delay + duration);
    
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    
    osc1.start(ctx.currentTime + delay);
    osc2.start(ctx.currentTime + delay);
    osc1.stop(ctx.currentTime + delay + duration);
    osc2.stop(ctx.currentTime + delay + duration);
  };

  const configuredDuration = getConfiguredDuration(soundType, config);

  if (soundType === 'air-horn') {
    playBeep(0, configuredDuration ?? 5.0, true);
  } else if (soundType === 'horn' || soundType === 'horn-deep') {
    playBeep(0, configuredDuration ?? 3.0, true);
  } else if (soundType === 'horn-double') {
    playBeep(0, 1.2, true);
    playBeep(1.5, 1.5, true);
  } else if (soundType.includes('long')) {
    const duration = configuredDuration ?? 1.0;
    playBeep(0, duration);
    playBeep(duration + 0.2, duration);
  } else {
    playBeep(0, 0.4);
    playBeep(0.5, 0.4);
    playBeep(1.0, 0.4);
  }
}

const addUserSchema = z.object({
  email: z.string().email("Email inválido").min(1, "O email é obrigatório"),
  name: z.string().optional(),
});

function AuthorizedUsersSection() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: authorizedUsers = [], isLoading } = useQuery<AuthorizedUser[]>({
    queryKey: ["/api/authorized-users"]
  });

  const addUserForm = useForm({
    resolver: zodResolver(addUserSchema),
    defaultValues: { email: "", name: "" }
  });

  const addMutation = useMutation({
    mutationFn: async (data: { email: string; name?: string }) => {
      const res = await apiRequest("POST", "/api/authorized-users", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/authorized-users"] });
      toast({ title: "Utilizador adicionado", description: "O email foi adicionado à lista de utilizadores autorizados." });
      addUserForm.reset();
      setDialogOpen(false);
    },
    onError: (error: any) => {
      toast({ 
        title: "Erro", 
        description: error.message || "Não foi possível adicionar o utilizador.", 
        variant: "destructive" 
      });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/authorized-users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/authorized-users"] });
      toast({ title: "Utilizador removido", description: "O email foi removido da lista." });
    }
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-6 h-6 text-orange-600" />
            <div>
              <CardTitle>Utilizadores Autorizados</CardTitle>
              <CardDescription>
                Controla quem pode aceder ao painel de gestão do clube.
              </CardDescription>
            </div>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button type="button" className="gap-2" data-testid="button-add-authorized-user">
                <UserPlus className="w-4 h-4" />
                Adicionar
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Adicionar Utilizador Autorizado</DialogTitle>
                <DialogDescription>
                  Adicione um email à lista de utilizadores que podem aceder à aplicação.
                </DialogDescription>
              </DialogHeader>
              <Form {...addUserForm}>
                <form onSubmit={addUserForm.handleSubmit((data) => addMutation.mutate(data))} className="space-y-4">
                  <FormField
                    control={addUserForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input placeholder="email@exemplo.com" {...field} data-testid="input-authorized-email" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={addUserForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nome (opcional)</FormLabel>
                        <FormControl>
                          <Input placeholder="Nome do utilizador" {...field} data-testid="input-authorized-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button type="submit" disabled={addMutation.isPending} data-testid="button-confirm-add-user">
                      {addMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Adicionar
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : authorizedUsers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Sem restrições de acesso</p>
            <p className="text-sm mt-1">
              Qualquer utilizador pode fazer login. Adicione emails para restringir o acesso.
            </p>
          </div>
        ) : (
          <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {authorizedUsers.map((user) => (
                <TableRow key={user.id} data-testid={`row-authorized-user-${user.id}`}>
                  <TableCell className="font-medium">{user.email}</TableCell>
                  <TableCell className="text-muted-foreground">{user.name || "-"}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-red-500 hover:text-red-600 hover:bg-red-50"
                      onClick={() => deleteMutation.mutate(user.id)}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-authorized-user-${user.id}`}
                      title="Remover utilizador"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ChangePasswordSection() {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const changePasswordMutation = useMutation({
    mutationFn: async (data: { currentPassword: string; newPassword: string }) => {
      const res = await apiRequest("POST", "/api/auth/change-password", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Sucesso", description: "Palavra-passe alterada com sucesso." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setShowConfirmPassword(false);
    },
    onError: (err: any) => {
      toast({
        title: "Erro",
        description: err.message || "Não foi possível alterar a palavra-passe.",
        variant: "destructive",
      });
    },
  });

  const handleChangePassword = () => {
    if (newPassword !== confirmPassword) {
      toast({ title: "Erro", description: "As palavras-passe não coincidem.", variant: "destructive" });
      return;
    }
    if (newPassword.length < 4) {
      toast({ title: "Erro", description: "A nova palavra-passe deve ter pelo menos 4 caracteres.", variant: "destructive" });
      return;
    }
    changePasswordMutation.mutate({ currentPassword, newPassword });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Key className="w-6 h-6 text-orange-600" />
          <div>
            <CardTitle>Alterar Palavra-passe</CardTitle>
            <CardDescription>Atualize a palavra-passe de acesso à plataforma.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="settings-current-password">Palavra-passe atual</Label>
          <div className="relative">
            <Input
              id="settings-current-password"
              type={showCurrentPassword ? "text" : "password"}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Introduza a palavra-passe atual"
              className="pr-10"
            />
            <button
              type="button"
              className="absolute right-2 inset-y-0 flex items-center"
              onClick={() => setShowCurrentPassword((v) => !v)}
            >
              {showCurrentPassword ? (
                <EyeOff className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Eye className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="settings-new-password">Nova palavra-passe</Label>
          <div className="relative">
            <Input
              id="settings-new-password"
              type={showNewPassword ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Introduza a nova palavra-passe"
              className="pr-10"
            />
            <button
              type="button"
              className="absolute right-2 inset-y-0 flex items-center"
              onClick={() => setShowNewPassword((v) => !v)}
            >
              {showNewPassword ? (
                <EyeOff className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Eye className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="settings-confirm-password">Confirmar nova palavra-passe</Label>
          <div className="relative">
            <Input
              id="settings-confirm-password"
              type={showConfirmPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repita a nova palavra-passe"
              className="pr-10"
            />
            <button
              type="button"
              className="absolute right-2 inset-y-0 flex items-center"
              onClick={() => setShowConfirmPassword((v) => !v)}
            >
              {showConfirmPassword ? (
                <EyeOff className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Eye className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </div>
        </div>

        <Button
          type="button"
          className="w-full sm:w-auto bg-orange-600 text-white hover:bg-orange-500"
          onClick={handleChangePassword}
          disabled={
            !currentPassword ||
            !newPassword ||
            !confirmPassword ||
            newPassword !== confirmPassword ||
            changePasswordMutation.isPending
          }
          data-testid="button-change-password-settings"
        >
          {changePasswordMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Guardar nova palavra-passe
        </Button>
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const { toast } = useToast();
  
  const { data: settings, isLoading } = useQuery<SettingsType>({
    queryKey: ["/api/settings"]
  });

  const form = useForm({
    defaultValues: {
      clubName: "Now Padel & Fit",
      primaryColor: "#f97316",
      website: "https://nowpadel.pt",
      whatsappNotifications: true,
      emailNotifications: false,
      publicRegistration: true,
      nonstopCourts: 3,
      nonstopRounds: 5,
      warmupTime: 5,
      gameTime: 20,
      restTime: 2,
      airHornDuration: 5,
      soundDurationTarget: "air-horn",
      soundDurationSeconds: 5,
      startWarmupSound: "beep-low",
      startGameSound: "beep-high",
      endGameSound: "beep-low",
      finalSound: "beep-high",
      tieBreaker: "direct"
    }
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        clubName: settings.clubName,
        primaryColor: settings.primaryColor,
        website: settings.website,
        whatsappNotifications: settings.whatsappNotifications === 1,
        emailNotifications: settings.emailNotifications === 1,
        publicRegistration: settings.publicRegistration === 1,
        nonstopCourts: settings.nonstopCourts,
        nonstopRounds: settings.nonstopRounds,
        warmupTime: settings.warmupTime,
        gameTime: settings.gameTime,
        restTime: settings.restTime,
        airHornDuration: settings.airHornDuration ?? 5,
        soundDurationTarget: settings.soundDurationTarget ?? "air-horn",
        soundDurationSeconds: settings.soundDurationSeconds ?? settings.airHornDuration ?? 5,
        startWarmupSound: settings.startWarmupSound,
        startGameSound: settings.startGameSound,
        endGameSound: settings.endGameSound,
        finalSound: settings.finalSound,
        tieBreaker: settings.tieBreaker
      });
    }
  }, [settings, form]);

  const [activeTab, setActiveTab] = useState("nonstop");

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/settings", {
        ...data,
        whatsappNotifications: data.whatsappNotifications ? 1 : 0,
        emailNotifications: data.emailNotifications ? 1 : 0,
        publicRegistration: data.publicRegistration ? 1 : 0
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Definições guardadas", description: "As alterações foram aplicadas com sucesso." });
    }
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6 pb-10">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight">Definições</h2>
        <p className="text-muted-foreground">Gere as definições do teu clube.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 h-auto">
          <TabsTrigger className="text-[11px] sm:text-sm" value="nonstop" data-testid="tab-nonstop">Non Stop</TabsTrigger>
          <TabsTrigger className="text-[11px] sm:text-sm" value="visual" data-testid="tab-visual">Identidade Visual</TabsTrigger>
          <TabsTrigger className="text-[11px] sm:text-sm" value="access" data-testid="tab-access">Acesso</TabsTrigger>
        </TabsList>

        {activeTab !== "access" && (
          <Form {...form}>
            <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))} className="space-y-6">
              <TabsContent value="nonstop" className="space-y-6 mt-6" forceMount={activeTab === "nonstop" ? true : undefined}>
              <Card>
                <CardHeader>
                  <CardTitle>Configuração do Torneio</CardTitle>
                  <CardDescription>Defina os parâmetros base para o Non Stop.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField control={form.control} name="nonstopCourts" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Campos em Jogo</FormLabel>
                        <Select value={field.value?.toString()} onValueChange={(v) => field.onChange(parseInt(v))}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>{[2, 3, 4, 5, 6].map(n => <SelectItem key={n} value={n.toString()}>{n} Campos</SelectItem>)}</SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="nonstopRounds" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Número de Rondas</FormLabel>
                        <Select value={field.value?.toString()} onValueChange={(v) => field.onChange(parseInt(v))}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>{[3, 4, 5, 6, 7, 8, 9, 10].map(n => <SelectItem key={n} value={n.toString()}>{n} Rondas</SelectItem>)}</SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                  </div>
                  
                  <div className="space-y-3">
                    <FormLabel>Tempos (Minutos)</FormLabel>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <FormField control={form.control} name="warmupTime" render={({ field }) => (
                        <FormItem>
                          <span className="text-xs uppercase text-muted-foreground">Aquecimento</span>
                          <FormControl>
                            <Input 
                              type="number" 
                              min="0" 
                              {...field} 
                              value={field.value ?? ''}
                              onChange={(e) => field.onChange(e.target.value === '' ? '' : parseInt(e.target.value))}
                              onBlur={(e) => {
                                const num = parseInt(e.target.value) || 0;
                                field.onChange(num < 0 ? 0 : num);
                              }}
                            />
                          </FormControl>
                          <FormDescription className="text-xs">0 = sem aquecimento</FormDescription>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="gameTime" render={({ field }) => (
                        <FormItem>
                          <span className="text-xs uppercase text-muted-foreground">Jogo</span>
                          <FormControl>
                            <Input 
                              type="number" 
                              min="1" 
                              {...field} 
                              value={field.value ?? ''}
                              onChange={(e) => field.onChange(e.target.value === '' ? '' : parseInt(e.target.value))}
                              onBlur={(e) => {
                                const num = parseInt(e.target.value) || 1;
                                field.onChange(num < 1 ? 1 : num);
                              }}
                            />
                          </FormControl>
                          <FormDescription className="text-xs">mínimo 1 minuto</FormDescription>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="restTime" render={({ field }) => (
                        <FormItem>
                          <span className="text-xs uppercase text-muted-foreground">Descanso</span>
                          <FormControl>
                            <Input 
                              type="number" 
                              min="1" 
                              {...field} 
                              value={field.value ?? ''}
                              onChange={(e) => field.onChange(e.target.value === '' ? '' : parseInt(e.target.value))}
                              onBlur={(e) => {
                                const num = parseInt(e.target.value) || 1;
                                field.onChange(num < 1 ? 1 : num);
                              }}
                            />
                          </FormControl>
                          <FormDescription className="text-xs">mínimo 1 minuto</FormDescription>
                        </FormItem>
                      )} />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <FormLabel>Duração Personalizada do Som</FormLabel>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField control={form.control} name="soundDurationTarget" render={({ field }) => (
                        <FormItem>
                          <span className="text-xs uppercase text-muted-foreground">Som a personalizar</span>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Escolha o som" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="air-horn">Air Horn / Buzina de Ar</SelectItem>
                              <SelectItem value="horn">Buzina Forte (Puuuum)</SelectItem>
                              <SelectItem value="horn-deep">Buzina Grave (Puuuum)</SelectItem>
                              <SelectItem value="beep-low-long">Bip Grave Longo (2x)</SelectItem>
                              <SelectItem value="beep-high-long">Bip Agudo Longo (2x)</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="soundDurationSeconds" render={({ field }) => (
                        <FormItem>
                          <span className="text-xs uppercase text-muted-foreground">Duração (segundos)</span>
                          <FormControl>
                            <Input
                              type="number"
                              min="1"
                              max="10"
                              {...field}
                              value={field.value ?? ''}
                              onChange={(e) => field.onChange(e.target.value === '' ? '' : parseInt(e.target.value))}
                              onBlur={(e) => {
                                const num = parseInt(e.target.value) || 5;
                                field.onChange(Math.min(10, Math.max(1, num)));
                              }}
                            />
                          </FormControl>
                          <FormDescription className="text-xs">A duração aplica-se apenas ao som selecionado</FormDescription>
                        </FormItem>
                      )} />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Sons dos Alertas</CardTitle>
                  <CardDescription>Defina os sons para cada fase do Non Stop.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField
                      control={form.control}
                      name="startWarmupSound"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between">
                            <FormLabel>Início do Aquecimento</FormLabel>
                            <Button 
                              type="button" 
                              variant="ghost" 
                              size="icon" 
                              className="h-6 w-6" 
                              onClick={() =>
                                playPreviewSound(field.value, {
                                  airHornDuration: form.getValues("airHornDuration") ?? 5,
                                  soundDurationTarget: form.getValues("soundDurationTarget"),
                                  soundDurationSeconds: form.getValues("soundDurationSeconds") ?? 5,
                                })
                              }
                              data-testid="button-preview-warmup-sound"
                            >
                              <Volume2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Escolha o som" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="beep-low">Bip Grave (3x)</SelectItem>
                              <SelectItem value="beep-high">Bip Agudo (3x)</SelectItem>
                              <SelectItem value="beep-low-long">Bip Grave Longo (2x)</SelectItem>
                              <SelectItem value="beep-high-long">Bip Agudo Longo (2x)</SelectItem>
                              <SelectItem value="horn">Buzina Forte (Puuuum)</SelectItem>
                              <SelectItem value="horn-deep">Buzina Grave (Puuuum)</SelectItem>
                              <SelectItem value="horn-double">Buzina Dupla (Puum-Puum)</SelectItem>
                              <SelectItem value="air-horn">Air Horn / Buzina de Ar</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="startGameSound"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between">
                            <FormLabel>Início do Jogo</FormLabel>
                            <Button 
                              type="button" 
                              variant="ghost" 
                              size="icon" 
                              className="h-6 w-6" 
                              onClick={() =>
                                playPreviewSound(field.value, {
                                  airHornDuration: form.getValues("airHornDuration") ?? 5,
                                  soundDurationTarget: form.getValues("soundDurationTarget"),
                                  soundDurationSeconds: form.getValues("soundDurationSeconds") ?? 5,
                                })
                              }
                              data-testid="button-preview-game-sound"
                            >
                              <Volume2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Escolha o som" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="beep-low">Bip Grave (3x)</SelectItem>
                              <SelectItem value="beep-high">Bip Agudo (3x)</SelectItem>
                              <SelectItem value="beep-low-long">Bip Grave Longo (2x)</SelectItem>
                              <SelectItem value="beep-high-long">Bip Agudo Longo (2x)</SelectItem>
                              <SelectItem value="horn">Buzina Forte (Puuuum)</SelectItem>
                              <SelectItem value="horn-deep">Buzina Grave (Puuuum)</SelectItem>
                              <SelectItem value="horn-double">Buzina Dupla (Puum-Puum)</SelectItem>
                              <SelectItem value="air-horn">Air Horn / Buzina de Ar</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="endGameSound"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between">
                            <FormLabel>Fim do Jogo / Descanso</FormLabel>
                            <Button 
                              type="button" 
                              variant="ghost" 
                              size="icon" 
                              className="h-6 w-6" 
                              onClick={() =>
                                playPreviewSound(field.value, {
                                  airHornDuration: form.getValues("airHornDuration") ?? 5,
                                  soundDurationTarget: form.getValues("soundDurationTarget"),
                                  soundDurationSeconds: form.getValues("soundDurationSeconds") ?? 5,
                                })
                              }
                              data-testid="button-preview-endgame-sound"
                            >
                              <Volume2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Escolha o som" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="beep-low">Bip Grave (3x)</SelectItem>
                              <SelectItem value="beep-high">Bip Agudo (3x)</SelectItem>
                              <SelectItem value="beep-low-long">Bip Grave Longo (2x)</SelectItem>
                              <SelectItem value="beep-high-long">Bip Agudo Longo (2x)</SelectItem>
                              <SelectItem value="horn">Buzina Forte (Puuuum)</SelectItem>
                              <SelectItem value="horn-deep">Buzina Grave (Puuuum)</SelectItem>
                              <SelectItem value="horn-double">Buzina Dupla (Puum-Puum)</SelectItem>
                              <SelectItem value="air-horn">Air Horn / Buzina de Ar</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="finalSound"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between">
                            <FormLabel>Final do Non Stop</FormLabel>
                            <Button 
                              type="button" 
                              variant="ghost" 
                              size="icon" 
                              className="h-6 w-6" 
                              onClick={() =>
                                playPreviewSound(field.value, {
                                  airHornDuration: form.getValues("airHornDuration") ?? 5,
                                  soundDurationTarget: form.getValues("soundDurationTarget"),
                                  soundDurationSeconds: form.getValues("soundDurationSeconds") ?? 5,
                                })
                              }
                              data-testid="button-preview-final-sound"
                            >
                              <Volume2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Escolha o som" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="beep-low">Bip Grave (3x)</SelectItem>
                              <SelectItem value="beep-high">Bip Agudo (3x)</SelectItem>
                              <SelectItem value="beep-low-long">Bip Grave Longo (2x)</SelectItem>
                              <SelectItem value="beep-high-long">Bip Agudo Longo (2x)</SelectItem>
                              <SelectItem value="horn">Buzina Forte (Puuuum)</SelectItem>
                              <SelectItem value="horn-deep">Buzina Grave (Puuuum)</SelectItem>
                              <SelectItem value="horn-double">Buzina Dupla (Puum-Puum)</SelectItem>
                              <SelectItem value="air-horn">Air Horn / Buzina de Ar</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Regras do Torneio</CardTitle>
                  <CardDescription>Configure os critérios de pontuação e desempate.</CardDescription>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="tieBreaker"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Critério de Desempate</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Escolha o critério" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="direct">Confronto Direto</SelectItem>
                            <SelectItem value="diff">Diferença de Jogos (Ganhos - Perdidos)</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          Define qual critério será usado primeiro em caso de igualdade de pontos.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="visual" className="space-y-6 mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Identidade Visual</CardTitle>
                  <CardDescription>Configure como o seu clube é apresentado aos jogadores.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField
                    control={form.control}
                    name="clubName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nome do Clube</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormDescription>Este nome aparecerá no cabeçalho e mensagens.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-4">
                      <FormLabel>Logótipo do Clube</FormLabel>
                      <div className="p-6 border-2 border-dashed rounded-xl bg-slate-50 flex flex-col items-center justify-center gap-4 group hover:bg-slate-100 transition-colors relative overflow-hidden">
                        <div className="h-24 w-48 flex items-center justify-center bg-white rounded-lg shadow-sm border p-2">
                          <img 
                            key={settings?.logo ? 'custom' : 'default'}
                            src={settings?.logo || "/attached_assets/NowPadel_1767487885301.png"} 
                            alt="Logo" 
                            className="max-h-full max-w-full object-contain" 
                          />
                        </div>
                        <div className="relative">
                          <Input 
                            id="logo-upload"
                            type="file" 
                            className="hidden" 
                            accept="image/*"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const reader = new FileReader();
                                reader.onloadend = async () => {
                                  const base64 = reader.result as string;
                                  try {
                                    await apiRequest("POST", "/api/settings", {
                                      ...form.getValues(),
                                      logo: base64,
                                      whatsappNotifications: form.getValues().whatsappNotifications ? 1 : 0,
                                      emailNotifications: form.getValues().emailNotifications ? 1 : 0,
                                      publicRegistration: form.getValues().publicRegistration ? 1 : 0
                                    });
                                    queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
                                    toast({ title: "Logótipo atualizado", description: "O novo logótipo foi guardado com sucesso." });
                                  } catch (error) {
                                    toast({ title: "Erro no upload", description: "Não foi possível guardar o logótipo.", variant: "destructive" });
                                  }
                                };
                                reader.readAsDataURL(file);
                              }
                            }}
                          />
                          <Button 
                            variant="secondary" 
                            size="sm" 
                            className="gap-2" 
                            type="button"
                            onClick={() => document.getElementById('logo-upload')?.click()}
                            data-testid="button-change-logo"
                          >
                            <Image className="w-4 h-4" /> Alterar Logo
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <FormLabel>Cor Principal</FormLabel>
                      <div className="flex items-center gap-4">
                        <FormField
                          control={form.control}
                          name="primaryColor"
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <div className="flex items-center gap-3">
                                  <div className="relative">
                                    <Input 
                                      type="color" 
                                      {...field} 
                                      className="w-20 h-20 p-1 rounded-xl cursor-pointer border-4 border-white shadow-sm hover:scale-105 transition-transform"
                                      data-testid="input-primary-color"
                                    />
                                  </div>
                                  <div className="flex-1 space-y-1">
                                    <p className="font-medium text-sm">Toque no quadrado para escolher</p>
                                    <p className="text-xs text-muted-foreground italic text-balance">Esta cor será usada nos botões e elementos de destaque do clube.</p>
                                  </div>
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-4">
                <Button 
                  type="button" 
                  variant="secondary" 
                  onClick={() => {
                    if (settings) {
                      form.reset({
                        clubName: settings.clubName,
                        primaryColor: settings.primaryColor,
                        website: settings.website,
                        whatsappNotifications: settings.whatsappNotifications === 1,
                        emailNotifications: settings.emailNotifications === 1,
                        publicRegistration: settings.publicRegistration === 1,
                        nonstopCourts: settings.nonstopCourts,
                        nonstopRounds: settings.nonstopRounds,
                        warmupTime: settings.warmupTime,
                        gameTime: settings.gameTime,
                        restTime: settings.restTime,
                        airHornDuration: settings.airHornDuration ?? 5,
                        soundDurationTarget: settings.soundDurationTarget ?? "air-horn",
                        soundDurationSeconds: settings.soundDurationSeconds ?? settings.airHornDuration ?? 5,
                        startWarmupSound: settings.startWarmupSound,
                        startGameSound: settings.startGameSound,
                        endGameSound: settings.endGameSound,
                        finalSound: settings.finalSound,
                        tieBreaker: settings.tieBreaker
                      });
                      toast({ title: "Cancelado", description: "Alterações descartadas" });
                    }
                  }}
                  data-testid="button-cancel-settings"
                >
                  Cancelar
                </Button>
                <Button type="submit" className="px-6 sm:px-12" disabled={mutation.isPending} data-testid="button-save-settings">
                  {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Guardar Alterações
                </Button>
              </div>
            </form>
          </Form>
        )}

        <TabsContent value="access" className="space-y-6 mt-6">
          <ChangePasswordSection />
          <AuthorizedUsersSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
