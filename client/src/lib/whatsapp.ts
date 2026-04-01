function stripInvalidSurrogates(value: string) {
  let result = "";

  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += value[i] + value[i + 1];
        i++;
      }
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      continue;
    }

    result += value[i];
  }

  return result;
}

function stripEmojiAndReplacementChars(value: string) {
  return value
    .replace(/\uFFFD/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "");
}

function normalizeWhatsAppMessage(message: string) {
  return stripEmojiAndReplacementChars(stripInvalidSurrogates(message))
    .normalize("NFC")
    .replace(/\r\n/g, "\n");
}

function encodeWhatsAppMessage(message: string) {
  return encodeURIComponent(normalizeWhatsAppMessage(message));
}

export function openWhatsAppGeneral(message: string): Window | null {
  const encodedMessage = encodeWhatsAppMessage(message);
  return window.open(`https://wa.me/?text=${encodedMessage}`, "_blank");
}

export function openWhatsApp(phone: string, message: string, windowRef?: { current: Window | null }): Window | null {
  const encodedMessage = encodeWhatsAppMessage(message);
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
