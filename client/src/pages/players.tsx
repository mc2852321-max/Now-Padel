import { useQuery, useMutation } from "@tanstack/react-query";
import { Player, insertPlayerSchema } from "@shared/schema";
import { api, buildUrl } from "@shared/routes";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SiWhatsapp } from "react-icons/si";
import { Plus, Trash2, Edit2, Filter, Clock, Calendar as CalendarIcon, Search } from "lucide-react";
import { useState, useRef } from "react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { openWhatsApp } from "@/lib/whatsapp";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { format, isToday, isTomorrow } from "date-fns";
import { pt } from "date-fns/locale";
import { cn } from "@/lib/utils";

const LEVELS = ["M2", "M3", "M4", "M5", "M6", "F2", "F3", "F4", "F5", "F6"];

const HOURS = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
const MINUTES = ["00", "30"];

export default function Players() {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [searchText, setSearchText] = useState<string>("");
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  
  const [gameDate, setGameDate] = useState<Date | undefined>(new Date());
  const [gameHour, setGameHour] = useState("18");
  const [gameMinute, setGameMinute] = useState("30");
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  
  const [isBulkMessageOpen, setIsBulkMessageOpen] = useState(false);
  const [sendingIndex, setSendingIndex] = useState(-1);
  const [lastSelectedIds, setLastSelectedIds] = useState<number[]>([]);
  const whatsappWindowRef = useRef<Window | null>(null);
  const { toast } = useToast();

  const queryKey = levelFilter === "all" ? ["/api/players"] : ["/api/players", { level: levelFilter }];

  const { data: players = [], isLoading } = useQuery<Player[]>({
    queryKey,
    queryFn: async ({ queryKey }) => {
      const [url, params] = queryKey as [string, { level?: string }?];
      const searchParams = new URLSearchParams();
      if (params?.level) {
        searchParams.append("level", params.level);
      }
      const queryString = searchParams.toString();
      const finalUrl = queryString ? `${url}?${queryString}` : url;
      const res = await fetch(finalUrl);
      if (!res.ok) {
        return [];
      }
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    }
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", api.players.create.path, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.players.list.path] });
      setIsCreateOpen(false);
      toast({ title: "Sucesso", description: "Jogador adicionado com sucesso" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number, data: any }) => {
      const res = await apiRequest("PATCH", buildUrl(api.players.update.path, { id }), data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.players.list.path] });
      setEditingPlayer(null);
      toast({ title: "Sucesso", description: "Jogador atualizado com sucesso" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", buildUrl(api.players.delete.path, { id }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.players.list.path] });
      toast({ title: "Sucesso", description: "Jogador removido com sucesso" });
    }
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-64">A carregar jogadores...</div>;
  }

  const filteredPlayers = players?.filter(player => {
    if (!searchText.trim()) return true;
    const search = searchText.toLowerCase().trim();
    return player.name.toLowerCase().includes(search) || 
           player.phone.includes(search);
  }) || [];

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredPlayers.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredPlayers.map(p => p.id));
    }
  };

  const getDayLabel = (date: Date) => {
    if (isToday(date)) return "hoje";
    if (isTomorrow(date)) return "amanhã";
    return `no dia ${format(date, "dd/MM/yyyy")}`;
  };

  const handleBulkWhatsapp = () => {
    if (selectedIds.length === 0 || !gameDate) return;
    const currentSelected = [...selectedIds];
    const selectedPlayers = players?.filter(p => currentSelected.includes(p.id)) || [];
    
    if (selectedPlayers.length === 0) return;

    const sortedSelectedPlayers = currentSelected.map(id => selectedPlayers.find(p => p.id === id)!).filter(Boolean);

    setLastSelectedIds(currentSelected);
    setSendingIndex(0);
    
    const player = sortedSelectedPlayers[0];
    const dayLabel = getDayLabel(gameDate);
    const timeLabel = `${gameHour}:${gameMinute}`;
    const displayLevel = levelFilter !== "all" ? levelFilter : player.level;
    const message = `Olá 👋\nFalta 1 jogador para um jogo do nível ${displayLevel} ${dayLabel} às ${timeLabel}.\nConsegues jogar? 😉`;
    
    openWhatsApp(player.phone, message, whatsappWindowRef);

    if (sortedSelectedPlayers.length === 1) {
      setTimeout(() => {
        setSendingIndex(-1);
        setSelectedIds([]);
        setLastSelectedIds([]);
        whatsappWindowRef.current = null;
        toast({ title: "Sucesso", description: "Mensagem enviada!" });
        setIsBulkMessageOpen(false);
      }, 500);
    }
  };

  const handleNextMessage = () => {
    const selectedPlayers = players?.filter(p => lastSelectedIds.includes(p.id)) || [];
    const sortedSelectedPlayers = lastSelectedIds.map(id => selectedPlayers.find(p => p.id === id)!).filter(Boolean);
    
    const nextIndex = sendingIndex + 1;
    
    if (nextIndex >= sortedSelectedPlayers.length) {
      setSendingIndex(-1);
      setIsBulkMessageOpen(false);
      setSelectedIds([]);
      setLastSelectedIds([]);
      whatsappWindowRef.current = null;
      toast({ title: "Sucesso", description: "Mensagens enviadas!" });
      return;
    }

    setSendingIndex(nextIndex);
    
    const player = sortedSelectedPlayers[nextIndex];
    const dayLabel = getDayLabel(gameDate!);
    const timeLabel = `${gameHour}:${gameMinute}`;
    const displayLevel = levelFilter !== "all" ? levelFilter : player.level;
    const message = `Olá 👋\nFalta 1 jogador para um jogo do nível ${displayLevel} ${dayLabel} às ${timeLabel}.\nConsegues jogar? 😉`;
    
    openWhatsApp(player.phone, message, whatsappWindowRef);
    whatsappWindowRef.current?.focus();
  };

  const handleIndividualWhatsapp = (player: Player) => {
    setIsBulkMessageOpen(true);
    setSelectedIds([player.id]);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Jogadores</h2>
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Pesquisar nome ou telefone..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-[200px]"
              data-testid="input-search-players"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Nível" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos Níveis</SelectItem>
                {LEVELS.map(l => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Dialog open={isBulkMessageOpen} onOpenChange={setIsBulkMessageOpen}>
            <DialogTrigger asChild>
              <Button 
                className="gap-2 bg-orange-600 text-white hover:bg-orange-500"
                disabled={selectedIds.length === 0}
                onClick={() => {
                  setLastSelectedIds([...selectedIds]);
                }}
              >
                <SiWhatsapp className="w-5 h-5" />
                <span>Enviar Selecionados ({selectedIds.length})</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Enviar Convite WhatsApp</DialogTitle>
              </DialogHeader>
              <div className="space-y-6 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <CalendarIcon className="w-4 h-4" />
                      Data
                    </label>
                    <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant={"outline"}
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !gameDate && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {gameDate ? format(gameDate, "dd/MM/yyyy") : <span>Escolha o dia</span>}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={gameDate}
                          onSelect={(date) => {
                            setGameDate(date);
                            setIsCalendarOpen(false);
                          }}
                          initialFocus
                          locale={pt}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      Hora
                    </label>
                    <div className="flex gap-1">
                      <Select value={gameHour} onValueChange={setGameHour}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="HH" />
                        </SelectTrigger>
                        <SelectContent>
                          {HOURS.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={gameMinute} onValueChange={setGameMinute}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="MM" />
                        </SelectTrigger>
                        <SelectContent>
                          {MINUTES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-sm">
                  <p className="font-semibold mb-2 text-slate-500 uppercase text-[10px]">Pré-visualização:</p>
                  <div className="whitespace-pre-wrap italic">
                    Olá 👋{"\n"}
                    Falta 1 jogador para um jogo do nível {levelFilter !== "all" ? levelFilter : "[Nível]"} {gameDate ? getDayLabel(gameDate) : "[Dia]"} às {gameHour}:{gameMinute}.{"\n"}
                    Consegues jogar? 😉
                  </div>
                </div>

                {sendingIndex === -1 ? (
                  <Button 
                    className="w-full bg-orange-600 hover:bg-orange-500 h-12 text-lg" 
                    onClick={handleBulkWhatsapp}
                    disabled={selectedIds.length === 0 || !gameDate}
                  >
                    Iniciar Envio ({selectedIds.length})
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <p className="text-center text-sm font-medium text-blue-600 animate-pulse">
                      A processar jogador {sendingIndex + 1} de {lastSelectedIds.length}...
                    </p>
                    <Button 
                      className={`w-full h-12 text-lg ${sendingIndex + 1 >= lastSelectedIds.length ? 'bg-orange-600 hover:bg-orange-500' : ''}`}
                      onClick={handleNextMessage}
                    >
                      {sendingIndex + 1 >= lastSelectedIds.length ? 'Terminar' : 'Próximo Jogador'}
                    </Button>
                    <Button 
                      variant="ghost"
                      className="w-full" 
                      onClick={() => {
                        setSendingIndex(-1);
                        setLastSelectedIds([]);
                      }}
                    >
                      Cancelar
                    </Button>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-orange-600 text-white hover:bg-orange-500">
                <Plus className="w-4 h-4" />
                <span>Adicionar</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Adicionar Jogador</DialogTitle>
              </DialogHeader>
              {isCreateOpen && <PlayerForm onSubmit={(data) => createMutation.mutate(data)} />}
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 px-4">
                  <Checkbox 
                    checked={selectedIds.length === filteredPlayers.length && filteredPlayers.length > 0}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Telemóvel</TableHead>
                <TableHead>Nível</TableHead>
                <TableHead>Notas</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPlayers.map((player) => (
                <TableRow key={player.id} className={selectedIds.includes(player.id) ? "bg-muted/50" : ""}>
                  <TableCell className="px-4">
                    <Checkbox 
                      checked={selectedIds.includes(player.id)}
                      onCheckedChange={() => toggleSelect(player.id)}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{player.name}</TableCell>
                  <TableCell>{player.phone}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{player.level}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground">
                    {player.notes || "-"}
                  </TableCell>
                  <TableCell className="text-right px-4">
                    <div className="flex justify-end gap-1">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="text-orange-600 hover:text-orange-500" 
                        onClick={() => handleIndividualWhatsapp(player)}
                      >
                        <SiWhatsapp className="w-5 h-5" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => setEditingPlayer(player)}
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteMutation.mutate(player.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!players?.length && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    Nenhum jogador encontrado.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!editingPlayer} onOpenChange={() => setEditingPlayer(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Jogador</DialogTitle>
          </DialogHeader>
          {editingPlayer && (
            <PlayerForm 
              defaultValues={editingPlayer} 
              onSubmit={(data) => updateMutation.mutate({ id: editingPlayer.id, data })} 
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlayerForm({ defaultValues, onSubmit }: { defaultValues?: any, onSubmit: (data: any) => void }) {
  const form = useForm({
    resolver: zodResolver(insertPlayerSchema),
    defaultValues: defaultValues || {
      name: "",
      phone: "",
      level: "placeholder",
      notes: ""
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <p className="text-xs text-muted-foreground italic">* Campos de preenchimento obrigatório</p>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome <span className="text-destructive">*</span></FormLabel>
              <FormControl><Input {...field} placeholder="Introduza o nome" /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Telemóvel <span className="text-destructive">*</span></FormLabel>
              <FormControl>
                <Input 
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  {...field} 
                  placeholder="Introduza o número" 
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, "");
                    field.onChange(value);
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="level"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nível <span className="text-destructive">*</span></FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha uma opção" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="placeholder" disabled>Escolha uma opção</SelectItem>
                  {LEVELS.map(l => (
                    <SelectItem key={l} value={l}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notas</FormLabel>
              <FormControl><Textarea {...field} placeholder="Notas adicionais" /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full">Guardar</Button>
      </form>
    </Form>
  );
}
