/**
 * Wrapper fino de `@radix-ui/react-popover` (SPEC-006 — painel do sino).
 * Elevação nível 3 do design system: `--popover` + borda 1px + sombra
 * (TOKENS.md, "Dropdown, popover").
 */
'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';

import { cn } from '@/lib/cn';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export const PopoverContent = ({
  className,
  align = 'end',
  sideOffset = 8,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 rounded-md border border-border bg-popover text-popover-foreground shadow-lg outline-none',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
);
