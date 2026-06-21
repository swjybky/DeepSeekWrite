import { useCallback, useRef, useState } from 'react'
import {
  AppDialog,
  type AppDialogOptions,
  type PendingDialog,
} from './AppDialog'

export function useAppDialog() {
  const [pending, setPending] = useState<PendingDialog | null>(null)
  const resolverRef = useRef<((value: boolean) => void) | null>(null)
  const idRef = useRef(0)

  const close = useCallback((value: boolean) => {
    resolverRef.current?.(value)
    resolverRef.current = null
    setPending(null)
  }, [])

  const confirm = useCallback((options: AppDialogOptions) => {
    resolverRef.current?.(false)
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
      idRef.current += 1
      setPending({ id: idRef.current, options })
    })
  }, [])

  const alert = useCallback(
    (options: Omit<AppDialogOptions, 'hideCancel' | 'cancelText'>) =>
      confirm({
        ...options,
        confirmText: options.confirmText ?? '知道了',
        hideCancel: true,
      }),
    [confirm],
  )

  const dialog = pending ? (
    <AppDialog
      pending={pending}
      onCancel={() => close(false)}
      onConfirm={() => close(true)}
    />
  ) : null

  return { alert, confirm, dialog }
}
