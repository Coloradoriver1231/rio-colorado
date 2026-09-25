import { Component, type ReactNode } from "react";

/** Si una pestaña falla, muestra el error en vez de dejar la página en blanco. */
export default class Boundary extends Component<{ children: ReactNode; name: string }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidUpdate(prev: { name: string }) { if (prev.name !== this.props.name && this.state.err) this.setState({ err: null }); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <section className="card">
        <h2>Esta sección no se pudo mostrar</h2>
        <p className="note warn">Error: {this.state.err.message}. Las demás pestañas siguen funcionando. Probá recargar la página; si sigue, mandame este mensaje.</p>
      </section>
    );
  }
}
