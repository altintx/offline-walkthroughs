export interface Palette {
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
  radius: 12,
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
