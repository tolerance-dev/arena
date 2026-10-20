import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Our type scale (globals.css --text-*) must count as font sizes; otherwise `text-meta` would be read as a colour
// and merged away together with the real text colour.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: ['meta', 'ui', 'body', 'lead', 'title', 'section', 'page'] }] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
