import { toast as base, type ExternalToast } from "sonner";

type Message = Parameters<typeof base>[0];

const place = (data?: ExternalToast, duration?: number): ExternalToast => ({
  position: "bottom-right",
  duration: data?.action ? 10_000 : duration,
  ...data,
});

export const toast = Object.assign(
  (message: Message, data?: ExternalToast) => base(message, place(data)),
  {
    success: (message: Message, data?: ExternalToast) => base.success(message, place(data)),
    error: (message: Message, data?: ExternalToast) => base.error(message, place(data, 8_000)),
    info: (message: Message, data?: ExternalToast) => base.info(message, place(data)),
    warning: (message: Message, data?: ExternalToast) => base.warning(message, place(data)),
  },
);
