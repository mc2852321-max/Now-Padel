import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { SiWhatsapp } from "react-icons/si";
import { useState } from "react";

export default function Messages() {
  const [message, setMessage] = useState("");

  const handleSend = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
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
              onChange={(e) => setMessage(e.target.value)}
            />
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
