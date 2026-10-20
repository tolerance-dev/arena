import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// Product Hunt's pill buttons: semibold text, 2px grey outline that darkens on hover, colour-only transitions.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full border-2 border-transparent bg-clip-padding font-semibold whitespace-nowrap transition-[background-color,border-color,color] duration-150 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        ink: "bg-ink text-ink-foreground hover:bg-ink/85",
        outline: "border-border bg-card text-foreground hover:border-border-strong hover:bg-muted aria-expanded:bg-muted",
        secondary: "bg-secondary text-secondary-foreground hover:bg-pending aria-expanded:bg-pending",
        ghost: "text-muted-foreground hover:bg-secondary hover:text-foreground aria-expanded:bg-secondary aria-expanded:text-foreground",
        destructive: "bg-destructive/10 text-destructive hover:bg-destructive/15",
        link: "rounded-sm border-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 gap-1.5 px-4 text-body",
        xs: "h-6 gap-1 px-2 text-meta [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-ui [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 px-5 text-title",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
