import { useQuery, useMutation } from "@tanstack/react-query";
import { Team, NonstopResult, Settings, insertTeamSchema } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Plus, Settings as SettingsIcon, Trash2, Square, Play, Pause, Download, Edit2 } from "lucide-react";
import * as XLSX from "xlsx-js-style";
import { Link } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useState, useEffect } from "react";

type TimerState = 'idle' | 'warmup' | 'game' | 'rest';

function getConfiguredDuration(
  soundType: string,
  settings?: Settings
) {
  const fallback = Math.max(1, settings?.airHornDuration || 5);
  const configured = Math.max(1, settings?.soundDurationSeconds || fallback);
  return soundType === (settings?.soundDurationTarget || "air-horn") ? configured : null;
}

export default function Nonstop() {
  const { toast } = useToast();
  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });
  const { data: teams } = useQuery<Team[]>({
    queryKey: ["/api/teams"],
  });
  const { data: results } = useQuery<NonstopResult[]>({
    queryKey: ["/api/results"],
  });

  const [timerState, setTimerState] = useState<TimerState>('idle');
  const [timeLeft, setTimeLeft] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [round, setRound] = useState(1);
  const [isTeamDialogOpen, setIsTeamDialogOpen] = useState(false);
  const [isManageTeamsOpen, setIsManageTeamsOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);

  const numCourts = settings?.nonstopCourts || 3;
  const numTeams = numCourts * 2;
  const numRounds = settings?.nonstopRounds || 5;
  const warmupMinutes = settings?.warmupTime ?? 0;
  const gameMinutes = settings?.gameTime ?? 20;
  const restMinutes = settings?.restTime ?? 2;
  const totalRounds = settings?.nonstopRounds ?? 5;

  const playSound = (type: 'start-warmup' | 'start-game' | 'end-game' | 'final') => {
    let soundType = settings?.startGameSound || 'beep-high';
    if (type === 'start-warmup') soundType = settings?.startWarmupSound || 'beep-low';
    if (type === 'end-game') soundType = settings?.endGameSound || 'beep-low';
    if (type === 'final') soundType = settings?.finalSound || 'beep-high';

    const frequency = soundType === 'beep-high' ? 880 : 
                      soundType === 'beep-low' ? 440 :
                      soundType === 'horn-deep' ? 60 :
                      soundType === 'air-horn' ? 85 :
                      soundType.includes('horn') ? 100 : 440; // Frequency for horn variants
    
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

    const playAirHornSample = (durationSeconds: number) => {
      const audio = new Audio("/sounds/air-horn.mpeg");
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
      });

      audio.play().catch(() => {
        if (stopTimer) clearTimeout(stopTimer);
        playBeep(0, Math.max(1, durationSeconds), true);
      });
    };

    const configuredDuration = getConfiguredDuration(soundType, settings);

    if (soundType === 'air-horn') {
      playAirHornSample(configuredDuration ?? 5.0);
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
      // Play 3 beeps
      playBeep(0, 0.4);
      playBeep(0.5, 0.4);
      playBeep(1.0, 0.4);
    }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isActive && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (isActive && timeLeft === 0) {
      if (timerState === 'warmup') {
        // Warmup -> Game 1
        setTimerState('game');
        setTimeLeft(gameMinutes * 60);
        playSound('start-game');
      } else if (timerState === 'game') {
        if (round < totalRounds) {
          // Game X -> Rest
          playSound('end-game');
          if (restMinutes > 0) {
            setTimerState('rest');
            setTimeLeft(restMinutes * 60);
          } else {
            setRound((prev) => prev + 1);
            setTimerState('game');
            setTimeLeft(gameMinutes * 60);
            playSound('start-game');
          }
        } else {
          // Final Game -> End
          setIsActive(false);
          setTimerState('idle');
          playSound('final');
          toast({ title: "Non Stop Finalizado", description: "O torneio chegou ao fim!" });
        }
      } else if (timerState === 'rest') {
        // Rest -> Game X+1
        setRound((prev) => prev + 1);
        setTimerState('game');
        setTimeLeft(gameMinutes * 60);
        playSound('start-game');
      }
    }
    return () => clearInterval(interval);
  }, [isActive, timeLeft, timerState, round, gameMinutes, restMinutes, totalRounds]);

  const startTimer = () => {
    setRound(1);
    if (warmupMinutes > 0) {
      setTimerState('warmup');
      setTimeLeft(warmupMinutes * 60);
      playSound('start-warmup');
    } else {
      setTimerState('game');
      setTimeLeft(gameMinutes * 60);
      playSound('start-game');
    }
    setIsActive(true);
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
      const res = await apiRequest("POST", "/api/teams", data);
      return res.json();
    },
    onSuccess: async (newTeam) => {
      const currentTeams = [...(teams || []), newTeam];
      if (currentTeams.length >= numTeams) {
        setIsTeamDialogOpen(false);
      }
      
      if (currentTeams.length === numTeams) {
        await rebuildSchedule(currentTeams);
        toast({ title: "Calendario gerado", description: "Emparelhamentos criados sem repeticoes indevidas." });
      } else if ((results?.length || 0) > 0) {
        await apiRequest("POST", "/api/results/clear");
      }

      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      queryClient.invalidateQueries({ queryKey: ["/api/results"] });
      toast({ title: "Sucesso", description: "Equipa adicionada" });
    }
  });

  const updateTeamMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/teams/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      queryClient.invalidateQueries({ queryKey: ["/api/results"] });
      setEditingTeam(null);
      toast({ title: "Sucesso", description: "Dupla atualizada" });
    },
  });

  const deleteTeamMutation = useMutation({
    mutationFn: async (id: number) => {
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
    const key = getScoreKey(roundNum, courtNum, field);
    const next = value.replace(/[^\d]/g, "");
    setScoreDrafts((prev) => ({ ...prev, [key]: next }));
  };

  const commitScore = (roundNum: number, courtNum: number, field: "A" | "B", matchResult?: NonstopResult) => {
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
        onSettled: () => {
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
      if (!data.teamAId || !data.teamBId || data.teamAId < 1 || data.teamBId < 1) {
        return null;
      }
      const res = await apiRequest("POST", "/api/results", data);
      return res.json();
    },
    onSuccess: (data) => {
      if (data) {
        queryClient.invalidateQueries({ queryKey: ["/api/results"] });
      }
    }
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/nonstop/reset");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      queryClient.invalidateQueries({ queryKey: ["/api/results"] });
      toast({ title: "Sucesso", description: "Torneio reiniciado" });
    }
  });

  const exportToExcel = async () => {
    try {
      const res = await fetch("/api/nonstop/export");
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
        ...Array(numRounds).fill({ wch: 5 })
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
    
    teams.forEach(team => {
      standings[team.id] = { points: 0, gamesWon: 0, gamesLost: 0, teamId: team.id, name: team.name, sequence: [] };
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
              teamA.points += 3;
            } else if (result.scoreB > result.scoreA) {
              teamB.points += 3;
            } else {
              teamA.points += 1;
              teamB.points += 1;
            }
          }
        }
      }
    });

    // Calculate sequences
    teams.forEach(team => {
      const teamStandings = standings[team.id];
      for (let r = 1; r <= numRounds; r++) {
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

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h2 className="text-3xl font-bold tracking-tight uppercase">Nonstop {numCourts} Campos</h2>
        
        <div className="flex flex-wrap items-center gap-2">
          <Card className={cn(
            "flex items-center gap-4 px-4 py-2 border-2",
            isActive ? "bg-orange-950 border-orange-500" : "bg-slate-900 border-slate-800"
          )}>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-widest text-orange-500 font-bold">
                {timerState === 'idle'
                  ? 'Cronometro'
                  : timerState === 'warmup'
                  ? 'Aquecimento'
                  : timerState === 'game'
                  ? 'Em Jogo'
                  : 'Descanso'}
              </span>
              <span className="text-2xl font-mono text-white leading-none">
                {formatTime(timeLeft)}
              </span>
            </div>

            <div className="flex items-center gap-1">
              {timerState === 'warmup' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-[10px] px-2 border-orange-500 text-orange-500 hover:bg-orange-500/10"
                  onClick={() => {
                    setTimerState('game');
                    setTimeLeft(gameMinutes * 60);
                    playSound('start-game');
                    setIsActive(true);
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
                  className="h-8 text-[10px] px-2 border-orange-500 text-orange-500 hover:bg-orange-500/10"
                  onClick={() => {
                    setRound((prev) => prev + 1);
                    setTimerState('game');
                    setTimeLeft(gameMinutes * 60);
                    playSound('start-game');
                    setIsActive(true);
                    toast({ title: "Descanso Ignorado", description: "Início da próxima ronda!" });
                  }}
                >
                  PULAR DESC
                </Button>
              )}

              {!isActive ? (
                <>
                  <Button size="sm" className="h-8 text-[10px] px-2 bg-orange-600 hover:bg-orange-500" onClick={() => {
                    if (timeLeft > 0 && timerState !== 'idle') {
                      setIsActive(true);
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
                  <Button variant="outline" size="icon" className="h-8 w-8 text-orange-500 border-orange-500/50" onClick={() => setIsActive(false)}>
                    <Pause className="h-3 w-3" />
                  </Button>
                  <Button variant="destructive" size="icon" className="h-8 w-8" onClick={() => { setIsActive(false); setTimerState('idle'); setTimeLeft(0); }}>
                    <Square className="h-3 w-3" />
                  </Button>
                </>
              )}

              <Link href="/settings">
                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400" data-testid="button-open-settings">
                  <SettingsIcon className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </Card>

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

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="icon" className="text-destructive hover:bg-destructive/10">
                <Trash2 className="w-4 h-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reiniciar Torneio?</AlertDialogTitle>
                <AlertDialogDescription>Apagar todas as equipas e resultados? Esta ação não pode ser desfeita.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => resetMutation.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Confirmar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Dialog open={isTeamDialogOpen} onOpenChange={setIsTeamDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-orange-600 text-white hover:bg-orange-500" disabled={(teams?.length || 0) >= numTeams}>
                <Plus className="w-4 h-4" /> Adicionar dupla
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Adicionar dupla</DialogTitle></DialogHeader>
              <TeamForm onSubmit={(data) => createTeamMutation.mutate(data)} key={teams?.length || 0} />
            </DialogContent>
          </Dialog>

          <Dialog open={isManageTeamsOpen} onOpenChange={setIsManageTeamsOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-orange-600 text-white hover:bg-orange-500">
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
                        <TableCell className="font-medium">{team.name}</TableCell>
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

      <div className="space-y-4">
        <div className="sticky top-0 z-50 pt-1">
          <Card className="overflow-hidden border-2 border-slate-800 bg-slate-100 shadow-xl">
            <CardHeader className="bg-slate-900 text-white py-2 px-3">
              <CardTitle className="text-sm uppercase tracking-widest text-center">Classificação Geral</CardTitle>
            </CardHeader>
            <CardContent className="p-0 max-h-[46vh] overflow-auto bg-slate-100">
              <Table>
                <TableHeader className="bg-orange-600 text-white">
                  <TableRow className="hover:bg-orange-600 h-8">
                    <TableHead className="text-white font-bold uppercase text-[11px] py-1.5 px-3 min-w-[220px]">Duplas</TableHead>
                    {Array.from({ length: numRounds }).map((_, i) => (
                      <TableHead key={i} className="text-white font-bold text-center text-[11px] py-1.5 border-l border-orange-500">Ronda {i + 1}</TableHead>
                    ))}
                    <TableHead className="text-white font-bold text-center text-[11px] py-1.5 border-l border-orange-500">JG</TableHead>
                    <TableHead className="text-white font-bold text-center text-[11px] py-1.5 border-l border-orange-500">JP</TableHead>
                    <TableHead className="text-white font-bold text-center text-[11px] py-1.5 border-l border-orange-500">DIF.</TableHead>
                    <TableHead className="text-white font-bold text-center text-[11px] py-1.5 border-l border-orange-500 w-20">Pontos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.map((s: any) => (
                    <TableRow key={s.teamId} className="hover:bg-slate-50 h-8">
                      <TableCell className="font-medium py-1.5 px-3 text-xs leading-tight">{s.name}</TableCell>
                      {s.sequence.map((char: string, i: number) => (
                        <TableCell key={i} className={cn(
                          "text-center text-xs font-bold border-l w-20 py-1.5",
                          char === 'V' ? "bg-green-100 text-green-700" :
                          char === 'D' ? "bg-red-100 text-red-700" : 
                          char === 'E' ? "bg-yellow-100 text-yellow-700" : ""
                        )}>
                          {char}
                        </TableCell>
                      ))}
                      <TableCell className="text-center text-xs border-l w-14 py-1.5">{s.gamesWon}</TableCell>
                      <TableCell className="text-center text-xs border-l w-14 py-1.5">{s.gamesLost}</TableCell>
                      <TableCell className="text-center text-xs border-l w-14 py-1.5">{s.gamesWon - s.gamesLost}</TableCell>
                      <TableCell className="text-center text-xs font-bold border-l bg-slate-50 w-20 py-1.5">{s.points}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {Array.from({ length: numRounds }).map((_, rIdx) => {
          const roundNum = rIdx + 1;
          return (
            <Card key={roundNum} className="overflow-hidden border-2 border-orange-600">
              <CardHeader className="bg-orange-600 text-white py-2 text-center">
                <CardTitle className="text-xs uppercase tracking-widest">Ronda {roundNum}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-slate-100">
                    <TableRow className="hover:bg-slate-100 h-8">
                      <TableHead className="w-12 text-center font-bold text-[11px] px-2 py-1.5">CAMPO</TableHead>
                      <TableHead className="font-bold text-[11px] w-[34%] px-2 py-1.5">EQUIPA A</TableHead>
                      <TableHead className="w-16 text-center font-bold text-[11px] px-2 py-1.5">RESULTADO</TableHead>
                      <TableHead className="w-8 text-center text-[11px] text-muted-foreground font-normal py-1.5">vs</TableHead>
                      <TableHead className="w-16 text-center font-bold text-[11px] px-2 py-1.5">RESULTADO</TableHead>
                      <TableHead className="font-bold text-[11px] w-[34%] px-2 py-1.5">EQUIPA B</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Array.from({ length: numCourts }).map((_, cIdx) => {
                      const courtNum = cIdx + 1;
                      const matchResult = results?.find(res => res.round === roundNum && res.court === courtNum);
                      return (
                        <TableRow key={courtNum} className="h-9">
                          <TableCell className="text-center text-xs font-bold bg-slate-50 border-r px-2 py-1.5">{courtNum}</TableCell>
                          <TableCell className="w-[34%] px-1 py-1">
                            <Select 
                              value={matchResult?.teamAId?.toString()} 
                              onValueChange={(val) => updateResultMutation.mutate({ ...matchResult, round: roundNum, court: courtNum, teamAId: parseInt(val), scoreA: matchResult?.scoreA ?? 0, scoreB: matchResult?.scoreB ?? 0, teamBId: matchResult?.teamBId ?? 0 })}
                            >
                              <SelectTrigger className="border-none shadow-none focus:ring-0 h-7 text-[11px] px-2 min-w-[130px]">
                                <SelectValue placeholder="Selecionar Equipa" />
                              </SelectTrigger>
                              <SelectContent>
                                {teams?.map(t => <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="p-0 px-1 py-1">
                            <Input 
                              type="text"
                              inputMode="numeric"
                              className="border-none text-center text-xs font-bold focus-visible:ring-0 h-6 w-10 mx-auto px-0"
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
                          <TableCell className="text-center text-[11px] text-muted-foreground bg-slate-50 border-x py-1.5">vs</TableCell>
                          <TableCell className="p-0 px-1 py-1">
                            <Input 
                              type="text"
                              inputMode="numeric"
                              className="border-none text-center text-xs font-bold focus-visible:ring-0 h-6 w-10 mx-auto px-0"
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
                          <TableCell className="w-[34%] px-1 py-1">
                            <Select 
                              value={matchResult?.teamBId?.toString()} 
                              onValueChange={(val) => updateResultMutation.mutate({ ...matchResult, round: roundNum, court: courtNum, teamBId: parseInt(val), scoreA: matchResult?.scoreA ?? 0, scoreB: matchResult?.scoreB ?? 0, teamAId: matchResult?.teamAId ?? 0 })}
                            >
                              <SelectTrigger className="border-none shadow-none focus:ring-0 h-7 text-[11px] px-2 min-w-[130px]">
                                <SelectValue placeholder="Selecionar Equipa" />
                              </SelectTrigger>
                              <SelectContent>
                                {teams?.map(t => <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>)}
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

      <Dialog open={!!editingTeam} onOpenChange={() => setEditingTeam(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar dupla</DialogTitle>
          </DialogHeader>
          {editingTeam && (
            <TeamForm
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
  defaultValues,
  submitLabel = "Adicionar",
}: {
  onSubmit: (data: any) => void;
  defaultValues?: Partial<Team>;
  submitLabel?: string;
}) {
  const form = useForm({
    resolver: zodResolver(insertTeamSchema),
    defaultValues: {
      name: defaultValues?.name || "",
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome da dupla</FormLabel>
              <FormControl><Input placeholder="Ex: João e Maria" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full">{submitLabel}</Button>
      </form>
    </Form>
  );
}

