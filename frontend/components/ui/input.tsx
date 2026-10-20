import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

// The class for selects and file inputs, so every control matches the text field.
export const fieldClass =
  "h-8 w-full min-w-0 rounded-md border border-input bg-card px-2.5 text-body transition-colors outline-none placeholder:text-faint focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return <InputPrimitive type={type} data-slot="input" className={cn(fieldClass, className)} {...props} />
}

export { Input }
