import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { SiWhatsapp } from "react-icons/si";
import { useRef, useState } from "react";
import { openWhatsAppGeneral } from "@/lib/whatsapp";

const QUICK_EMOJIS = [
  0x1f600,
  0x1f609,
  0x1f44d,
  0x1f3be,
  0x1f525,
  0x2705,
  0x23f0,
  0x1f4e3,
  0x1f4aa,
  0x1f64f,
].map((codePoint) => String.fromCodePoint(codePoint));

export default function Messages() {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleSend = () => {
    openWhatsAppGeneral(message);
  };

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;

    if (!el) {
      setMessage((prev) => `${prev}${emoji}`);
      return;
    }

    const start = el.selectionStart ?? message.length;
    const end = el.selectionEnd ?? start;
    const nextValue = `${message.slice(0, start)}${emoji}${message.slice(end)}`;

    setMessage(nextValue);

    requestAnimationFrame(() => {
      const nextPos = start + emoji.length;
      el.focus();
      el.setSelectionRange(nextPos, nextPos);
    });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold tracking-tight">Mensagens</h2>
      
      <Card>
        <CardHeader>
          <CardTitle>Enviar Mensagem Geral</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none">Conteúdo da Mensagem</label>
            <Textarea 
              placeholder="Escreva aqui a mensagem para os jogadores..." 
              className="min-h-[200px]"
              value={message}
              ref={textareaRef}
              onChange={(e) => setMessage(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Emojis rápidos:</span>
              {QUICK_EMOJIS.map((emoji) => (
                <Button
                  key={emoji}
                  type="button"
                  variant="outline"
                  className="h-8 min-w-8 px-2 text-base"
                  onClick={() => insertEmoji(emoji)}
                  title={`Inserir ${emoji}`}
                >
                  {emoji}
                </Button>
              ))}
            </div>
          </div>
          <Button 
            className="w-full gap-2 bg-orange-600 hover:bg-orange-500 text-white"
            onClick={handleSend}
            disabled={!message}
          >
            <SiWhatsapp className="w-5 h-5" />
            <span>Gerar Link WhatsApp</span>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
