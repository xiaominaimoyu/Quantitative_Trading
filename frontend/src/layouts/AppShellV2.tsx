/**
 * AppShellV2 — 应用框架 v2
 *
 * 组合 SiderV2 + TopBarV2 + <Outlet>
 * 挂载 CommandPalette（Portal）与 useHotkeys（全局快捷键）
 */

import { useCallback, useMemo, useState } from 'react'
import { Layout, Drawer, Modal } from 'antd'
import { Outlet, useNavigate } from 'react-router'
import { useSiderState } from '@/shared/useSiderState'
import { useHotkeys, HOTKEY_HELP, type HotkeyBinding } from './useHotkeys'
import { SiderV2 } from './SiderV2'
import { TopBarV2 } from './TopBarV2'
import { CommandPalette, type CommandSource } from './CommandPalette'
import { layoutTokens } from '@/theme/tokens/v2'
import { useTheme } from '@/theme'

const { Content } = Layout

interface AppShellV2Props {
  commandSources?: CommandSource[]
  notifications?: import('./NotifyCenter').NotifyItem[]
  tasks?: import('./NotifyCenter').TaskItem[]
  onMarkAllRead?: () => void
  onCancelTask?: (id: string) => void
}

export default function AppShellV2({
  commandSources = [],
  notifications = [],
  tasks = [],
  onMarkAllRead = () => {},
  onCancelTask,
}: AppShellV2Props) {
  const navigate = useNavigate()
  const { mode, userMode, toggle } = useSiderState()
  const { toggleUi } = useTheme()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const collapsed = userMode === 'collapsed'

  const hotkeys = useMemo<HotkeyBinding[]>(
    () => [
      { keys: 'mod k', handler: () => setPaletteOpen(true), disabledInInput: true },
      { keys: '[', handler: toggle, disabledInInput: true },
      { keys: 'g d', handler: () => navigate('/'), disabledInInput: true },
      { keys: 'g e', handler: () => navigate('/experiments'), disabledInInput: true },
      { keys: 'g s', handler: () => navigate('/strategies'), disabledInInput: true },
      { keys: 'g r', handler: () => navigate('/reports'), disabledInInput: true },
      { keys: 'g k', handler: () => navigate('/risk'), disabledInInput: true },
      { keys: 'g a', handler: () => navigate('/audit'), disabledInInput: true },
      { keys: '?', handler: () => setHelpOpen(true), disabledInInput: true },
      { keys: 't', handler: toggleUi, disabledInInput: true },
    ],
    [navigate, toggle, toggleUi],
  )

  useHotkeys(hotkeys)

  const handleToggleSider = useCallback(() => {
    if (mode === 'hidden') {
      setDrawerOpen(true)
    } else {
      toggle()
    }
  }, [mode, toggle])

  return (
    <Layout style={{ minHeight: '100vh', background: 'var(--bg-page)' }}>
      <a href="#main-content" className="qt-skip-link">
        跳转到主内容
      </a>

      {mode !== 'hidden' && (
        <SiderV2 collapsed={collapsed} onToggle={toggle} />
      )}

      {mode === 'hidden' && (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          placement="left"
          width={layoutTokens.siderWidth}
          styles={{ body: { padding: 0, background: 'var(--bg-container)' } }}
        >
          <SiderV2 collapsed={false} onToggle={() => setDrawerOpen(false)} />
        </Drawer>
      )}

      <Layout style={{ background: 'var(--bg-page)' }}>
        <TopBarV2
          onToggleSider={handleToggleSider}
          onOpenCommandPalette={() => setPaletteOpen(true)}
          notifications={notifications}
          tasks={tasks}
          onMarkAllRead={onMarkAllRead}
          onCancelTask={onCancelTask}
        />

        <Content id="main-content" tabIndex={-1}>
          <div
            style={{
              padding: 'var(--space-lg) var(--space-xl) var(--space-3xl)',
              maxWidth: 'var(--content-max-width)',
              width: '100%',
              margin: '0 auto',
            }}
          >
            <Outlet />
          </div>
        </Content>
      </Layout>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        sources={commandSources}
      />

      <Modal
        open={helpOpen}
        onCancel={() => setHelpOpen(false)}
        title="快捷键一览"
        footer={null}
        width={480}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {HOTKEY_HELP.map((h) => (
              <tr key={h.keys}>
                <td
                  style={{
                    padding: '6px 0',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--color-primary)',
                    width: 120,
                  }}
                >
                  {h.keys}
                </td>
                <td style={{ padding: '6px 0', color: 'var(--text-primary)' }}>{h.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Modal>
    </Layout>
  )
}