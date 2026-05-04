import { useQuery, useMutation } from "@tanstack/react-query";
import { Team, Player, NonstopResult, Settings, NonstopTimer, insertTeamSchema } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { fetchAllPlayers, type PlayersPageResponse } from "@/lib/players";
import { useToast } from "@/hooks/use-toast";
import { Plus, Settings as SettingsIcon, Trash2, Square, Play, Pause, Download, Edit2, Maximize2, Minimize2, History, Save } from "lucide-react";
import * as XLSX from "xlsx";
import { Link } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useState, useEffect, useRef, useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { format } from "date-fns";

type TimerState = 'idle' | 'warmup' | 'game' | 'rest';
type TimerSound = 'start-warmup' | 'start-game' | 'end-game' | 'final';
type SyncedTimer = Omit<NonstopTimer, "isActive" | "phaseEndsAt" | "updatedAt"> & {
  isActive: boolean;
  phaseEndsAt: string | null;
  updatedAt: string;
};
type NonstopEventSummary = {
  id: number;
  status: "draft" | "active" | "completed" | "cancelled" | string;
  label: string | null;
  category: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};
type NonstopEventDetails = {
  event: NonstopEventSummary;
  teams: Team[];
  results: NonstopResult[];
  timer: SyncedTimer;
  snapshot: any | null;
};
type WakeLockSentinelLike = EventTarget & {
  released?: boolean;
  release: () => Promise<void>;
};
type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};
const DEFAULT_NONSTOP_CATEGORY = "Non Stop";
const NONSTOP_MAX_WIN_POINTS_PER_EVENT = 15;

const formatPoints = (value: number) => (
  Number.isInteger(value)
    ? String(value)
    : value.toLocaleString("pt-PT", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 3,
    })
);

function resolveNonstopRoundWinPoints(nonstopRounds?: number | null) {
  const rounds = Number.isFinite(nonstopRounds) ? Math.max(1, Number(nonstopRounds)) : 1;
  return NONSTOP_MAX_WIN_POINTS_PER_EVENT / rounds;
}

function resolveNonstopStandingsPoints(roundWins: number, nonstopRounds?: number | null) {
  const wins = Number.isFinite(roundWins) ? Math.max(0, Number(roundWins)) : 0;
  if (wins <= 0) return 0;

  return Math.round(wins * resolveNonstopRoundWinPoints(nonstopRounds));
}

function getConfiguredDuration(
  soundType: string,
  settings?: Settings
) {
  const fallback = Math.max(1, settings?.airHornDuration || 5);
  const configured = Math.max(1, settings?.soundDurationSeconds || fallback);
  return soundType === (settings?.soundDurationTarget || "air-horn") ? configured : null;
}

function normalizeTeamName(name: string) {
  return name.replace(/\s+/g, " ").trim();
}

function toLisbonDayKey(dateLike: Date | string | null | undefined) {
  if (!dateLike) return "";
  const value = new Date(dateLike);
  if (Number.isNaN(value.getTime())) return "";
  return value.toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });
}

