"use client";

import { ThemeProvider as NextThemeProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * Class-based theming so both light and dark are first-class, per the design
 * system. `disableTransitionOnChange` stops every colour on the page animating
 * during a toggle, which reads as a glitch rather than a transition.
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemeProvider>) {
  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemeProvider>
  );
}
