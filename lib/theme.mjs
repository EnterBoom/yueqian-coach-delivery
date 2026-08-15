export const THEME_STORAGE_KEY = "yueqian-theme";

export function isThemePreference(value) {
  return value === "system" || value === "light" || value === "dark";
}

export function resolveTheme(preference, systemDark) {
  return preference === "dark" || (preference === "system" && systemDark) ? "dark" : "light";
}
