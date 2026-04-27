import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SiWhatsapp } from "react-icons/si";
import { Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { openWhatsAppGeneral } from "@/lib/whatsapp";

type MessageTemplate = {
  id: string;
  title: string;
  body: string;
  custom?: boolean;
};
type MessageVariableKey = "nome" | "nivel" | "data" | "hora";
type MessageVariable = {
  key: MessageVariableKey;
  token: string;
  label: string;
  placeholder: string;
};

const STORAGE_KEY = "now-padel-message-templates";

const DEFAULT_TEMPLATES: MessageTemplate[] = [
  {
    id: "game-invite",
    title: "Convite para jogo",
    body: "Olá {nome},\nTemos um jogo de nível {nivel} no dia {data} às {hora}.\nConsegues jogar?",
  },
  {
    id: "nonstop",
    title: "Non Stop",
    body: "Olá {nome},\nVamos organizar um Non Stop no dia {data} às {hora}.\nQueres participar?",
  },
  {
    id: "lesson",
    title: "Aula / treino",
    body: "Olá {nome},\nHá vaga para treino no dia {data} às {hora}.\nConfirmas presença?",
  },
  {
    id: "general-notice",
    title: "Aviso geral",
    body: "Olá,\nPartilhamos uma atualização do clube:\n\n",
  },
];

const MESSAGE_VARIABLES: MessageVariable[] = [
  { key: "nome", token: "{nome}", label: "Nome", placeholder: "Nome do jogador" },
  { key: "nivel", token: "{nivel}", label: "Nível", placeholder: "Ex: M4" },
  { key: "data", token: "{data}", label: "Data", placeholder: "Ex: 27/04" },
  { key: "hora", token: "{hora}", label: "Hora", placeholder: "Ex: 19:30" },
];

function applyPreviewVariables(value: string, variableValues: Record<MessageVariableKey, string>) {
  return MESSAGE_VARIABLES.reduce(
    (text, variable) => {
      const replacement = variableValues[variable.key].trim();
      return text.split(variable.token).join(replacement || variable.token);
    },
    value,
  );
}

export default function Messages() {
  const [message, setMessage] = useState("");
  const [savedTemplates, setSavedTemplates] = useState<MessageTemplate[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [variableValues, setVariableValues] = useState<Record<MessageVariableKey, string>>({
    nome: "",
    nivel: "",
    data: "",
    hora: "",
  });
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) return;

      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return;

      setSavedTemplates(
        parsed
          .filter((item) => item && typeof item.title === "string" && typeof item.body === "string")
          .map((item) => ({
            id: String(item.id || crypto.randomUUID()),
            title: item.title,
            body: item.body,
            custom: true,
          })),
      );
    } catch {
      setSavedTemplates([]);
    }
  }, []);

  const allTemplates = useMemo(
    () => [...DEFAULT_TEMPLATES, ...savedTemplates],
    [savedTemplates],
  );

  const previewMessage = useMemo(
    () => applyPreviewVariables(message, variableValues),
    [message, variableValues],
  );

  const persistTemplates = (templates: MessageTemplate[]) => {
    setSavedTemplates(templates);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  };

  const handleSend = () => {
    openWhatsAppGeneral(previewMessage);
  };

  const handleSaveTemplate = () => {
    const body = message.trim();
    if (!body) return;

    const title = templateName.trim() || `Template ${savedTemplates.length + 1}`;
    persistTemplates([
      ...savedTemplates,
      {
        id: crypto.randomUUID(),
        title,
        body,
        custom: true,
      },
    ]);
    setTemplateName("");
  };

  const handleDeleteTemplate = (id: string) => {
    persistTemplates(savedTemplates.filter((template) => template.id !== id));
  };

  const insertVariable = (token: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setMessage((current) => `${current}${current.endsWith(" ") || current === "" ? "" : " "}${token}`);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const nextMessage = `${message.slice(0, start)}${token}${message.slice(end)}`;
    setMessage(nextMessage);

    window.requestAnimationFrame(() => {
      textarea.focus();
      const nextCursor = start + token.length;
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold tracking-tight">Mensagens</h2>

      <Card>
        <CardHeader>
          <CardTitle>Enviar Mensagem Geral</CardTitle>
          <CardDescription>Prepare mensagens rápidas para abrir no WhatsApp.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Conteúdo da Mensagem</label>
                <Textarea
                  ref={textareaRef}
                  placeholder="Escreva aqui a mensagem para os jogadores..."
                  className="min-h-[220px]"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium leading-none">Variáveis</p>
                <div className="flex flex-wrap gap-2">
                  {MESSAGE_VARIABLES.map((variable) => (
                    <Button
                      key={variable.token}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => insertVariable(variable.token)}
                    >
                      {variable.token}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
                {MESSAGE_VARIABLES.map((variable) => (
                  <div key={`value-${variable.key}`} className="space-y-1.5">
                    <label className="text-xs font-medium leading-none" htmlFor={`message-variable-${variable.key}`}>
                      {variable.label}
                    </label>
                    <Input
                      id={`message-variable-${variable.key}`}
                      value={variableValues[variable.key]}
                      onChange={(event) => {
                        const value = event.target.value;
                        setVariableValues((current) => ({
                          ...current,
                          [variable.key]: value,
                        }));
                      }}
                      placeholder={variable.placeholder}
                    />
                  </div>
                ))}
              </div>

              <div className="rounded-md border bg-slate-50 p-4 text-sm">
                <p className="mb-2 text-[10px] font-semibold uppercase text-slate-500">Pré-visualização</p>
                <div className="min-h-[72px] whitespace-pre-wrap text-slate-700">
                  {previewMessage || "Sem mensagem."}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium leading-none">Templates</p>
                <div className="space-y-2">
                  {allTemplates.map((template) => (
                    <div key={template.id} className="flex items-center gap-2 rounded-md border bg-background p-2">
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto min-h-10 flex-1 justify-start px-2 text-left"
                        onClick={() => setMessage(template.body)}
                      >
                        <span className="truncate">{template.title}</span>
                      </Button>
                      {template.custom && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0 text-destructive hover:text-destructive"
                          title="Apagar template"
                          aria-label={`Apagar template ${template.title}`}
                          onClick={() => handleDeleteTemplate(template.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2 rounded-md border p-3">
                <label className="text-sm font-medium leading-none" htmlFor="template-name">Guardar template</label>
                <div className="flex gap-2">
                  <Input
                    id="template-name"
                    value={templateName}
                    onChange={(event) => setTemplateName(event.target.value)}
                    placeholder="Nome"
                  />
                  <Button
                    type="button"
                    size="icon"
                    title="Guardar template"
                    aria-label="Guardar template"
                    disabled={!message.trim()}
                    onClick={handleSaveTemplate}
                  >
                    <Save className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <Button
            className="w-full gap-2 bg-orange-600 hover:bg-orange-500 text-white"
            onClick={handleSend}
            disabled={!message.trim()}
          >
            <SiWhatsapp className="w-5 h-5" />
            <span>Gerar Link WhatsApp</span>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
