import glassModule from "./glass.module.css";

// glass.module.css's class names, typed as plain strings - CSS-module
// lookups are `string | undefined` under noUncheckedIndexedAccess, which
// Mantine's className props (exactOptionalPropertyTypes) won't take.
export const glassClasses = glassModule as Record<
  | "bar"
  | "button"
  | "buttonLabel"
  | "iconButton"
  | "controls"
  | "logoPanel"
  | "navItem"
  | "navItemActive"
  | "menu"
  | "menuItem"
  | "menuDivider",
  string
>;

// Mantine Menu props for a glass dropdown - the pointer arrow is dropped
// since it reads as a seam against a blurred glass panel.
export const glassMenuProps = {
  classNames: {
    dropdown: glassClasses.menu,
    item: glassClasses.menuItem,
    divider: glassClasses.menuDivider,
  },
};
