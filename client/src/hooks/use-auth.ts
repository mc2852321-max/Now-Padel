import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface AuthUser {
  id: number;
  email: string;
  name: string | null;
}

async function fetchUser(): Promise<AuthUser | null> {
  const response = await fetch("/api/auth/user", {
    credentials: "include",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  return response.json();
}

async function logoutFn(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });
}

async function loginFn({ email, password }: { email: string; password: string }): Promise<AuthUser> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || "Erro ao fazer login");
  }

  const data = await response.json();
  return data.user;
}

export function useAuth() {
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const logoutMutation = useMutation({
    mutationFn: logoutFn,
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/user"], null);
    },
  });

  const loginMutation = useMutation({
    mutationFn: loginFn,
    onSuccess: (user) => {
      queryClient.setQueryData(["/api/auth/user"], user);
    },
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
    login: loginMutation.mutateAsync,
    isLoggingIn: loginMutation.isPending,
    loginError: loginMutation.error?.message,
  };
}
