import type { JSX } from 'solid-js'

const Icon = (props: { children: JSX.Element; size?: number }) => (
  <svg
    class="icon"
    width={props.size ?? 18}
    height={props.size ?? 18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {props.children}
  </svg>
)

export const RestartIcon = () => (
  <Icon>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
  </Icon>
)
export const BackIcon = () => (
  <Icon>
    <path d="M15 18l-6-6 6-6" />
  </Icon>
)
export const NextIcon = () => (
  <Icon>
    <path d="M9 18l6-6-6-6" />
  </Icon>
)
export const PlayIcon = () => (
  <Icon>
    <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />
  </Icon>
)
export const PauseIcon = () => (
  <Icon>
    <path d="M8 5v14M16 5v14" stroke-width="2.6" />
  </Icon>
)
export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)
export const MinusIcon = () => (
  <Icon>
    <path d="M5 12h14" />
  </Icon>
)
export const FitIcon = () => (
  <Icon>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Icon>
)
export const CheckIcon = () => (
  <Icon size={14}>
    <path d="M5 12.5l4.5 4.5L19 7.5" stroke-width="2.6" />
  </Icon>
)
export const ChevronIcon = (props: { open: boolean }) => (
  <svg class="icon chevron" classList={{ open: props.open }} width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
)
