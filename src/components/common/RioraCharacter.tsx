'use client'
import { motion } from 'framer-motion'
import Image from 'next/image'

export type CharacterMode = 'normal' | 'happy' | 'warning'

type Props = {
  mode?: CharacterMode
  size?: number
}

export function RioraCharacter({ mode = 'normal', size = 92 }: Props) {
  const imageSrc =
    mode === 'normal' || mode === 'happy'
      ? '/characters/sunglass-bear.jpg'
      : '/characters/angry-bear.jpg'

  return (
    <motion.div
      animate={{
        scale: mode === 'warning' ? [1, 1.08, 1] : [1, 1.02, 1],
      }}
      transition={{
        duration: mode === 'warning' ? 0.55 : 3,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
      className="relative rounded-3xl bg-white shadow-2xl border border-white/60 overflow-hidden"
      style={{ width: size, height: size }}
    >
      <Image
        src={imageSrc}
        alt="Salon Riora マスコット"
        fill
        className="object-cover p-2"
        priority
      />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/10" />
    </motion.div>
  )
}

export default RioraCharacter
