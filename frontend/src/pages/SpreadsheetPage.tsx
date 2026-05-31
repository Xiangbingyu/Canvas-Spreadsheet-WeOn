import { FormulaBar } from '@/components/FormulaBar/FormulaBar'
import { Loading } from '@/components/Loading/Loading'
import { Menubar } from '@/components/Menubar/Menubar'
import { SheetTabs } from '@/components/sheetTabs/SheetTabs'
import { StatusBar } from '@/components/statusBar/StatusBar'
import { Toolbar } from '@/components/Toolbar/Toolbar'
import { CellEditOverlay } from '@/components/cellEditor/CellEditOverlay'
import GrideCanvas from '@/components/grideCanvas/GrideCanvas'
import { useSpreadsheetInteraction } from '@/hooks/useSpreadsheetInteraction'
import { useCommitCell } from '@/hooks/useCommitCell'
import { useUnifiedHistory } from '@/hooks/useUnifiedHistory'

export function SpreadsheetPage() {
  // 单元格提交（协同 WS / 本地兜底，开关在 useCommitCell 内）
  const onCommitCell = useCommitCell()

  // 统一的撤销/重做：支持单元格编辑和行列操作；Ctrl+Z / Ctrl+Shift+Z
  const { commitWithHistory, commitBatchWithHistory, executeRowColWithHistory, undo, redo } =
    useUnifiedHistory(onCommitCell)

  const {
    engine,
    canvasHandleRef,
    editingCell,
    editValue,
    setEditValue,
    textareaRef,
    isComposingRef,
    textareaStyle,
    submitEdit,
    cancelEdit,
    onScrollChange,
    formulaBarValue,
  } = useSpreadsheetInteraction({ onCommitCell: commitWithHistory })

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white font-[Roboto,Arial,sans-serif]">
      <Menubar />
      <Toolbar
        onCommitCell={commitWithHistory}
        onCommitBatch={commitBatchWithHistory}
        onUndo={undo}
        onRedo={redo}
      />
      <FormulaBar value={formulaBarValue} onCommitCell={commitWithHistory} />

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <GrideCanvas
          ref={canvasHandleRef}
          interactionEngine={engine}
          onScrollChange={onScrollChange}
          executeRowColWithHistory={executeRowColWithHistory}
        />

        <CellEditOverlay
          editingCell={editingCell}
          editValue={editValue}
          textareaRef={textareaRef}
          isComposingRef={isComposingRef}
          style={textareaStyle}
          onChange={setEditValue}
          onSubmit={submitEdit}
          onCancel={cancelEdit}
        />

        <Loading visible={false} />
      </div>

      <StatusBar onlineCount={3} userName="演示用户" />
      <SheetTabs />
    </div>
  )
}
