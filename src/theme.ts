export interface Palette {
  glow?: string;
  secondaryAccent?: string;
  tertiaryAccent?: string;
  background: string;
  surface: string;
  text: string;
  accent: string;
  border: string;
  highlight: string;
}
export interface VisualTheme {
  name: string;
  font: string;
  spacing: number;
  radius: number;
  light: Palette;
  dark: Palette;
}
export const theme: VisualTheme = {
  name: "Super Manual",
  font: "ManualMono",
  spacing: 12,
  radius: 8,
  light: {
    highlight: "#ffffff",
    background: "#d4d1db",
    surface: "#eeedf2",
    text: "#252137",
    accent: "#63419b",
    border: "#92899f",
  },
  dark: {
    highlight: "#736982",
    background: "#201d29",
    surface: "#302b3d",
    text: "#f1eaf9",
    accent: "#b89ae9",
    border: "#685b7c",
  },
};

const readCube: VisualTheme = {
  name: "Read Cube",
  font: "ManualMono",
  spacing: 12,
  radius: 8,
  light: {
    background: "#d3b9f3",
    surface: "#eee4ff",
    text: "#28143e",
    accent: "#006b43",
    secondaryAccent: "#b32235",
    tertiaryAccent: "#805b00",
    border: "#806295",
    highlight: "#ffffff",
  },
  dark: {
    background: "#24123e",
    surface: "#43276c",
    text: "#f5edff",
    accent: "#63e6aa",
    secondaryAccent: "#ff9a9d",
    tertiaryAccent: "#ffda51",
    border: "#b39bd6",
    highlight: "#8767b4",
  },
};

const readStation: VisualTheme = {
  name: "Read Station",
  font: "ManualMono",
  spacing: 12,
  radius: 4,
  light: {
    background: "#c1c7d0",
    surface: "#edf0f4",
    text: "#242b35",
    accent: "#b31937",
    border: "#687380",
    highlight: "#ffffff",
  },
  dark: {
    background: "#171c23",
    surface: "#2b323c",
    text: "#edf0f5",
    accent: "#ff7b8d",
    border: "#919cab",
    highlight: "#596575",
  },
};

const readBox: VisualTheme = {
  name: "Read Box",
  font: "ManualMono",
  spacing: 12,
  radius: 14,
  light: {
    background: "#d2dfc8",
    surface: "#f0f7e9",
    text: "#182614",
    accent: "#286c0b",
    border: "#627954",
    highlight: "#ffffff",
    glow: "#69a82e",
  },
  dark: {
    background: "#060c04",
    surface: "#14200d",
    text: "#e9f7dd",
    accent: "#9aff44",
    border: "#82a16b",
    highlight: "#4b6f31",
    glow: "#79ff22",
  },
};

export const themes: Record<string, VisualTheme> = {
  "super-manual": theme,
  "read-cube": readCube,
  "read-station": readStation,
  "read-box": readBox,
};