function toLisbonTimeKey(dateLike: Date | string | null | undefined) {
  if (!dateLike) return "";
  const value = new Date(dateLike);
  if (Number.isNaN(value.getTime())) return "";
  return value.toLocaleTimeString("pt-PT", {
    timeZone: "Europe/Lisbon",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function parseNonstopCategories(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    if (Array.isArray(parsed)) {
      const unique = Array.from(new Set(
        parsed
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean),
      ));
      if (unique.length > 0) return unique;
    }
  } catch {
    // ignore malformed settings payload
  }
  return [DEFAULT_NONSTOP_CATEGORY];
}

export default function Nonstop() {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<"current" | "history">("current");
  const [historyDate, setHistoryDate] = useState<Date | undefined>(new Date());
  const [selectedHistoryEventId, setSelectedHistoryEventId] = useState<number | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);

  const { data: currentEvent } = useQuery<NonstopEventSummary>({
    queryKey: ["/api/nonstop/current"],
    refetchInterval: 3000,
    refetchOnWindowFocus: true,
  });

  const { data: events = [] } = useQuery<NonstopEventSummary[]>({
    queryKey: ["/api/nonstop/events"],
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });

  const selectedHistoryEvent = events.find((event) => event.id === selectedHistoryEventId) ?? null;
  const readOnlyMode = viewMode === "history";
  const editableEvent = currentEvent ?? null;
  const [eventDateInput, setEventDateInput] = useState(toLisbonDayKey(new Date()));
  const [eventTimeInput, setEventTimeInput] = useState("21:30");
  const [eventCategoryInput, setEventCategoryInput] = useState(DEFAULT_NONSTOP_CATEGORY);

  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/settings"],
    refetchInterval: 3000,
    refetchOnWindowFocus: true,
  });
  const configuredCategories = useMemo(
    () => parseNonstopCategories(settings?.nonstopCategories),
    [settings?.nonstopCategories],
  );

  const playersQuery = useQuery<PlayersPageResponse>({
    queryKey: ["/api/players", "all"],
    queryFn: fetchAllPlayers,
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  });
  const playersPage = playersQuery.data;
  const playersErrorMessage = playersQuery.error instanceof Error
    ? playersQuery.error.message
    : null;
  const playersErrorToastRef = useRef<{ message: string; at: number } | null>(null);

  useEffect(() => {
    if (!playersErrorMessage) return;
    const now = Date.now();
    const lastToast = playersErrorToastRef.current;
    if (lastToast && lastToast.message === playersErrorMessage && now - lastToast.at < 30000) {
      return;
    }
    playersErrorToastRef.current = { message: playersErrorMessage, at: now };
    toast({
      title: "Erro ao carregar jogadores",
      description: playersErrorMessage,
      variant: "destructive",
    });
  }, [playersErrorMessage, toast]);

  const availablePlayers = playersPage?.items ?? [];
  const playersById = useMemo(
    () => new Map(availablePlayers.map((player) => [player.id, player])),
    [availablePlayers],
  );
  const getLinkedPlayersDisplay = (team: Team) => {
    const linkedPlayers = [team.playerAId, team.playerBId]
      .filter((id): id is number => typeof id === "number" && id > 0)
      .map((id) => playersById.get(id))
      .filter((player): player is Player => Boolean(player))
      .map((player) => player.name);

    if (linkedPlayers.length === 0) return null;
    return linkedPlayers.join(" / ");
  };

  const getTeamOptionLabel = (team: Team) => {
    const normalizedName = normalizeTeamName(team.name ?? "");
    if (normalizedName) return normalizedName;
    const linkedPlayers = getLinkedPlayersDisplay(team);
    if (linkedPlayers) return linkedPlayers;
    return "Dupla sem nome";
  };

  const teamsQueryKey = readOnlyMode && selectedHistoryEventId
    ? `/api/teams?eventId=${selectedHistoryEventId}`
    : "/api/teams";

  const { data: teams } = useQuery<Team[]>({
    queryKey: [teamsQueryKey],
    refetchInterval: 3000,
    refetchOnWindowFocus: true,
  });

  const resultsQueryKey = readOnlyMode && selectedHistoryEventId
    ? `/api/results?eventId=${selectedHistoryEventId}`
    : "/api/results";

  const { data: results } = useQuery<NonstopResult[]>({
    queryKey: [resultsQueryKey],
    refetchInterval: 3000,
    refetchOnWindowFocus: true,
  });

  const timerQueryKey = readOnlyMode && selectedHistoryEventId
    ? `/api/nonstop/timer?eventId=${selectedHistoryEventId}`
    : "/api/nonstop/timer";

  const { data: syncedTimer } = useQuery<SyncedTimer>({
    queryKey: [timerQueryKey],
    refetchInterval: 1000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  const [timerState, setTimerState] = useState<TimerState>('idle');
  const [timeLeft, setTimeLeft] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [round, setRound] = useState(1);
  const [isTeamDialogOpen, setIsTeamDialogOpen] = useState(false);
  const [isManageTeamsOpen, setIsManageTeamsOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [isPresentationMode, setIsPresentationMode] = useState(false);
  const [isDesktopPresentationViewport, setIsDesktopPresentationViewport] = useState(false);
  const [confirmStopPresentation, setConfirmStopPresentation] = useState(false);
  const phaseEndAtRef = useRef<number | null>(null);
  const presentationContainerRef = useRef<HTMLDivElement | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const soundBusyUntilRef = useRef(0);
  const soundTimeoutsRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const lastQueuedSoundRef = useRef<{ key: string; type: TimerSound; at: number } | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const airHornAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastBoundarySoundRef = useRef<{ id: string; at: number } | null>(null);
  const lastSyncedTimerSnapshotRef = useRef<{
    timerState: TimerState;
    isActive: boolean;
    round: number;
    phaseEndsAt: string | null;
  } | null>(null);

  const numCourts = settings?.nonstopCourts || 3;
  const numTeams = numCourts * 2;
  const numRounds = settings?.nonstopRounds || 5;
  const warmupMinutes = settings?.warmupTime ?? 0;
  const gameMinutes = settings?.gameTime ?? 20;
  const totalRounds = settings?.nonstopRounds ?? 5;
  const isSelectedHistoryMode = readOnlyMode && Boolean(selectedHistoryEventId);
  const historyNumRounds = useMemo(
    () => Math.max(0, ...(results ?? []).map((result) => result.round || 0)),
    [results],
  );
  const historyNumCourts = useMemo(
    () => Math.max(0, ...(results ?? []).map((result) => result.court || 0)),
    [results],
  );
  const hasLoadedResults = Array.isArray(results);
  const displayNumRounds = isSelectedHistoryMode && hasLoadedResults
    ? Math.max(1, historyNumRounds || 1)
    : numRounds;
  const displayNumCourts = isSelectedHistoryMode && hasLoadedResults
    ? Math.max(1, historyNumCourts || Math.ceil((teams?.length ?? 0) / 2) || 1)
    : numCourts;
  const getEventsByDate = (date?: Date) => {
    if (!date) return [];
    const dayKey = toLisbonDayKey(date);
    return events
      .filter((event) => toLisbonDayKey(event.startedAt ?? event.createdAt) === dayKey)
      .sort((a, b) => {
        const aTime = new Date(a.startedAt ?? a.createdAt).getTime();
        const bTime = new Date(b.startedAt ?? b.createdAt).getTime();
        return aTime - bTime;
      });
  };

  const eventsForSelectedDate = useMemo(() => {
    return getEventsByDate(historyDate);
  }, [events, historyDate]);

  useEffect(() => {
    if (viewMode !== "history") return;
    if (isCalendarOpen || isHistoryDrawerOpen) return;
    if (selectedHistoryEventId && events.some((event) => event.id === selectedHistoryEventId)) return;
    if (eventsForSelectedDate.length === 1) {
      setSelectedHistoryEventId(eventsForSelectedDate[0].id);
    }
  }, [viewMode, isCalendarOpen, isHistoryDrawerOpen, selectedHistoryEventId, events, eventsForSelectedDate]);

  useEffect(() => {
    if (!editableEvent) {
      setEventDateInput(toLisbonDayKey(new Date()));
      setEventTimeInput("21:30");
      setEventCategoryInput(configuredCategories[0] ?? DEFAULT_NONSTOP_CATEGORY);
      return;
    }

    const eventDate = editableEvent.startedAt ?? editableEvent.createdAt;
    setEventDateInput(toLisbonDayKey(eventDate));
    setEventTimeInput(toLisbonTimeKey(eventDate) || "21:30");
    const configuredCurrentCategory = configuredCategories.includes(editableEvent.category)
      ? editableEvent.category
      : (configuredCategories[0] || DEFAULT_NONSTOP_CATEGORY);
    setEventCategoryInput(configuredCurrentCategory);
  }, [editableEvent?.id, editableEvent?.startedAt, editableEvent?.createdAt, editableEvent?.category, configuredCategories]);

  const updateEventMetadataMutation = useMutation({
    mutationFn: async (payload: { id: number; eventDate: string; eventTime: string; category: string }) => {
      const res = await apiRequest("PATCH", `/api/nonstop/events/${payload.id}`, {
        eventDate: payload.eventDate,
        eventTime: payload.eventTime,
        category: payload.category,
      });
      return res.json() as Promise<NonstopEventSummary>;
    },
    onSuccess: (event) => {
      queryClient.invalidateQueries({ queryKey: ["/api/nonstop/current"] });
      queryClient.invalidateQueries({
        predicate: (query) => String(query.queryKey[0] ?? "").startsWith("/api/nonstop/events"),
      });

      if (viewMode === "history") {
        const eventDate = event.startedAt ?? event.createdAt;
        const nextHistoryDate = new Date(eventDate);
        if (!Number.isNaN(nextHistoryDate.getTime())) {
          setHistoryDate(nextHistoryDate);
        }
      }

      toast({ title: "Guardado", description: "Data, hora e categoria do histórico atualizadas." });
    },
    onError: (error: any) => {
      toast({
        title: "Erro",
        description: error?.message || "Não foi possível atualizar os metadados do Non Stop.",
        variant: "destructive",
      });
    },
  });
  const currentEventDateKey = editableEvent
    ? toLisbonDayKey(editableEvent.startedAt ?? editableEvent.createdAt)
    : "";
  const currentEventTimeKey = editableEvent
    ? toLisbonTimeKey(editableEvent.startedAt ?? editableEvent.createdAt) || "21:30"
    : "";
  const currentEventCategoryKey = editableEvent
    ? (editableEvent.category || configuredCategories[0] || DEFAULT_NONSTOP_CATEGORY)
    : "";
  const hasEventMetadataChanges = Boolean(
    editableEvent &&
      eventDateInput &&
      eventTimeInput &&
      eventCategoryInput &&
      (
        eventDateInput !== currentEventDateKey ||
        eventTimeInput !== currentEventTimeKey ||
        eventCategoryInput !== currentEventCategoryKey
      ),
  );
  const saveEventMetadata = async () => {
    if (!editableEvent || !eventDateInput || !eventTimeInput || !eventCategoryInput) return null;
    return updateEventMetadataMutation.mutateAsync({
      id: editableEvent.id,
      eventDate: eventDateInput,
      eventTime: eventTimeInput,
      category: eventCategoryInput,
    });
  };

  const syncTimerMutation = useMutation({
    mutationFn: async (payload: {
      timerState: TimerState;
      isActive: boolean;
      round: number;
      timeLeft: number;
      phaseEndsAt: number | null;
    }) => {
      const res = await apiRequest("POST", "/api/nonstop/timer", {
        timerState: payload.timerState,
        isActive: payload.isActive,
        round: payload.round,
        timeLeft: payload.timeLeft,
        phaseEndsAt: payload.phaseEndsAt ? new Date(payload.phaseEndsAt).toISOString() : null,
      });
      return res.json();
    },
  });

  const syncTimer = (
    payload: {
      timerState: TimerState;
      isActive: boolean;
      round: number;
      timeLeft: number;
      phaseEndsAt: number | null;
    }
  ) => {
    if (readOnlyMode) return;
    syncTimerMutation.mutate(payload);
  };

  const enterPresentationMode = async () => {
    setConfirmStopPresentation(false);
    setIsPresentationMode(true);
    const el = presentationContainerRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) return;
    try {
      await el.requestFullscreen();
    } catch {
      toast({
        title: "Modo apresentação ativo",
        description: "Ecrã completo indisponível neste dispositivo, mas o layout compacto foi aplicado.",
      });
    }
  };

  const exitPresentationMode = async () => {
    setConfirmStopPresentation(false);
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // ignore and fallback to normal layout
      }
    }
    setIsPresentationMode(false);
  };

  useEffect(() => {
    const onFullscreenChange = () => {
      const ownsFullscreen = document.fullscreenElement === presentationContainerRef.current;
      if (!ownsFullscreen && isPresentationMode) {
        setConfirmStopPresentation(false);
        setIsPresentationMode(false);
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [isPresentationMode]);

  useEffect(() => {
    const releaseWakeLock = async () => {
      const lock = wakeLockRef.current;
      wakeLockRef.current = null;
      if (!lock || lock.released) return;

      try {
        await lock.release();
      } catch {
        // Browser support and permission state can change while leaving presentation mode.
      }
    };

    if (!isPresentationMode || typeof navigator === "undefined") {
      void releaseWakeLock();
      return;
    }

    let cancelled = false;

    const requestWakeLock = async () => {
      const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
      if (!wakeLock || wakeLockRef.current) return;

      try {
        const lock = await wakeLock.request("screen");
        if (cancelled) {
          void lock.release().catch(() => {});
          return;
        }

        wakeLockRef.current = lock;
        lock.addEventListener(
          "release",
          () => {
            if (wakeLockRef.current === lock) {
              wakeLockRef.current = null;
            }
          },
          { once: true },
        );
      } catch {
        wakeLockRef.current = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void requestWakeLock();
      }
    };

    void requestWakeLock();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void releaseWakeLock();
    };
  }, [isPresentationMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(min-width: 1024px) and (pointer: fine)");
    const updateViewportType = () => setIsDesktopPresentationViewport(mediaQuery.matches);

    updateViewportType();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateViewportType);
      return () => mediaQuery.removeEventListener("change", updateViewportType);
    }

    mediaQuery.addListener(updateViewportType);
    return () => mediaQuery.removeListener(updateViewportType);
  }, []);

  useEffect(() => {
    if (!syncedTimer) return;
    const nextTimerState = syncedTimer.timerState as TimerState;
    const nextIsActive = Boolean(syncedTimer.isActive);
    const nextRound = Math.max(1, syncedTimer.round || 1);
    const nextPhaseEndAt = syncedTimer.phaseEndsAt
      ? new Date(syncedTimer.phaseEndsAt).getTime()
      : null;
    const nextTimeLeft =
      nextIsActive && nextPhaseEndAt
        ? Math.max(0, Math.ceil((nextPhaseEndAt - Date.now()) / 1000))
        : Math.max(0, syncedTimer.timeLeft || 0);

    setTimerState(nextTimerState);
    setIsActive(nextIsActive);
    setRound(nextRound);
    setTimeLeft(nextTimeLeft);
    phaseEndAtRef.current = nextPhaseEndAt;
  }, [syncedTimer?.updatedAt, syncedTimer?.timeLeft]);

  useEffect(() => {
    const resyncTimer = () => {
      queryClient.invalidateQueries({ queryKey: [timerQueryKey] });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        resyncTimer();
      }
    };

    window.addEventListener("focus", resyncTimer);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("focus", resyncTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [timerQueryKey]);

  const resolveSoundType = (
    type: TimerSound
  ) => {
    let soundType = settings?.startGameSound || 'beep-high';
    if (type === 'start-warmup') soundType = settings?.startWarmupSound || 'beep-low';
    if (type === 'end-game') soundType = settings?.endGameSound || 'beep-low';
    if (type === 'final') soundType = settings?.finalSound || 'beep-high';
    return soundType;
  };

  const getSoundDurationMs = (soundType: string) => {
    const configuredDuration = getConfiguredDuration(soundType, settings);
    if (soundType === 'air-horn') return (configuredDuration ?? 5.0) * 1000;
    if (soundType === 'horn' || soundType === 'horn-deep') return (configuredDuration ?? 3.0) * 1000;
    if (soundType === 'horn-double') return 3000;
    if (soundType.includes('long')) {
      const duration = configuredDuration ?? 1.0;
      return (duration * 2 + 0.2) * 1000;
    }
    return 1400;
  };

  const getBoundaryId = (
    state: TimerState,
    currentRound: number,
    phaseEndsAt: number | string | null | undefined,
  ) => {
    const phaseTime = typeof phaseEndsAt === "number"
      ? phaseEndsAt
      : phaseEndsAt
        ? new Date(phaseEndsAt).getTime()
        : 0;
    const phaseKey = Number.isFinite(phaseTime) ? Math.floor(phaseTime / 1000) : 0;
    return `${state}:${currentRound}:${phaseKey}`;
  };

  const ensureAudioContext = async () => {
    if (typeof window === "undefined") return null;
    const win = window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const AudioContextCtor = win.AudioContext || win.webkitAudioContext;
    if (!AudioContextCtor) return null;

    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioContextCtor();
    }

    if (audioContextRef.current.state === "suspended") {
      try {
        await audioContextRef.current.resume();
      } catch {
        return null;
      }
    }

    return audioContextRef.current;
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!airHornAudioRef.current) {
      const audio = new Audio("/sounds/air-horn.mpeg");
      audio.preload = "auto";
      audio.load();
      airHornAudioRef.current = audio;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let removed = false;

    const unlockAudio = () => {
      if (removed) return;
      void ensureAudioContext();
      if (airHornAudioRef.current) {
        airHornAudioRef.current.load();
      }
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
      removed = true;
    };

    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
    window.addEventListener("touchstart", unlockAudio, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
      removed = true;
    };
  }, []);

  const playSound = (type: TimerSound, dedupeKeyOverride?: string) => {
    const soundType = resolveSoundType(type);
    const now = Date.now();
    const dedupeKey = dedupeKeyOverride || `${type}:${timerState}:${round}`;
    const lastQueuedSound = lastQueuedSoundRef.current;
    if (
      lastQueuedSound &&
      (
        (lastQueuedSound.key === dedupeKey && now - lastQueuedSound.at < 10000) ||
        (lastQueuedSound.type === type && now - lastQueuedSound.at < 4000)
      )
    ) {
      return;
    }
    lastQueuedSoundRef.current = { key: dedupeKey, type, at: now };

    const durationMs = getSoundDurationMs(soundType);
    const scheduledStart = Math.max(now, soundBusyUntilRef.current);
    const queueGapMs = 120;
    soundBusyUntilRef.current = scheduledStart + durationMs + queueGapMs;

    const runPlayback = async () => {
      const liveSoundType = resolveSoundType(type);
      const ctx = await ensureAudioContext();

      const frequency = liveSoundType === 'beep-high' ? 880 : 
                        liveSoundType === 'beep-low' ? 440 :
                        liveSoundType === 'horn-deep' ? 60 :
                        liveSoundType === 'air-horn' ? 85 :
                        liveSoundType.includes('horn') ? 100 : 440; // Frequency for horn variants

      const playBeep = (delay: number, duration: number = 0.4, isHorn: boolean = false) => {
        if (!ctx) return;
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

      const playAirHornSample = (durationSeconds: number) => {
        const audio = airHornAudioRef.current ?? new Audio("/sounds/air-horn.mpeg");
        audio.preload = "auto";
        audio.currentTime = 0;
        let stopTimer: ReturnType<typeof setTimeout> | null = null;

        if (durationSeconds > 0) {
          stopTimer = setTimeout(() => {
            audio.pause();
            audio.currentTime = 0;
          }, durationSeconds * 1000);
        }

        audio.addEventListener("ended", () => {
          if (stopTimer) clearTimeout(stopTimer);
        }, { once: true });

        audio.play().catch(() => {
          if (stopTimer) clearTimeout(stopTimer);
          playBeep(0, Math.max(1, durationSeconds), true);
        });
      };

      const configuredDuration = getConfiguredDuration(liveSoundType, settings);

      if (liveSoundType === 'air-horn') {
        playAirHornSample(configuredDuration ?? 5.0);
      } else if (liveSoundType === 'horn' || liveSoundType === 'horn-deep') {
        playBeep(0, configuredDuration ?? 3.0, true); 
      } else if (liveSoundType === 'horn-double') {
        playBeep(0, 1.2, true);
        playBeep(1.5, 1.5, true);
      } else if (liveSoundType.includes('long')) {
        const duration = configuredDuration ?? 1.0;
        playBeep(0, duration);
        playBeep(duration + 0.2, duration);
      } else {
        // Play 3 beeps
        playBeep(0, 0.4);
        playBeep(0.5, 0.4);
        playBeep(1.0, 0.4);
      }
    };

    const delay = scheduledStart - now;
    if (delay <= 0) {
      void runPlayback();
      return;
    }

    const timeoutId = setTimeout(() => {
      void runPlayback();
      soundTimeoutsRef.current = soundTimeoutsRef.current.filter((id) => id !== timeoutId);
    }, delay);
    soundTimeoutsRef.current.push(timeoutId);
  };

  const clearScheduledSounds = () => {
    soundTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    soundTimeoutsRef.current = [];
    soundBusyUntilRef.current = 0;
    lastQueuedSoundRef.current = null;
    lastBoundarySoundRef.current = null;
  };

  const beginPhase = (
    nextState: TimerState,
    durationSeconds: number,
    sound?: TimerSound,
    isActiveOverride: boolean = isActive,
    roundOverride: number = round,
  ) => {
    const safeDuration = Math.max(0, Math.floor(durationSeconds));
    const nextPhaseEndAt = safeDuration > 0 ? Date.now() + safeDuration * 1000 : null;
    setIsActive(isActiveOverride);
    setRound(roundOverride);
    setTimerState(nextState);
    setTimeLeft(safeDuration);
    phaseEndAtRef.current = nextPhaseEndAt;
    syncTimer({
      timerState: nextState,
      isActive: isActiveOverride,
      round: roundOverride,
      timeLeft: safeDuration,
      phaseEndsAt: nextPhaseEndAt,
    });
    if (sound) {
      const phaseKey = nextPhaseEndAt ? Math.floor(nextPhaseEndAt / 1000) : 0;
      playSound(sound, `sync:${sound}:${nextState}:${roundOverride}:${phaseKey}`);
    }
  };

  useEffect(() => {
    if (!syncedTimer || readOnlyMode) return;

    const nextSnapshot = {
      timerState: syncedTimer.timerState as TimerState,
      isActive: Boolean(syncedTimer.isActive),
      round: Math.max(1, syncedTimer.round || 1),
      phaseEndsAt: syncedTimer.phaseEndsAt ?? null,
    };

    const prevSnapshot = lastSyncedTimerSnapshotRef.current;
    lastSyncedTimerSnapshotRef.current = nextSnapshot;

    if (!prevSnapshot) return;
    if (
      prevSnapshot.timerState === nextSnapshot.timerState &&
      prevSnapshot.isActive === nextSnapshot.isActive &&
      prevSnapshot.round === nextSnapshot.round &&
      prevSnapshot.phaseEndsAt === nextSnapshot.phaseEndsAt
    ) {
      return;
    }

    let transitionSound: TimerSound | null = null;

    if (
      prevSnapshot.timerState === "warmup" &&
      nextSnapshot.timerState === "game" &&
      nextSnapshot.isActive
    ) {
      transitionSound = "start-game";
    } else if (
      prevSnapshot.timerState === "game" &&
      nextSnapshot.timerState === "rest" &&
      nextSnapshot.isActive
    ) {
      transitionSound = "end-game";
    } else if (
      prevSnapshot.timerState === "rest" &&
      nextSnapshot.timerState === "game" &&
      nextSnapshot.isActive
    ) {
      transitionSound = "start-game";
    } else if (
      prevSnapshot.timerState === "game" &&
      nextSnapshot.timerState === "game" &&
      nextSnapshot.isActive &&
      nextSnapshot.round > prevSnapshot.round
    ) {
      transitionSound = "start-game";
    } else if (
      prevSnapshot.timerState === "game" &&
      prevSnapshot.isActive &&
      prevSnapshot.round >= totalRounds &&
      nextSnapshot.timerState === "idle" &&
      !nextSnapshot.isActive
    ) {
      transitionSound = "final";
    }

    if (!transitionSound) return;

    const previousBoundaryId = getBoundaryId(
      prevSnapshot.timerState,
      prevSnapshot.round,
      prevSnapshot.phaseEndsAt,
    );
    const lastBoundarySound = lastBoundarySoundRef.current;
    if (
      lastBoundarySound?.id === previousBoundaryId &&
      Date.now() - lastBoundarySound.at < 60000
    ) {
      return;
    }

    const phaseKey = nextSnapshot.phaseEndsAt
      ? Math.floor(new Date(nextSnapshot.phaseEndsAt).getTime() / 1000)
      : 0;

    playSound(
      transitionSound,
      `sync:${transitionSound}:${nextSnapshot.timerState}:${nextSnapshot.round}:${phaseKey}`,
    );
  }, [
    syncedTimer?.updatedAt,
    syncedTimer?.timerState,
    syncedTimer?.isActive,
    syncedTimer?.round,
    syncedTimer?.phaseEndsAt,
    readOnlyMode,
    totalRounds,
  ]);

  useEffect(() => {
    if (!isActive || timeLeft > 0 || readOnlyMode) return;

    let fallbackSound: TimerSound | null = null;
    if (timerState === "warmup") {
      fallbackSound = "start-game";
    } else if (timerState === "game" && round < totalRounds) {
      const hasRestBetweenRounds = Math.max(0, settings?.restTime ?? 2) > 0;
      fallbackSound = hasRestBetweenRounds ? "end-game" : "start-game";
    } else if (timerState === "game" && round >= totalRounds) {
      fallbackSound = "final";
    } else if (timerState === "rest" && round < totalRounds) {
      fallbackSound = "start-game";
    }

    if (!fallbackSound) return;

    const boundaryId = getBoundaryId(timerState, round, phaseEndAtRef.current);
    const lastBoundarySound = lastBoundarySoundRef.current;
    if (
      lastBoundarySound?.id === boundaryId &&
      Date.now() - lastBoundarySound.at < 60000
    ) {
      return;
    }
    lastBoundarySoundRef.current = { id: boundaryId, at: Date.now() };

    playSound(fallbackSound, `boundary:${fallbackSound}:${boundaryId}`);
  }, [isActive, timeLeft, timerState, round, totalRounds, readOnlyMode, settings?.restTime]);

  useEffect(() => {
    if (readOnlyMode) {
      lastSyncedTimerSnapshotRef.current = null;
    }
  }, [readOnlyMode]);

  useEffect(() => {
    if (!isActive) {
      phaseEndAtRef.current = null;
      return;
    }

    if (timeLeft <= 0) return;

    if (!phaseEndAtRef.current) {
      phaseEndAtRef.current = Date.now() + timeLeft * 1000;
    }

    const interval = setInterval(() => {
      if (!phaseEndAtRef.current) return;
      const remaining = Math.max(0, Math.ceil((phaseEndAtRef.current - Date.now()) / 1000));
      setTimeLeft((prev) => (prev === remaining ? prev : remaining));
    }, 250);

    return () => clearInterval(interval);
  }, [isActive, timeLeft]);

  useEffect(() => {
    return () => {
      clearScheduledSounds();
      const ctx = audioContextRef.current;
      audioContextRef.current = null;
      if (ctx && ctx.state !== "closed") {
        void ctx.close().catch(() => {});
      }
      const airHornAudio = airHornAudioRef.current;
      airHornAudioRef.current = null;
      if (airHornAudio) {
        airHornAudio.pause();
        airHornAudio.currentTime = 0;
      }
    };
  }, []);

  const startTimer = () => {
    if (warmupMinutes > 0) {
      beginPhase('warmup', warmupMinutes * 60, 'start-warmup', true, 1);
    } else {
      beginPhase('game', gameMinutes * 60, 'start-game', true, 1);
    }
  };

  const stopTimer = () => {
    clearScheduledSounds();
    setIsActive(false);
    setTimerState('idle');
    setTimeLeft(0);
    phaseEndAtRef.current = null;
    setConfirmStopPresentation(false);
    syncTimer({
      timerState: 'idle',
      isActive: false,
      round,
      timeLeft: 0,
      phaseEndsAt: null,
    });
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const shuffleTeams = (list: Team[]) => {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  const generateRoundRobinRounds = (teamList: Team[]) => {
    if (teamList.length < 2) return [];

    const initial = shuffleTeams(teamList);
    const hasBye = initial.length % 2 !== 0;
    const rotating: (Team | null)[] = hasBye ? [...initial, null] : [...initial];
    const rounds: Array<Array<{ teamAId: number; teamBId: number }>> = [];
    const roundsInCycle = rotating.length - 1;

    for (let roundIndex = 0; roundIndex < roundsInCycle; roundIndex++) {
      const pairings: Array<{ teamAId: number; teamBId: number }> = [];

      for (let i = 0; i < rotating.length / 2; i++) {
        const teamA = rotating[i];
        const teamB = rotating[rotating.length - 1 - i];
        if (!teamA || !teamB) continue;
        pairings.push({ teamAId: teamA.id, teamBId: teamB.id });
      }

      rounds.push(pairings);

      // Circle method: first team fixed, remaining rotate.
      const fixed = rotating[0];
      const rest = rotating.slice(1);
      const moved = rest.pop();
      if (moved !== undefined) {
        rest.unshift(moved);
      }
      rotating.splice(0, rotating.length, fixed, ...rest);
    }

    return rounds;
  };

  const generatePermutations = (items: number[]): number[][] => {
    if (items.length <= 1) return [items];
    const result: number[][] = [];
    items.forEach((item, index) => {
      const rest = [...items.slice(0, index), ...items.slice(index + 1)];
      const restPermutations = generatePermutations(rest);
      restPermutations.forEach((perm) => {
        result.push([item, ...perm]);
      });
    });
    return result;
  };

  const rebuildSchedule = async (teamList: Team[]) => {
    await apiRequest("POST", "/api/results/clear");

    if (teamList.length !== numTeams) return;

    const rounds = generateRoundRobinRounds(teamList);
    if (!rounds.length) return;

    const courtUsage = new Map<number, number[]>();
    teamList.forEach((team) => {
      courtUsage.set(team.id, Array.from({ length: numCourts }, () => 0));
    });

    for (let roundNum = 1; roundNum <= numRounds; roundNum++) {
      const pairings = rounds[(roundNum - 1) % rounds.length];
      if (!pairings.length) continue;

      const availablePairIndices = Array.from({ length: Math.min(numCourts, pairings.length) }, (_, idx) => idx);
      const permutations = generatePermutations(availablePairIndices);
      let selectedOrder = availablePairIndices;
      let bestCost = Number.POSITIVE_INFINITY;

      for (const permutation of permutations) {
        let cost = 0;
        for (let courtIndex = 0; courtIndex < permutation.length; courtIndex++) {
          const match = pairings[permutation[courtIndex]];
          if (!match) continue;
          const teamAUsage = courtUsage.get(match.teamAId)?.[courtIndex] ?? 0;
          const teamBUsage = courtUsage.get(match.teamBId)?.[courtIndex] ?? 0;
          cost += teamAUsage + teamBUsage;
        }
        if (cost < bestCost) {
          bestCost = cost;
          selectedOrder = permutation;
        }
      }

      for (let courtIndex = 0; courtIndex < selectedOrder.length; courtIndex++) {
        const courtNum = courtIndex + 1;
        const match = pairings[selectedOrder[courtIndex]];
        if (!match) continue;
        await apiRequest("POST", "/api/results", {
          round: roundNum,
          court: courtNum,
          teamAId: match.teamAId,
          teamBId: match.teamBId,
          scoreA: 0,
          scoreB: 0,
        });
        const teamAUsage = courtUsage.get(match.teamAId);
        if (teamAUsage) teamAUsage[courtIndex] += 1;
        const teamBUsage = courtUsage.get(match.teamBId);
        if (teamBUsage) teamBUsage[courtIndex] += 1;
      }
    }
  };

  const createTeamMutation = useMutation({
    mutationFn: async (data: any) => {
      if (readOnlyMode) return null;
      const res = await apiRequest("POST", "/api/teams", {
        ...data,
        name: normalizeTeamName(data.name || ""),
        playerAId: Number(data.playerAId),
        playerBId: Number(data.playerBId),
      });
      return res.json();
    },
    onSuccess: async (newTeam) => {
      let currentTeams = [...(teams || []), newTeam];
      try {
        const teamsResponse = await apiRequest("GET", "/api/teams");
        currentTeams = (await teamsResponse.json()) as Team[];
      } catch (error) {
        console.warn("Failed to refresh teams after create:", error);
      }

      if (currentTeams.length >= numTeams) {
        setIsTeamDialogOpen(false);
      }
      
      if (currentTeams.length === numTeams) {
        await rebuildSchedule(currentTeams);
        toast({ title: "Calendário gerado", description: "Emparelhamentos criados sem repetições indevidas." });
      } else if ((results?.length || 0) > 0) {
        await apiRequest("POST", "/api/results/clear");
      }

      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      queryClient.invalidateQueries({ queryKey: ["/api/results"] });
      toast({ title: "Sucesso", description: "Equipa adicionada" });
    },
    onError: (error: any) => {
      toast({
        title: "Erro",
        description: error?.message || "Não foi possível adicionar a dupla.",
        variant: "destructive",
      });
    },
  });

  const updateTeamMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      if (readOnlyMode) return null;
      const res = await apiRequest("PATCH", `/api/teams/${id}`, {
        ...data,
        name: normalizeTeamName(data.name || ""),
        playerAId: Number(data.playerAId),
        playerBId: Number(data.playerBId),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      queryClient.invalidateQueries({ queryKey: ["/api/results"] });
      setEditingTeam(null);
      toast({ title: "Sucesso", description: "Dupla atualizada" });
    },
    onError: (error: any) => {
      toast({
        title: "Erro",
        description: error?.message || "Não foi possível atualizar a dupla.",
        variant: "destructive",
      });
    },
  });

  const deleteTeamMutation = useMutation({
    mutationFn: async (id: number) => {
      if (readOnlyMode) return;
      await apiRequest("DELETE", `/api/teams/${id}`);
    },
    onSuccess: async (_data, id) => {
      const remainingTeams = (teams || []).filter((team) => team.id !== id);
      await rebuildSchedule(remainingTeams);
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      queryClient.invalidateQueries({ queryKey: ["/api/results"] });
      toast({ title: "Sucesso", description: "Dupla apagada" });
    },
  });

  const [scoreDrafts, setScoreDrafts] = useState<Record<string, string>>({});

  const getScoreKey = (roundNum: number, courtNum: number, field: "A" | "B") =>
    `${roundNum}-${courtNum}-${field}`;

  const getScoreValue = (
    roundNum: number,
    courtNum: number,
    field: "A" | "B",
    matchResult?: NonstopResult
  ) => {
    const key = getScoreKey(roundNum, courtNum, field);
    if (scoreDrafts[key] !== undefined) return scoreDrafts[key];
    const baseValue = field === "A" ? matchResult?.scoreA : matchResult?.scoreB;
    return baseValue === null || baseValue === undefined ? "" : String(baseValue);
  };

  const onScoreChange = (roundNum: number, courtNum: number, field: "A" | "B", value: string) => {
    if (readOnlyMode) return;
    const key = getScoreKey(roundNum, courtNum, field);
    const next = value.replace(/[^\d]/g, "");
    setScoreDrafts((prev) => ({ ...prev, [key]: next }));
  };

  const commitScore = (roundNum: number, courtNum: number, field: "A" | "B", matchResult?: NonstopResult) => {
    if (readOnlyMode) return;
    const key = getScoreKey(roundNum, courtNum, field);
    const raw = scoreDrafts[key];
    if (raw === undefined) return;

    const parsed = raw.trim() === "" ? 0 : parseInt(raw, 10);
    const safeValue = Number.isNaN(parsed) ? 0 : parsed;
    const teamAId = matchResult?.teamAId ?? 0;
    const teamBId = matchResult?.teamBId ?? 0;
    if (!teamAId || !teamBId) return;
    const currentValue = field === "A" ? (matchResult?.scoreA ?? 0) : (matchResult?.scoreB ?? 0);

    if (safeValue === currentValue) {
      setScoreDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }

    updateResultMutation.mutate(
      {
        ...matchResult,
        round: roundNum,
        court: courtNum,
        scoreA: field === "A" ? safeValue : (matchResult?.scoreA ?? 0),
        scoreB: field === "B" ? safeValue : (matchResult?.scoreB ?? 0),
        teamAId,
        teamBId,
      },
      {
        onSuccess: () => {
          setScoreDrafts((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
        },
      }
    );
  };

  const updateResultMutation = useMutation({
    mutationFn: async (data: any) => {
      if (readOnlyMode) return null;
      if (!data.teamAId || !data.teamBId || data.teamAId < 1 || data.teamBId < 1) {
        return null;
      }
      const res = await apiRequest("POST", "/api/results", data);
      return res.json();
    },
    onMutate: async (incoming) => {
      await queryClient.cancelQueries({ queryKey: ["/api/results"] });
      const previous = queryClient.getQueryData<NonstopResult[]>(["/api/results"]);

      queryClient.setQueryData<NonstopResult[]>(["/api/results"], (current = []) => {
        if (!incoming?.teamAId || !incoming?.teamBId) return current;
        const idx = current.findIndex((r) => r.round === incoming.round && r.court === incoming.court);
        if (idx === -1) {
          return [...current, incoming as NonstopResult];
        }
        const next = [...current];
        next[idx] = { ...next[idx], ...incoming } as NonstopResult;
        return next;
      });

      return { previous };
    },
    onError: (_err, _incoming, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/results"], context.previous);
      }
    },
    onSuccess: (data) => {
      if (data) {
        queryClient.setQueryData<NonstopResult[]>(["/api/results"], (current = []) => {
          const idx = current.findIndex((r) => r.round === data.round && r.court === data.court);
          if (idx === -1) return [...current, data];
          const next = [...current];
          next[idx] = data;
          return next;
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/results"] });
    },
  });

  const finalizeAndStartMutation = useMutation({
    mutationFn: async () => {
      if (hasEventMetadataChanges) {
        await saveEventMetadata();
      }
      const res = await apiRequest("POST", "/api/nonstop/finalize-and-start", {});
      return res.json();
    },
    onSuccess: () => {
      clearScheduledSounds();
      setViewMode("current");
      setSelectedHistoryEventId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/nonstop/current"] });
      queryClient.invalidateQueries({
        predicate: (query) => String(query.queryKey[0] ?? "").startsWith("/api/nonstop/events"),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      queryClient.invalidateQueries({ queryKey: ["/api/results"] });
      queryClient.invalidateQueries({ queryKey: ["/api/nonstop/timer"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ranking"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ranking/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ranking/entries"] });
      toast({ title: "Sucesso", description: "Evento finalizado e novo Non Stop iniciado" });
    },
    onError: (error: any) => {
      toast({
        title: "Erro",
        description: error?.message || "Não foi possível finalizar o evento.",
        variant: "destructive",
      });
    },
  });

  const deleteHistoryEventMutation = useMutation({
    mutationFn: async (eventId: number) => {
      const res = await apiRequest("DELETE", `/api/nonstop/events/${eventId}`);
      return res.json() as Promise<{ deletedEventId: number; deletedRankingEntries: number }>;
    },
    onSuccess: (result) => {
      setSelectedHistoryEventId(null);
      setIsHistoryDrawerOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/nonstop/current"] });
      queryClient.invalidateQueries({
        predicate: (query) => String(query.queryKey[0] ?? "").startsWith("/api/nonstop/events"),
      });
      queryClient.invalidateQueries({
        predicate: (query) => String(query.queryKey[0] ?? "").startsWith("/api/teams"),
      });
      queryClient.invalidateQueries({
        predicate: (query) => String(query.queryKey[0] ?? "").startsWith("/api/results"),
      });
      queryClient.invalidateQueries({
        predicate: (query) => String(query.queryKey[0] ?? "").startsWith("/api/nonstop/timer"),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/ranking"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ranking/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ranking/entries"] });
      toast({
        title: "Evento apagado",
        description: `Foram eliminados ${result.deletedRankingEntries} registos de pontos associados a este evento.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Erro",
        description: error?.message || "Nao foi possivel apagar este evento.",
        variant: "destructive",
      });
    },
  });

  const exportToExcel = async () => {
    try {
      const exportUrl = readOnlyMode
        ? `/api/nonstop/export?eventId=${selectedHistoryEventId}`
        : "/api/nonstop/export";
      const res = await fetch(exportUrl, { credentials: "include" });
      const data = await res.json();
      
      const wb = XLSX.utils.book_new();
      const clubName = settings?.clubName || "Non Stop Padel";
      const dateStr = new Date().toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });
      
      const border = {
        top: { style: "thin", color: { rgb: "D4D4D4" } },
        bottom: { style: "thin", color: { rgb: "D4D4D4" } },
        left: { style: "thin", color: { rgb: "D4D4D4" } },
        right: { style: "thin", color: { rgb: "D4D4D4" } }
      };

      const titleStyle = {
        font: { bold: true, sz: 18, color: { rgb: "EA580C" } },
        alignment: { horizontal: "center", vertical: "center" }
      };

      const subtitleStyle = {
        font: { sz: 11, color: { rgb: "737373" } },
        alignment: { horizontal: "center", vertical: "center" }
      };

      const headerStyle = {
        font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
        fill: { fgColor: { rgb: "EA580C" } },
        alignment: { horizontal: "center", vertical: "center" },
        border
      };

      const gold1st = {
        font: { bold: true, sz: 12, color: { rgb: "000000" } },
        fill: { fgColor: { rgb: "FFD700" } },
        alignment: { horizontal: "left", vertical: "center" },
        border
      };

      const silver2nd = {
        font: { bold: true, sz: 11, color: { rgb: "000000" } },
        fill: { fgColor: { rgb: "C0C0C0" } },
        alignment: { horizontal: "left", vertical: "center" },
        border
      };

      const bronze3rd = {
        font: { bold: true, sz: 11, color: { rgb: "000000" } },
        fill: { fgColor: { rgb: "CD7F32" } },
        alignment: { horizontal: "left", vertical: "center" },
        border
      };

      const podiumCenter = (bg: string) => ({
        font: { bold: true, sz: 11, color: { rgb: "000000" } },
        fill: { fgColor: { rgb: bg } },
        alignment: { horizontal: "center", vertical: "center" },
        border
      });

      const winStyle = {
        font: { bold: true, color: { rgb: "166534" } },
        fill: { fgColor: { rgb: "DCFCE7" } },
        alignment: { horizontal: "center", vertical: "center" },
        border
      };

      const lossStyle = {
        font: { bold: true, color: { rgb: "DC2626" } },
        fill: { fgColor: { rgb: "FEE2E2" } },
        alignment: { horizontal: "center", vertical: "center" },
        border
      };

      const drawStyle = {
        font: { bold: true, color: { rgb: "CA8A04" } },
        fill: { fgColor: { rgb: "FEF9C3" } },
        alignment: { horizontal: "center", vertical: "center" },
        border
      };

      const cellStyleEven = {
        alignment: { horizontal: "center", vertical: "center" },
        fill: { fgColor: { rgb: "FFFFFF" } },
        border
      };

      const cellStyleOdd = {
        alignment: { horizontal: "center", vertical: "center" },
        fill: { fgColor: { rgb: "FFF7ED" } },
        border
      };

      const nameStyleEven = {
        alignment: { horizontal: "left", vertical: "center" },
        font: { bold: true },
        fill: { fgColor: { rgb: "FFFFFF" } },
        border
      };

      const nameStyleOdd = {
        alignment: { horizontal: "left", vertical: "center" },
        font: { bold: true },
        fill: { fgColor: { rgb: "FFF7ED" } },
        border
      };

      const pointsStyle = {
        font: { bold: true, sz: 12, color: { rgb: "EA580C" } },
        alignment: { horizontal: "center", vertical: "center" },
        fill: { fgColor: { rgb: "FFEDD5" } },
        border
      };

      const titleRow = [{ v: `${clubName} - Non Stop`, s: titleStyle }];
      const dateRow = [{ v: dateStr, s: subtitleStyle }];
      const emptyRow = [{ v: "" }];
      
      const standingsData = [
        titleRow,
        dateRow,
        emptyRow,
        ...data.standings.map((row: Record<string, unknown>, idx: number) => Object.values(row))
      ];

      const wsStandings = XLSX.utils.aoa_to_sheet([]);
      
      XLSX.utils.sheet_add_aoa(wsStandings, [[clubName + " - Non Stop"]], { origin: "A1" });
      wsStandings["A1"].s = titleStyle;
      
      XLSX.utils.sheet_add_aoa(wsStandings, [[dateStr]], { origin: "A2" });
      wsStandings["A2"].s = subtitleStyle;
      
      const headers = Object.keys(data.standings[0] || {});
      const roundColumnCount = Math.max(0, headers.length - 6);
      XLSX.utils.sheet_add_aoa(wsStandings, [headers], { origin: "A4" });
      
      for (let C = 0; C < headers.length; C++) {
        const addr = XLSX.utils.encode_cell({ r: 3, c: C });
        if (wsStandings[addr]) wsStandings[addr].s = headerStyle;
      }
      
      data.standings.forEach((row: Record<string, unknown>, idx: number) => {
        const rowData = Object.values(row);
        XLSX.utils.sheet_add_aoa(wsStandings, [rowData], { origin: `A${5 + idx}` });
        
        const position = idx + 1;
        const isOdd = idx % 2 === 0;
        
        for (let C = 0; C < rowData.length; C++) {
          const addr = XLSX.utils.encode_cell({ r: 4 + idx, c: C });
          if (!wsStandings[addr]) continue;
          
          const val = String(rowData[C]);
          
          if (position <= 3) {
            if (C === 1) {
              wsStandings[addr].s = position === 1 ? gold1st : position === 2 ? silver2nd : bronze3rd;
            } else if (C === 2) {
              wsStandings[addr].s = podiumCenter(position === 1 ? "FFD700" : position === 2 ? "C0C0C0" : "CD7F32");
            } else if (C >= 6) {
              if (val === "V") wsStandings[addr].s = winStyle;
              else if (val === "D") wsStandings[addr].s = lossStyle;
              else if (val === "E") wsStandings[addr].s = drawStyle;
              else wsStandings[addr].s = podiumCenter(position === 1 ? "FFD700" : position === 2 ? "C0C0C0" : "CD7F32");
            } else {
              wsStandings[addr].s = podiumCenter(position === 1 ? "FFD700" : position === 2 ? "C0C0C0" : "CD7F32");
            }
          } else {
            if (C === 1) {
              wsStandings[addr].s = isOdd ? nameStyleOdd : nameStyleEven;
            } else if (C === 2) {
              wsStandings[addr].s = pointsStyle;
            } else if (C >= 6) {
              if (val === "V") wsStandings[addr].s = winStyle;
              else if (val === "D") wsStandings[addr].s = lossStyle;
              else if (val === "E") wsStandings[addr].s = drawStyle;
              else wsStandings[addr].s = isOdd ? cellStyleOdd : cellStyleEven;
            } else {
              wsStandings[addr].s = isOdd ? cellStyleOdd : cellStyleEven;
            }
          }
        }
      });

      wsStandings['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } }
      ];
      
      wsStandings['!cols'] = [
        { wch: 6 },
        { wch: 28 },
        { wch: 8 },
        { wch: 6 },
        { wch: 6 },
        { wch: 6 },
        ...Array(roundColumnCount).fill({ wch: 5 })
      ];

      wsStandings['!rows'] = [{ hpt: 28 }, { hpt: 18 }, { hpt: 12 }];
      
      XLSX.utils.book_append_sheet(wb, wsStandings, "Classificação");
      
      const wsGames = XLSX.utils.aoa_to_sheet([]);
      
      XLSX.utils.sheet_add_aoa(wsGames, [["Jogos por Ronda"]], { origin: "A1" });
      wsGames["A1"].s = { font: { bold: true, sz: 14, color: { rgb: "EA580C" } }, alignment: { horizontal: "center" } };
      
      const gameHeaders = Object.keys(data.games[0] || {});
      XLSX.utils.sheet_add_aoa(wsGames, [gameHeaders], { origin: "A3" });
      
      for (let C = 0; C < gameHeaders.length; C++) {
        const addr = XLSX.utils.encode_cell({ r: 2, c: C });
        if (wsGames[addr]) wsGames[addr].s = headerStyle;
      }
      
      data.games.forEach((row: Record<string, unknown>, idx: number) => {
        const rowData = Object.values(row);
        XLSX.utils.sheet_add_aoa(wsGames, [rowData], { origin: `A${4 + idx}` });
        
        const isOdd = idx % 2 === 0;
        
        for (let C = 0; C < rowData.length; C++) {
          const addr = XLSX.utils.encode_cell({ r: 3 + idx, c: C });
          if (!wsGames[addr]) continue;
          
          if (C === 2 || C === 4) {
            wsGames[addr].s = isOdd ? nameStyleOdd : nameStyleEven;
          } else if (C === 3 || C === 5) {
            const scoreA = Number(rowData[3]) || 0;
            const scoreB = Number(rowData[5]) || 0;
            if (C === 3) {
              wsGames[addr].s = scoreA > scoreB ? winStyle : scoreA < scoreB ? lossStyle : scoreA === scoreB && scoreA > 0 ? drawStyle : (isOdd ? cellStyleOdd : cellStyleEven);
            } else {
              wsGames[addr].s = scoreB > scoreA ? winStyle : scoreB < scoreA ? lossStyle : scoreA === scoreB && scoreB > 0 ? drawStyle : (isOdd ? cellStyleOdd : cellStyleEven);
            }
          } else {
            wsGames[addr].s = isOdd ? cellStyleOdd : cellStyleEven;
          }
        }
      });

      wsGames['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
      
      wsGames['!cols'] = [
        { wch: 8 },
        { wch: 8 },
        { wch: 24 },
        { wch: 8 },
        { wch: 24 },
        { wch: 8 }
      ];

      wsGames['!rows'] = [{ hpt: 22 }];
      
      XLSX.utils.book_append_sheet(wb, wsGames, "Jogos");
      
      const date = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `nonstop_${date}.xlsx`);
      
      toast({ title: "Exportado", description: "Ficheiro Excel gerado com sucesso." });
    } catch (error) {
      toast({ title: "Erro", description: "Não foi possível exportar os dados.", variant: "destructive" });
    }
  };

  const getStandings = () => {
    if (!teams || !results) return [];
    
    const standings: Record<number, { points: number; gamesWon: number; gamesLost: number; teamId: number; name: string; sequence: string[] }> = {};
    const roundWins: Record<number, number> = {};
    
    teams.forEach(team => {
      standings[team.id] = { points: 0, gamesWon: 0, gamesLost: 0, teamId: team.id, name: team.name, sequence: [] };
      roundWins[team.id] = 0;
    });

    results?.forEach(result => {
      if (result.scoreA !== null && result.scoreB !== null) {
        const teamA = standings[result.teamAId];
        const teamB = standings[result.teamBId];
        
        if (teamA && teamB) {
          teamA.gamesWon += result.scoreA;
          teamA.gamesLost += result.scoreB;
          teamB.gamesWon += result.scoreB;
          teamB.gamesLost += result.scoreA;

          const hasPlayed = result.scoreA > 0 || result.scoreB > 0;
          if (hasPlayed) {
            if (result.scoreA > result.scoreB) {
              roundWins[teamA.teamId] += 1;
            } else if (result.scoreB > result.scoreA) {
              roundWins[teamB.teamId] += 1;
            }
          }
        }
      }
    });

    Object.values(standings).forEach((teamStandings) => {
      teamStandings.points = resolveNonstopStandingsPoints(roundWins[teamStandings.teamId] ?? 0, displayNumRounds);
    });

    // Calculate sequences
    teams.forEach(team => {
      const teamStandings = standings[team.id];
      for (let r = 1; r <= displayNumRounds; r++) {
        const roundResult = results.find(res => res.round === r && (res.teamAId === team.id || res.teamBId === team.id));
        if (roundResult) {
          const isTeamA = roundResult.teamAId === team.id;
          const score = isTeamA ? roundResult.scoreA : roundResult.scoreB;
          const oppScore = isTeamA ? roundResult.scoreB : roundResult.scoreA;
          const hasPlayed = score > 0 || oppScore > 0;
          if (!hasPlayed) teamStandings.sequence.push("-");
          else if (score > oppScore) teamStandings.sequence.push("V");
          else if (score < oppScore) teamStandings.sequence.push("D");
          else teamStandings.sequence.push("E");
        } else {
          teamStandings.sequence.push("-");
        }
      }
    });

    return Object.values(standings).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;

      // 1º critério de desempate: confronto direto
      const directMatch = results?.find(r =>
        (r.teamAId === a.teamId && r.teamBId === b.teamId) ||
        (r.teamAId === b.teamId && r.teamBId === a.teamId)
      );

      if (directMatch && directMatch.scoreA !== null && directMatch.scoreB !== null) {
        const aScore = directMatch.teamAId === a.teamId ? directMatch.scoreA : directMatch.scoreB;
        const bScore = directMatch.teamAId === b.teamId ? directMatch.scoreA : directMatch.scoreB;
        if (aScore !== bScore) return bScore - aScore;
      }

      // 2º critério de desempate: diferença jogos ganhos vs perdidos
      const diffA = a.gamesWon - a.gamesLost;
      const diffB = b.gamesWon - b.gamesLost;
      return diffB - diffA;
    });
  };

  const stats = getStandings();
  const daysWithEvents = events.map((event) => new Date(event.startedAt ?? event.createdAt));
  const showHistoryEmptyState = viewMode === "history" && !selectedHistoryEventId;
  const selectedHistoryEventDateLabel = selectedHistoryEvent
    ? format(new Date(selectedHistoryEvent.startedAt ?? selectedHistoryEvent.createdAt), "dd/MM/yyyy HH:mm")
    : "";
  const historyEmptyTitle = eventsForSelectedDate.length === 0
    ? "Sem Non Stops neste dia"
    : eventsForSelectedDate.length === 1
    ? "Seleciona um dia"
    : "Seleciona um Non Stop";
  const historyEmptyDescription = eventsForSelectedDate.length === 0
    ? "Escolhe outro dia no calendário para consultar o histórico."
    : eventsForSelectedDate.length === 1
    ? "Escolhe um dia no calendário para carregar o histórico."
    : "Este dia tem mais do que um Non Stop. Escolhe o horário para carregar os resultados.";

  return (
    <div
      ref={presentationContainerRef}
      style={
        isPresentationMode && isDesktopPresentationViewport
          ? ({ zoom: 1.25 } as any)
          : undefined
      }
      className={cn(
        "space-y-8 pb-10",
        isPresentationMode && "fixed inset-0 z-[80] bg-background overflow-auto p-1 space-y-1 pb-1 max-[900px]:p-0.5 max-[900px]:space-y-0.5 max-[900px]:pb-0.5"
      )}
    >
      <div className={cn(
        "flex flex-col md:flex-row md:items-center justify-between gap-4",
        isPresentationMode && "sticky top-0 z-50 bg-background/95 px-1 py-1 border rounded-md gap-2 max-[900px]:py-0.5 max-[900px]:gap-1"
      )}>
        <div className={cn("space-y-1", isPresentationMode && "hidden")}>
          <h2 className="text-3xl font-bold tracking-tight uppercase">Nonstop {displayNumCourts} Campos</h2>
          {playersErrorMessage && (
            <p className="text-sm text-red-600">
              Não foi possível carregar todos os jogadores. Tenta novamente dentro de instantes.
            </p>
          )}
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          <div
            className={cn(
              "w-full sm:w-auto flex flex-wrap items-center gap-1.5 rounded-xl border border-white/70 bg-white/70 p-1.5 shadow-sm backdrop-blur-md",
              isPresentationMode && "hidden",
            )}
          >
            <ToggleGroup
              type="single"
              value={viewMode}
              className="gap-1"
              onValueChange={(value) => {
                if (!value) return;
                const nextMode = value as "current" | "history";
                setViewMode(nextMode);
                if (nextMode === "current") {
                  setSelectedHistoryEventId(null);
                  setIsCalendarOpen(false);
                  setIsHistoryDrawerOpen(false);
                  return;
                }
                const fallbackDay = historyDate ?? new Date();
                setHistoryDate(fallbackDay);
                setSelectedHistoryEventId(null);
                setIsHistoryDrawerOpen(false);
                setIsCalendarOpen(true);
              }}
            >
              <ToggleGroupItem
                value="current"
                className="h-11 rounded-lg border border-slate-200 bg-white/80 px-3 text-[12px] font-medium text-slate-900 shadow-sm hover:bg-white data-[state=on]:border-orange-600 data-[state=on]:bg-orange-600 data-[state=on]:text-white"
              >
                Atual
              </ToggleGroupItem>
              <Popover
                open={isCalendarOpen}
                onOpenChange={(open) => {
                  if (viewMode !== "history") {
                    setIsCalendarOpen(false);
                    return;
                  }
                  setIsCalendarOpen(open);
                }}
              >
                <PopoverTrigger asChild>
                  <ToggleGroupItem
                    value="history"
                    className="h-11 rounded-lg border border-slate-200 bg-white/80 px-3 text-[12px] font-medium text-slate-900 shadow-sm hover:bg-white data-[state=on]:border-orange-600 data-[state=on]:bg-orange-600 data-[state=on]:text-white"
                    onClick={() => {
                      if (viewMode === "history") setIsCalendarOpen(true);
                    }}
                  >
                    <History className="w-3.5 h-3.5 mr-1" />
                    Histórico
                  </ToggleGroupItem>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={historyDate}
                    onSelect={(date) => {
                      setHistoryDate(date);
                      if (!date) return;
                      if (viewMode !== "history") setViewMode("history");
                      const sameDay = getEventsByDate(date);
                      if (sameDay.length === 1) {
                        setSelectedHistoryEventId(sameDay[0].id);
                        setIsHistoryDrawerOpen(false);
                        setIsCalendarOpen(false);
                      } else if (sameDay.length > 1) {
                        setSelectedHistoryEventId(null);
                        setIsHistoryDrawerOpen(true);
                        setIsCalendarOpen(false);
                      } else {
                        setSelectedHistoryEventId(null);
                        setIsHistoryDrawerOpen(false);
                        setIsCalendarOpen(false);
                        toast({
                          title: "Sem eventos neste dia",
                          description: "Escolhe outro dia no calendário para ver histórico.",
                        });
                      }
                    }}
                    modifiers={{ hasEvents: daysWithEvents }}
                    modifiersClassNames={{ hasEvents: "bg-orange-100 text-orange-700 font-semibold" }}
                  />
                </PopoverContent>
              </Popover>
            </ToggleGroup>

            {viewMode === "history" && !selectedHistoryEventId ? (
              <Badge variant="outline" className="h-11 rounded-lg border-slate-200 bg-white/80 px-3 text-[12px] font-medium text-slate-600 shadow-sm">
                {eventsForSelectedDate.length === 0
                  ? "Sem eventos neste dia"
                  : eventsForSelectedDate.length === 1
                  ? "Seleciona no calendário"
                  : "Seleciona um horário"}
              </Badge>
            ) : null}
          </div>
          <Card className={cn(
            "flex items-center justify-between gap-4 px-4 py-2 border-2 sm:min-w-[420px] sm:ml-auto md:mr-[4.5rem]",
            isPresentationMode && "gap-2 px-3 py-1.5 sm:min-w-[360px] md:mr-0 max-[900px]:gap-1.5 max-[900px]:px-2.5 max-[900px]:py-1",
            isActive ? "bg-orange-950 border-orange-500" : "bg-slate-900 border-slate-800"
          )}>
            <div className={cn("flex flex-col w-[110px]", isPresentationMode && "w-[96px] max-[900px]:w-[88px]")}>
              <span className={cn("text-[10px] uppercase tracking-widest text-orange-500 font-bold", isPresentationMode && "text-[9px] tracking-wider max-[900px]:text-[8px]")}>
                {timerState === 'idle'
                  ? 'Cronómetro'
                  : timerState === 'warmup'
                  ? 'Aquecimento'
                  : timerState === 'game'
                  ? 'Em Jogo'
                  : 'Descanso'}
              </span>
              <span className={cn("text-2xl font-mono tabular-nums text-white leading-none", isPresentationMode && "text-xl max-[900px]:text-lg")}>
                {formatTime(timeLeft)}
              </span>
            </div>

            <div className={cn("flex items-center justify-end gap-1 min-w-[220px]", isPresentationMode && "min-w-[186px] max-[900px]:min-w-[170px]")}>
              {timerState === 'warmup' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={readOnlyMode}
                  className={cn("h-8 text-[10px] px-2 border-orange-500 text-orange-500 hover:bg-orange-500/10", isPresentationMode && "h-7 text-[9px] px-1.5 max-[900px]:h-6 max-[900px]:text-[8px] max-[900px]:px-1")}
                  onClick={() => {
                    beginPhase('game', gameMinutes * 60, 'start-game', true, 1);
                    toast({ title: "Aquecimento Ignorado", description: "Início da ronda 1!" });
                  }}
                >
                  PULAR AQ
                </Button>
              )}

              {timerState === 'rest' && round < totalRounds && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={readOnlyMode}
                  className={cn("h-8 text-[10px] px-2 border-orange-500 text-orange-500 hover:bg-orange-500/10", isPresentationMode && "h-7 text-[9px] px-1.5 max-[900px]:h-6 max-[900px]:text-[8px] max-[900px]:px-1")}
                  onClick={() => {
                    const nextRound = round + 1;
                    beginPhase('game', gameMinutes * 60, 'start-game', true, nextRound);
                    toast({ title: "Descanso Ignorado", description: "Início da próxima ronda!" });
                  }}
                >
                  PULAR DESC
                </Button>
              )}

              {!isActive ? (
                <>
                  <Button size="sm" disabled={readOnlyMode} className={cn("h-8 w-[130px] text-[10px] px-2 bg-orange-600 hover:bg-orange-500 justify-center", isPresentationMode && "h-7 w-[118px] text-[9px] px-1.5 max-[900px]:h-6 max-[900px]:w-[108px] max-[900px]:text-[8px] max-[900px]:px-1")} onClick={() => {
                    if (timeLeft > 0 && timerState !== 'idle') {
                      const nextPhaseEndAt = Date.now() + timeLeft * 1000;
                      phaseEndAtRef.current = nextPhaseEndAt;
                      setIsActive(true);
                      syncTimer({
                        timerState,
                        isActive: true,
                        round,
                        timeLeft,
                        phaseEndsAt: nextPhaseEndAt,
                      });
                    } else {
                      startTimer();
                    }
                  }}>
                    {timeLeft > 0 && timerState !== 'idle' ? <Play className="h-3 w-3 mr-1" /> : null}
                    {timeLeft > 0 && timerState !== 'idle' ? 'RETOMAR' : 'JOGAR'}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="default"
                    size="sm"
                    disabled={readOnlyMode}
                    className={cn("order-2 h-8 w-[130px] px-3 text-[10px] border-orange-500 bg-orange-600 text-white hover:bg-orange-500 justify-center", isPresentationMode && "h-7 w-[118px] text-[9px] px-1.5 max-[900px]:h-6 max-[900px]:w-[108px] max-[900px]:text-[8px] max-[900px]:px-1")}
                    onClick={() => {
                    const remaining = phaseEndAtRef.current
                      ? Math.max(0, Math.ceil((phaseEndAtRef.current - Date.now()) / 1000))
                      : timeLeft;
                    phaseEndAtRef.current = null;
                    setTimeLeft(remaining);
                    setIsActive(false);
                    setConfirmStopPresentation(false);
                    syncTimer({
                      timerState,
                      isActive: false,
                      round,
                      timeLeft: remaining,
                      phaseEndsAt: null,
                    });
                  }}
                  >
                    <Pause className="h-3 w-3 mr-1" />
                    PAUSAR
                  </Button>
                  {isPresentationMode ? (
                    !confirmStopPresentation ? (
                      <Button
                        variant="outline"
                        size="icon"
                        disabled={readOnlyMode}
                        className={cn("order-1 h-8 w-8 border-red-500/60 text-red-500 hover:bg-red-500/10", isPresentationMode && "h-7 w-7 max-[900px]:h-6 max-[900px]:w-6")}
                        title="Parar cronómetro"
                        onClick={() => setConfirmStopPresentation(true)}
                      >
                        <Square className="h-3 w-3" />
                      </Button>
                    ) : (
                      <div className="order-1 flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className={cn("h-8 text-[10px] px-2", isPresentationMode && "h-7 text-[9px] px-1.5 max-[900px]:h-6 max-[900px]:text-[8px] max-[900px]:px-1")}
                          onClick={() => setConfirmStopPresentation(false)}
                        >
                          Cancelar
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={readOnlyMode}
                          className={cn("h-8 text-[10px] px-2", isPresentationMode && "h-7 text-[9px] px-1.5 max-[900px]:h-6 max-[900px]:text-[8px] max-[900px]:px-1")}
                          onClick={stopTimer}
                        >
                          Confirmar
                        </Button>
                      </div>
                    )
                  ) : null}

                  <div className={cn(isPresentationMode && "hidden")}>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        disabled={readOnlyMode}
                        className="order-1 h-8 w-8 border-red-500/60 text-red-500 hover:bg-red-500/10"
                        title="Parar cronómetro"
                      >
                        <Square className="h-3 w-3" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Parar cronómetro?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Esta ação vai interromper a ronda atual e colocar o cronómetro em estado inicial.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => {
                            if (readOnlyMode) return;
                            stopTimer();
                          }}
                        >
                          Parar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  </div>
                </>
              )}

              <Link href="/settings">
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-8 w-8 text-slate-400", isPresentationMode && "hidden")}
                  data-testid="button-open-settings"
                >
                  <SettingsIcon className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </Card>

          <Button
            variant={isPresentationMode ? "default" : "outline"}
            size="sm"
            className={cn(
              "h-9 px-3 text-[11px] font-semibold tracking-wide border-2 shadow-sm",
              isPresentationMode && "h-8 px-2.5 text-[10px] max-[900px]:h-7 max-[900px]:px-2 max-[900px]:text-[9px]",
              isPresentationMode
                ? "bg-gradient-to-r from-red-600 to-orange-500 border-red-500 text-white hover:from-red-500 hover:to-orange-400"
                : "border-orange-500 text-orange-600 hover:bg-orange-500/10"
            )}
            onClick={() => {
              if (isPresentationMode) {
                void exitPresentationMode();
              } else {
                void enterPresentationMode();
              }
            }}
            title={isPresentationMode ? "Sair do modo apresentação" : "Entrar em modo apresentação"}
          >
            {isPresentationMode ? <Minimize2 className="w-3.5 h-3.5 mr-1" /> : <Maximize2 className="w-3.5 h-3.5 mr-1" />}
            {isPresentationMode ? "SAIR APRESENTAÇÃO" : "MODO APRESENTAÇÃO"}
            {isPresentationMode ? (
              <span className="ml-2 inline-flex items-center rounded-full border border-white/40 bg-white/15 px-1.5 py-0.5 text-[9px] font-bold leading-none">
                <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-red-200 animate-pulse" />
                AO VIVO
              </span>
            ) : null}
          </Button>

          <div className={cn(isPresentationMode && "hidden")}>
            <Button 
              variant="outline" 
              size="icon" 
              onClick={exportToExcel}
              disabled={!teams?.length || !results?.some(r => r.scoreA !== null && r.scoreB !== null && (r.scoreA > 0 || r.scoreB > 0))}
              title={!results?.some(r => r.scoreA !== null && r.scoreB !== null && (r.scoreA > 0 || r.scoreB > 0)) ? "Sem resultados para exportar" : "Exportar Excel"}
              data-testid="button-export-excel"
            >
              <Download className="w-4 h-4" />
            </Button>
          </div>

          {readOnlyMode && selectedHistoryEvent && selectedHistoryEvent.status !== "active" ? (
            <div className={cn(isPresentationMode && "hidden")}>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-9 gap-2 px-3 text-[11px]"
                    disabled={deleteHistoryEventMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                    Apagar evento
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Apagar evento histórico?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Ao apagar este evento, todos os pontos associados aos jogadores neste Non Stop também serão eliminados.
                    </AlertDialogDescription>
                    <p className="text-sm text-muted-foreground">
                      {selectedHistoryEvent.label || selectedHistoryEvent.category || "Non Stop"} · {selectedHistoryEventDateLabel}
                    </p>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => deleteHistoryEventMutation.mutate(selectedHistoryEvent.id)}
                    >
                      Confirmar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ) : null}

          <div className={cn(isPresentationMode && "hidden")}>
            <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button className="h-9 gap-2 bg-orange-600 text-white hover:bg-orange-500 px-3 text-[11px]" disabled={readOnlyMode}>
                <Square className="w-4 h-4" />
                <span className="hidden sm:inline">Finalizar e iniciar novo</span>
                <span className="sm:hidden">Finalizar</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Finalizar evento atual?</AlertDialogTitle>
                <AlertDialogDescription>O evento atual será arquivado e um novo Non Stop vazio será criado.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <AlertDialogAction
                        onClick={() => {
                          if (finalizeAndStartMutation.isPending) return;
                          finalizeAndStartMutation.mutate();
                        }}
                        disabled={finalizeAndStartMutation.isPending}
                        className="bg-orange-600 text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {finalizeAndStartMutation.isPending ? "A finalizar..." : "Confirmar"}
                      </AlertDialogAction>
                    </span>
                  </TooltipTrigger>
                  {finalizeAndStartMutation.isPending ? (
                    <TooltipContent>
                      Indisponivel: o evento ja esta a ser finalizado e os pontos a ser atribuidos.
                    </TooltipContent>
                  ) : null}
                </Tooltip>
              </AlertDialogFooter>
            </AlertDialogContent>
            </AlertDialog>
          </div>

          <div className={cn(isPresentationMode && "hidden")}>
            <Dialog open={isTeamDialogOpen} onOpenChange={setIsTeamDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-orange-600 text-white hover:bg-orange-500 h-9" disabled={readOnlyMode || (teams?.length || 0) >= numTeams}>
                <Plus className="w-4 h-4" /> Adicionar dupla
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader><DialogTitle>Adicionar dupla</DialogTitle></DialogHeader>
              {editableEvent && !readOnlyMode ? (
                <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-xs font-semibold uppercase text-slate-600">Data, hora e categoria no histórico</span>
                      <p className="text-xs leading-snug text-slate-500">
                        Fica registada no histórico deste Non Stop.
                      </p>
                    </div>
                    {hasEventMetadataChanges ? (
                      <Badge variant="outline" className="h-6 border-orange-200 bg-orange-50 px-2 text-[10px] font-medium text-orange-700">
                        Por guardar
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="date"
                      value={eventDateInput}
                      onChange={(event) => setEventDateInput(event.target.value)}
                      className="h-9 min-w-[145px] flex-1 bg-white text-[12px] font-medium text-slate-900"
                      title="Dia do Non Stop"
                    />
                    <Input
                      type="time"
                      value={eventTimeInput}
                      onChange={(event) => setEventTimeInput(event.target.value)}
                      className="h-9 w-[105px] bg-white text-[12px] font-medium text-slate-900"
                      title="Hora do Non Stop"
                    />
                    <Select value={eventCategoryInput} onValueChange={setEventCategoryInput}>
                      <SelectTrigger className="h-9 min-w-[150px] flex-1 bg-white text-[12px] font-medium text-slate-900">
                        <SelectValue placeholder="Categoria" />
                      </SelectTrigger>
                      <SelectContent>
                        {configuredCategories.map((category) => (
                          <SelectItem key={`event-category-${category}`} value={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      className="h-9 gap-1.5 bg-orange-600 px-3 text-[11px] font-semibold text-white hover:bg-orange-500"
                      disabled={
                        updateEventMetadataMutation.isPending ||
                        !eventDateInput ||
                        !eventTimeInput ||
                        !eventCategoryInput ||
                        !hasEventMetadataChanges
                      }
                      onClick={() => {
                        void saveEventMetadata();
                      }}
                      title="Guardar data, hora e categoria"
                    >
                      <Save className="w-3.5 h-3.5" />
                      Guardar
                    </Button>
                  </div>
                </div>
              ) : null}
              <TeamForm
                players={availablePlayers}
                teams={teams || []}
                isSubmitting={createTeamMutation.isPending || updateEventMetadataMutation.isPending}
                onSubmit={async (data) => {
                  if (hasEventMetadataChanges) {
                    try {
                      await saveEventMetadata();
                    } catch {
                      return;
                    }
                  }
                  await createTeamMutation.mutateAsync(data);
                }}
                key={teams?.length || 0}
              />
            </DialogContent>
            </Dialog>
          </div>

          <div className={cn(isPresentationMode && "hidden")}>
            <Dialog open={isManageTeamsOpen} onOpenChange={setIsManageTeamsOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-orange-600 text-white hover:bg-orange-500 h-9" disabled={readOnlyMode}>
                <Edit2 className="w-4 h-4" /> Gerir duplas
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Gerir duplas</DialogTitle>
              </DialogHeader>
              <div className="max-h-[60vh] overflow-auto border rounded-md">
                <Table>
                  <TableHeader className="bg-slate-100">
                    <TableRow>
                      <TableHead>Dupla</TableHead>
                      <TableHead className="text-right w-36">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(teams || []).map((team) => (
                      <TableRow key={team.id}>
                        <TableCell className="font-medium">
                          <p>{getTeamOptionLabel(team)}</p>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setEditingTeam(team)}
                              title="Editar dupla"
                            >
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-destructive hover:text-destructive"
                                  title="Apagar dupla"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Apagar dupla?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    A dupla "{team.name}" e todos os jogos associados serão apagados.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => deleteTeamMutation.mutate(team.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Confirmar
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!teams?.length && (
                      <TableRow>
                        <TableCell colSpan={2} className="h-16 text-center text-muted-foreground">
                          Ainda não existem duplas.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      {showHistoryEmptyState ? (
        <Card className="border-2 border-dashed border-slate-300 bg-white/75 shadow-sm backdrop-blur">
          <CardContent className="flex min-h-[260px] flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <History className="h-10 w-10 text-orange-600" />
            <div className="space-y-1">
              <h3 className="text-xl font-semibold text-slate-900">{historyEmptyTitle}</h3>
              <p className="max-w-md text-sm text-muted-foreground">{historyEmptyDescription}</p>
            </div>
            {eventsForSelectedDate.length > 1 ? (
              <Button
                className="mt-2 bg-orange-600 text-white hover:bg-orange-500"
                onClick={() => setIsHistoryDrawerOpen(true)}
              >
                Escolher horário
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
      <div className={cn("space-y-2", isPresentationMode && "space-y-1 -mt-2")}>
        <div className={cn("pt-1 2xl:sticky 2xl:top-0 2xl:z-50", isPresentationMode && "pt-0")}>
          <Card className="overflow-hidden border-2 border-slate-800 bg-slate-100 shadow-xl">
            <CardHeader className={cn("bg-slate-900 text-white py-1.5 px-2.5", isPresentationMode && "py-0.5 px-2 max-[900px]:py-0")}>
              <CardTitle className={cn("font-np-head text-sm uppercase tracking-widest text-center", isPresentationMode && "text-[10px] max-[900px]:text-[9px]")}>Classificação Geral</CardTitle>
            </CardHeader>
            <CardContent className={cn("p-0 max-h-[30vh] overflow-auto bg-slate-100", isPresentationMode && "max-h-none overflow-visible")}>
              <Table>
                <TableHeader className="font-np-head bg-orange-600 text-white">
                  <TableRow className={cn("hover:bg-orange-600 h-6", isPresentationMode && "h-5 max-[900px]:h-[18px]")}>
                    <TableHead className={cn("h-6 text-white font-bold uppercase text-[10px] leading-none py-0.5 px-2 min-w-[200px]", isPresentationMode && "h-5 text-[9px] py-0 px-1.5 max-[900px]:text-[8px]")}>Duplas</TableHead>
                    {Array.from({ length: displayNumRounds }).map((_, i) => (
                      <TableHead key={i} className={cn("h-6 text-white font-bold text-center text-[10px] leading-none py-0.5 border-l border-orange-500 whitespace-nowrap min-w-[64px]", isPresentationMode && "h-5 text-[9px] py-0 min-w-[56px] max-[900px]:text-[8px]")}>Ronda {i + 1}</TableHead>
                    ))}
                    <TableHead className={cn("h-6 text-white font-bold text-center text-[10px] leading-none py-0.5 border-l border-orange-500", isPresentationMode && "h-5 text-[9px] py-0 max-[900px]:text-[8px]")}>JG</TableHead>
                    <TableHead className={cn("h-6 text-white font-bold text-center text-[10px] leading-none py-0.5 border-l border-orange-500", isPresentationMode && "h-5 text-[9px] py-0 max-[900px]:text-[8px]")}>JP</TableHead>
                    <TableHead className={cn("h-6 text-white font-bold text-center text-[10px] leading-none py-0.5 border-l border-orange-500", isPresentationMode && "h-5 text-[9px] py-0 max-[900px]:text-[8px]")}>DIF.</TableHead>
                    <TableHead className={cn("h-6 text-white font-bold text-center text-[10px] leading-none py-0.5 border-l border-orange-500 w-16", isPresentationMode && "h-5 text-[9px] py-0 w-14 max-[900px]:text-[8px]")}>Pontos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="font-np-body">
                  {stats.map((s: any) => (
                    <TableRow key={s.teamId} className={cn("hover:bg-slate-50 h-7", isPresentationMode && "h-5 max-[900px]:h-[18px]")}>
                      <TableCell className={cn("font-np-body font-medium py-1 px-2 text-[11px] leading-tight whitespace-normal break-words", isPresentationMode && "py-0 text-[9px] max-[900px]:text-[8px]")}>{normalizeTeamName(s.name)}</TableCell>
                      {s.sequence.map((char: string, i: number) => (
                        <TableCell key={i} className={cn(
                          "font-np-head text-center text-[11px] font-bold border-l w-16 py-1",
                          isPresentationMode && "text-[9px] w-14 py-0",
                          char === 'V' ? "bg-green-100 text-green-700" :
                          char === 'D' ? "bg-red-100 text-red-700" : 
                          char === 'E' ? "bg-yellow-100 text-yellow-700" : ""
                        )}>
                          {char}
                        </TableCell>
                      ))}
                      <TableCell className={cn("font-np-num text-center text-[11px] border-l w-12 py-1", isPresentationMode && "text-[9px] w-11 py-0")}>{s.gamesWon}</TableCell>
                      <TableCell className={cn("font-np-num text-center text-[11px] border-l w-12 py-1", isPresentationMode && "text-[9px] w-11 py-0")}>{s.gamesLost}</TableCell>
                      <TableCell className={cn("font-np-num text-center text-[11px] border-l w-12 py-1", isPresentationMode && "text-[9px] w-11 py-0")}>{s.gamesWon - s.gamesLost}</TableCell>
                      <TableCell className={cn("font-np-num text-center text-[11px] font-bold border-l bg-slate-50 w-16 py-1", isPresentationMode && "text-[9px] w-14 py-0")}>{formatPoints(s.points)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      <div className={cn("grid grid-cols-1 lg:grid-cols-2 gap-2", isPresentationMode && "xl:grid-cols-3 gap-1")}>
        {Array.from({ length: displayNumRounds }).map((_, rIdx) => {
          const roundNum = rIdx + 1;
          return (
            <Card key={roundNum} className="overflow-hidden border-2 border-orange-600">
              <CardHeader className={cn("bg-orange-600 text-white py-1 text-center", isPresentationMode && "py-0.5")}>
                <CardTitle className={cn("font-np-head text-[10px] uppercase tracking-widest", isPresentationMode && "text-[9px]")}>Ronda {roundNum}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="font-np-head bg-slate-100">
                    <TableRow className={cn("hover:bg-slate-100 h-6", isPresentationMode && "h-5")}>
                      <TableHead className={cn("h-6 w-9 text-center font-bold text-[10px] leading-none px-1 py-0.5", isPresentationMode && "h-5 text-[9px] py-0 max-[900px]:text-[8px]")}>CAMPO</TableHead>
                      <TableHead className={cn("h-6 font-bold text-[10px] leading-none w-[34%] px-1 py-0.5", isPresentationMode && "h-5 text-[9px] py-0 max-[900px]:text-[8px]")}>EQUIPA A</TableHead>
                      <TableHead className={cn("h-6 w-10 text-center font-bold text-[10px] leading-none px-1 py-0.5", isPresentationMode && "h-5 text-[9px] py-0 max-[900px]:text-[8px]")}>RES</TableHead>
                      <TableHead className={cn("h-6 w-6 text-center text-[10px] leading-none text-muted-foreground font-normal py-0.5", isPresentationMode && "h-5 text-[9px] py-0 max-[900px]:text-[8px]")}>vs</TableHead>
                      <TableHead className={cn("h-6 w-10 text-center font-bold text-[10px] leading-none px-1 py-0.5", isPresentationMode && "h-5 text-[9px] py-0 max-[900px]:text-[8px]")}>RES</TableHead>
                      <TableHead className={cn("h-6 font-bold text-[10px] leading-none w-[34%] px-1 py-0.5", isPresentationMode && "h-5 text-[9px] py-0 max-[900px]:text-[8px]")}>EQUIPA B</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="font-np-body">
                    {Array.from({ length: displayNumCourts }).map((_, cIdx) => {
                      const courtNum = cIdx + 1;
                      const matchResult = results?.find(res => res.round === roundNum && res.court === courtNum);
                      const scoreA = typeof matchResult?.scoreA === "number" ? matchResult.scoreA : null;
                      const scoreB = typeof matchResult?.scoreB === "number" ? matchResult.scoreB : null;
                      const hasPlayed = scoreA !== null && scoreB !== null && (scoreA > 0 || scoreB > 0);
                      const isTeamAWinner = hasPlayed && scoreA > scoreB;
                      const isTeamBWinner = hasPlayed && scoreB > scoreA;
                      return (
                        <TableRow key={courtNum} className={cn("h-7", isPresentationMode && "h-6 max-[900px]:h-5")}>
                          <TableCell className={cn("font-np-num text-center text-[11px] font-bold bg-slate-50 border-r px-1 py-1", isPresentationMode && "text-[10px] py-0.5 max-[900px]:text-[9px] max-[900px]:py-0")}>{courtNum}</TableCell>
                          <TableCell className={cn("w-[34%] max-w-0 px-1 py-1", isPresentationMode && "py-0.5")}>
                            <Select 
                              value={matchResult?.teamAId?.toString()} 
                              onValueChange={(val) => {
                                if (readOnlyMode) return;
                                updateResultMutation.mutate({ ...matchResult, round: roundNum, court: courtNum, teamAId: parseInt(val), scoreA: matchResult?.scoreA ?? 0, scoreB: matchResult?.scoreB ?? 0, teamBId: matchResult?.teamBId ?? 0 });
                              }}
                            >
                              <SelectTrigger disabled={readOnlyMode} className={cn("font-np-body w-full min-w-0 border-none shadow-none focus:ring-0 h-6 text-[10px] px-1.5 [&>span]:min-w-0 [&>span]:flex-1 [&>span]:text-left [&>span]:truncate", isTeamAWinner && "font-bold", isPresentationMode && "h-5 text-[9px] px-1 max-[900px]:h-4 max-[900px]:text-[8px]")}>
                                <SelectValue className="block truncate text-left" placeholder="Selecionar Equipa" />
                              </SelectTrigger>
                              <SelectContent>
                                {teams?.map((t) => (
                                  <SelectItem className="font-np-body" key={t.id} value={t.id.toString()}>
                                    {getTeamOptionLabel(t)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className={cn("p-0 px-1 py-1", isPresentationMode && "py-0.5")}>
                            <Input 
                              type="text"
                              inputMode="numeric"
                              disabled={readOnlyMode}
                              className={cn("font-np-num border-none text-center text-[11px] font-bold focus-visible:ring-0 h-5 w-8 mx-auto px-0", isPresentationMode && "text-[10px] h-4 w-7 max-[900px]:text-[9px] max-[900px]:h-3.5 max-[900px]:w-6")}
                              value={getScoreValue(roundNum, courtNum, "A", matchResult)}
                              onChange={(e) => onScoreChange(roundNum, courtNum, "A", e.target.value)}
                              onBlur={() => commitScore(roundNum, courtNum, "A", matchResult)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  (e.currentTarget as HTMLInputElement).blur();
                                }
                              }}
                            />
                          </TableCell>
                          <TableCell className={cn("font-np-head text-center text-[10px] text-muted-foreground bg-slate-50 border-x py-1", isPresentationMode && "text-[9px] py-0.5 max-[900px]:text-[8px] max-[900px]:py-0")}>vs</TableCell>
                          <TableCell className={cn("p-0 px-1 py-1", isPresentationMode && "py-0.5")}>
                            <Input 
                              type="text"
                              inputMode="numeric"
                              disabled={readOnlyMode}
                              className={cn("font-np-num border-none text-center text-[11px] font-bold focus-visible:ring-0 h-5 w-8 mx-auto px-0", isPresentationMode && "text-[10px] h-4 w-7 max-[900px]:text-[9px] max-[900px]:h-3.5 max-[900px]:w-6")}
                              value={getScoreValue(roundNum, courtNum, "B", matchResult)}
                              onChange={(e) => onScoreChange(roundNum, courtNum, "B", e.target.value)}
                              onBlur={() => commitScore(roundNum, courtNum, "B", matchResult)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  (e.currentTarget as HTMLInputElement).blur();
                                }
                              }}
                            />
                          </TableCell>
                          <TableCell className={cn("w-[34%] max-w-0 px-1 py-1", isPresentationMode && "py-0.5")}>
                            <Select 
                              value={matchResult?.teamBId?.toString()} 
                              onValueChange={(val) => {
                                if (readOnlyMode) return;
                                updateResultMutation.mutate({ ...matchResult, round: roundNum, court: courtNum, teamBId: parseInt(val), scoreA: matchResult?.scoreA ?? 0, scoreB: matchResult?.scoreB ?? 0, teamAId: matchResult?.teamAId ?? 0 });
                              }}
                            >
                              <SelectTrigger disabled={readOnlyMode} className={cn("font-np-body w-full min-w-0 border-none shadow-none focus:ring-0 h-6 text-[10px] px-1.5 [&>span]:min-w-0 [&>span]:flex-1 [&>span]:text-left [&>span]:truncate", isTeamBWinner && "font-bold", isPresentationMode && "h-5 text-[9px] px-1 max-[900px]:h-4 max-[900px]:text-[8px]")}>
                                <SelectValue className="block truncate text-left" placeholder="Selecionar Equipa" />
                              </SelectTrigger>
                              <SelectContent>
                                {teams?.map((t) => (
                                  <SelectItem className="font-np-body" key={t.id} value={t.id.toString()}>
                                    {getTeamOptionLabel(t)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          );
        })}
      </div>
      </div>
      )}

      <Drawer open={isHistoryDrawerOpen} onOpenChange={setIsHistoryDrawerOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Selecionar Non Stop</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-4 space-y-2">
            {eventsForSelectedDate.length === 0 ? (
              <p className="text-sm text-muted-foreground">Não há eventos neste dia.</p>
            ) : (
              eventsForSelectedDate.map((event) => (
                <Button
                  key={event.id}
                  variant={selectedHistoryEventId === event.id ? "default" : "outline"}
                  className="w-full justify-between"
                  onClick={() => {
                    setSelectedHistoryEventId(event.id);
                    setViewMode("history");
                    setIsHistoryDrawerOpen(false);
                  }}
                >
                  <span>{event.label || event.category || "Non Stop"}</span>
                  <span>{toLisbonTimeKey(event.startedAt ?? event.createdAt)}</span>
                </Button>
              ))
            )}
          </div>
        </DrawerContent>
      </Drawer>

      <Dialog open={!!editingTeam} onOpenChange={() => setEditingTeam(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar dupla</DialogTitle>
          </DialogHeader>
          {editingTeam && (
            <TeamForm
              players={availablePlayers}
              teams={teams || []}
              editingTeamId={editingTeam.id}
              defaultValues={editingTeam}
              submitLabel="Guardar alterações"
              onSubmit={(data) => updateTeamMutation.mutate({ id: editingTeam.id, data })}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TeamForm({
  onSubmit,
  players,
  teams,
  editingTeamId,
  defaultValues,
  submitLabel = "Adicionar",
  isSubmitting = false,
}: {
  onSubmit: (data: any) => void;
  players: Player[];
  teams: Team[];
  editingTeamId?: number;
  defaultValues?: Partial<Team>;
  submitLabel?: string;
  isSubmitting?: boolean;
}) {
  const playersById = useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players],
  );

  const form = useForm({
    resolver: zodResolver(insertTeamSchema),
    defaultValues: {
      name: defaultValues?.name || "",
      playerAId: typeof defaultValues?.playerAId === "number" ? defaultValues.playerAId : undefined,
      playerBId: typeof defaultValues?.playerBId === "number" ? defaultValues.playerBId : undefined,
    },
  });
  const selectedPlayerAId = form.watch("playerAId");
  const selectedPlayerBId = form.watch("playerBId");
  const [playerASearch, setPlayerASearch] = useState("");
  const [playerBSearch, setPlayerBSearch] = useState("");
  const [isPlayerASelectOpen, setIsPlayerASelectOpen] = useState(false);
  const [isPlayerBSelectOpen, setIsPlayerBSelectOpen] = useState(false);
  const occupiedPlayerIds = useMemo(() => {
    const ids = new Set<number>();
    for (const team of teams) {
      if (typeof editingTeamId === "number" && team.id === editingTeamId) continue;
      if (typeof team.playerAId === "number") ids.add(team.playerAId);
      if (typeof team.playerBId === "number") ids.add(team.playerBId);
    }
    return ids;
  }, [teams, editingTeamId]);
  const sortedPlayers = useMemo(
    () =>
      [...players].sort((a, b) =>
        a.name.localeCompare(b.name, "pt-PT", { sensitivity: "base" }),
      ),
    [players],
  );
  const filteredPlayersA = useMemo(() => {
    const searchValue = playerASearch.trim().toLocaleLowerCase();
    if (!searchValue) return sortedPlayers;
    return sortedPlayers.filter((player) =>
      player.id === selectedPlayerAId ||
      player.name.toLocaleLowerCase().includes(searchValue),
    );
  }, [playerASearch, sortedPlayers, selectedPlayerAId]);
  const filteredPlayersB = useMemo(() => {
    const searchValue = playerBSearch.trim().toLocaleLowerCase();
    if (!searchValue) return sortedPlayers;
    return sortedPlayers.filter((player) =>
      player.id === selectedPlayerBId ||
      player.name.toLocaleLowerCase().includes(searchValue),
    );
  }, [playerBSearch, sortedPlayers, selectedPlayerBId]);

  const applyAutoName = () => {
    const nameA = typeof selectedPlayerAId === "number" ? playersById.get(selectedPlayerAId)?.name : null;
    const nameB = typeof selectedPlayerBId === "number" ? playersById.get(selectedPlayerBId)?.name : null;
    if (!nameA || !nameB) return;
    form.setValue("name", normalizeTeamName(`${nameA} / ${nameB}`), { shouldDirty: true });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="playerAId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Jogador A</FormLabel>
                <Select
                  open={isPlayerASelectOpen}
                  onOpenChange={(open) => {
                    setIsPlayerASelectOpen(open);
                    if (!open) setPlayerASearch("");
                  }}
                  value={typeof field.value === "number" ? String(field.value) : undefined}
                  onValueChange={(value) => field.onChange(Number(value))}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar jogador" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <div className="px-2 pb-1 pt-1">
                      <Input
                        value={playerASearch}
                        onChange={(event) => setPlayerASearch(event.target.value)}
                        onKeyDown={(event) => event.stopPropagation()}
                        placeholder="Procurar jogador..."
                        className="h-8"
                      />
                    </div>
                    {filteredPlayersA.length === 0 ? (
                      <p className="px-2 py-1 text-xs text-muted-foreground">Sem jogadores encontrados.</p>
                    ) : (
                      filteredPlayersA.map((player) => (
                        <SelectItem
                          key={`team-player-a-${player.id}`}
                          value={String(player.id)}
                          disabled={
                            selectedPlayerBId === player.id ||
                            (occupiedPlayerIds.has(player.id) && selectedPlayerAId !== player.id)
                          }
                        >
                          {player.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="playerBId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Jogador B</FormLabel>
                <Select
                  open={isPlayerBSelectOpen}
                  onOpenChange={(open) => {
                    setIsPlayerBSelectOpen(open);
                    if (!open) setPlayerBSearch("");
                  }}
                  value={typeof field.value === "number" ? String(field.value) : undefined}
                  onValueChange={(value) => field.onChange(Number(value))}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar jogador" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <div className="px-2 pb-1 pt-1">
                      <Input
                        value={playerBSearch}
                        onChange={(event) => setPlayerBSearch(event.target.value)}
                        onKeyDown={(event) => event.stopPropagation()}
                        placeholder="Procurar jogador..."
                        className="h-8"
                      />
                    </div>
                    {filteredPlayersB.length === 0 ? (
                      <p className="px-2 py-1 text-xs text-muted-foreground">Sem jogadores encontrados.</p>
                    ) : (
                      filteredPlayersB.map((player) => (
                        <SelectItem
                          key={`team-player-b-${player.id}`}
                          value={String(player.id)}
                          disabled={
                            selectedPlayerAId === player.id ||
                            (occupiedPlayerIds.has(player.id) && selectedPlayerBId !== player.id)
                          }
                        >
                          {player.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome da dupla</FormLabel>
              <div className="space-y-2">
                <FormControl><Input placeholder="Ex: Joao e Maria" {...field} /></FormControl>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={applyAutoName}
                  disabled={!(selectedPlayerAId && selectedPlayerBId)}
                >
                  Usar nomes dos jogadores
                </Button>
                <p className="text-xs text-muted-foreground">
                  Cada jogador so pode pertencer a uma dupla por evento.
                </p>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={isSubmitting}>{submitLabel}</Button>
      </form>
    </Form>
  );
}
