import { useEffect, useRef, useState } from 'react'
import { CollabClient } from './CollabClient'
import type { CollabCallbacks } from './CollabClient'
import type { UserInfo } from './protocol'
import { LocalStubServer } from './LocalStubServer_test'

export function CollabTestPanel() {
  const [logs, setLogs] = useState<string[]>([])
  const serverRef = useRef<LocalStubServer>()
  const aliceRef = useRef<CollabClient>()
  const bobRef = useRef<CollabClient>()

  const addLog = (msg: string) =>
    setLogs((prev) => [...prev.slice(-99), `${new Date().toLocaleTimeString()} ${msg}`])

  const makeCallbacks = (name: string): CollabCallbacks => ({
    onSnapshot: (_, seq) => addLog(`${name}: snapshot loaded (seq=${seq})`),
    onCellUpdated: (d) => addLog(`${name}: cell [${d.row},${d.col}] = "${d.value}"`),
    onSheetImported: () => addLog(`${name}: sheet imported`),
    onUndoApplied: (d) => addLog(`${name}: undo → [${d.row},${d.col}] = "${d.value}"`),
    onRedoApplied: (d) => addLog(`${name}: redo → [${d.row},${d.col}] = "${d.value}"`),
    onPresence: (users: UserInfo[]) =>
      addLog(`${name}: online: ${users.map((u) => u.name).join(', ')}`),
    onError: (code, msg) => addLog(`${name}: ERROR ${code} - ${msg}`),
    onConnectionChange: (s) => addLog(`${name}: ${s}`),
  })

  const startTest = () => {
    setLogs([])
    const server = new LocalStubServer()
    serverRef.current = server

    const alice = server.createClient('u1', 'Alice', '#ff0000', makeCallbacks('Alice'))
    const bob = server.createClient('u2', 'Bob', '#00ff00', makeCallbacks('Bob'))

    aliceRef.current = alice
    bobRef.current = bob
  }

  useEffect(
    () => () => {
      aliceRef.current?.disconnect()
      bobRef.current?.disconnect()
    },
    []
  )

  return (
    <div style={{ padding: 20, fontFamily: 'monospace', fontSize: 13 }}>
      <h2>Collab 自测 (LocalStubServer)</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={startTest}>1. Start</button>
        <button onClick={() => aliceRef.current?.setCell(1, 1, 'hello')}>2. Alice A1=hello</button>
        <button onClick={() => bobRef.current?.setCell(1, 1, 'world')}>
          3. Bob A1=world (LWW)
        </button>
        <button onClick={() => aliceRef.current?.undo()}>4. Alice undo</button>
        <button onClick={() => aliceRef.current?.redo()}>5. Alice redo</button>
        <button
          onClick={() => {
            aliceRef.current?.disconnect()
            bobRef.current?.disconnect()
            addLog('--- done ---')
          }}
        >
          Cleanup
        </button>
      </div>

      <div
        style={{
          background: '#1e1e1e',
          color: '#d4d4d4',
          padding: 12,
          borderRadius: 6,
          maxHeight: 500,
          overflow: 'auto',
        }}
      >
        {logs.length === 0 && <div style={{ color: '#888' }}>Click Start</div>}
        {logs.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  )
}
