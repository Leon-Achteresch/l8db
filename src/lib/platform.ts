const platform = typeof navigator !== "undefined" ? navigator.platform : "";

export const IS_MAC = /Mac|iPhone|iPad|iPod/i.test(platform);
export const USE_CUSTOM_WINDOW_CONTROLS = /Win|Linux/i.test(platform);
