import { RioraCharacter } from '@/components/common/RioraCharacter'

type Suggestion = {
  today_goal: string
}

type Props = {
  suggestion: Suggestion
}

export default function AISuggestionCard({ suggestion }: Props) {
  return (
    <div className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-3xl p-7 shadow-2xl shadow-black/5">
      <div className="flex items-start gap-5">
        <RioraCharacter mode="normal" size={78} />
        <div className="flex-1 pt-2">
          <p className="text-[#9F7E6C] text-xs tracking-widest mb-1">AI ADVICE</p>
          <p className="text-[#5C4033] leading-relaxed text-[15.5px]">{suggestion.today_goal}</p>
        </div>
      </div>
    </div>
  )
}
