import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Trophy, Upload } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
  availableSeasons: number[];
  rules: {
    participation: number;
    loss: number;
    formats: RankingRuleFormat[];
  };
  items: RankingItem[];
};

const formatPoints = (value: number) => (
  Number.isInteger(value)
    ? String(value)
    : value.toLocaleString("pt-PT", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })
);

export default function Ranking() {
  const { toast } = useToast();
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [batchLabel, setBatchLabel] = useState("");
  const [playerSearch, setPlayerSearch] = useState("");
  const [importValues, setImportValues] = useState<Record<number, string>>({});
  const [selectedSeason, setSelectedSeason] = useState<number | undefined>(undefined);
  const [showZeroPlayers, setShowZeroPlayers] = useState(false);
  const lastPlayersErrorToastRef = useRef<{ message: string; at: number } | null>(null);

  const { data: ranking, isLoading: isRankingLoading } = useQuery<RankingResponse>({
    queryKey: ["/api/ranking", { season: selectedSeason ?? "current", showZeroPlayers }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (typeof selectedSeason === "number") {
        params.set("season", String(selectedSeason));
      }
      params.set("onlyWithPoints", showZeroPlayers ? "0" : "1");
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/ranking${suffix}`, { credentials: "include" });
      if (!res.ok) {
        throw new Error("Não foi possível carregar o ranking.");
      }
      return res.json();
    },
    refetchInterval: 10000,
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

  const players = playersPage?.items ?? [];
  const filteredPlayers = useMemo(() => {
    const search = playerSearch.trim().toLowerCase();
    if (!search) return players;
    return players.filter((player) => player.name.toLowerCase().includes(search));
  }, [playerSearch, players]);

  const totalImportedPoints = useMemo(
    () => ranking?.items.reduce((sum, row) => sum + row.importedPoints, 0) ?? 0,
    [ranking?.items],
  );

  const importMutation = useMutation({
    mutationFn: async (payload: { batchLabel?: string; seasonYear?: number; rows: Array<{ playerId: number; points: number }> }) => {
      const res = await apiRequest("POST", "/api/ranking/import", payload);
      return res.json() as Promise<{ inserted: number }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ranking"] });
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
      rows,
    });
  };

  const rankingItems = ranking?.items ?? [];
  const scoringFormats = ranking?.rules.formats ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Ranking</h2>
          <p className="text-sm text-muted-foreground">
            Temporada {ranking?.season ?? "-"}: participação +{formatPoints(ranking?.rules.participation ?? 2)} e derrota +{formatPoints(ranking?.rules.loss ?? 0)}.
          </p>
          <p className="text-sm text-muted-foreground">
            Pontos por vitória variam conforme o formato do Non Stop:
          </p>
          <div className="text-sm text-muted-foreground">
            {scoringFormats.map((rule) => (
              <p key={rule.id}>{rule.description}</p>
            ))}
          </div>
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
              <Button className="gap-2 bg-orange-600 text-white hover:bg-orange-500">
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
            <p className="text-3xl font-bold">{rankingItems.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pontos totais</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{formatPoints(rankingItems.reduce((sum, row) => sum + row.totalPoints, 0))}</p>
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
          <CardTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-orange-600" />
            Classificação
          </CardTitle>
          <CardDescription>Ranking atualizado automaticamente quando o Non Stop é finalizado.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Posição</TableHead>
                <TableHead>Jogador</TableHead>
                <TableHead>Nível</TableHead>
                <TableHead className="text-right">Pontos</TableHead>
                <TableHead className="text-right">Participações</TableHead>
                <TableHead className="text-right">Vitórias</TableHead>
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
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>{row.level}</TableCell>
                  <TableCell className="text-right font-semibold">{formatPoints(row.totalPoints)}</TableCell>
                  <TableCell className="text-right">{row.participationCount}</TableCell>
                  <TableCell className="text-right">{row.roundWins}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
