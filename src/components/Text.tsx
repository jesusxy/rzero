import { For } from 'solid-js'

const HYPHENATED = /([A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)/

export function Text(props: { value: string | undefined }) {
  const parts = () => (props.value ?? '').split(HYPHENATED)
  return <For each={parts()}>{(part, i) => (i() % 2 === 1 ? <span class="nowrap">{part}</span> : part)}</For>
}
