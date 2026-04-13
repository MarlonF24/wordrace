import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const FALSY_VALUES = new Set<unknown>([false, null, undefined, "", " ", "[]", "{}"]);

export function isFalsy(value: unknown): boolean {
    if (FALSY_VALUES.has(value)) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object" && value !== null) return Object.keys(value).length === 0;
    return !value;
}