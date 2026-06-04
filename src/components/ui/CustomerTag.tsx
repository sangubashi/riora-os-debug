type Props = {
  label: string
}

export default function CustomerTag({ label }: Props) {
  return (
    <span className="inline-block px-5 py-1.5 bg-white/60 backdrop-blur-md border border-white/70 rounded-3xl text-xs text-[#5C4033] font-medium">
      {label}
    </span>
  )
}
