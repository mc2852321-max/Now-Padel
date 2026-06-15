import { useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { type Player, type Settings, insertPlayerSchema } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const LEVELS = ["M2", "M3", "M4", "M5", "M6", "F2", "F3", "F4", "F5", "F6"];

function parseArrayField(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item));
  } catch {}
  return [];
}

type PlayerFormProps = {
  defaultValues?: Partial<Player>;
  isSubmitting?: boolean;
  submitLabel?: string;
  onSubmit: (data: any) => void | Promise<void>;
};

export function PlayerForm({
  defaultValues,
  isSubmitting = false,
  submitLabel = "Guardar",
  onSubmit,
}: PlayerFormProps) {
  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const checklistOptions = (() => {
    const parsed = parseArrayField(settings?.playerProfileOptions);
    if (parsed.length > 0) return parsed;
    return ["Academia", "Fecha jogos", "Non Stop"];
  })();

  const form = useForm({
    resolver: zodResolver(insertPlayerSchema),
    defaultValues: {
      name: defaultValues?.name ?? "",
      phone: defaultValues?.phone ?? "",
      level: defaultValues?.level ?? "placeholder",
      notes: defaultValues?.notes ?? "",
      profileTags: defaultValues?.profileTags ?? "[]",
    },
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
                  onChange={(event) => {
                    const value = event.target.value.replace(/\D/g, "");
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
                  {LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>{level}</SelectItem>
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
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "A guardar..." : submitLabel}
        </Button>
      </form>
    </Form>
  );
}
