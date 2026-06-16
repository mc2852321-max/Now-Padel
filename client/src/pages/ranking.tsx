import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, History, Info, Trophy, Upload } from "lucide-react";
import * as XLSX from "xlsx-js-style";
import { type Settings } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { fetchAllPlayers, type PlayersPageResponse } from "@/lib/players";
import { getRankingSeasonLabel, type RankingSeasonOption } from "@shared/ranking-seasons";

const RANKING_POLL_MS = 60_000;

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
  currentSeason: number;
  category: string;
  scope?: "category" | "all";
  availableSeasons: number[];
  seasonOptions?: RankingSeasonOption[];
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
  currentSeason?: number;
  availableCategories: string[];
  availableSeasons: number[];
  seasonOptions?: RankingSeasonOption[];
  items: RankingHistoryItem[];
};

const ALL_CATEGORIES_VALUE = "__all__";
const RANKING_EXPORT_PAGE_SIZE = 100;

function sanitizeSheetName(value: string) {
  const clean = value
    .replace(/[\\/?*[\]:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (clean || "Ranking").slice(0, 31);
}

function slugifyFilePart(value: string) {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return (slug || "ranking").slice(0, 80);
}

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
  const [isExportingRanking, setIsExportingRanking] = useState(false);
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

  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/settings"],
    refetchInterval: RANKING_POLL_MS,
    refetchOnWindowFocus: true,
  });

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
    refetchInterval: RANKING_POLL_MS,
    refetchOnWindowFocus: true,
  });
  const rankingHistoryCategory = isGeneralCategorySelected
    ? ALL_CATEGORIES_VALUE
    : (selectedCategory ?? ranking?.category);
  const rankingHistoryReferenceSeason = selectedSeason ?? ranking?.season;
  const { data: rankingHistory, isLoading: isRankingHistoryLoading } = useQuery<RankingHistoryResponse>({
    queryKey: ["/api/ranking/history", { category: rankingHistoryCategory ?? "all", season: rankingHistoryReferenceSeason ?? "current", limitSeasons: 2 }],
    enabled: Boolean(rankingHistoryReferenceSeason),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limitSeasons", "2");
      if (typeof rankingHistoryReferenceSeason === "number") {
        params.set("season", String(rankingHistoryReferenceSeason));
      }
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
    refetchInterval: RANKING_POLL_MS,
    refetchOnWindowFocus: true,
  });

  const playersQuery = useQuery<PlayersPageResponse>({
    queryKey: ["/api/players", "all"],
    queryFn: fetchAllPlayers,
    refetchInterval: RANKING_POLL_MS,
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
    if (typeof selectedSeason === "number" && ranking?.currentSeason === selectedSeason) {
      setSelectedSeason(undefined);
    }
  }, [ranking?.currentSeason, selectedSeason]);

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

  const fetchRankingExportItems = async (
    season: number,
    category: string,
    includeAllCategories: boolean,
  ) => {
    const firstParams = new URLSearchParams();
    firstParams.set("season", String(season));
    firstParams.set("onlyWithPoints", showZeroPlayers ? "0" : "1");
    firstParams.set("page", "1");
    firstParams.set("pageSize", String(RANKING_EXPORT_PAGE_SIZE));
    if (includeAllCategories) {
      firstParams.set("scope", "all");
    } else {
      firstParams.set("category", category);
    }

    const firstRes = await fetch(`/api/ranking?${firstParams.toString()}`, { credentials: "include" });
    if (!firstRes.ok) throw new Error("Não foi possível preparar a exportação.");
    const firstPage = await firstRes.json() as RankingResponse;
    const pages = [firstPage];

    for (let pageNumber = 2; pageNumber <= firstPage.totalPages; pageNumber += 1) {
      const params = new URLSearchParams(firstParams);
      params.set("page", String(pageNumber));
      const res = await fetch(`/api/ranking?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Não foi possível carregar todos os dados do ranking.");
      pages.push(await res.json() as RankingResponse);
    }

    return pages.flatMap((pageData) => pageData.items);
  };

  const handleExportRanking = async () => {
    if (!ranking) return;

    const season = selectedSeason ?? ranking.season;
    const includeAllCategories = isGeneralCategorySelected || ranking.scope === "all";
    const exportCategory = includeAllCategories
      ? "Geral (todas as categorias)"
      : (selectedCategory ?? ranking.category);
    const clubName = settings?.clubName || "Now Padel & Fit";
    const exportedAt = new Date();
    const exportDate = exportedAt.toLocaleDateString("pt-PT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const exportDateTime = exportedAt.toLocaleString("pt-PT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    setIsExportingRanking(true);
    try {
      const exportItems = await fetchRankingExportItems(season, exportCategory, includeAllCategories);
      const exportSeasonLabel = getRankingSeasonLabel(season, ranking.seasonOptions ?? []);
      const totalPlayers = exportItems.length;
      const totalPoints = exportItems.reduce((sum, row) => sum + row.totalPoints, 0);

      const wb = XLSX.utils.book_new();
      const ws: any = XLSX.utils.aoa_to_sheet([]);
      const title = `Classificação - ${exportCategory}`;
      const sheetName = sanitizeSheetName(includeAllCategories ? "Ranking Geral" : exportCategory);
      const tableHeaders = ["Posição", "Jogador", "Participações", "Vitórias", "Pontos"];
      const tableRows = exportItems.map((row) => [
        row.position,
        row.name,
        row.participationCount,
        row.roundWins,
        row.totalPoints,
      ]);

      const border = {
        top: { style: "thin", color: { rgb: "E2E8F0" } },
        bottom: { style: "thin", color: { rgb: "E2E8F0" } },
        left: { style: "thin", color: { rgb: "E2E8F0" } },
        right: { style: "thin", color: { rgb: "E2E8F0" } },
      };
      const titleStyle = {
        font: { bold: true, sz: 20, color: { rgb: "F97316" } },
        fill: { fgColor: { rgb: "0F172A" } },
        alignment: { horizontal: "center", vertical: "center" },
      };
      const subtitleStyle = {
        font: { bold: true, sz: 12, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "111827" } },
        alignment: { horizontal: "center", vertical: "center" },
      };
      const metaLabelStyle = {
        font: { bold: true, color: { rgb: "475569" } },
        fill: { fgColor: { rgb: "F8FAFC" } },
        alignment: { horizontal: "left", vertical: "center" },
        border,
      };
      const metaValueStyle = {
        font: { bold: true, color: { rgb: "0F172A" } },
        fill: { fgColor: { rgb: "FFFFFF" } },
        alignment: { horizontal: "left", vertical: "center" },
        border,
      };
      const headerStyle = {
        font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
        fill: { fgColor: { rgb: "EA580C" } },
        alignment: { horizontal: "center", vertical: "center" },
        border,
      };
      const oddStyle = {
        fill: { fgColor: { rgb: "FFF7ED" } },
        alignment: { horizontal: "center", vertical: "center" },
        border,
      };
      const evenStyle = {
        fill: { fgColor: { rgb: "FFFFFF" } },
        alignment: { horizontal: "center", vertical: "center" },
        border,
      };
      const nameOddStyle = {
        ...oddStyle,
        font: { bold: true, color: { rgb: "111827" } },
        alignment: { horizontal: "left", vertical: "center" },
      };
      const nameEvenStyle = {
        ...evenStyle,
        font: { bold: true, color: { rgb: "111827" } },
        alignment: { horizontal: "left", vertical: "center" },
      };
      const podiumStyle = (fill: string) => ({
        font: { bold: true, color: { rgb: "111827" } },
        fill: { fgColor: { rgb: fill } },
        alignment: { horizontal: "center", vertical: "center" },
        border,
      });
      const podiumNameStyle = (fill: string) => ({
        ...podiumStyle(fill),
        alignment: { horizontal: "left", vertical: "center" },
      });
      const pointsStyle = {
        font: { bold: true, sz: 12, color: { rgb: "EA580C" } },
        fill: { fgColor: { rgb: "FFEDD5" } },
        alignment: { horizontal: "right", vertical: "center" },
        border,
      };
      const emptyStyle = {
        font: { italic: true, color: { rgb: "64748B" } },
        alignment: { horizontal: "center", vertical: "center" },
        border,
      };

      XLSX.utils.sheet_add_aoa(ws, [[title]], { origin: "A1" });
      XLSX.utils.sheet_add_aoa(ws, [[`${clubName} · ${exportSeasonLabel} · Exportado em ${exportDateTime}`]], { origin: "A2" });
      XLSX.utils.sheet_add_aoa(ws, [
        ["Ranking", exportCategory, "", "Temporada", exportSeasonLabel],
        ["Atualizado em", exportDateTime, "", "Jogadores", totalPlayers],
        ["Pontos totais", totalPoints, "", "", ""],
      ], { origin: "A4" });
      XLSX.utils.sheet_add_aoa(ws, [tableHeaders], { origin: "A8" });

      if (tableRows.length > 0) {
        XLSX.utils.sheet_add_aoa(ws, tableRows, { origin: "A9" });
      } else {
        XLSX.utils.sheet_add_aoa(ws, [["Sem jogadores com pontuação neste ranking."]], { origin: "A9" });
      }

      ws["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
        ...(tableRows.length === 0 ? [{ s: { r: 8, c: 0 }, e: { r: 8, c: 4 } }] : []),
      ];
      ws["!cols"] = [
        { wch: 10 },
        { wch: 34 },
        { wch: 16 },
        { wch: 12 },
        { wch: 14 },
      ];
      ws["!rows"] = [
        { hpt: 32 },
        { hpt: 22 },
        { hpt: 8 },
        { hpt: 22 },
        { hpt: 22 },
        { hpt: 22 },
        { hpt: 8 },
        { hpt: 24 },
      ];

      for (let columnIndex = 0; columnIndex < 5; columnIndex += 1) {
        const titleAddr = XLSX.utils.encode_cell({ r: 0, c: columnIndex });
        const subtitleAddr = XLSX.utils.encode_cell({ r: 1, c: columnIndex });
        if (!ws[titleAddr]) ws[titleAddr] = { t: "s", v: "" };
        if (!ws[subtitleAddr]) ws[subtitleAddr] = { t: "s", v: "" };
        ws[titleAddr].s = titleStyle;
        ws[subtitleAddr].s = subtitleStyle;

        const headerAddr = XLSX.utils.encode_cell({ r: 7, c: columnIndex });
        if (ws[headerAddr]) ws[headerAddr].s = headerStyle;
      }

      for (let rowIndex = 3; rowIndex <= 5; rowIndex += 1) {
        for (let columnIndex = 0; columnIndex < 5; columnIndex += 1) {
          const addr = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
          if (!ws[addr]) ws[addr] = { t: "s", v: "" };
          ws[addr].s = columnIndex === 0 || columnIndex === 3 ? metaLabelStyle : metaValueStyle;
        }
      }

      if (tableRows.length === 0) {
        ws["A9"].s = emptyStyle;
      } else {
        exportItems.forEach((row, index) => {
          const excelRowIndex = 8 + index;
          const isOdd = index % 2 === 0;
          const podiumFill = row.position === 1
            ? "FACC15"
            : row.position === 2
              ? "CBD5E1"
              : row.position === 3
                ? "FDBA74"
                : null;

          for (let columnIndex = 0; columnIndex < 5; columnIndex += 1) {
            const addr = XLSX.utils.encode_cell({ r: excelRowIndex, c: columnIndex });
            if (!ws[addr]) continue;

            if (podiumFill) {
              ws[addr].s = columnIndex === 1 ? podiumNameStyle(podiumFill) : podiumStyle(podiumFill);
            } else if (columnIndex === 1) {
              ws[addr].s = isOdd ? nameOddStyle : nameEvenStyle;
            } else if (columnIndex === 4) {
              ws[addr].s = pointsStyle;
            } else {
              ws[addr].s = isOdd ? oddStyle : evenStyle;
            }
          }
        });
      }

      const lastTableRow = Math.max(9, 8 + tableRows.length);
      ws["!autofilter"] = { ref: `A8:E${lastTableRow}` };
      wb.Props = {
        Title: title,
        Subject: `Ranking ${exportSeasonLabel}`,
        Author: clubName,
        CreatedDate: exportedAt,
      };

      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      const fileDate = exportedAt.toISOString().slice(0, 10);
      const filename = `now-padel-ranking-${slugifyFilePart(exportCategory)}-${slugifyFilePart(exportSeasonLabel)}-${fileDate}.xlsx`;
      XLSX.writeFile(wb, filename);

      toast({
        title: "Exportado",
        description: "Classificação exportada para Excel com sucesso.",
      });
    } catch (error: any) {
      toast({
        title: "Erro",
        description: error?.message || "Não foi possível exportar a classificação.",
        variant: "destructive",
      });
    } finally {
      setIsExportingRanking(false);
    }
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
  const seasonOptions = ranking?.seasonOptions ?? rankingHistory?.seasonOptions ?? [];
  const seasonMetaById = useMemo(() => new Map(seasonOptions.map((season) => [season.id, season])), [seasonOptions]);
  const currentSeason = ranking?.currentSeason ?? rankingHistory?.currentSeason;
  const seasonOptionIds = useMemo(() => {
    const ids = ranking?.seasonOptions?.length
      ? ranking.seasonOptions.map((season) => season.id)
      : (ranking?.availableSeasons ?? []);
    return Array.from(new Set(ids));
  }, [ranking?.availableSeasons, ranking?.seasonOptions]);
  const seasonGroups = useMemo(() => {
    const groups = new Map<string, number[]>();
    seasonOptionIds.forEach((seasonId) => {
      const option = seasonMetaById.get(seasonId);
      const configuredYear = option?.startsAt?.slice(0, 4);
      const year = configuredYear && /^\d{4}$/.test(configuredYear)
        ? configuredYear
        : String(seasonId >= 200000 ? Math.floor(seasonId / 100) : seasonId);
      groups.set(year, [...(groups.get(year) ?? []), seasonId]);
    });

    return Array.from(groups.entries())
      .map(([year, seasons]) => ({
        year,
        seasons: seasons.sort((a, b) => {
          const startA = seasonMetaById.get(a)?.startsAt ?? "";
          const startB = seasonMetaById.get(b)?.startsAt ?? "";
          return startB.localeCompare(startA) || b - a;
        }),
      }))
      .sort((a, b) => Number(b.year) - Number(a.year));
  }, [seasonMetaById, seasonOptionIds]);
  const seasonLabel = ranking
    ? getRankingSeasonLabel(ranking.season, seasonOptions)
    : "-";
  const getSeasonLabel = (seasonId: number) => getRankingSeasonLabel(seasonId, seasonOptions);
  const handleSeasonChange = (value: string) => {
    const nextSeason = Number(value);
    if (!Number.isFinite(nextSeason)) return;
    setSelectedSeason(nextSeason === currentSeason ? undefined : nextSeason);
  };

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
                  Regras da {seasonLabel}
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
            {seasonLabel} · Categoria {categoryLabel}: consulte as regras no ícone de informação.
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
            onValueChange={handleSeasonChange}
            disabled={!ranking}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Temporada" />
            </SelectTrigger>
            <SelectContent className="max-h-[340px]">
              {seasonGroups.map((group, groupIndex) => (
                <div key={`season-year-${group.year}`}>
                  <SelectGroup>
                    <SelectLabel className="py-1 pl-8 pr-2 text-xs uppercase tracking-wide text-muted-foreground">
                      {group.year}
                    </SelectLabel>
                    {group.seasons.map((season) => (
                      <SelectItem key={`season-option-${season}`} value={String(season)}>
                        <span className="flex w-full items-center justify-between gap-3">
                          <span className="truncate">{getSeasonLabel(season)}</span>
                          {season === currentSeason && (
                            <span className="rounded-sm bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
                              Atual
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {groupIndex < seasonGroups.length - 1 && <SelectSeparator />}
                </div>
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

          <Button
            type="button"
            variant="outline"
            className="gap-2 border-orange-200 bg-white text-orange-700 hover:bg-orange-50 hover:text-orange-800"
            onClick={handleExportRanking}
            disabled={!ranking || isRankingLoading || isExportingRanking}
          >
            <Download className="w-4 h-4" />
            {isExportingRanking ? "A exportar..." : "Exportar Excel"}
          </Button>

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

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                      <p className="text-sm font-semibold">{getSeasonLabel(seasonRow.season)}</p>
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
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Jogadores</p>
                      <p className="font-semibold">{seasonRow.totalPlayers}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Pontos</p>
                      <p className="font-semibold">{formatPoints(seasonRow.totalPoints)}</p>
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
            <Table className="min-w-[560px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Posição</TableHead>
                  <TableHead>Jogador</TableHead>
                  <TableHead className="hidden md:table-cell text-right">Participações</TableHead>
                  <TableHead className="hidden md:table-cell text-right">Vitórias</TableHead>
                  <TableHead className="text-right">Pontos</TableHead>
                </TableRow>
              </TableHeader>
            <TableBody>
              {isRankingLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    A carregar ranking...
                  </TableCell>
                </TableRow>
              )}
              {!isRankingLoading && rankingItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
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
                        Part. {row.participationCount} · Vit. {row.roundWins}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-right">{row.participationCount}</TableCell>
                  <TableCell className="hidden md:table-cell text-right">{row.roundWins}</TableCell>
                  <TableCell className="text-right font-semibold">{formatPoints(row.totalPoints)}</TableCell>
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
