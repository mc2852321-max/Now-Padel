const TIMER_WORKER_SOURCE = `
  let intervalId = null;
  self.onmessage = (event) => {
    if (event.data === "stop") {
      if (intervalId !== null) clearInterval(intervalId);
      intervalId = null;
      return;
    }
    if (event.data === "start") {
      if (intervalId !== null) clearInterval(intervalId);
      self.postMessage("tick");
      intervalId = setInterval(() => self.postMessage("tick"), 250);
    }
  };
`;

export function startResilientTicker(onTick: () => void): () => void {
  if (typeof Worker !== "undefined" && typeof Blob !== "undefined" && typeof URL !== "undefined") {
    try {
      const workerUrl = URL.createObjectURL(new Blob([TIMER_WORKER_SOURCE], { type: "text/javascript" }));
      const worker = new Worker(workerUrl);
      worker.onmessage = () => onTick();
      worker.postMessage("start");

      return () => {
        worker.postMessage("stop");
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
      };
    } catch {
      // Fall back to the window timer when workers are blocked by the browser or CSP.
    }
  }

  onTick();
  const intervalId = window.setInterval(onTick, 250);
  return () => window.clearInterval(intervalId);
}
