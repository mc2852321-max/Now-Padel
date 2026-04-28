import { keepPreviousData, useQuery, useMutation } from "@tanstack/react-query";
import { type Player, type Settings, insertPlayerSchema, type MessageRequest, type WhatsappSendResponse } from "@shared/schema";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SiWhatsapp } from "react-icons/si";
import { Plus, Trash2, Edit2, Filter, Clock, Calendar as CalendarIcon, Search, ChevronDown, Loader2, ExternalLink } from "lucide-react";
import { useState, useEffect } from "react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { format, isToday, isTomorrow } from "date-fns";
import { pt } from "date-fns/locale";
import { cn } from "@/lib/utils";

const LEVELS = ["M2", "M3", "M4", "M5", "M6", "F2", "F3", "F4", "F5", "F6"];
const PAGE_SIZE_OPTIONS = [25, 50, 100];

const HOURS = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
const MINUTES = ["00", "30"];

function parseArrayField(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item));
  } catch {}
  return [];
}

type PlayersPageResponse = {
  items: Player[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export default function Players() {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [profileTagFilter, setProfileTagFilter] = useState<string[]>([]);
  const [searchText, setSearchText] = useState<string>("");
  const [debouncedSearchText, setDebouncedSearchText] = useState<string>("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  
  const [gameDate, setGameDate] = useState<Date | undefined>(new Date());
  const [gameHour, setGameHour] = useState("18");
  const [gameMinute, setGameMinute] = useState("30");
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  
  const [isBulkMessageOpen, setIsBulkMessageOpen] = useState(false);
  const [sendResult, setSendResult] = useState<WhatsappSendResponse | null>(null);
  const { toast } = useToast();
  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const availableProfileOptions = (() => {
    const parsed = parseArrayField(settings?.playerProfileOptions);
    if (parsed.length > 0) return parsed;
    return ["Academia", "Fecha jogos", "Non Stop"];
  })();

  const profileFilterLabel = profileTagFilter.length === 0
    ? "Todos Perfis"
    : profileTagFilter.length === 1
      ? profileTagFilter[0]
      : `${profileTagFilter.length} perfis`;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [searchText]);

  const queryKey = ["/api/players", { level: levelFilter, profileTags: profileTagFilter, search: debouncedSearchText, page, pageSize }];

  const { data, isLoading } = useQuery<PlayersPageResponse>({
    queryKey,
    queryFn: async ({ queryKey }) => {
      const [url, params] = queryKey as [string, { level: string; profileTags: string[]; search: string; page: number; pageSize: number }];
      const searchParams = new URLSearchParams();
      if (params.level && params.level !== "all") {
        searchParams.append("level", params.level);
      }
      params.profileTags.forEach((tag) => {
        searchParams.append("profileTag", tag);
      });
      if (params.search.trim()) {
        searchParams.append("search", params.search.trim());
      }
      searchParams.append("page", String(params.page));
      searchParams.append("pageSize", String(params.pageSize));

      const res = await fetch(`${url}?${searchParams.toString()}`);
      if (!res.ok) {
        return { items: [], total: 0, page: 1, pageSize: params.pageSize, totalPages: 1 };
      }
      const response = await res.json();
      if (!response || !Array.isArray(response.items)) {
        return { items: [], total: 0, page: 1, pageSize: params.pageSize, totalPages: 1 };
      }
      return response as PlayersPageResponse;
    },
    placeholderData: keepPreviousData,
  });

  const players = data?.items ?? [];
  const totalPlayers = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const selectedPlayersForPreview = selectedIds
    .map((id) => players.find((player) => player.id === id))
    .filter((player): player is Player => Boolean(player));
  const previewLevel = (() => {
    if (levelFilter !== "all") return levelFilter;
    if (selectedPlayersForPreview.length === 1) return selectedPlayersForPreview[0].level;

    const uniqueLevels = Array.from(new Set(selectedPlayersForPreview.map((player) => player.level)));
    return uniqueLevels.length === 1 ? uniqueLevels[0] : "[Nível]";
  })();

  useEffect(() => {
    setSelectedIds([]);
  }, [page, pageSize, levelFilter, profileTagFilter, debouncedSearchText]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

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

  const getDayLabel = (date: Date) => {
    if (isToday(date)) return "hoje";
    if (isTomorrow(date)) return "amanhã";
    return `no dia ${format(date, "dd/MM/yyyy")}`;
  };

  const buildInviteMessage = (player: Player) => {
    if (!gameDate) return "";
    const dayLabel = getDayLabel(gameDate);
    const timeLabel = `${gameHour}:${gameMinute}`;
    const displayLevel = levelFilter !== "all" ? levelFilter : player.level;
    return `Olá 👋\nFalta 1 jogador para um jogo do nível ${displayLevel} ${dayLabel} às ${timeLabel}.\nConsegues jogar? 😉`;
  };

  const sendWhatsappMutation = useMutation({
    mutationFn: async (payload: MessageRequest) => {
      const res = await apiRequest("POST", api.whatsapp.send.path, payload);
      return res.json() as Promise<WhatsappSendResponse>;
    },
    onSuccess: (result) => {
      setSendResult(result);

      if (result.mode === "manual") {
        toast({
          title: "Envio manual preparado",
          description: `${result.manual} link(s) de WhatsApp pronto(s).`,
        });
        return;
      }

      if (result.failed === 0 && result.skipped === 0) {
        toast({
          title: result.mode === "mock" ? "Envio simulado" : "Sucesso",
          description: `${result.sent} mensagem(ns) ${result.mode === "mock" ? "simulada(s)" : "enviada(s)"}.`,
        });
        return;
      }

      toast({
        title: "Envio concluido com avisos",
        description: `${result.sent} enviada(s), ${result.failed} falhada(s), ${result.skipped} ignorada(s).`,
        variant: "destructive",
      });
    },
    onError: (error) => {
      toast({
        title: "Erro ao enviar WhatsApp",
        description: error instanceof Error ? error.message : "Nao foi possivel enviar as mensagens.",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-64">A carregar jogadores...</div>;
  }

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === players.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(players.map(p => p.id));
    }
  };

  const handleBulkWhatsapp = () => {
    if (selectedIds.length === 0 || !gameDate) return;
    const currentSelected = [...selectedIds];
    const selectedPlayers = players?.filter(p => currentSelected.includes(p.id)) || [];
    
    if (selectedPlayers.length === 0) return;

    const sortedSelectedPlayers = currentSelected.map(id => selectedPlayers.find(p => p.id === id)!).filter(Boolean);

    setSendResult(null);
    sendWhatsappMutation.mutate({
      messages: sortedSelectedPlayers.map((player) => ({
        playerId: player.id,
        message: buildInviteMessage(player),
      })),
    });
  };

  const handleIndividualWhatsapp = (player: Player) => {
    setSendResult(null);
    sendWhatsappMutation.reset();
    setIsBulkMessageOpen(true);
    setSelectedIds([player.id]);
  };

  const renderProfileTags = (player: Player) => {
    const selectedTags = parseArrayField(player.profileTags);
    if (selectedTags.length === 0) {
      return <span className="text-muted-foreground">-</span>;
    }

    return (
      <div className="flex flex-wrap gap-1.5">
        {selectedTags.map((tag) => (
          <Badge key={`${player.id}-${tag}`} variant="secondary" className="text-[11px]">
            {tag}
          </Badge>
        ))}
      </div>
    );
  };

  const renderPlayerActions = (player: Player, compact = true) => (
    <div className={compact ? "flex justify-end gap-1" : "grid grid-cols-3 gap-2"}>
      <Button
        variant={compact ? "ghost" : "outline"}
        size={compact ? "icon" : "sm"}
        className={cn(
          "text-orange-600 hover:text-orange-500",
          !compact && "gap-2 px-2 text-xs",
        )}
        title="Enviar WhatsApp"
        aria-label={`Enviar WhatsApp a ${player.name}`}
        onClick={() => handleIndividualWhatsapp(player)}
      >
        <SiWhatsapp className="w-5 h-5" />
        {!compact && <span>WhatsApp</span>}
      </Button>
      <Button
        variant={compact ? "ghost" : "outline"}
        size={compact ? "icon" : "sm"}
        className={cn(!compact && "gap-2 px-2 text-xs")}
        title="Editar jogador"
        aria-label={`Editar ${player.name}`}
        onClick={() => setEditingPlayer(player)}
      >
        <Edit2 className="w-4 h-4" />
        {!compact && <span>Editar</span>}
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant={compact ? "ghost" : "outline"}
            size={compact ? "icon" : "sm"}
            className={cn(
              "text-destructive hover:text-destructive",
              !compact && "gap-2 px-2 text-xs",
            )}
            title="Apagar jogador"
            aria-label={`Apagar ${player.name}`}
          >
            <Trash2 className="w-4 h-4" />
            {!compact && <span>Apagar</span>}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar jogador?</AlertDialogTitle>
            <AlertDialogDescription>
              O jogador "{player.name}" será removido da lista. Esta ação não pode ser anulada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate(player.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

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
              onChange={(e) => {
                setSearchText(e.target.value);
                setPage(1);
              }}
              className="w-[200px]"
              data-testid="input-search-players"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <Select
              value={levelFilter}
              onValueChange={(value) => {
                setLevelFilter(value);
                setPage(1);
              }}
            >
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
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-[180px] justify-between font-normal">
                  <span className="truncate">{profileFilterLabel}</span>
                  <ChevronDown className="h-4 w-4 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[220px]">
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    setProfileTagFilter([]);
                    setPage(1);
                  }}
                >
                  Todos Perfis
                </DropdownMenuItem>
                {availableProfileOptions.length > 0 && <DropdownMenuSeparator />}
                {availableProfileOptions.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option}
                    checked={profileTagFilter.includes(option)}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(checked) => {
                      setProfileTagFilter((prev) => {
                        if (checked === true) {
                          return prev.includes(option) ? prev : [...prev, option];
                        }
                        return prev.filter((tag) => tag !== option);
                      });
                      setPage(1);
                    }}
                  >
                    {option}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Dialog
            open={isBulkMessageOpen}
            onOpenChange={(open) => {
              setIsBulkMessageOpen(open);
              if (!open) {
                setSendResult(null);
                sendWhatsappMutation.reset();
              }
            }}
          >
            <DialogTrigger asChild>
              <Button 
                className="gap-2 bg-orange-600 text-white hover:bg-orange-500"
                disabled={selectedIds.length === 0}
                onClick={() => {
                  setSendResult(null);
                  sendWhatsappMutation.reset();
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
                    Falta 1 jogador para um jogo do nível {previewLevel} {gameDate ? getDayLabel(gameDate) : "[Dia]"} às {gameHour}:{gameMinute}.{"\n"}
                    Consegues jogar? 😉
                  </div>
                </div>

                <Button 
                  className="w-full bg-orange-600 hover:bg-orange-500 h-12 text-lg" 
                  onClick={handleBulkWhatsapp}
                  disabled={selectedIds.length === 0 || !gameDate || sendWhatsappMutation.isPending}
                >
                  {sendWhatsappMutation.isPending ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      A enviar...
                    </>
                  ) : (
                    <>Enviar automaticamente ({selectedIds.length})</>
                  )}
                </Button>

                {sendResult && (
                  <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {sendResult.mode === "mock"
                          ? "Mock local"
                          : sendResult.mode === "manual"
                            ? "Manual"
                            : "Evolution API"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {sendResult.sent} OK
                        {sendResult.manual > 0 ? ` / ${sendResult.manual} manuais` : ""}
                        {" / "}
                        {sendResult.failed} falhas / {sendResult.skipped} ignoradas
                      </span>
                    </div>
                    <div className="mt-3 max-h-36 space-y-2 overflow-y-auto">
                      {sendResult.results.map((result) => (
                        <div key={`${result.playerId}-${result.status}`} className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{result.name}</p>
                            {result.error && <p className="text-xs text-destructive">{result.error}</p>}
                          </div>
                          <Badge
                            variant={
                              result.status === "failed"
                                ? "destructive"
                                : result.status === "skipped"
                                  ? "outline"
                                  : "secondary"
                            }
                          >
                            {result.status === "mock_sent" ? "mock" : result.status}
                          </Badge>
                          {sendResult.results.length > 1 && (result.status === "manual" || result.status === "failed") && result.fallbackUrl && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1 px-2 text-xs"
                              onClick={() => window.open(result.fallbackUrl, "_blank")}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              Abrir
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                    {sendResult.fallbackUrl && sendResult.failed + sendResult.skipped + sendResult.manual > 0 && (
                      <Button
                        variant="outline"
                        className="mt-3 w-full gap-2"
                        onClick={() => window.open(sendResult.fallbackUrl, "_blank")}
                      >
                        <ExternalLink className="w-4 h-4" />
                        Abrir WhatsApp manual
                      </Button>
                    )}
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

      <Card className="hidden md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 px-4">
                  <Checkbox 
                    checked={selectedIds.length === players.length && players.length > 0}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Telemóvel</TableHead>
                <TableHead>Nível</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead>Notas</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {players.map((player) => (
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
                  <TableCell className="max-w-[300px]">{renderProfileTags(player)}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground">
                    {player.notes || "-"}
                  </TableCell>
                  <TableCell className="text-right px-4">{renderPlayerActions(player)}</TableCell>
                </TableRow>
              ))}
              {!players.length && (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    Nenhum jogador encontrado.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="space-y-3 md:hidden">
        {players.map((player) => (
          <Card
            key={`mobile-${player.id}`}
            className={cn(
              "overflow-hidden",
              selectedIds.includes(player.id) && "border-orange-400 bg-orange-50/50",
            )}
          >
            <CardContent className="space-y-4 p-4">
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={selectedIds.includes(player.id)}
                  onCheckedChange={() => toggleSelect(player.id)}
                  aria-label={`Selecionar ${player.name}`}
                  className="mt-1"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="break-words text-base font-semibold leading-tight">{player.name}</h3>
                    <Badge variant="outline" className="shrink-0">{player.level}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{player.phone}</p>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Perfil</p>
                  {renderProfileTags(player)}
                </div>
                {player.notes && (
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Notas</p>
                    <p className="break-words text-muted-foreground">{player.notes}</p>
                  </div>
                )}
              </div>

              {renderPlayerActions(player, false)}
            </CardContent>
          </Card>
        ))}
        {!players.length && (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              Nenhum jogador encontrado.
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {totalPlayers > 0
            ? `A mostrar ${((page - 1) * pageSize) + 1}-${Math.min(page * pageSize, totalPlayers)} de ${totalPlayers} jogadores`
            : "Sem jogadores para mostrar"}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Por página</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              setPageSize(Number(value));
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[90px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>{size}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            Anterior
          </Button>
          <span className="text-sm min-w-[90px] text-center">
            Página {page} / {Math.max(1, totalPages)}
          </span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            Seguinte
          </Button>
        </div>
      </div>

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
  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const parseArrayField = (value?: string | null) => {
    if (!value) return [] as string[];
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item));
    } catch {}
    return [];
  };

  const checklistOptions = (() => {
    const parsed = parseArrayField(settings?.playerProfileOptions);
    if (parsed.length > 0) return parsed;
    return ["Academia", "Fecha jogos", "Non Stop"];
  })();

  const form = useForm({
    resolver: zodResolver(insertPlayerSchema),
    defaultValues: defaultValues || {
      name: "",
      phone: "",
      level: "placeholder",
      notes: "",
      profileTags: "[]",
    }
  });

  const selectedTags = parseArrayField(form.watch("profileTags"));

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
          name="profileTags"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Perfil do Jogador</FormLabel>
              <FormControl>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-md border p-3">
                  {checklistOptions.map((option) => {
                    const checked = selectedTags.includes(option);
                    return (
                      <label key={`form-${option}`} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => {
                            const next = checked
                              ? selectedTags.filter((tag) => tag !== option)
                              : [...selectedTags, option];
                            field.onChange(JSON.stringify(next));
                          }}
                        />
                        <span>{option}</span>
                      </label>
                    );
                  })}
                </div>
              </FormControl>
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
