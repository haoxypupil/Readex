export interface TtsVoiceOption {
  id: string
  label: string
}

export const TTS_VOICES: readonly TtsVoiceOption[] = [
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 女声' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊 · 女声' },
  { id: 'zh-CN-YunxiNeural', label: '云希 · 男声' },
  { id: 'zh-CN-YunjianNeural', label: '云健 · 男声' }
] as const

export const DEFAULT_TTS_VOICE = TTS_VOICES[0].id
export const DEFAULT_TTS_RATE = 1
export const DEFAULT_TTS_VOLUME = 1
export const TTS_MIN_RATE = 0.6
export const TTS_MAX_RATE = 2
export const TTS_MIN_VOLUME = 0
export const TTS_MAX_VOLUME = 1
export const TTS_MAX_TEXT_LENGTH = 4000

export type TtsEngine = 'online' | 'system'

export interface SystemVoiceLike {
  name: string
  lang: string
}

/** 优先使用用户选中的系统语音，其次中文语音，最后回退到第一个可用语音。 */
export function selectSystemVoice(
  voices: readonly SystemVoiceLike[],
  preferred?: string
): SystemVoiceLike | null {
  if (!voices.length) return null
  const wanted = preferred?.trim()
  return (
    (wanted ? voices.find((voice) => voice.name === wanted) : undefined) ??
    voices.find((voice) => /^zh(-|_)/i.test(voice.lang)) ??
    voices.find((voice) => /^zh/i.test(voice.lang)) ??
    voices[0]
  )
}

export interface TtsSynthesisRequest {
  text: string
  voice: string
  rate: number
  volume: number
}

export interface TtsCue {
  part: string
  start: number
  end: number
}

export interface TtsSynthesisResult {
  audio: Uint8Array
  cues: TtsCue[]
  cached: boolean
}
