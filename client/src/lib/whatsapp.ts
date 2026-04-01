function normalizeWhatsAppMessage(message: string) {
  return message.normalize("NFC").replace(/\r\n/g, "\n");
}

export function openWhatsAppGeneral(message: string): Window | null {
  const encodedMessage = encodeURIComponent(normalizeWhatsAppMessage(message));
  return window.open(`https://wa.me/?text=${encodedMessage}`, "_blank");
}

export function openWhatsApp(phone: string, message: string, windowRef?: { current: Window | null }): Window | null {
  const encodedMessage = encodeURIComponent(normalizeWhatsAppMessage(message));
  const cleanPhone = phone.replace(/\D/g, '');
  
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  
  if (isMobile) {
    const url = `https://wa.me/${cleanPhone}?text=${encodedMessage}`;
    const win = window.open(url, 'whatsapp_tab');
    if (windowRef) windowRef.current = win;
    return win;
  }
  
  const appUrl = `whatsapp://send?phone=${cleanPhone}&text=${encodedMessage}`;
  const webUrl = `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodedMessage}`;
  
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  document.body.appendChild(iframe);
  
  const startTime = Date.now();
  let opened = false;
  
  const handleBlur = () => {
    opened = true;
    window.removeEventListener('blur', handleBlur);
  };
  
  window.addEventListener('blur', handleBlur);
  
  try {
    iframe.contentWindow?.location.replace(appUrl);
  } catch (e) {
    // Protocol not supported
  }
  
  setTimeout(() => {
    document.body.removeChild(iframe);
    window.removeEventListener('blur', handleBlur);
    
    if (!opened && Date.now() - startTime < 1500) {
      const win = window.open(webUrl, 'whatsapp_tab');
      if (windowRef) windowRef.current = win;
    }
  }, 1000);
  
  return null;
}
