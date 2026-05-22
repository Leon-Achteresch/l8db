import { useEffect } from "react"
import { useNavigate } from "@tanstack/react-router"

import { useConnectionsStore } from "@/lib/connections"

export function HomeView() {
  const connections = useConnectionsStore((s) => s.connections)
  const navigate = useNavigate()

  useEffect(() => {
    if (connections.length === 0) {
      void navigate({ to: "/connections" })
    }
  }, [connections.length, navigate])

  return <main className="mx-auto flex flex-1 flex-col justify-center text-center" />
}
