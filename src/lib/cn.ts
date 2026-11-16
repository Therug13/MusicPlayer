import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const tap =
  "transition-transform duration-150 ease-out active:not-disabled:scale-[0.96]";
