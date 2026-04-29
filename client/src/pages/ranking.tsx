import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { History, Info, Trophy, Upload } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { fetchAllPlayers, type PlayersPageResponse } from "@/lib/players";

type RankingItem = {
  position: number;
  playerId: number;
  name: string;
  level: string;
  totalPoints: number;
  importedPoints: number;
  participationCount: number;
  roundWins: number;
  lastEntryAt: string | null;
};

type RankingRuleFormat = {
  id: string;
  courts: number;
  rounds: number | null;
  roundWin: number;
  description: string;
};

type RankingResponse = {
  season: number;
  category: string;
  scope?: "category" | "all";
  availableSeasons: number[];
  availableCategories: string[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  summary: {
    totalPoints: number;
    importedPoints: number;
  };
  rules: {
    participation: number;
    loss: number;
    formats: RankingRuleFormat[];
  };
  items: RankingItem[];
};

type RankingHistoryItem = {
  season: number;
  totalPlayers: number;
  totalPoints: number;
  importedPoints: number;
  lastEntryAt: string | null;
  topPlayers: Array<{
    position: number;
    playerId: number;
    name: string;
    level: string;
    totalPoints: number;
  }>;
};

type RankingHistoryResponse = {
  category: string;
  scope?: "category" | "all";
  limitSeasons: number;
  availableCategories: string[];
  availableSeasons: number[];
  items: RankingHistoryItem[];
};

const ALL_CATEGORIES_VALUE = "__all__";

const formatPoints = (value: number) => (
  Number.isInteger(value)
    ? String(value)
    : value.toLocaleString("pt-PT", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 3,
    })
);

const formatDateTime = (value: string | null) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatRuleDetails = (rule: RankingRuleFormat) => {
  if (rule.description.trim()) {
    return rule.description;
  }

  const courtsLabel = rule.courts === 1 ? "1 campo" : `${rule.courts} campos`;
  if (rule.rounds == null) {
    return `Non Stop de ${courtsLabel}: +${formatPoints(rule.roundWin)} pontos por vitória.`;
  }

  const turnsLabel = rule.rounds === 3
    ? "1 volta"
    : rule.rounds === 6
      ? "2 voltas"
      : null;
  const roundsLabel = turnsLabel
    ? `${rule.rounds} rondas (${turnsLabel})`
    : `${rule.rounds} rondas`;

  return `Non Stop de ${courtsLabel} com ${roundsLabel}: +${formatPoints(rule.roundWin)} pontos por vitória.`;
};

