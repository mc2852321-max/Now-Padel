import type { Player } from "@shared/schema";

export type PlayersPageResponse = {
  items: Player[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const PLAYERS_PAGE_SIZE = 100;

async function fetchPlayersPage(page: number): Promise<PlayersPageResponse> {
  const res = await fetch(`/api/players?page=${page}&pageSize=${PLAYERS_PAGE_SIZE}`, {
    credentials: "include",
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("401: Sessão expirada. Inicia sessão novamente.");
    }
    throw new Error(`Nao foi possivel carregar jogadores (pagina ${page}).`);
  }
  return res.json();
}

export async function fetchAllPlayers(): Promise<PlayersPageResponse> {
  const firstPage = await fetchPlayersPage(1);

  const totalPages = Math.max(1, firstPage.totalPages || 1);
  if (totalPages === 1) return firstPage;

  const remainingPagePromises: Array<Promise<PlayersPageResponse>> = [];
  for (let page = 2; page <= totalPages; page += 1) {
    remainingPagePromises.push(fetchPlayersPage(page));
  }

  const remainingPages = await Promise.all(remainingPagePromises);
  const mergedItems = [
    ...firstPage.items,
    ...remainingPages.flatMap((page) => page.items),
  ];

  return {
    items: mergedItems,
    total: mergedItems.length,
    page: 1,
    pageSize: PLAYERS_PAGE_SIZE,
    totalPages,
  };
}
