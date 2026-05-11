import type React from "react";

export function createWorkspaceThemeStyle(color = "#5aa982"): React.CSSProperties {
  const accent = /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#5aa982";
  return {
    "--workspace-accent": accent,
    "--workspace-bg": mixHex(accent, "#ffffff", 0.86),
    "--workspace-soft": mixHex(accent, "#ffffff", 0.76),
    "--workspace-active": mixHex(accent, "#ffffff", 0.9),
    "--workspace-card-bg": mixHex(accent, "#ffffff", 0.94),
    "--workspace-content-bg": mixHex(accent, "#ffffff", 0.88),
    "--workspace-border": hexToRgba(accent, 0.28),
    "--workspace-shadow": hexToRgba(accent, 0.12)
  } as React.CSSProperties;
}

export function mixHex(color: string, base: string, baseWeight: number) {
  const foreground = hexToRgb(color);
  const background = hexToRgb(base);
  const mix = (channel: keyof typeof foreground) =>
    Math.round(background[channel] * baseWeight + foreground[channel] * (1 - baseWeight));
  return `rgb(${mix("r")}, ${mix("g")}, ${mix("b")})`;
}

export function hexToRgba(color: string, alpha: number) {
  const { r, g, b } = hexToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function hexToRgb(color: string) {
  const value = color.replace("#", "");
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16)
  };
}
