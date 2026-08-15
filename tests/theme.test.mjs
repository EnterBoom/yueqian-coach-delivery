import assert from "node:assert/strict";
import test from "node:test";
import { isThemePreference, resolveTheme, THEME_STORAGE_KEY } from "../lib/theme.mjs";

test("theme preference follows the system until the user overrides it", () => {
  assert.equal(THEME_STORAGE_KEY, "yueqian-theme");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(isThemePreference("system"), true);
  assert.equal(isThemePreference("unknown"), false);
});
