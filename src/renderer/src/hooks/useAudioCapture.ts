import { useCallback, useEffect, useRef, useState } from 'react'

interface CaptureResources {
  audioContext: AudioContext
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  node: AudioWorkletNode
  gain: GainNode
}

interface UseAudioCaptureResult {
  isCapturing: boolean
  startCapture: (sessionId: string) => Promise<void>
  stopCapture: () => Promise<void>
}

const CAPTURE_SAMPLE_RATE = 16000

export function useAudioCapture(): UseAudioCaptureResult {
  const resourcesRef = useRef<CaptureResources | undefined>(undefined)
  const sessionIdRef = useRef<string | undefined>(undefined)
  const [isCapturing, setIsCapturing] = useState(false)

  const stopCapture = useCallback(async () => {
    const resources = resourcesRef.current
    resourcesRef.current = undefined
    sessionIdRef.current = undefined

    if (!resources) {
      setIsCapturing(false)
      return
    }

    resources.node.port.onmessage = null
    resources.source.disconnect()
    resources.node.disconnect()
    resources.gain.disconnect()
    resources.stream.getTracks().forEach((track) => track.stop())
    await resources.audioContext.close()
    setIsCapturing(false)
  }, [])

  const startCapture = useCallback(
    async (sessionId: string) => {
      await stopCapture()

      if (!('audioWorklet' in AudioContext.prototype)) {
        throw new Error('当前运行环境不支持 AudioWorklet')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })
      const audioContext = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE })

      try {
        await audioContext.audioWorklet.addModule(
          new URL('../audio/pcm-capture-worklet.js', import.meta.url)
        )

        const source = audioContext.createMediaStreamSource(stream)
        const node = new AudioWorkletNode(audioContext, 'pcm-capture-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1]
        })
        const gain = audioContext.createGain()
        gain.gain.value = 0

        sessionIdRef.current = sessionId
        node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
          const activeSessionId = sessionIdRef.current

          if (!activeSessionId) {
            return
          }

          window.appApi.sendAudioChunk({
            sessionId: activeSessionId,
            sampleRate: CAPTURE_SAMPLE_RATE,
            channels: 1,
            format: 'pcm16',
            data: event.data,
            timestamp: Date.now()
          })
        }

        source.connect(node)
        node.connect(gain)
        gain.connect(audioContext.destination)

        resourcesRef.current = {
          audioContext,
          stream,
          source,
          node,
          gain
        }
        setIsCapturing(true)
      } catch (error) {
        stream.getTracks().forEach((track) => track.stop())
        await audioContext.close()
        throw error
      }
    },
    [stopCapture]
  )

  useEffect(() => {
    return () => {
      void stopCapture()
    }
  }, [stopCapture])

  return {
    isCapturing,
    startCapture,
    stopCapture
  }
}
