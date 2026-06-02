import { useState } from 'react'

export function useDisclosure() {
  const [open, setOpen] = useState(false)
  return {
    open,
    onOpenChange: setOpen,
    onOpen: () => setOpen(true),
    onClose: () => setOpen(false),
  }
}
