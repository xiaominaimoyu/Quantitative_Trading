import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { App as AntApp } from 'antd'
import { router } from '@/router'
import { AppProviders } from '@/app/AppProviders'
import '@/shared/dayjs'
import '@/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <AntApp style={{ height: '100%' }}>
        <RouterProvider router={router} />
      </AntApp>
    </AppProviders>
  </StrictMode>,
)
