import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }

type State = { error: Error | null }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[DeepWrite] UI error', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="editor-wrap" role="alert">
          <p className="editor-error">界面加载出错</p>
          <p className="muted" style={{ marginTop: '0.75rem', whiteSpace: 'pre-wrap' }}>
            {this.state.error.message}
          </p>
        </div>
      )
    }
    return this.props.children
  }
}
