type Props = {
  name: string
  isVip?: boolean
}

export default function CustomerNameBadge({ name, isVip = false }: Props) {
  return (
    <div className="flex items-center gap-4">
      <p className="text-3xl font-light tracking-[-1px] text-[#5C4033]">
        {name}
      </p>
      {isVip && (
        <div className="px-3 py-1 bg-gradient-to-r from-amber-400 to-yellow-500 text-white text-xs font-medium rounded-full">
          VIP
        </div>
      )}
    </div>
  )
}
