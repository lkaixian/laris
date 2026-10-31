import { createRoot } from 'react-dom/client'
import './theme.css'
import './glass.css'
import App from './App'
import { ErrorBoundary } from './ErrorBoundary'
import { initSkin } from './skin'

initSkin()

// onCaughtError: the boundary logs the error itself (once), so React's duplicate log is off.
createRoot(document.getElementById('root')!, { onCaughtError: () => undefined }).render(<ErrorBoundary level="root"><App /></ErrorBoundary>)
