import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Junta classes resolvendo conflito do Tailwind (padrão shadcn). */
export const cn = (...classes: ClassValue[]): string => twMerge(clsx(classes));