export default function Ranking() {
  const { toast } = useToast();
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [batchLabel, setBatchLabel] = useState("");
  const [playerSearch, setPlayerSearch] = useState("");
  const [importValues, setImportValues] = useState<Record<number, string>>({});
  const [selectedSeason, setSelectedSeason] = useState<number | undefined>(undefined);
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(undefined);
  const [showZeroPlayers, setShowZeroPlayers] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const lastPlayersErrorToastRef = useRef<{ message: string; at: number } | null>(null);
  const isGeneralCategorySelected = selectedCategory === ALL_CATEGORIES_VALUE;

  const { data: ranking, isLoading: isRankingLoading } = useQuery<RankingResponse>({
    queryKey: ["/api/ranking", { season: selectedSeason ?? "current", category: selectedCategory ?? "current", showZeroPlayers, page, pageSize }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (typeof selectedSeason === "number") {
        params.set("season", String(selectedSeason));
      }
      if (isGeneralCategorySelected) {
        params.set("scope", "all");
      } else if (selectedCategory) {
        params.set("category", selectedCategory);
      }
      params.set("onlyWithPoints", showZeroPlayers ? "0" : "1");
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/ranking${suffix}`, { credentials: "include" });
      if (!res.ok) {
        throw new Error("Não foi possível carregar o ranking.");
      }
      return res.json();
    },
    refetchInterval: 3000,
    refetchOnWindowFocus: true,
  });
  const rankingHistoryCategory = isGeneralCategorySelected
    ? ALL_CATEGORIES_VALUE
    : (selectedCategory ?? ranking?.category);
  const { data: rankingHistory, isLoading: isRankingHistoryLoading } = useQuery<RankingHistoryResponse>({
    queryKey: ["/api/ranking/history", { category: rankingHistoryCategory ?? "all", limitSeasons: 2 }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limitSeasons", "2");
      if (rankingHistoryCategory === ALL_CATEGORIES_VALUE) {
        params.set("scope", "all");
      } else if (rankingHistoryCategory) {
        params.set("category", rankingHistoryCategory);
      }
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/ranking/history${suffix}`, { credentials: "include" });
      if (!res.ok) {
        throw new Error("Não foi possível carregar o histórico do ranking.");
      }
      return res.json();
    },
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });

  const playersQuery = useQuery<PlayersPageResponse>({
    queryKey: ["/api/players", "all"],
    queryFn: fetchAllPlayers,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });
  const playersPage = playersQuery.data;
  const playersErrorMessage = playersQuery.error instanceof Error
    ? playersQuery.error.message
    : null;

  useEffect(() => {
    if (!playersErrorMessage) return;
    const now = Date.now();
    const lastToast = lastPlayersErrorToastRef.current;
    if (lastToast && lastToast.message === playersErrorMessage && now - lastToast.at < 30000) {
      return;
    }
    lastPlayersErrorToastRef.current = { message: playersErrorMessage, at: now };
    toast({
      title: "Erro ao carregar jogadores",
      description: playersErrorMessage,
      variant: "destructive",
    });
  }, [playersErrorMessage, toast]);

  useEffect(() => {
    setPage(1);
  }, [selectedSeason, selectedCategory, showZeroPlayers]);

  useEffect(() => {
    if (ranking && ranking.page !== page) {
      setPage(ranking.page);
    }
  }, [ranking, page]);

  const players = playersPage?.items ?? [];
  const filteredPlayers = useMemo(() => {
    const search = playerSearch.trim().toLowerCase();
    if (!search) return players;
    return players.filter((player) => player.name.toLowerCase().includes(search));
  }, [playerSearch, players]);

  const totalImportedPoints = useMemo(
    () => ranking?.summary.importedPoints ?? 0,
    [ranking?.summary.importedPoints],
  );

  const importMutation = useMutation({
    mutationFn: async (payload: { batchLabel?: string; seasonYear?: number; category?: string; rows: Array<{ playerId: number; points: number }> }) => {
      const res = await apiRequest("POST", "/api/ranking/import", payload);
      return res.json() as Promise<{ inserted: number }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ranking"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ranking/history"] });
      setIsImportDialogOpen(false);
      setImportValues({});
      setBatchLabel("");
      setPlayerSearch("");
      toast({
        title: "Importação concluída",
        description: `${result.inserted} registos de pontos foram importados.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Erro",
        description: error?.message || "Não foi possível importar os pontos iniciais.",
        variant: "destructive",
      });
    },
  });

  const handleImport = () => {
    if (isGeneralCategorySelected) {
      toast({
        title: "Seleciona uma categoria",
        description: "Para importar pontos iniciais, escolhe primeiro uma categoria específica.",
      });
      return;
    }

    const rows = Object.entries(importValues)
      .map(([playerId, value]) => ({
        playerId: Number(playerId),
        points: Number(String(value).replace(",", ".")),
      }))
      .filter((row) => Number.isInteger(row.playerId) && Number.isFinite(row.points))
      .filter((row) => row.points !== 0);

    if (rows.length === 0) {
      toast({
        title: "Sem dados para importar",
        description: "Preenche pelo menos um jogador com pontuação diferente de zero.",
      });
      return;
    }

    importMutation.mutate({
      batchLabel: batchLabel.trim() || undefined,
      seasonYear: selectedSeason ?? ranking?.season,
      category: selectedCategory && selectedCategory !== ALL_CATEGORIES_VALUE
        ? selectedCategory
        : ranking?.category,
      rows,
    });
  };

  const rankingItems = ranking?.items ?? [];
  const scoringFormats = ranking?.rules.formats ?? [];
  const rankingTotal = ranking?.total ?? rankingItems.length;
  const rankingPage = ranking?.page ?? page;
  const rankingTotalPages = ranking?.totalPages ?? 1;
  const rankingPageSize = ranking?.pageSize ?? pageSize;
  const showingFrom = rankingTotal === 0 ? 0 : ((rankingPage - 1) * rankingPageSize) + 1;
  const showingTo = rankingTotal === 0 ? 0 : Math.min(rankingPage * rankingPageSize, rankingTotal);
  const categoryLabel = isGeneralCategorySelected
    ? "Geral (todas as categorias)"
    : (ranking?.category ?? "-");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-3xl font-bold tracking-tight">Ranking</h2>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  aria-label="Ver regras de pontuação do ranking"
                >
                  <Info className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start" className="max-w-[380px] space-y-2 whitespace-normal leading-relaxed">
                <p className="font-medium">
                  Regras da temporada {ranking?.season ?? "-"}
                </p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>Participação: +{formatPoints(ranking?.rules.participation ?? 2)} pontos.</li>
                  <li>Derrota por ronda: +{formatPoints(ranking?.rules.loss ?? 0)} pontos.</li>
                </ul>
                <p className="font-medium">Pontos por vitória (por ronda):</p>
                {scoringFormats.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-4">
                    {scoringFormats.map((rule) => (
                      <li key={`rule-tip-${rule.id}`}>{formatRuleDetails(rule)}</li>
                    ))}
                  </ul>
                ) : (
                  <p>Sem regras de pontuação configuradas.</p>
                )}
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="text-sm text-muted-foreground">
            Temporada {ranking?.season ?? "-"} · Categoria {categoryLabel}: consulte as regras no ícone de informação.
          </p>
          {playersErrorMessage && (
            <p className="text-sm text-red-600">
              Não foi possível carregar todos os jogadores. Tenta novamente dentro de instantes.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select
            value={String(selectedSeason ?? ranking?.season ?? "")}
            onValueChange={(value) => setSelectedSeason(Number(value))}
            disabled={!ranking}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Temporada" />
            </SelectTrigger>
            <SelectContent>
              {(ranking?.availableSeasons ?? []).map((season) => (
                <SelectItem key={`season-option-${season}`} value={String(season)}>
                  Temporada {season}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(selectedCategory ?? ranking?.category ?? "")}
            onValueChange={(value) => setSelectedCategory(value)}
            disabled={!ranking}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CATEGORIES_VALUE}>Geral (todas as categorias)</SelectItem>
              {(ranking?.availableCategories ?? []).map((category) => (
                <SelectItem key={`category-option-${category}`} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 rounded-md border px-3 py-2">
            <Switch
              id="ranking-show-zero"
              checked={showZeroPlayers}
              onCheckedChange={setShowZeroPlayers}
            />
            <Label htmlFor="ranking-show-zero" className="cursor-pointer text-sm">
              Mostrar jogadores com 0 pontos
            </Label>
          </div>

          <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
            <DialogTrigger asChild>
              <Button
                className="gap-2 bg-orange-600 text-white hover:bg-orange-500"
                disabled={isGeneralCategorySelected}
                title={isGeneralCategorySelected ? "Escolhe uma categoria específica para importar pontos." : undefined}
              >
                <Upload className="w-4 h-4" />
                Importar Pontos Iniciais
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Importar Pontos Iniciais</DialogTitle>
                <DialogDescription>
                  Define a pontuação base atual de cada jogador. A partir daqui, o sistema soma automaticamente novos pontos.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 overflow-hidden">
                <Input
                  value={batchLabel}
                  onChange={(event) => setBatchLabel(event.target.value)}
                  placeholder="Etiqueta do lote (opcional)"
                />
                <Input
                  value={playerSearch}
                  onChange={(event) => setPlayerSearch(event.target.value)}
                  placeholder="Pesquisar jogador..."
                />

                <div className="max-h-[48vh] overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Jogador</TableHead>
                        <TableHead>Nível</TableHead>
                        <TableHead className="w-32 text-right">Pontos</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredPlayers.map((player) => (
                        <TableRow key={`import-player-${player.id}`}>
                          <TableCell className="font-medium">{player.name}</TableCell>
                          <TableCell>{player.level}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="0.5"
                              className="text-right"
                              value={importValues[player.id] ?? ""}
                              onChange={(event) => {
                                const nextValue = event.target.value;
                                setImportValues((current) => ({
                                  ...current,
                                  [player.id]: nextValue,
                                }));
                              }}
                              placeholder="0"
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                      {filteredPlayers.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} className="h-20 text-center text-muted-foreground">
                            Sem jogadores para mostrar.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  onClick={handleImport}
                  disabled={importMutation.isPending}
                  className="bg-orange-600 text-white hover:bg-orange-500"
                >
                  {importMutation.isPending ? "A importar..." : "Importar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Jogadores no ranking</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{rankingTotal}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pontos totais</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{formatPoints(ranking?.summary.totalPoints ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Base importada</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{formatPoints(totalImportedPoints)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="w-4 h-4 text-orange-600" />
            Histórico das últimas 2 temporadas
          </CardTitle>
          <CardDescription>
            Consulta rápida por temporada na categoria {rankingHistory?.category ?? ranking?.category ?? "-"}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isRankingHistoryLoading ? (
            <p className="text-sm text-muted-foreground">A carregar histórico...</p>
          ) : (rankingHistory?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Ainda não existem temporadas para mostrar.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {(rankingHistory?.items ?? []).map((seasonRow) => (
                <div key={`history-season-${seasonRow.season}`} className="space-y-3 rounded-md border p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">Temporada {seasonRow.season}</p>
                      <p className="text-xs text-muted-foreground">
                        Atualizado: {formatDateTime(seasonRow.lastEntryAt)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedSeason(seasonRow.season)}
                    >
                      Ver temporada
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Jogadores</p>
                      <p className="font-semibold">{seasonRow.totalPlayers}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Pontos</p>
                      <p className="font-semibold">{formatPoints(seasonRow.totalPoints)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Base</p>
                      <p className="font-semibold">{formatPoints(seasonRow.importedPoints)}</p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Top 3</p>
                    {seasonRow.topPlayers.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Sem pontuação nesta temporada.</p>
                    ) : (
                      seasonRow.topPlayers.map((player) => (
                        <div key={`history-top-${seasonRow.season}-${player.playerId}`} className="flex items-center justify-between text-sm">
                          <span>{player.position}. {player.name}</span>
                          <span className="font-semibold">{formatPoints(player.totalPoints)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-orange-600" />
            Classificação
          </CardTitle>
          <CardDescription>Ranking atualizado automaticamente quando o Non Stop é finalizado.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Posição</TableHead>
                  <TableHead>Jogador</TableHead>
                  <TableHead className="hidden sm:table-cell">Nível</TableHead>
                  <TableHead className="text-right">Pontos</TableHead>
                  <TableHead className="hidden md:table-cell text-right">Participações</TableHead>
                  <TableHead className="hidden md:table-cell text-right">Vitórias</TableHead>
                </TableRow>
              </TableHeader>
            <TableBody>
              {isRankingLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    A carregar ranking...
                  </TableCell>
                </TableRow>
              )}
              {!isRankingLoading && rankingItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    Sem pontuação registada. Importa os pontos iniciais para começar.
                  </TableCell>
                </TableRow>
              )}
              {rankingItems.map((row) => (
                <TableRow key={`ranking-row-${row.playerId}`}>
                  <TableCell className="font-semibold">{row.position}</TableCell>
                  <TableCell className="font-medium">
                    <div className="flex flex-col">
                      <span>{row.name}</span>
                      <span className="text-xs text-muted-foreground sm:hidden">
                        Nível {row.level} · Part. {row.participationCount} · Vit. {row.roundWins}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{row.level}</TableCell>
                  <TableCell className="text-right font-semibold">{formatPoints(row.totalPoints)}</TableCell>
                  <TableCell className="hidden md:table-cell text-right">{row.participationCount}</TableCell>
                  <TableCell className="hidden md:table-cell text-right">{row.roundWins}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            </Table>
          </div>
          <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {rankingTotal > 0
                ? `A mostrar ${showingFrom}-${showingTo} de ${rankingTotal} jogadores`
                : "Sem jogadores para mostrar."}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={String(rankingPageSize)}
                onValueChange={(value) => {
                  setPageSize(Number(value));
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-[96px]">
                  <SelectValue placeholder="25" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25 / pág.</SelectItem>
                  <SelectItem value="50">50 / pág.</SelectItem>
                  <SelectItem value="100">100 / pág.</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(Math.max(1, rankingPage - 1))}
                disabled={isRankingLoading || rankingPage <= 1}
              >
                Anterior
              </Button>
              <span className="text-sm text-muted-foreground">
                Página {rankingPage} / {Math.max(1, rankingTotalPages)}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(Math.min(rankingTotalPages, rankingPage + 1))}
                disabled={isRankingLoading || rankingPage >= rankingTotalPages}
              >
                Seguinte
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
