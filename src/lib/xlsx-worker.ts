import { buildXlsx } from "@/lib/xlsx";

self.onmessage = (event: MessageEvent<Parameters<typeof buildXlsx>[0]>) => {
  try {
    const bytes = buildXlsx(event.data);
    self.postMessage({ bytes }, { transfer: [bytes.buffer] });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
