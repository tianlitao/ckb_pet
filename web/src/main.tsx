import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from '@ckb-ccc/connector-react'
import { ccc } from '@ckb-ccc/ccc'
import './index.css'
import { App } from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider name="PetCell" defaultClient={new ccc.ClientPublicTestnet()}>
      <App />
    </Provider>
  </StrictMode>,
)
